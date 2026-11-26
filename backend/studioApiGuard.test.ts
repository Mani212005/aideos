/**
 * File Description: Unit and end-to-end behavioural tests for the Studio local API guard, loopback host default, and CORS allowlist.
 * Inputs and outputs: synthetic HTTP requests and a live local Studio dev server -> assertions verifying foreign/non-local writes are refused and local/agent-link flows work.
 * Used by: npm test, npm run ci (unit job).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startEditor } from "./testSupport/studioDriver";
import {
  guardStudioApiRequest,
  isLocalStudioRequest,
  resolveAllowedCorsOrigin,
  resolveAllowedHosts,
  resolveStudioHost,
  type StudioGuardRequest,
} from "./studioApiGuard";

// Builds a minimal request object for pure guard unit tests.
function fakeReq(
  overrides: {
    method?: string;
    remoteAddress?: string;
    headers?: Record<string, string | undefined>;
  } = {},
): StudioGuardRequest {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides.headers ?? {})) {
    if (value !== undefined) headers[key.toLowerCase()] = value;
  }
  return {
    method: overrides.method ?? "POST",
    headers,
    socket: { remoteAddress: overrides.remoteAddress ?? "127.0.0.1" },
  };
}

test("resolveStudioHost binds loopback 127.0.0.1 by default and honors explicit HOST opt-in", () => {
  assert.equal(resolveStudioHost({}), "127.0.0.1");
  assert.equal(resolveStudioHost({ HOST: "   " }), "127.0.0.1");
  assert.equal(resolveStudioHost({ HOST: "0.0.0.0" }), "0.0.0.0");
  assert.equal(resolveStudioHost({ HOST: " 192.168.1.20 " }), "192.168.1.20");
});

test("resolveAllowedHosts keeps Render default and trims AIDEOS_ALLOWED_HOSTS", () => {
  assert.deepEqual(resolveAllowedHosts({}), [".onrender.com"]);
  assert.deepEqual(
    resolveAllowedHosts({ AIDEOS_ALLOWED_HOSTS: "studio.example.com, .onrender.com , preview.example.com" }),
    [".onrender.com", "studio.example.com", "preview.example.com"],
  );
});

test("isLocalStudioRequest accepts direct same-origin loopback requests and rejects foreign, missing-origin, non-loopback, or proxied requests", () => {
  assert.equal(
    isLocalStudioRequest(
      fakeReq({
        remoteAddress: "127.0.0.1",
        headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001", "sec-fetch-site": "same-origin" },
      }),
    ),
    true,
  );
  assert.equal(
    isLocalStudioRequest(
      fakeReq({
        remoteAddress: "::1",
        headers: { host: "localhost:3001", origin: "http://localhost:3001" },
      }),
    ),
    true,
  );
  assert.equal(
    isLocalStudioRequest(
      fakeReq({
        remoteAddress: "::ffff:127.0.0.1",
        headers: { host: "[::1]:3001", origin: "http://[::1]:3001" },
      }),
    ),
    true,
  );

  // Foreign web origin, missing origin, null origin, mismatched port, and non-loopback peer must all fail.
  const rejected: Array<[string, StudioGuardRequest]> = [
    ["foreign origin", fakeReq({ headers: { host: "127.0.0.1:3001", origin: "https://evil.example" } })],
    ["missing origin", fakeReq({ headers: { host: "127.0.0.1:3001" } })],
    ["null origin", fakeReq({ headers: { host: "127.0.0.1:3001", origin: "null" } })],
    ["different loopback port", fakeReq({ headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:8080" } })],
    ["https scheme mismatch", fakeReq({ headers: { host: "localhost:3001", origin: "https://localhost:3001" } })],
    ["LAN peer IP", fakeReq({ remoteAddress: "192.168.1.42", headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" } })],
    ["proxied X-Forwarded-For", fakeReq({ headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001", "x-forwarded-for": "203.0.113.5" } })],
    ["cross-site Sec-Fetch-Site", fakeReq({ headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001", "sec-fetch-site": "cross-site" } })],
    ["hosted domain Host header", fakeReq({ remoteAddress: "10.0.0.5", headers: { host: "aideos-backend.onrender.com", origin: "https://aideos-backend.onrender.com" } })],
  ];
  for (const [label, req] of rejected) {
    assert.equal(isLocalStudioRequest(req), false, `expected reject for ${label}`);
  }
});

test("resolveAllowedCorsOrigin never echoes foreign origins or Render origins against a local Studio", () => {
  assert.equal(
    resolveAllowedCorsOrigin(fakeReq({ headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" } })),
    "http://127.0.0.1:3001",
  );
  assert.equal(
    resolveAllowedCorsOrigin(fakeReq({ headers: { host: "127.0.0.1:3001", origin: "https://evil.example" } })),
    null,
  );
  assert.equal(
    resolveAllowedCorsOrigin(
      fakeReq({ headers: { host: "127.0.0.1:3001", origin: "https://evil.onrender.com" } }),
      { AIDEOS_ALLOWED_ORIGINS: "https://studio.example.com" },
    ),
    null,
    "a local Studio must never accept external origins via CORS",
  );
  assert.equal(
    resolveAllowedCorsOrigin(
      fakeReq({ remoteAddress: "10.0.0.8", headers: { host: "aideos-backend.onrender.com", origin: "https://aideos-backend.onrender.com" } }),
    ),
    "https://aideos-backend.onrender.com",
  );
  assert.equal(
    resolveAllowedCorsOrigin(
      fakeReq({ remoteAddress: "10.0.0.8", headers: { host: "aideos-backend.onrender.com", origin: "https://aideos.vercel.app" } }),
      { AIDEOS_ALLOWED_ORIGINS: "https://aideos.vercel.app" },
    ),
    "https://aideos.vercel.app",
  );
  assert.equal(
    resolveAllowedCorsOrigin(
      fakeReq({ remoteAddress: "10.0.0.8", headers: { host: "aideos-backend.onrender.com", origin: "https://evil.example" } }),
      { AIDEOS_ALLOWED_ORIGINS: "https://aideos.vercel.app" },
    ),
    null,
  );
});

test("guardStudioApiRequest refuses non-local callers on every mutating, voiceover, and export route while keeping agent-link and hosted-safe routes working", () => {
  const guardedRoutes: Array<[string, string]> = [
    ["POST", "/api/generate-voiceover"],
    ["POST", "/api/export"],
    ["POST", "/api/export/job-1/cancel"],
    ["POST", "/api/films/demo"],
    ["POST", "/api/projects/new"],
    ["POST", "/api/active-film"],
    ["POST", "/api/scripts/demo"],
    ["POST", "/api/parse-script-scenes"],
    ["POST", "/api/media/upload"],
    ["POST", "/api/broll/generate"],
    ["POST", "/api/prompt-agent"],
    ["DELETE", "/api/agent/trace"],
    ["POST", "/api/edit-log"],
    ["POST", "/api/ai-edit"],
    ["POST", "/api/reel/demo"],
    ["POST", "/api/audio-library/track-1/preview"],
    ["POST", "/api/soundtrack/demo"],
    ["POST", "/api/caption-placement/check"],
    ["POST", "/api/design/demo/approve-look"],
    ["POST", "/api/design/demo/shots/s1/motion"],
    ["POST", "/api/design/demo/motion/m1/revert"],
    ["POST", "/api/design/demo"],
    ["POST", "/api/unknown-future-mutation"],
  ];

  for (const [method, pathname] of guardedRoutes) {
    const foreign = guardStudioApiRequest(
      fakeReq({ method, headers: { host: "127.0.0.1:3001", origin: "https://evil.example" } }),
      pathname,
    );
    assert.equal(foreign.allow, false, `expected foreign ${method} ${pathname} to be refused`);

    const hosted = guardStudioApiRequest(
      fakeReq({
        method,
        remoteAddress: "10.0.0.5",
        headers: { host: "aideos-backend.onrender.com", origin: "https://aideos.vercel.app", "x-forwarded-host": "aideos.vercel.app" },
      }),
      pathname,
    );
    assert.equal(hosted.allow, false, `expected hosted ${method} ${pathname} to be refused`);

    const local = guardStudioApiRequest(
      fakeReq({ method, headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" } }),
      pathname,
    );
    assert.equal(local.allow, true, `expected local Studio ${method} ${pathname} to be allowed`);
  }

  // Agent-link connector and MCP endpoints keep working from CLI/agent clients without an Origin header (including hosted).
  for (const pathname of ["/api/agent-link/claim", "/api/agent-link/result", "/api/mcp"]) {
    assert.equal(
      guardStudioApiRequest(
        fakeReq({ method: "POST", remoteAddress: "10.0.0.5", headers: { host: "aideos-backend.onrender.com" } }),
        pathname,
      ).allow,
      true,
      `expected hosted CLI/MCP ${pathname} without Origin to be allowed`,
    );
    assert.equal(
      guardStudioApiRequest(
        fakeReq({ method: "POST", headers: { host: "127.0.0.1:3001", origin: "https://evil.example" } }),
        pathname,
      ).allow,
      false,
      `expected foreign browser Origin on ${pathname} to be refused`,
    );
  }

  // Hosted Vercel rewrite (same-origin HTTPS via X-Forwarded-Host) stays working for pairing, disconnect, and read-only acceptance checks.
  for (const [method, pathname] of [
    ["POST", "/api/agent-link/pair"],
    ["DELETE", "/api/agent-link"],
    ["POST", "/api/acceptance/hello-scene"],
  ] as const) {
    assert.equal(
      guardStudioApiRequest(
        fakeReq({
          method,
          remoteAddress: "10.0.0.5",
          headers: {
            host: "aideos-backend.onrender.com",
            origin: "https://aideos.vercel.app",
            "x-forwarded-host": "aideos.vercel.app",
            "sec-fetch-site": "same-origin",
          },
        }),
        pathname,
      ).allow,
      true,
      `expected Vercel rewrite ${method} ${pathname} to be allowed`,
    );
    assert.equal(
      guardStudioApiRequest(
        fakeReq({
          method,
          headers: { host: "127.0.0.1:3001", origin: "https://evil.example" },
        }),
        pathname,
      ).allow,
      false,
      `expected foreign browser Origin on local ${method} ${pathname} to be refused`,
    );
  }
});

test("Live Studio server refuses foreign-origin mutations, strips wildcard CORS, allows local Studio writes, and keeps agent-link working", async () => {
  const videosDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-guard-e2e-"));
  const server = await startEditor(videosDir);
  const localOrigin = new URL(server.url).origin;
  const foreignOrigin = "https://evil.example";

  try {
    // 1. Foreign-origin OPTIONS preflight is refused with 403 and no Access-Control-Allow-Origin.
    const preflightForeign = await fetch(new URL("/api/generate-voiceover", server.url), {
      method: "OPTIONS",
      headers: { origin: foreignOrigin, "access-control-request-method": "POST" },
    });
    assert.equal(preflightForeign.status, 403);
    assert.equal(preflightForeign.headers.get("access-control-allow-origin"), null);

    // 2. Local-origin OPTIONS preflight succeeds and echoes only the local Studio origin (never '*').
    const preflightLocal = await fetch(new URL("/api/generate-voiceover", server.url), {
      method: "OPTIONS",
      headers: { origin: localOrigin, "access-control-request-method": "POST" },
    });
    assert.equal(preflightLocal.status, 204);
    assert.equal(preflightLocal.headers.get("access-control-allow-origin"), localOrigin);

    // 3. Foreign-origin GET /api/films does not receive wildcard CORS.
    const foreignGet = await fetch(new URL("/api/films", server.url), {
      headers: { origin: foreignOrigin },
    });
    assert.equal(foreignGet.status, 200);
    assert.equal(foreignGet.headers.get("access-control-allow-origin"), null);

    // 4. Local-origin GET /api/films echoes the exact local Studio origin.
    const localGet = await fetch(new URL("/api/films", server.url), {
      headers: { origin: localOrigin },
    });
    assert.equal(localGet.status, 200);
    assert.equal(localGet.headers.get("access-control-allow-origin"), localOrigin);

    // 5. Foreign-origin writes, voice synthesis, and export routes are refused with 403 before reaching handlers.
    const blockedRequests: Array<[string, Record<string, unknown>, RegExp]> = [
      ["/api/generate-voiceover", { projectId: "blocked-vo", script: "" }, /Voiceover synthesis is only available/i],
      ["/api/export", {}, /Video exports are only available/i],
      ["/api/films/blocked-film", {}, /Write requests are only available/i],
      ["/api/scripts/blocked-script", { script: "Should not be written." }, /Write requests are only available/i],
      ["/api/media/upload", { filename: "x.txt", base64Data: "aGk=" }, /Write requests are only available/i],
      ["/api/agent-link/pair", { agent: "claude" }, /Origin is not allowed/i],
    ];
    for (const [route, payload, pattern] of blockedRequests) {
      const res = await fetch(new URL(route, server.url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: foreignOrigin },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string };
      assert.equal(res.status, 403, `expected 403 on foreign POST ${route}, got ${res.status}`);
      assert.equal(res.headers.get("access-control-allow-origin"), null, `expected no ACAO on foreign POST ${route}`);
      assert.match(json.error ?? "", pattern, `unexpected error message on foreign POST ${route}`);
    }
    assert.equal(fs.existsSync(path.join(videosDir, "blocked-script", "script.md")), false, "refused write must not touch disk");

    // 6. Local-origin write works and persists cleanly.
    const localScriptRes = await fetch(new URL("/api/scripts/local-guard-check", server.url), {
      method: "POST",
      headers: { "content-type": "application/json", origin: localOrigin },
      body: JSON.stringify({ script: "Local Studio script write works." }),
    });
    assert.equal(localScriptRes.status, 200);
    assert.equal(localScriptRes.headers.get("access-control-allow-origin"), localOrigin);
    assert.ok(fs.existsSync(path.join(videosDir, "local-guard-check", "script.md")));

    // 7. Streamed video package assets enforce same-origin resource policy and omit wildcard CORS for foreign origins.
    const foreignAsset = await fetch(new URL("/videos/local-guard-check/script.md", server.url), {
      headers: { origin: foreignOrigin },
    });
    assert.equal(foreignAsset.status, 200);
    assert.equal(foreignAsset.headers.get("access-control-allow-origin"), null);
    assert.equal(foreignAsset.headers.get("cross-origin-resource-policy"), "same-origin");

    // 8. Agent-link end-to-end flow: pair from local Studio -> claim from CLI (no Origin) -> disconnect from local Studio.
    const pairRes = await fetch(new URL("/api/agent-link/pair", server.url), {
      method: "POST",
      headers: { "content-type": "application/json", origin: localOrigin },
      body: JSON.stringify({ agent: "claude" }),
    });
    assert.equal(pairRes.status, 200);
    const pairJson = (await pairRes.json()) as { ownerKey: string; code: string };
    assert.ok(pairJson.ownerKey && pairJson.code);

    const claimRes = await fetch(new URL("/api/agent-link/claim", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pairJson.code, agent: "claude", machine: "guard-test" }),
    });
    assert.equal(claimRes.status, 200);
    const claimJson = (await claimRes.json()) as { token: string };
    assert.ok(claimJson.token);

    const disconnectRes = await fetch(new URL("/api/agent-link", server.url), {
      method: "DELETE",
      headers: { origin: localOrigin, "x-aideos-owner": pairJson.ownerKey },
    });
    assert.equal(disconnectRes.status, 200);
  } finally {
    server.stop();
    fs.rmSync(videosDir, { recursive: true, force: true });
  }
});
