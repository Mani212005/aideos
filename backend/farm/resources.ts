/**
 * File Description: Host resource probes for the farm worker: free bytes on the disk that holds a directory, the resident memory of a process and all its children, and free memory. Each probe can be replaced in tests.
 * Inputs and outputs: a directory or a process id -> bytes.
 * Used by: backend/farm/worker.ts, backend/farm/metrics.ts, backend/farm/loadTest.ts.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The part of fs.statfsSync the probes read. */
export type StatFs = (p: string) => { bavail: number | bigint; bsize: number | bigint };

/** Free bytes on the disk that holds `dir` (the nearest existing parent when it does not exist yet). */
export function freeDiskBytes(dir: string, statfs: StatFs = fs.statfsSync): number {
  let probe = path.resolve(dir);
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const stat = statfs(probe);
  return Number(stat.bavail) * Number(stat.bsize);
}

/** Memory the host can give a new process right now. */
export function freeMemoryBytes(): number {
  return os.freemem();
}

/** Reads one /proc entry's parent id and resident pages, or null when the process is gone or unreadable. */
function readProc(pid: number): { ppid: number; rssPages: number } | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name sits in parentheses and may hold spaces; the fields start after the last ")".
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { ppid: Number(fields[1]), rssPages: Number(fields[21]) };
  } catch {
    return null;
  }
}

/** The resident memory of a process and every descendant in bytes (Linux); this process alone elsewhere. */
export function processTreeRssBytes(rootPid: number = process.pid): number {
  if (process.platform !== "linux") return process.memoryUsage().rss;
  const children = new Map<number, number[]>();
  const pages = new Map<number, number>();
  let names: string[];
  try {
    names = fs.readdirSync("/proc");
  } catch {
    return process.memoryUsage().rss;
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const info = readProc(Number(name));
    if (!info) continue;
    pages.set(Number(name), info.rssPages);
    children.set(info.ppid, [...(children.get(info.ppid) ?? []), Number(name)]);
  }
  const pageSize = 4096;
  let total = 0;
  const stack = [rootPid];
  const seen = new Set<number>();
  while (stack.length) {
    const pid = stack.pop() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += (pages.get(pid) ?? 0) * pageSize;
    stack.push(...(children.get(pid) ?? []));
  }
  return total || process.memoryUsage().rss;
}
