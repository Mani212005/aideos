/**
 * File Description: Where a farm keeps its files: the queue database, the content store, the worker cache, the one temp root of the workers and the load-test logs, all under one root directory (`AIDEOS_FARM_DIR`, or `~/.aideos/farm`).
 * Inputs and outputs: an optional root directory -> the absolute paths of the farm's parts.
 * Used by: scripts/farm.ts and backend/farm/loadTest.ts.
 */

import os from "node:os";
import path from "node:path";

export interface FarmPaths {
  root: string;
  queueFile: string;
  storeDir: string;
  cacheDir: string;
  /** The temp root: every worker's private directory lives under it. */
  workRoot: string;
  logsDir: string;
}

/** The farm root from an explicit value, the environment, or the home directory. */
export function farmRoot(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(explicit ?? env.AIDEOS_FARM_DIR ?? path.join(os.homedir(), ".aideos", "farm"));
}

/** The paths of every part of a farm. */
export function farmPaths(root: string = farmRoot()): FarmPaths {
  const base = path.resolve(root);
  return { root: base, queueFile: path.join(base, "queue.sqlite"), storeDir: path.join(base, "store"), cacheDir: path.join(base, "cache"), workRoot: path.join(base, "work"), logsDir: path.join(base, "logs") };
}
