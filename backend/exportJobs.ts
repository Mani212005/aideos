/**
 * File Description: Studio export jobs. Runs one Remotion render as a cancellable background job whose
 * progress is read from the renderer's own "Rendered N/T" and "Encoded N/T" lines (never a time
 * estimate), and whose cancel kills the whole render process group and deletes the partial video.
 * Nothing here downloads anything: a finished job only reports where the file can be fetched from.
 * Inputs and outputs: a prepare step that yields a render command, and cancel calls -> job snapshots (status, real progress, result).
 * Used by: editor/vite.config.ts (/api/export routes), backend/exportJobs.test.ts.
 */

import { execFileSync, spawn } from "child_process";
import type { ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { ExportJobSnapshot } from "./exportJobTypes";

export type { ExportStatus, ExportJobSnapshot } from "./exportJobTypes";

/** The render command a job runs, produced after the job exists so the work before it can be cancelled too. */
export interface PreparedRender {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

/** Everything a job needs from the caller. */
export interface ExportJobInput {
  filmId: string;
  format: "long" | "reel";
  filename: string;
  outPath: string;
  downloadUrl: string;
  /** Slow work before the render (end card voice, retimed audio, film module). Throwing fails the job. */
  prepare: () => Promise<PreparedRender>;
  /** Work on the finished file (audio master). May return a notice for the user. Throwing fails the job. */
  finalize?: (outPath: string) => string | void;
  /** Always runs once the job has settled, whichever way it ended. */
  cleanup?: () => void;
}

/** Test seams for the process boundary. */
export interface ExportJobDeps {
  spawn?: typeof spawn;
  /** Milliseconds a cancelled render gets to exit after SIGTERM before SIGKILL. */
  killGraceMs?: number;
  now?: () => number;
}

interface Job {
  snapshot: ExportJobSnapshot;
  input: ExportJobInput;
  child?: ChildProcess;
  tempDir?: string;
  cancelRequested: boolean;
  settled: Promise<void>;
}

/** Pulls the latest "Rendered a/b" and "Encoded a/b" counts out of renderer output. */
export function parseRenderProgress(text: string): { rendered?: number; encoded?: number; total?: number } {
  const out: { rendered?: number; encoded?: number; total?: number } = {};
  for (const m of text.matchAll(/Rendered\s+(\d+)\s*\/\s*(\d+)/g)) {
    out.rendered = Number(m[1]);
    out.total = Number(m[2]);
  }
  for (const m of text.matchAll(/Encoded\s+(\d+)\s*\/\s*(\d+)/g)) {
    out.encoded = Number(m[1]);
    out.total = Number(m[2]);
  }
  return out;
}

/** Whole-job progress: rendering and encoding each count for half, and it reaches 1 only when the job is done. */
export function progressFraction(rendered: number, encoded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(0.99, (Math.min(rendered, total) + Math.min(encoded, total)) / (2 * total));
}

/** Stops a render and everything it spawned (Chrome, ffmpeg) by signalling its whole process group. */
function signalTree(child: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    if (process.platform === "win32" && child.pid) {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else if (child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

/** Creates the registry of export jobs. At most one renders at a time because every render rewrites the active film. */
export function createExportJobs(deps: ExportJobDeps = {}) {
  const jobs = new Map<string, Job>();
  const now = deps.now ?? Date.now;
  let counter = 0;

  /** The job that is still preparing, rendering or finishing, if any. */
  const active = (): Job | undefined =>
    [...jobs.values()].find((j) => ["preparing", "rendering", "finishing"].includes(j.snapshot.status));

  /** Removes the partial video and the renderer's temp directory. */
  const discard = (job: Job): void => {
    fs.rmSync(job.input.outPath, { force: true });
    if (job.tempDir) fs.rmSync(job.tempDir, { recursive: true, force: true });
  };

  /** Marks a job finished; the first terminal state wins. */
  const settle = (job: Job, status: "done" | "failed" | "cancelled", extra: Partial<ExportJobSnapshot> = {}): void => {
    const s = job.snapshot;
    if (["done", "failed", "cancelled"].includes(s.status)) return;
    Object.assign(s, extra, { status, finishedAt: now() });
    if (status === "done") {
      s.progress = 1;
      s.downloadUrl = job.input.downloadUrl;
    } else {
      discard(job);
    }
    if (job.tempDir) fs.rmSync(job.tempDir, { recursive: true, force: true });
    try {
      job.input.cleanup?.();
    } catch {
      // Cleanup problems must not mask the job's own outcome.
    }
  };

  /** Runs prepare, the render and finalize for a job. */
  const run = async (job: Job): Promise<void> => {
    const s = job.snapshot;
    try {
      const prepared = await job.input.prepare();
      if (job.cancelRequested) return settle(job, "cancelled");

      job.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-export-"));
      fs.mkdirSync(path.dirname(job.input.outPath), { recursive: true });
      const child = (deps.spawn ?? spawn)(prepared.command, prepared.args, {
        cwd: prepared.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        env: { ...process.env, ...prepared.env, TMPDIR: job.tempDir, TMP: job.tempDir, TEMP: job.tempDir },
      });
      job.child = child;
      s.status = "rendering";

      let tail = "";
      let pending = "";
      /** Reads progress out of complete output lines. */
      const read = (text: string): void => {
        const seen = parseRenderProgress(text);
        if (seen.total) s.totalFrames = seen.total;
        if (seen.rendered !== undefined) s.renderedFrames = Math.max(s.renderedFrames, seen.rendered);
        if (seen.encoded !== undefined) s.encodedFrames = Math.max(s.encodedFrames, seen.encoded);
        s.progress = Math.max(s.progress, progressFraction(s.renderedFrames, s.encodedFrames, s.totalFrames));
      };
      const observe = (chunk: Buffer): void => {
        const text = chunk.toString();
        tail = (tail + text).slice(-4000);
        // Progress lines can be split across chunks, so only complete lines are read until the process ends.
        pending += text;
        const lines = pending.split(/\r|\n/);
        pending = lines.pop() ?? "";
        read(lines.join("\n"));
      };
      child.stdout?.on("data", observe);
      child.stderr?.on("data", observe);

      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        // Whatever the renderer leaves running (Chrome, ffmpeg) goes down with it, so an exit never leaves an orphan
        // holding the output pipes open.
        child.on("exit", () => signalTree(child, "SIGKILL"));
        child.on("close", (c) => resolve(c));
      });

      read(pending);
      if (job.cancelRequested) return settle(job, "cancelled");
      if (code !== 0) {
        return settle(job, "failed", { error: `Remotion render exited with code ${code}: ${tail.trim()}` });
      }
      if (!fs.existsSync(job.input.outPath)) {
        return settle(job, "failed", { error: `The render finished but ${job.input.filename} was not written.` });
      }
      s.status = "finishing";
      const notice = job.input.finalize?.(job.input.outPath);
      if (job.cancelRequested) return settle(job, "cancelled");
      settle(job, "done", notice ? { notice } : {});
    } catch (err) {
      if (job.cancelRequested) return settle(job, "cancelled");
      settle(job, "failed", { error: err instanceof Error ? err.message : String(err) });
    }
  };

  return {
    /** Starts a job and returns its snapshot at once, or the running job's snapshot as `busy`. */
    start(input: ExportJobInput): { job: ExportJobSnapshot; busy: boolean } {
      const running = active();
      if (running) return { job: { ...running.snapshot }, busy: true };
      const id = `exp-${now().toString(36)}-${(counter++).toString(36)}`;
      const job: Job = {
        input,
        cancelRequested: false,
        settled: Promise.resolve(),
        snapshot: {
          id,
          filmId: input.filmId,
          format: input.format,
          status: "preparing",
          progress: 0,
          renderedFrames: 0,
          encodedFrames: 0,
          totalFrames: 0,
          filename: input.filename,
          startedAt: now(),
        },
      };
      jobs.set(id, job);
      job.settled = run(job);
      return { job: { ...job.snapshot }, busy: false };
    },

    /** The current snapshot of a job, or undefined for an unknown id. */
    get(id: string): ExportJobSnapshot | undefined {
      const job = jobs.get(id);
      return job ? { ...job.snapshot } : undefined;
    },

    /** The job still in flight, if any, so a reloaded page can find it again. */
    current(): ExportJobSnapshot | undefined {
      const job = active();
      return job ? { ...job.snapshot } : undefined;
    },

    /** Stops the render, deletes the partial video, and resolves once the process tree has exited. */
    async cancel(id: string): Promise<ExportJobSnapshot | undefined> {
      const job = jobs.get(id);
      if (!job) return undefined;
      if (["done", "failed", "cancelled"].includes(job.snapshot.status)) return { ...job.snapshot };
      job.cancelRequested = true;
      const child = job.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        signalTree(child, "SIGTERM");
        const grace = setTimeout(() => signalTree(child, "SIGKILL"), deps.killGraceMs ?? 5000);
        await job.settled.finally(() => clearTimeout(grace));
      } else {
        await job.settled;
      }
      // A kill that raced a normal finish still leaves nothing behind.
      settle(job, "cancelled");
      return { ...job.snapshot };
    },

    /** Kills every render still running, for server shutdown. */
    killAll(): void {
      for (const job of jobs.values()) {
        if (job.child && job.child.exitCode === null) signalTree(job.child, "SIGKILL");
      }
    },
  };
}

export type ExportJobs = ReturnType<typeof createExportJobs>;
