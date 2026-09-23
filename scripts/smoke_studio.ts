/**
 * File Description: Browser smoke check for the Aideos Studio.
 * Starts the editor dev server, loads the studio in headless Chrome and fails when the page does
 * not render or throws an uncaught error. Unit tests run in Node and cannot see a crash that only
 * happens in the browser bundle (for example a Node-only import leaking into client code, which
 * blanked the studio after #43), so this check loads the real page the way a user does.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { findChromeBinary } from "../backend/scene/renderStill";

const ROOT = path.resolve(__dirname, "..");
const EDITOR_DIR = path.join(ROOT, "editor");
// An element that only exists once the React app has rendered its shell.
const RENDERED_SELECTOR = 'nav[aria-label="Production stages"]';

// Asks the OS for a free TCP port on localhost.
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

// Polls a URL until it answers or the deadline passes.
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not up yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`dev server did not answer at ${url} within ${timeoutMs}ms`);
}

/** What the browser reported while loading the studio. */
interface PageReport {
  rendered: boolean;
  errors: string[];
}

// Loads the page in headless Chrome over the DevTools protocol, collects uncaught exceptions and
// console errors for `settleMs`, then reports whether the studio shell rendered.
async function loadInChrome(chrome: string, url: string, settleMs = 8000): Promise<PageReport> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-smoke-"));
  const debugPort = await freePort();
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 30000);
    const targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as {
      type: string;
      webSocketDebuggerUrl: string;
    }[];
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("headless Chrome exposed no page target");

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("could not connect to headless Chrome"));
    });
    let nextId = 1;
    const pending = new Map<number, (result: unknown) => void>();
    const errors: string[] = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        method?: string;
        params?: Record<string, any>;
      };
      if (msg.id !== undefined) {
        pending.get(msg.id)?.(msg.result);
        pending.delete(msg.id);
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails;
        errors.push(`uncaught: ${d?.exception?.description ?? d?.text ?? "unknown exception"}`.split("\n")[0]);
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
        const text = (msg.params.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ");
        errors.push(`console.error: ${text}`.split("\n")[0]);
      }
    };
    // Sends one DevTools command and waits for its result.
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });

    await send("Runtime.enable");
    await send("Page.enable");
    await send("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, settleMs));
    const check = await send("Runtime.evaluate", {
      expression: `!!document.querySelector('${RENDERED_SELECTOR}')`,
      returnByValue: true,
    });
    ws.close();
    return { rendered: check?.result?.value === true, errors };
  } finally {
    const exited = new Promise((r) => browser.once("exit", r));
    browser.kill("SIGKILL");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    // Chrome helpers can still be flushing the profile; a leftover temp dir is harmless.
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

// Runs the smoke check and exits non-zero when the studio fails to render.
async function main(): Promise<void> {
  const chrome = findChromeBinary();
  if (!chrome) {
    if (process.env.AIDEOS_SMOKE_REQUIRED === "1") throw new Error("no Chrome or Chromium found; set AIDEOS_CHROME_PATH");
    console.warn("[smoke] skipped: no Chrome or Chromium found (set AIDEOS_CHROME_PATH to enable)");
    return;
  }
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: EDITOR_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let serverLog = "";
  server.stdout?.on("data", (d) => (serverLog += d));
  server.stderr?.on("data", (d) => (serverLog += d));
  try {
    await waitForHttp(url, 60000);
    const report = await loadInChrome(chrome, url);
    const problems: string[] = [];
    if (!report.rendered) problems.push("the studio shell did not render (blank page)");
    if (report.errors.length) problems.push(`errors in the browser:\n  ${report.errors.slice(0, 5).join("\n  ")}`);
    const serverErrors = serverLog.split("\n").filter((line) => /\[vite\].*(error|Error)/.test(line));
    if (serverErrors.length) problems.push(`dev server errors:\n  ${serverErrors.slice(0, 5).join("\n  ")}`);
    if (problems.length) {
      throw new Error(`studio smoke check failed:\n- ${problems.join("\n- ")}`);
    }
    console.log(`[smoke] studio rendered at ${url} with no uncaught errors`);
  } finally {
    // The server was started in its own process group so npx and vite exit together.
    try {
      process.kill(-server.pid!, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
