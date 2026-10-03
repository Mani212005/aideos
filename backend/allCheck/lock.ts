/**
 * File Description: One all-check run per video at a time. A lock file in videos/<slug>/all-check/
 * names the tmux window running the agent; a second run is refused with a pointer to the live one,
 * while a lock whose window is gone (crashed, closed without finishing) is stale and is taken over.
 * Creation is atomic (exclusive write), liveness is injectable.
 */

import fs from "node:fs";
import path from "node:path";
import { allCheckDir, AllCheckError, type AgentName } from "./types";

/** The lock record: who holds the video and where to find them. */
export interface LockRecord {
  slug: string;
  agent: AgentName;
  startedAt: string;
  /** Process that created the lock, which is the only owner until the tmux window exists. */
  launcherPid: number;
  /** tmux window id (for example @12) once the agent window exists. */
  tmuxWindowId?: string;
  /** tmux session name, for the attach hint. */
  tmuxSession?: string;
}

/** How liveness is decided: tests inject both. */
export interface LockDeps {
  windowAlive: (windowId: string) => boolean;
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
/** A lock with no window yet is the launcher still starting: trusted this long. */
const STARTING_GRACE_MS = 120_000;

// Path of a video's lock file.
export function lockPath(slug: string): string {
  return path.join(allCheckDir(slug), LOCK_FILE);
}

// Reads the lock of a video, or null when there is none (or it is unreadable).
export function readLock(slug: string): LockRecord | null {
  try {
    return JSON.parse(fs.readFileSync(lockPath(slug), "utf8")) as LockRecord;
  } catch {
    return null;
  }
}

// Decides whether the run a lock names is still going.
export function lockIsLive(lock: LockRecord, deps: LockDeps): boolean {
  if (lock.tmuxWindowId) return deps.windowAlive(lock.tmuxWindowId);
  const age = deps.now() - Date.parse(lock.startedAt);
  return age < STARTING_GRACE_MS && deps.pidAlive(lock.launcherPid);
}

// Describes where a live run is, for the refusal message and the status command.
export function describeLock(lock: LockRecord): string {
  const where = lock.tmuxWindowId
    ? `tmux window ${lock.tmuxWindowId}${lock.tmuxSession ? ` in session "${lock.tmuxSession}" (attach: tmux attach -t ${lock.tmuxSession})` : ""}`
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

// Records the tmux window the agent runs in once it exists.
export function attachWindowToLock(slug: string, windowId: string, session: string): void {
  const lock = readLock(slug);
  if (!lock) return;
  fs.writeFileSync(lockPath(slug), JSON.stringify({ ...lock, tmuxWindowId: windowId, tmuxSession: session }, null, 2) + "\n");
}

// Releases a video's lock.
export function releaseLock(slug: string): void {
  fs.rmSync(lockPath(slug), { force: true });
}

// The real liveness checks: a tmux window by id, a process by pid.
export function realLockDeps(tmuxWindowAlive: (windowId: string) => boolean): LockDeps {
  return { windowAlive: tmuxWindowAlive, pidAlive: realPidAlive, now: () => Date.now() };
}
