/**
 * File Description: The one runner for blocking child processes (execFileSync and spawnSync) that gives every call a time limit. A call that sets its own `timeout` keeps it; any other call gets a default picked by the program: a short limit for quick tools (ffprobe, git, lsof, ps, unzip, open, osascript) and a long ceiling for heavy media and analysis work. A hung child is killed with SIGKILL, so a stalled tool can never freeze a render, a review or the Studio server.
 * Inputs and outputs: a program, its arguments and the usual node child_process options -> the same result node gives (stdout text or Buffer for execFileSyncBounded, a SpawnSyncReturns for spawnSyncBounded), or a failure once the time limit passes.
 * Used by: backend/ (render, audio, review, study, media, geminiReview, allCheck, sceneKit and other tool callers), scripts/, editor/vite.config.ts.
 */

import {
  execFileSync,
  spawnSync,
  type ExecFileSyncOptions,
  type ExecFileSyncOptionsWithBufferEncoding,
  type ExecFileSyncOptionsWithStringEncoding,
  type SpawnSyncOptions,
  type SpawnSyncOptionsWithBufferEncoding,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";
import path from "node:path";

/** The default time limits (ms) a blocking child process runs under when the caller sets none. */
export const PROC_TIMEOUT_MS = {
  /** Quick tools that read a file header, a repo or the process table: well under a second normally. */
  quick: 60_000,
  /** Heavy work (ffmpeg encodes, OCR, whisper, headless Chrome): a ceiling that catches a hang, not a slow job. */
  heavy: 30 * 60_000,
} as const;

/** Programs that finish quickly by nature; everything else counts as heavy work. */
const QUICK_PROGRAMS: ReadonlySet<string> = new Set([
  "ffprobe",
  "git",
  "lsof",
  "ps",
  "unzip",
  "open",
  "xdg-open",
  "osascript",
  "taskkill",
]);

/** The default time limit (ms) for a program, matched on its file name so a full path counts the same. */
export function defaultTimeoutMs(file: string): number {
  const name = path.basename(file).replace(/\.exe$/i, "").toLowerCase();
  return QUICK_PROGRAMS.has(name) ? PROC_TIMEOUT_MS.quick : PROC_TIMEOUT_MS.heavy;
}

/** Adds the default time limit and the kill signal to options that do not set their own. */
function withDeadline<T extends { timeout?: number; killSignal?: NodeJS.Signals | number }>(file: string, options: T | undefined): T {
  return { ...options, timeout: options?.timeout ?? defaultTimeoutMs(file), killSignal: options?.killSignal ?? "SIGKILL" } as T;
}

/** True when a spawnSync result or a thrown execFileSync error is the time limit firing (the child was killed). */
export function isProcTimeout(outcome: unknown): boolean {
  const err = (outcome as { error?: unknown } | null)?.error ?? outcome;
  return (err as { code?: string } | null)?.code === "ETIMEDOUT";
}

/** execFileSync with a time limit: text output when an encoding is set, a Buffer otherwise. Throws when the child fails or times out. */
export function execFileSyncBounded(file: string, args: readonly string[], options: ExecFileSyncOptionsWithStringEncoding): string;
export function execFileSyncBounded(file: string, args: readonly string[], options: ExecFileSyncOptionsWithBufferEncoding): Buffer;
export function execFileSyncBounded(file: string, args?: readonly string[], options?: ExecFileSyncOptions): string | Buffer;
export function execFileSyncBounded(file: string, args?: readonly string[], options?: ExecFileSyncOptions): string | Buffer {
  return execFileSync(file, args, withDeadline(file, options));
}

/** spawnSync with a time limit. On timeout the result carries `error.code === "ETIMEDOUT"` and a null status (see isProcTimeout). */
export function spawnSyncBounded(file: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>;
export function spawnSyncBounded(file: string, args: readonly string[], options: SpawnSyncOptionsWithBufferEncoding): SpawnSyncReturns<Buffer>;
export function spawnSyncBounded(file: string, args?: readonly string[], options?: SpawnSyncOptions): SpawnSyncReturns<string | Buffer>;
export function spawnSyncBounded(file: string, args?: readonly string[], options?: SpawnSyncOptions): SpawnSyncReturns<string | Buffer> {
  return spawnSync(file, args, withDeadline(file, options));
}
