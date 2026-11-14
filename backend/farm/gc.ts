/**
 * File Description: Mark-and-sweep garbage collection of the content store. Mark: every object an unfinished or dead task reads and every output of a finished task of a live film (other films keep theirs for a time limit). Sweep: remove every unmarked object not touched within a grace period, re-checking the object's time right before the removal so an object a submitter just reused is never lost. A live object is never removed.
 * Inputs and outputs: the store, the queue, the live films and the limits -> the removed objects and a report.
 * Used by: scripts/farm.ts, backend/farm/loadTest.ts and the farm tests.
 */

import fs from "node:fs";
import type { ContentStore } from "./contentStore";
import type { TaskQueue } from "./queue";

export interface GcOptions {
  store: ContentStore;
  queue: TaskQueue;
  /** Films whose outputs must stay; omit to keep every output younger than `resultTtlMs`. */
  liveFilms?: ReadonlySet<string>;
  /** How long outputs of films that are not live stay (default 7 days). */
  resultTtlMs?: number;
  /** Objects younger than this are never removed: a submitter may be about to reference them (default 1 hour). */
  graceMs?: number;
  now?: () => number;
}

export interface GcReport {
  scanned: number;
  marked: number;
  removed: number;
  bytesFreed: number;
  keptByGrace: number;
}

/** Runs one collection and returns what it did. */
export async function collectGarbage(options: GcOptions): Promise<GcReport> {
  const now = options.now ?? Date.now;
  const graceMs = options.graceMs ?? 60 * 60_000;
  const live = await options.queue.liveDigests({ liveFilms: options.liveFilms, resultTtlMs: options.resultTtlMs ?? 7 * 24 * 60 * 60_000 });
  const objects = options.store.list();
  const report: GcReport = { scanned: objects.length, marked: 0, removed: 0, bytesFreed: 0, keptByGrace: 0 };
  for (const object of objects) {
    if (live.has(object.digest)) {
      report.marked++;
      continue;
    }
    if (now() - object.mtimeMs < graceMs) {
      report.keptByGrace++;
      continue;
    }
    // A submitter may have reused the object after the listing; its time is fresh then.
    let fresh = object.mtimeMs;
    try {
      fresh = fs.statSync(options.store.pathOf(object.digest)).mtimeMs;
    } catch {
      continue;
    }
    if (now() - fresh < graceMs) {
      report.keptByGrace++;
      continue;
    }
    report.bytesFreed += options.store.remove(object.digest);
    report.removed++;
  }
  return report;
}
