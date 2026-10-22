/**
 * File Description: One all-check run per video at a time. A lock file in videos/<slug>/all-check/
 * names the Herdr pane running the agent; a second run is refused with a pointer to the live one,
 * while a lock whose pane is gone (crashed, closed without finishing) is stale and is taken over.
 * Creation is atomic (exclusive write), liveness is injectable.
 * Inputs and outputs: slug and lock state -> mutual exclusion lock file.
 * Used by: backend/allCheck/index.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { allCheckDir, AllCheckError } from "./types";
import { attachCommand, herdrLocationSchema, type HerdrLocation } from "./herdr";

const lockSchema = z.object({
  slug: z.string(),
  agent: z.enum(["claude", "agy"]),
  startedAt: z.string(),
  launcherPid: z.number().int(),
  herdr: herdrLocationSchema.optional(),
});
/** Who holds the video, with a location once the Herdr workspace has been created. */
export type LockRecord = z.infer<typeof lockSchema>;

/** How liveness is decided: tests inject both. */
export interface LockDeps {
  paneLive: (location: HerdrLocation) => boolean;
  pidAlive: (pid: number) => boolean;
  now: () => number;
}

// Whether a process id is alive.
function realPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export const LOCK_FILE = "lock.json";
/** A lock with no pane yet is the launcher still starting: trusted this long. */
const STARTING_GRACE_MS = 120_000;

// Path of a video's lock file.
export function lockPath(slug: string): string {
  return path.join(allCheckDir(slug), LOCK_FILE);
}

// Reads the lock of a video, or null when there is none (or it is unreadable).
export function readLock(slug: string): LockRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(lockPath(slug), "utf8"));
  } catch {
    return null;
  }
  if (raw && typeof raw === "object" && ("tmuxWindowId" in raw || "tmuxSession" in raw)) {
    throw new AllCheckError(`this video has a tmux-era all-check lock; if that run is over, delete ${lockPath(slug)}`);
  }
  const parsed = lockSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// Decides whether the run a lock names is still going.
export function lockIsLive(lock: LockRecord, deps: LockDeps): boolean {
  if (lock.herdr) return deps.paneLive(lock.herdr);
  const age = deps.now() - Date.parse(lock.startedAt);
  return age < STARTING_GRACE_MS && deps.pidAlive(lock.launcherPid);
}

// Describes where a live run is, for the refusal message and the status command.
export function describeLock(lock: LockRecord): string {
  const where = lock.herdr
    ? `Herdr workspace "all-check: ${lock.slug}", pane ${lock.herdr.paneId} (attach: ${attachCommand(lock.herdr)})`
    : "a run that is still starting";
  return `${lock.agent} agent since ${lock.startedAt}, in ${where}`;
}

/**
 * Takes the lock for a video. Throws AllCheckError naming the running run when one is live; a stale
 * lock is replaced. Returns whether a stale lock was taken over.
 */
export function acquireLock(record: LockRecord, deps: LockDeps): { tookOverStale: boolean } {
  const file = lockPath(record.slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let tookOverStale = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
      return { tookOverStale };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const existing = readLock(record.slug);
      if (existing && lockIsLive(existing, deps)) {
        throw new AllCheckError(
          `all-check is already running on "${record.slug}": ${describeLock(existing)}. ` +
            `Wait for it (aideos all-check wait ${record.slug}) or read its progress (aideos all-check status ${record.slug}).`,
        );
      }
      fs.rmSync(file, { force: true });
      tookOverStale = true;
    }
  }
  throw new AllCheckError(`could not take the all-check lock for "${record.slug}" (${file})`);
}

// Saves workspace ownership before typing, while the lock still belongs to the starting process.
export function recordOwnedWorkspace(slug: string, herdr: HerdrLocation): void {
  fs.writeFileSync(path.join(allCheckDir(slug), "workspace.json"), JSON.stringify({ slug, herdr }, null, 2) + "\n");
}

// Records the detected workspace in the lock, which finish removes.
export function attachWorkspaceToLock(slug: string, herdr: HerdrLocation): void {
  recordOwnedWorkspace(slug, herdr);
  const lock = readLock(slug);
  if (lock) fs.writeFileSync(lockPath(slug), JSON.stringify({ ...lock, herdr }, null, 2) + "\n");
}

// Reads only the workspace this video's launcher recorded as its own.
export function readOwnedWorkspace(slug: string): HerdrLocation | null {
  try {
    return z.object({ slug: z.literal(slug), herdr: herdrLocationSchema }).parse(JSON.parse(fs.readFileSync(path.join(allCheckDir(slug), "workspace.json"), "utf8"))).herdr;
  } catch {
    return null;
  }
}

// Releases a video's lock.
export function releaseLock(slug: string): void {
  fs.rmSync(lockPath(slug), { force: true });
}

// The real liveness checks: a recorded Herdr pane and the starting process.
export function realLockDeps(paneLive: (location: HerdrLocation) => boolean): LockDeps {
  return { paneLive, pidAlive: realPidAlive, now: () => Date.now() };
}
