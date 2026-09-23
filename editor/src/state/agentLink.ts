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
