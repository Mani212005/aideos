/**
 * File Description: The janitor of the farm. A worker removes its attempt directory after every task, but a killed worker cannot, so the janitor sweeps at worker start and on a timer: an attempt directory stays only while the queue shows a live lease for that worker, task and attempt; the directory tree of a worker that stopped answering goes entirely; unfinished store and cache puts older than a limit go too. The bar is zero bytes left.
 * Inputs and outputs: the work root, the queue and the stores -> removed directories and a report of the bytes freed.
 * Used by: backend/farm/worker.ts, backend/farm/loadTest.ts, scripts/farm.ts.
 */

import fs from "node:fs";
import path from "node:path";
import type { TaskQueue } from "./queue";
import { directoryBytes, type ContentStore } from "./contentStore";

/** The name of the directory a worker renders one attempt in: the first 16 hex digits of the task id and the attempt number. */
export function attemptDirName(taskId: string, attempt: number): string {
  return `attempt-${taskId.slice(0, 16)}-a${attempt}`;
}

const ATTEMPT_DIR = /^attempt-([0-9a-f]{16})-a(\d+)$/;

export interface SweepReport {
  attemptDirsRemoved: number;
  workerDirsRemoved: number;
  strayEntriesRemoved: number;
  bytesRemoved: number;
  storeTmpRemoved: number;
  storeTmpBytes: number;
}

export interface JanitorOptions {
  workRoot: string;
  queue: TaskQueue;
  /** Stores whose unfinished puts are swept (the shared store and the worker cache). */
  stores?: ContentStore[];
  /** A worker not heard from for this long is dead and its whole directory goes. */
  workerStaleMs: number;
  /** Unfinished puts older than this go; a live put finishes well within it. */
  tmpMaxAgeMs?: number;
}

/** Creates the janitor; `sweep` is safe to call from any worker at any time. */
export function createJanitor(options: JanitorOptions) {
  const tmpMaxAgeMs = options.tmpMaxAgeMs ?? 10 * 60_000;

  /** Removes a path and returns the bytes it held. */
  const removeTree = (target: string): number => {
    const bytes = directoryBytes(target) || (fs.existsSync(target) && fs.lstatSync(target).isFile() ? fs.lstatSync(target).size : 0);
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    return bytes;
  };

  return {
    /** One sweep. `keep` lists absolute attempt directories the caller is using right now. */
    async sweep(keep: ReadonlySet<string> = new Set(), self?: string): Promise<SweepReport> {
      const report: SweepReport = { attemptDirsRemoved: 0, workerDirsRemoved: 0, strayEntriesRemoved: 0, bytesRemoved: 0, storeTmpRemoved: 0, storeTmpBytes: 0 };
      const leases = await options.queue.liveLeases();
      const alive = new Set((await options.queue.liveWorkers(options.workerStaleMs)).map((w) => w.id));
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(options.workRoot, { withFileTypes: true });
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        const full = path.join(options.workRoot, entry.name);
        if (!entry.isDirectory()) {
          report.bytesRemoved += removeTree(full);
          report.strayEntriesRemoved++;
          continue;
        }
        if (entry.name !== self && !alive.has(entry.name)) {
          report.bytesRemoved += removeTree(full);
          report.workerDirsRemoved++;
          continue;
        }
        for (const inner of fs.readdirSync(full, { withFileTypes: true })) {
          const innerPath = path.join(full, inner.name);
          const match = inner.isDirectory() ? ATTEMPT_DIR.exec(inner.name) : null;
          const live = match !== null && (keep.has(innerPath) || leases.some((l) => l.worker === entry.name && l.taskId.startsWith(match[1]) && l.attempt === Number(match[2])));
          if (live) continue;
          report.bytesRemoved += removeTree(innerPath);
          if (match) report.attemptDirsRemoved++;
          else report.strayEntriesRemoved++;
        }
      }
      for (const store of options.stores ?? []) {
        const tmp = store.sweepTmp(tmpMaxAgeMs);
        report.storeTmpRemoved += tmp.removed;
        report.storeTmpBytes += tmp.bytes;
      }
      return report;
    },

    /** Bytes still under the work root: the number that must be zero when no task runs. */
    tempBytes(): number {
      return directoryBytes(options.workRoot);
    },
  };
}

export type Janitor = ReturnType<typeof createJanitor>;
