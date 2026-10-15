/**
 * File Description: Minimal headless Chrome session over the DevTools protocol for rendering WebGL character pages.
 * Inputs and outputs: local HTML file and a page expression -> the expression's awaited JSON value plus any page errors.
 * Used by: the character sheet renderer and the character pixel tests; skipped by callers when no Chrome is installed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findChromeBinary } from "../scene/renderStill";

/** Software WebGL keeps pixels the same across GPUs and operating systems. */
export const SOFTWARE_GL_FLAGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

// Asks the OS for a free localhost port.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

// Polls the DevTools endpoint until Chrome answers.
async function waitForChrome(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`headless Chrome did not answer on port ${port} within ${timeoutMs} ms`);
}

/** Reports whether a Chrome binary is available for browser-backed character checks. */
export const chromeAvailable = (): boolean => findChromeBinary() !== null;

// Opens a local page, evaluates an expression that resolves to JSON, and returns it with collected page errors.
export async function evaluatePage<T>(htmlFile: string, expression: string, options: { timeoutMs?: number; flags?: string[] } = {}): Promise<{ value: T; errors: string[] }> {
  const chrome = findChromeBinary();
  if (!chrome) throw new Error("CHARACTER_BROWSER_UNAVAILABLE: no Chrome or Chromium found; install Chrome or set AIDEOS_CHROME_PATH");
  const timeoutMs = options.timeoutMs ?? 120000;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-character-"));
  const port = await freePort();
  const browser = spawn(chrome, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--force-device-scale-factor=1",
    ...(options.flags ?? SOFTWARE_GL_FLAGS), `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await waitForChrome(port, 30000);
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("headless Chrome exposed no page target");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("could not connect to headless Chrome")); });
    let nextId = 1;
    const pending = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
    const errors: string[] = [];
    let loaded: () => void = () => undefined;
    const loadedEvent = new Promise<void>((resolve) => { loaded = resolve; });
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> };
      if (msg.id !== undefined) { pending.get(msg.id)?.(msg); pending.delete(msg.id); return; }
      if (msg.method === "Page.loadEventFired") loaded();
      if (msg.method === "Runtime.exceptionThrown") {
        const details = msg.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
        errors.push(`uncaught: ${details?.exception?.description ?? details?.text ?? "unknown"}`.split("\n")[0]);
      }
    };
    // Sends one DevTools command and resolves with its result.
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
    await send("Runtime.enable");
    await send("Page.enable");
    const timer = new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error(`character page did not finish within ${timeoutMs} ms`)), timeoutMs); });
    await send("Page.navigate", { url: pathToFileURL(htmlFile).href });
    await Promise.race([loadedEvent, timer]);
    const evaluation = send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const result = (await Promise.race([evaluation, timer])) as { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } };
    ws.close();
    if (result.exceptionDetails) throw new Error(`character page failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`.split("\n").slice(0, 3).join(" "));
    return { value: result.result?.value as T, errors };
  } finally {
    if (deadline) clearTimeout(deadline);
    const exited = new Promise((r) => browser.once("exit", r));
    try { browser.kill("SIGKILL"); } catch { /* already gone */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp profile; harmless */ }
  }
}
