/**
 * File Description: The browser half of the agent link (backend/agentLink/store.ts).
 * Pairing gives this browser an owner key; it is kept in localStorage and sent as X-Aideos-Owner
 * with every studio API request, which is how the server knows a task may go to the owner's
 * connected agent. Installed once, as a fetch wrapper, so no call site has to remember it.
 */

const OWNER_KEY_STORAGE = "aideos.ownerKey";

/** The owner key this browser holds, if it has ever paired an agent. */
export function readOwnerKey(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY_STORAGE);
  } catch {
    return null;
  }
}

/** Remembers the owner key a pairing returned. */
export function writeOwnerKey(key: string): void {
  try {
    window.localStorage.setItem(OWNER_KEY_STORAGE, key);
  } catch {
    // Private windows can refuse storage; pairing still works for this page's lifetime.
  }
  memoryKey = key;
}

let memoryKey: string | null = null;
let installed = false;

// True for requests to this studio's own API.
function isStudioApi(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith("/api/");
}

/** Adds the owner key to every studio API request made with fetch. */
export function installOwnerHeader(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const key = memoryKey ?? readOwnerKey();
    if (!key || !isStudioApi(input)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("X-Aideos-Owner")) headers.set("X-Aideos-Owner", key);
    return original(input, { ...init, headers });
  };
}

/** Makes a fresh owner key. Tokens are bound to the old key's hash, so swapping it ends them for good, even across a server restart. */
export function rotateOwnerKey(): string {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  writeOwnerKey(key);
  return key;
}

const EXPECTED_STORAGE = "aideos.agentLink.expected";

/** What the studio last saw connected, remembered so a server restart shows "reconnecting" rather than "disconnected". */
export interface ExpectedLink {
  agentLabel: string;
  machine: string;
  lastOnline: number;
}

/** The link this browser last saw online, if any. */
export function readExpectedLink(): ExpectedLink | null {
  try {
    const raw = window.localStorage.getItem(EXPECTED_STORAGE);
    return raw ? (JSON.parse(raw) as ExpectedLink) : null;
  } catch {
    return null;
  }
}

/** Remembers (or with null forgets) the link this browser last saw online. */
export function writeExpectedLink(link: ExpectedLink | null): void {
  try {
    if (link) window.localStorage.setItem(EXPECTED_STORAGE, JSON.stringify(link));
    else window.localStorage.removeItem(EXPECTED_STORAGE);
  } catch {
    // Storage can be refused; the badge then just shows the server's own view.
  }
}

/**
 * The state the badge shows. A server that restarted after the link was last online has lost its
 * connection table until the agent's next check-in, so that is "reconnecting", not "disconnected".
 */
export function linkPhase(
  status: { connected: boolean; online: boolean; startedAt?: string } | null,
  expected: ExpectedLink | null,
): "online" | "offline" | "reconnecting" | "none" {
  if (!status) return expected ? "reconnecting" : "none";
  if (status.connected) return status.online ? "online" : "offline";
  if (expected && status.startedAt && Date.parse(status.startedAt) >= expected.lastOnline - 2000) return "reconnecting";
  return "none";
}
