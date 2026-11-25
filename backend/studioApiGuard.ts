/**
 * File Description: Local-first network binding, CORS allowlisting, and request guard for the Aideos Studio HTTP API.
 * Inputs and outputs: incoming HTTP request metadata, pathname, and process env -> host bind setting, allowlisted CORS origin, and allow/403 guard decision.
 * Used by: editor/vite.config.ts, backend/studioApiGuard.test.ts.
 */

import { environment } from "./env";

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

/** Minimal request shape needed by the Studio API guard (works for Node IncomingMessage and unit tests). */
export interface StudioGuardRequest {
  method?: string;
  headers: IncomingHttpHeaders;
  socket?: { remoteAddress?: string | undefined } | null;
}

/** Result of evaluating whether a request may reach a Studio API route. */
export type StudioGuardDecision =
  | { allow: true }
  | { allow: false; status: 403; error: string; code: "local_studio_required" | "origin_not_allowed" };

/** Optional overrides for CORS headers emitted on allowlisted origins. */
export interface CorsHeaderOptions {
  methods?: string;
  headers?: string;
  exposeHeaders?: string;
}

const DEFAULT_STUDIO_HOST = "127.0.0.1";
const DEFAULT_CORS_METHODS = "GET, POST, PUT, DELETE, OPTIONS, HEAD";
const DEFAULT_CORS_HEADERS =
  "Content-Type, Range, Authorization, Accept, X-Requested-With, X-Aideos-Owner, Mcp-Session-Id, Mcp-Protocol-Version";

const IPV4_LOOPBACK = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_MAPPED_LOOPBACK = /^::ffff:127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD"]);
const ACCEPTANCE_ROUTE = /^\/api\/acceptance\/[a-z0-9-]+$/;
const REEL_ROUTE = /^\/api\/reel\/[a-z0-9-]+$/;
const EXPORT_ROUTE = /^\/api\/export(?:\/[a-z0-9-]+\/cancel)?$/;

// Reads a single-valued HTTP header as a trimmed string, or undefined when absent.
function singleHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value) && value.length > 0) return value[0]?.trim() || undefined;
  return undefined;
}

// Returns the host the Studio dev/preview server binds: loopback by default, explicit HOST opt-in otherwise.
export function resolveStudioHost(env: NodeJS.ProcessEnv = environment): string {
  const configured = env.HOST?.trim();
  return configured ? configured : DEFAULT_STUDIO_HOST;
}

// Returns the Vite allowedHosts list for hosted Render/custom domains without opening CORS.
export function resolveAllowedHosts(env: NodeJS.ProcessEnv = environment): string[] {
  const extras = (env.AIDEOS_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set([".onrender.com", ...extras]));
}

// Parses a strict serialized http(s) origin (scheme + host + optional port, no credentials or path).
export function parseHttpOrigin(raw: string | undefined): URL | null {
  if (!raw || /\s/.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.origin === "null" || parsed.origin !== raw) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Parses an HTTP Host or X-Forwarded-Host header into a URL for exact origin comparison.
export function parseHostHeader(raw: string | undefined, protocol: "http:" | "https:" = "http:"): URL | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  if (!first || /[\s@/?#]/.test(first)) return null;
  try {
    const parsed = new URL(`${protocol}//${first}`);
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Returns true when an IP address belongs to the local loopback interface.
export function isLoopbackIp(raw: string | undefined): boolean {
  if (!raw) return false;
  const peer = raw.trim().toLowerCase().split("%")[0];
  return peer === "::1" || IPV4_LOOPBACK.test(peer) || IPV6_MAPPED_LOOPBACK.test(peer);
}

// Returns true when a URL hostname refers to loopback (localhost, *.localhost, 127.0.0.0/8, ::1).
export function isLoopbackHostname(raw: string): boolean {
  const hostname = raw.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1" || IPV4_LOOPBACK.test(hostname);
}

// Returns true when reverse-proxy forwarding headers are present, indicating the caller is not directly local.
export function hasProxyForwardingHeaders(req: StudioGuardRequest): boolean {
  return Boolean(
    singleHeader(req.headers, "x-forwarded-for") ||
      singleHeader(req.headers, "x-forwarded-host") ||
      singleHeader(req.headers, "forwarded"),
  );
}

// Builds the explicit set of allowed non-local origins from AIDEOS_ALLOWED_ORIGINS and AIDEOS_PUBLIC_API_URL.
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = environment): Set<string> {
  const allowed = new Set<string>();
  const rawOrigins = (env.AIDEOS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const candidate of rawOrigins) {
    const parsed = parseHttpOrigin(candidate);
    if (parsed) allowed.add(parsed.origin);
  }
  const publicApi = env.AIDEOS_PUBLIC_API_URL?.trim();
  if (publicApi) {
    try {
      const parsed = new URL(publicApi);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin !== "null") {
        allowed.add(parsed.origin);
      }
    } catch {
      // Ignore malformed public API URL when building the CORS allowlist.
    }
  }
  return allowed;
}

// Checks whether a hostname matches an explicitly configured host rule in AIDEOS_ALLOWED_HOSTS.
function matchesConfiguredHost(hostname: string, env: NodeJS.ProcessEnv): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  const configured = (env.AIDEOS_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return configured.some((rule) => {
    if (rule.startsWith(".")) {
      const suffix = rule.slice(1);
      return normalized === suffix || normalized.endsWith(rule);
    }
    return normalized === rule;
  });
}

// Checks whether a request targets a loopback Host header (as opposed to a hosted domain).
function isLoopbackHostRequest(req: StudioGuardRequest): boolean {
  const hostOrigin = parseHostHeader(singleHeader(req.headers, "host"), "http:");
  return hostOrigin !== null && isLoopbackHostname(hostOrigin.hostname);
}

// Checks that a request comes directly from a loopback Studio page on the exact same local origin.
export function isLocalStudioRequest(req: StudioGuardRequest): boolean {
  if (!isLoopbackIp(req.socket?.remoteAddress)) return false;
  if (hasProxyForwardingHeaders(req)) return false;

  const fetchSite = singleHeader(req.headers, "sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") return false;

  const requestOrigin = parseHostHeader(singleHeader(req.headers, "host"), "http:");
  const origin = parseHttpOrigin(singleHeader(req.headers, "origin"));
  if (!requestOrigin || !origin) return false;

  return (
    origin.protocol === "http:" &&
    isLoopbackHostname(requestOrigin.hostname) &&
    isLoopbackHostname(origin.hostname) &&
    origin.origin === requestOrigin.origin
  );
}

// Resolves the exact allowlisted CORS origin to echo for a request, or null when no CORS grant applies.
export function resolveAllowedCorsOrigin(
  req: StudioGuardRequest,
  env: NodeJS.ProcessEnv = environment,
): string | null {
  const origin = parseHttpOrigin(singleHeader(req.headers, "origin"));
  if (!origin) return null;

  // Local Studio requests only ever allow their own exact loopback origin, never hosted/external origins.
  if (isLoopbackHostRequest(req)) {
    return isLocalStudioRequest(req) ? origin.origin : null;
  }

  // Hosted deployments allow explicitly configured origins and exact HTTPS self-origin requests.
  if (resolveAllowedOrigins(env).has(origin.origin)) {
    return origin.origin;
  }

  const hostHttpsOrigin = parseHostHeader(singleHeader(req.headers, "host"), "https:");
  if (origin.protocol === "https:" && hostHttpsOrigin && origin.origin === hostHttpsOrigin.origin) {
    return origin.origin;
  }

  const forwardedHost = singleHeader(req.headers, "x-forwarded-host");
  const forwardedHttpsOrigin = parseHostHeader(forwardedHost, "https:");
  if (
    origin.protocol === "https:" &&
    forwardedHttpsOrigin &&
    origin.origin === forwardedHttpsOrigin.origin &&
    matchesConfiguredHost(forwardedHttpsOrigin.hostname, env)
  ) {
    return origin.origin;
  }

  return null;
}

// Checks whether a hosted Studio browser request (direct Render or Vercel same-origin rewrite) is permitted for hosted-safe routes.
function isAllowedHostedStudioBrowserRequest(
  req: StudioGuardRequest,
  env: NodeJS.ProcessEnv = environment,
): boolean {
  const fetchSite = singleHeader(req.headers, "sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return false;

  const originHeader = singleHeader(req.headers, "origin");
  if (!originHeader) return true;

  const origin = parseHttpOrigin(originHeader);
  if (!origin) return false;

  if (resolveAllowedCorsOrigin(req, env) !== null) return true;

  // Vercel rewrites forward the browser's same-origin HTTPS host in X-Forwarded-Host.
  const forwardedHttpsOrigin = parseHostHeader(singleHeader(req.headers, "x-forwarded-host"), "https:");
  return (
    origin.protocol === "https:" &&
    forwardedHttpsOrigin !== null &&
    origin.origin === forwardedHttpsOrigin.origin
  );
}

// Appends a header token to Vary without overwriting existing Vary tokens.
function appendVaryHeader(res: ServerResponse, token: string): void {
  const current = res.getHeader("Vary");
  if (!current) {
    res.setHeader("Vary", token);
    return;
  }
  const existing = String(current)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!existing.some((part) => part.toLowerCase() === token.toLowerCase())) {
    res.setHeader("Vary", [...existing, token].join(", "));
  }
}

// Applies strict allowlist-only CORS headers to a response and returns the granted origin (or null).
export function applyStudioCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  options: CorsHeaderOptions = {},
  env: NodeJS.ProcessEnv = environment,
): string | null {
  appendVaryHeader(res, "Origin");
  const allowedOrigin = resolveAllowedCorsOrigin(req, env);
  if (!allowedOrigin) return null;

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", options.methods ?? DEFAULT_CORS_METHODS);
  res.setHeader("Access-Control-Allow-Headers", options.headers ?? DEFAULT_CORS_HEADERS);
  if (options.exposeHeaders) {
    res.setHeader("Access-Control-Expose-Headers", options.exposeHeaders);
  }
  return allowedOrigin;
}

// Chooses the Cross-Origin-Resource-Policy header for streamed media assets: same-origin by default.
export function resolveResourcePolicy(req: StudioGuardRequest, allowedOrigin: string | null): "same-origin" | "cross-origin" {
  if (!allowedOrigin) return "same-origin";
  const httpSelf = parseHostHeader(singleHeader(req.headers, "host"), "http:")?.origin;
  const httpsSelf = parseHostHeader(singleHeader(req.headers, "host"), "https:")?.origin;
  if (allowedOrigin === httpSelf || allowedOrigin === httpsSelf) return "same-origin";
  return "cross-origin";
}

// Picks a clear, route-specific error message when a non-local caller is refused on a guarded Studio route.
function localGuardMessage(pathname: string): string {
  if (pathname === "/api/generate-voiceover") {
    return "Voiceover synthesis is only available to the local Studio page.";
  }
  if (EXPORT_ROUTE.test(pathname)) {
    return "Video exports are only available to the local Studio page.";
  }
  if (REEL_ROUTE.test(pathname)) {
    return "Reel rebuilds are only available to the local Studio page.";
  }
  return "Write requests are only available to the local Studio page.";
}

// Enforces fail-closed local-Studio access across all mutating, voice synthesis, and export API routes.
export function guardStudioApiRequest(
  req: StudioGuardRequest,
  pathname: string,
  env: NodeJS.ProcessEnv = environment,
): StudioGuardDecision {
  if (!pathname.startsWith("/api/")) return { allow: true };

  const method = (req.method ?? "GET").toUpperCase();
  if (method === "OPTIONS") return { allow: true };

  // Safe read methods remain open to read (CORS allowlist still prevents foreign web pages from reading them).
  if (SAFE_HTTP_METHODS.has(method)) {
    return { allow: true };
  }

  // Token- or pairing-code-authenticated agent-link CLI and MCP endpoints must remain reachable by `aideos connect`
  // and paired MCP agents (which send no Origin), while still rejecting foreign browser Origins.
  if (
    method === "POST" &&
    (pathname === "/api/agent-link/claim" || pathname === "/api/agent-link/result" || pathname === "/api/mcp")
  ) {
    if (singleHeader(req.headers, "origin") && resolveAllowedCorsOrigin(req, env) === null) {
      return {
        allow: false,
        status: 403,
        code: "origin_not_allowed",
        error: "Origin is not allowed by Aideos Studio.",
      };
    }
    return { allow: true };
  }

  // Hosted-safe browser routes (agent pairing/disconnect and read-only acceptance hash check) stay functional
  // on hosted Studio (Render/Vercel) while refusing foreign origins on both local and hosted deployments.
  const isHostedSafeBrowserRoute =
    (method === "POST" && pathname === "/api/agent-link/pair") ||
    (method === "DELETE" && pathname === "/api/agent-link") ||
    (method === "POST" && ACCEPTANCE_ROUTE.test(pathname));

  if (isHostedSafeBrowserRoute) {
    const allowed = isLoopbackHostRequest(req)
      ? isLocalStudioRequest(req)
      : isAllowedHostedStudioBrowserRequest(req, env);
    if (!allowed) {
      return {
        allow: false,
        status: 403,
        code: "origin_not_allowed",
        error: "Origin is not allowed by Aideos Studio.",
      };
    }
    return { allow: true };
  }

  // Default fail-closed rule: every mutating, voice synthesis, export, and agent-dispatch route requires a local Studio page.
  if (!isLocalStudioRequest(req)) {
    return {
      allow: false,
      status: 403,
      code: "local_studio_required",
      error: localGuardMessage(pathname),
    };
  }

  return { allow: true };
}
