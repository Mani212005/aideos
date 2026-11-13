/**
 * File Description: Runs an encoder subprocess with progress, disk reserve protection and process-tree cancellation.
 * Inputs and outputs: command, signal and output path -> process completion or a diagnostic error.
 * Used by: the Remotion renderer adapter and pipeline render compatibility entry point.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RENDER_RESERVE_BYTES = 3 * 1024 ** 3;

export interface RenderCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface RenderProcessDeps {
  spawn?: typeof spawn;
  statfs?: (p: string) => { bavail: number | bigint; bsize: number | bigint };
  pollIntervalMs?: number;
  killGraceMs?: number;
  killProcess?: (child: ReturnType<typeof spawn>) => void;
}

/** Signals the entire renderer tree, including browser and encoder descendants. */
function signalTree(child: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    if (process.platform === "win32" && child.pid)
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else if (child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* The tree has already exited. */
    }
  }
}

/** Runs one command, waiting for close before cleaning its private temp files. */
export async function runRenderCommand(
  command: RenderCommand,
  outPath: string,
  options: {
    signal?: AbortSignal;
    onOutput?: (text: string) => void;
    onStdout?: (text: string) => void;
    requireOutput?: boolean;
  } = {},
  deps: RenderProcessDeps = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-render-"));
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let child: ChildProcess | undefined;
  let failure: Error | undefined;

  /** Stops a running tree once and escalates if graceful cancellation is ignored. */
  const stop = (): void => {
    if (!child || grace) return;
    if (deps.killProcess) deps.killProcess(child as ReturnType<typeof spawn>);
    else signalTree(child, "SIGTERM");
    grace = setTimeout(() => {
      if (child) signalTree(child, "SIGKILL");
    }, deps.killGraceMs ?? 5000);
  };

  try {
    child = (deps.spawn ?? spawn)(command.command, command.args, {
      cwd: command.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...command.env,
        TMPDIR: temp,
        TMP: temp,
        TEMP: temp,
      },
    });
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    watchdog = setInterval(() => {
      if (failure) return;
      try {
        for (const dir of [temp, path.dirname(outPath)]) {
          const stat = (deps.statfs ?? fs.statfsSync)(dir);
          if (Number(stat.bavail) * Number(stat.bsize) < RENDER_RESERVE_BYTES) {
            failure = new Error(
              `RENDER_DISK_LOW: render stopped because free space under ${dir} fell below the 3 GiB reserve`,
            );
            stop();
            break;
          }
        }
      } catch (error) {
        failure = new Error(
          `RENDER_DISK_CHECK_FAILED: could not check free space during render: ${error instanceof Error ? error.message : String(error)}`,
        );
        stop();
      }
    }, deps.pollIntervalMs ?? 3000);
    let tail = "";
    /** Retains diagnostics and forwards real renderer output. */
    const observe = (chunk: Buffer): void => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000);
      options.onOutput?.(text);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      options.onStdout?.(chunk.toString());
      observe(chunk);
    });
    child.stderr?.on("data", observe);
    const processChild = child;
    const code = await new Promise<number | null>((resolve, reject) => {
      processChild.on("error", reject);
      processChild.on("exit", () => signalTree(processChild, "SIGKILL"));
      processChild.on("close", resolve);
    });
    options.signal?.throwIfAborted();
    if (failure) throw failure;
    if (code !== 0)
      throw new Error(
        `Render subprocess exited with code ${code}: ${tail.trim()}`,
      );
    if (options.requireOutput !== false && !fs.existsSync(outPath))
      throw new Error(`Render failed to create output file at ${outPath}`);
  } finally {
    options.signal?.removeEventListener("abort", stop);
    clearInterval(watchdog);
    clearTimeout(grace);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
