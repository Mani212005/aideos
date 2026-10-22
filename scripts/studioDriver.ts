/**
 * File Description: A small headless-Chrome driver for studio journeys, over the DevTools protocol with no extra dependency: it starts the editor dev server on a throwaway videos folder, opens the studio like a user would, and offers real keyboard, click, screenshot and wait calls while collecting every uncaught error and console.error.
 * Inputs and outputs: a videos directory and a Chrome binary -> a connected Studio page that journeys drive; stop() kills Chrome, the dev server and removes the temp profile.
 * Used by: scripts/smoke_studio.ts and backend/journeys/j3_studio_edit.journey.ts (AI edit apply, new project, script save, reload).
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const EDITOR_DIR = path.join(ROOT, "editor");

/** Asks the OS for a free TCP port on localhost. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

/** Polls a URL until it answers or the deadline passes. */
export async function waitForHttp(
  url: string,
  timeoutMs: number,
  abortIf?: () => string | undefined,
  onSleep?: (wake: () => void) => void,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const aborted = abortIf?.();
    if (aborted) throw new Error(aborted);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    const abortedAfter = abortIf?.();
    if (abortedAfter) throw new Error(abortedAfter);
    const delay = Math.min(250, Math.max(0, deadline - Date.now()));
    if (delay <= 0) break;
    await new Promise<void>((r) => {
      const timer = setTimeout(r, delay);
      onSleep?.(() => {
        clearTimeout(timer);
        r();
      });
    });
  }
  const aborted = abortIf?.();
  if (aborted) throw new Error(aborted);
  throw new Error(`nothing answered at ${url} within ${timeoutMs}ms`);
}

/** A running editor dev server. */
export interface DevServer {
  url: string;
  /** Everything the server printed, for error scanning. */
  log: () => string;
  stop: () => void;
}

/** Starts the Vite editor on a free port; `videosDir` (when given) is where it reads and writes packages. */
export async function startEditor(videosDir?: string): Promise<DevServer> {
  if (!fs.existsSync(path.join(EDITOR_DIR, "node_modules"))) {
    spawnSync("npm", ["--prefix", EDITOR_DIR, "ci"], { stdio: "inherit" });
  }
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const child: ChildProcess = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: EDITOR_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, ...(videosDir ? { AIDEOS_VIDEOS_DIR: videosDir } : {}) },
  });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  let exitReason: string | undefined;
  let wakeSleep: (() => void) | undefined;
  const onExit = (code: number | null, signal: string | null) => {
    exitReason = `dev server exited with code ${code ?? signal ?? "unknown"} before answering`;
    wakeSleep?.();
  };
  const onError = (err: Error) => {
    exitReason = `dev server failed to start: ${err.message}`;
    wakeSleep?.();
  };
  child.once("exit", onExit);
  child.once("error", onError);
  try {
    await waitForHttp(
      url,
      180000,
      () => {
        if (exitReason) return exitReason;
        if (child.exitCode !== null) {
          return `dev server exited with code ${child.exitCode} before answering`;
        }
        return undefined;
      },
      (wake) => {
        wakeSleep = wake;
      },
    );
  } catch (err) {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${msg}${log ? `\nServer log:\n${log}` : ""}`);
  } finally {
    child.off("exit", onExit);
    child.off("error", onError);
  }
  return {
    url,
    log: () => log,
    stop: () => {
      // The server runs in its own process group so npx and vite exit together.
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
    },
  };
}

/** What a DevTools command or event carries; only the fields the driver reads are named. */
interface CdpResult {
  data?: string;
  exceptionDetails?: { text?: string; exception?: { description?: string } };
  result?: { value?: unknown };
}
interface CdpMessage {
  id?: number;
  result?: CdpResult;
  method?: string;
  params?: {
    type?: string;
    args?: Array<{ value?: unknown; description?: string }>;
    exceptionDetails?: CdpResult["exceptionDetails"];
    requestId?: string;
    request?: { url: string; method: string; postData?: string };
  };
}

/** A request the page made that a journey answers itself instead of letting it reach the server. */
export interface InterceptedRequest {
  url: string;
  method: string;
  /** The request body, when it had one. */
  body?: string;
}

/** What a journey answers an intercepted request with (JSON body). */
export interface FakeResponse {
  status?: number;
  json: unknown;
}

/** One page of headless Chrome, driven like a user: keys, clicks, screenshots, waits. */
export class StudioPage {
  /** Uncaught exceptions and console.error lines seen since the page opened. */
  readonly errors: string[] = [];
  private nextId = 1;
  private readonly pending = new Map<number, (result: CdpResult) => void>();
  /** Answers for intercepted requests, tried in order; a request no rule matches continues to the real server. */
  private readonly interceptRules: Array<{ method: string; urlPath: string; respond: (req: InterceptedRequest) => FakeResponse }> = [];

  /** Wraps an open DevTools socket and starts collecting errors. */
  private constructor(
    private readonly ws: WebSocket,
    private readonly browser: ChildProcess,
    private readonly profile: string,
  ) {
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as CdpMessage;
      if (msg.id !== undefined) {
        this.pending.get(msg.id)?.(msg.result ?? {});
        this.pending.delete(msg.id);
      } else if (msg.method === "Fetch.requestPaused" && msg.params?.requestId && msg.params.request) {
        this.answerPausedRequest(msg.params.requestId, msg.params.request);
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails;
        this.errors.push(`uncaught: ${d?.exception?.description ?? d?.text ?? "unknown exception"}`.split("\n")[0]);
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
        const text = (msg.params.args ?? []).map((a) => String(a.value ?? a.description ?? "")).join(" ");
        this.errors.push(`console.error: ${text}`.split("\n")[0]);
      }
    };
  }

  /** Launches Chrome headless at a fixed 1440x900 window and connects to its first page. */
  static async open(chrome: string): Promise<StudioPage> {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-smoke-"));
    let browser: ChildProcess | undefined;
    let ws: WebSocket | undefined;
    try {
      const debugPort = await freePort();
      browser = spawn(
        chrome,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-extensions",
          "--window-size=1440,900",
          // A CI runner is a disposable container: Chrome's sandbox needs privileges it does not grant.
          ...(process.env.CI === "true" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
          `--user-data-dir=${profile}`,
          `--remote-debugging-port=${debugPort}`,
          "about:blank",
        ],
        // Its own process group, so closing can kill Chrome's helper processes along with it.
        { stdio: "ignore", detached: true },
      );
      await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 30000);
      const targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
      const page = targets.find((t) => t.type === "page");
      if (!page) throw new Error("headless Chrome exposed no page target");
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise<void>((resolve, reject) => {
        ws!.onopen = () => resolve();
        ws!.onerror = () => reject(new Error("could not connect to headless Chrome"));
      });
      const studio = new StudioPage(ws, browser, profile);
      await studio.send("Runtime.enable");
      await studio.send("Page.enable");
      return studio;
    } catch (err) {
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
      if (browser) {
        try {
          process.kill(-browser.pid!, "SIGKILL");
        } catch {
          browser.kill("SIGKILL");
        }
      }
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {}
      throw err;
    }
  }

  /** Sends one DevTools command and waits for its result. */
  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Studio DevTools command ${method} timed out after 30000ms`));
      }, 30000);
      this.pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  /** Navigates and waits for the load event. */
  async goto(url: string, settleMs = 1500): Promise<void> {
    await this.send("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, settleMs));
  }

  /** Reloads the page (a hash-only navigation does not reload, so journeys that need a fresh app state call this). */
  async reload(settleMs = 1500): Promise<void> {
    await this.send("Page.reload");
    await new Promise((r) => setTimeout(r, settleMs));
  }

  /** Runs an expression in the page and returns its JSON value. */
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(`page evaluation failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value as T;
  }

  /** Polls a page expression until it is truthy, or throws naming what never happened. */
  async waitFor(expression: string, what: string, timeoutMs = 60000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.eval<boolean>(`Boolean(${expression})`).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    const errSuffix = this.errors.length ? `; browser errors: ${this.errors.join("; ")}` : "";
    throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}${errSuffix}`);
  }

  /** Presses and releases one key the way a user's keyboard would (it reaches the window listeners). */
  async key(key: string, options: { shift?: boolean } = {}): Promise<void> {
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    const vk: Record<string, number> = { ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 };
    const base = { key, code, modifiers: options.shift ? 8 : 0, windowsVirtualKeyCode: vk[key] ?? key.toUpperCase().charCodeAt(0) };
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(key.length === 1 ? { text: key } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /** Clicks the first visible, enabled button whose accessible text or title contains `label` (or, with `exact`, whose trimmed text is `label`). */
  async clickButton(label: string, options: { exact?: boolean } = {}): Promise<void> {
    const clicked = await this.eval<boolean>(`(() => {
      const wanted = ${JSON.stringify(label)}.toLowerCase();
      const exact = ${JSON.stringify(Boolean(options.exact))};
      const button = [...document.querySelectorAll('button')].find((b) => (exact ? b.textContent.trim().toLowerCase() === wanted : ((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '') + ' ' + b.textContent).toLowerCase().includes(wanted)) && b.offsetParent !== null && !b.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`no enabled button matching "${label}" is on the page`);
  }

  /** PNG bytes of the element matching `selector` (the whole element rectangle). */
  async screenshot(selector: string): Promise<Buffer> {
    const rect = await this.eval<{ x: number; y: number; width: number; height: number } | null>(
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    );
    if (!rect) throw new Error(`nothing on the page matches ${selector}`);
    const shot = await this.send("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 1 } });
    return Buffer.from(shot.data ?? "", "base64");
  }

  /**
   * Answers every `method` request whose URL path is exactly `urlPath` with `respond`'s fake JSON instead of
   * letting it reach the server, which is how a journey makes a model-backed endpoint deterministic while
   * every other request (saves, reloads, the edit log) stays real.
   */
  async intercept(method: string, urlPath: string, respond: (req: InterceptedRequest) => FakeResponse): Promise<void> {
    this.interceptRules.push({ method, urlPath, respond });
    await this.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  }

  /** Fulfils a paused request from the first matching rule, or lets it continue untouched. */
  private answerPausedRequest(requestId: string, request: { url: string; method: string; postData?: string }): void {
    const urlPath = new URL(request.url).pathname;
    const rule = this.interceptRules.find((r) => r.method === request.method && r.urlPath === urlPath);
    if (!rule) {
      void this.send("Fetch.continueRequest", { requestId });
      return;
    }
    const answer = rule.respond({ url: request.url, method: request.method, body: request.postData });
    void this.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: answer.status ?? 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(answer.json)).toString("base64"),
    });
  }

  /** Focuses the first element matching `selector` (a text field) so typing lands in it. */
  async focus(selector: string): Promise<void> {
    const ok = await this.eval<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.focus(); return document.activeElement === e; })()`);
    if (!ok) throw new Error(`could not focus ${selector}`);
  }

  /** Types text into the focused field the way a user's keyboard would (a real input event per insertion, so controlled React fields update). */
  async typeText(text: string): Promise<void> {
    await this.send("Input.insertText", { text });
  }

  /** Closes the page, kills Chrome and removes its profile. */
  async close(): Promise<void> {
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
    try {
      const exited = new Promise((r) => this.browser.once("exit", r));
      try {
        process.kill(-this.browser.pid!, "SIGKILL");
      } catch {
        this.browser.kill("SIGKILL");
      }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      // Helpers can outlive the main process by a moment and write into the profile as they die.
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      // Process already terminated.
    }
    try {
      fs.rmSync(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (err: unknown) {
      console.warn(`[studio] profile cleanup warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
