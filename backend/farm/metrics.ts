/**
 * File Description: Farm metrics in one place: the queue's counts and distributions plus the host facts a queue cannot know (free disk under the work root, bytes in the work root, the store and the cache), and a plain-text rendering for the CLI.
 * Inputs and outputs: the queue, the stores and the work root -> a FarmMetrics object and its text form.
 * Used by: scripts/farm.ts (status command), backend/farm/loadTest.ts and the farm tests.
 */

import { directoryBytes, type ContentStore } from "./contentStore";
import type { Distribution, QueueMetrics, TaskQueue } from "./queue";
import { freeDiskBytes, type StatFs } from "./resources";

export interface FarmMetrics extends QueueMetrics {
  freeDiskBytes: number;
  workRootBytes: number;
  storeBytes: number;
  storeObjects: number;
  cacheBytes: number;
}

/** Reads the queue metrics and the host facts. */
export async function farmMetrics(input: { queue: TaskQueue; store: ContentStore; cacheDir?: string; workRoot: string; statfs?: StatFs }): Promise<FarmMetrics> {
  const queue = await input.queue.metrics();
  const objects = input.store.list();
  return {
    ...queue,
    freeDiskBytes: freeDiskBytes(input.workRoot, input.statfs),
    workRootBytes: directoryBytes(input.workRoot),
    storeBytes: objects.reduce((sum, o) => sum + o.size, 0),
    storeObjects: objects.length,
    cacheBytes: input.cacheDir ? directoryBytes(input.cacheDir) : 0,
  };
}

/** One distribution as "p50 / p95 (n)". */
function dist(d: Distribution, scale = 1, digits = 2): string {
  return `p50 ${(d.p50 * scale).toFixed(digits)}, p95 ${(d.p95 * scale).toFixed(digits)} (n=${d.count})`;
}

/** Renders the metrics as the lines `farm status` prints. */
export function formatMetrics(m: FarmMetrics): string {
  const mib = (bytes: number): string => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  const lines = [
    `queue depth: parked ${m.depth.parked}, queued ${m.depth.queued}, leased ${m.depth.leased}, done ${m.depth.done}, dead ${m.depth.dead}`,
    `ready by class: ${Object.entries(m.readyByClass).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `oldest ready task: ${(m.oldestReadyAgeMs / 1000).toFixed(1)} s`,
    `submissions ${m.submissions}, cache hits ${m.cacheHits} (rate ${(m.cacheHitRate * 100).toFixed(1)} percent), coalesced ${m.coalesced}, parked ${m.parkedTotal}`,
    `retries ${m.retries}, dead letters ${m.deadLetters}, late completions ${m.lateCompletions}, released for disk ${m.releasedForDisk}`,
    `queue wait (s): ${dist(m.queueWaitMs, 0.001)}`,
    `worker seconds per task: ${dist(m.renderSeconds)}`,
    ...Object.entries(m.stageSeconds).map(([stage, d]) => `  ${stage} (s): ${dist(d, 1, 3)}`),
    `peak disk per task: ${mib(m.peakDiskBytes.max)}, peak memory per task: ${mib(m.peakMemoryBytes.max)}`,
    `cost so far: ${m.totalCostUsd.toFixed(4)} USD`,
    `free disk: ${(m.freeDiskBytes / 1024 ** 3).toFixed(2)} GiB, work root ${mib(m.workRootBytes)}, store ${m.storeObjects} objects ${mib(m.storeBytes)}, cache ${mib(m.cacheBytes)}`,
  ];
  return lines.join("\n");
}
