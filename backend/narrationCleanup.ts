/**
 * File Description: Local post-synthesis voice cleanup step for AIDeos narration audio. Runs a
 * user-configured local cleanup command (for example Resemble Enhance via AIDEOS_NARRATION_CLEANUP_CMD
 * or narrationCleanup.command in aideos.config.json) as the last audio processing step on generated
 * narration WAV files only - never on reference voice recordings and never via a hosted service.
 * Enabled by default: fails plainly with the setting name when unconfigured rather than silently
 * skipping, unless explicitly disabled with AIDEOS_NARRATION_CLEANUP=off (or narrationCleanup.enabled=false).
 * Writes only the single cleaned narration output (no plain-and-cleaned pair).
 * Inputs and outputs: generated narration WAV path, cleanup config/env -> cleaned WAV replacing input in place
 * (re-normalized to canonical PCM loudness), plus a structured NarrationCleanupReport.
 * Used by: backend/audio.ts, backend/pipeline/run.ts, backend/narrationCleanup.test.ts.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { environment } from "./env";
import { loadAideosConfig, configPath, type NarrationCleanupConfig } from "./aideosConfig";
import { decodeWav } from "./pcm";
import { isProcTimeout, spawnSyncBounded } from "./proc";

/** Environment variable that toggles voice cleanup on ("on"/"1"/"true") or off ("off"/"0"/"false"). Default: on. */
export const NARRATION_CLEANUP_ENV = "AIDEOS_NARRATION_CLEANUP";

/** Environment variable holding the local cleanup command template with {in} and {out} placeholders. */
export const NARRATION_CLEANUP_CMD_ENV = "AIDEOS_NARRATION_CLEANUP_CMD";

/** Environment variable overriding the cleanup command timeout in seconds (default 600 s). */
export const NARRATION_CLEANUP_TIMEOUT_ENV = "AIDEOS_NARRATION_CLEANUP_TIMEOUT_SECONDS";

/** Default timeout for one local CPU cleanup job (10 minutes). */
export const DEFAULT_CLEANUP_TIMEOUT_MS = 10 * 60_000;

/** Largest change in narration length (seconds) a cleanup may make before the film timing and sentence spans stop matching the audio. */
export const MAX_CLEANUP_DURATION_DRIFT_SEC = 0.05;

/** Resolved local voice-cleanup configuration. */
export interface ResolvedNarrationCleanup {
  enabled: boolean;
  command: string;
  timeoutMs: number;
}

/** Injectable runner for deterministic unit tests without shelling out or needing model weights. */
export type CleanupCommandRunner = (
  command: string,
  inputWavPath: string,
  outputWavPath: string,
  timeoutMs: number,
) => void | Promise<void>;

/** Per-call cleanup options passed into produceAudioPipeline. */
export interface NarrationCleanupOptions {
  /** Override whether voice cleanup runs (defaults to env/config, which defaults to true). */
  enabled?: boolean;
  /** Override the local cleanup command template containing {in} and {out}. */
  command?: string;
  /** Override the command timeout in milliseconds. */
  timeoutMs?: number;
  /** Injectable command runner for tests. */
  runner?: CleanupCommandRunner;
  /** Environment override (tests). */
  env?: NodeJS.ProcessEnv;
  /** Config file path override (tests). */
  configFile?: string;
}

/** Recorded outcome of the voice cleanup step on one produced narration. */
export interface NarrationCleanupReport {
  status: "applied" | "disabled";
  /** Stable short digest of the command that ran (never contains audio or secrets), or null when disabled. */
  commandHash: string | null;
  /** Plain explanation of what ran or why it was turned off. */
  summary: string;
}

/** Error thrown when voice cleanup is enabled but unconfigured, misconfigured, or fails to produce valid audio. */
export class NarrationCleanupError extends Error {
  code: "not_configured" | "invalid_config" | "command_failed" | "invalid_output" | "timeout";

  // Attaches a machine-readable error code alongside the plain-language remediation message.
  constructor(
    code: "not_configured" | "invalid_config" | "command_failed" | "invalid_output" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "NarrationCleanupError";
    this.code = code;
  }
}

// Parses a boolean toggle string ("on"/"1"/"true" vs "off"/"0"/"false"), throwing on invalid values.
function parseToggle(raw: string, label: string): boolean {
  const norm = raw.trim().toLowerCase();
  if (norm === "on" || norm === "1" || norm === "true" || norm === "yes") return true;
  if (norm === "off" || norm === "0" || norm === "false" || norm === "no") return false;
  throw new NarrationCleanupError(
    "invalid_config",
    `${label}="${raw}" is not valid. Use "on" or "off" (default "on").`,
  );
}

// Parses a positive timeout in seconds into milliseconds, throwing on invalid values.
function parseTimeoutSeconds(raw: string, label: string): number {
  const secs = /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(secs) || secs <= 0 || secs > 24 * 60 * 60) {
    throw new NarrationCleanupError(
      "invalid_config",
      `${label}="${raw}" is not a valid timeout in seconds (must be > 0 and <= 86400).`,
    );
  }
  return Math.round(secs * 1000);
}

// Quotes a filesystem path safely for POSIX /bin/sh single-quoted substitution.
function shellQuote(filePath: string): string {
  return `'${filePath.replace(/'/g, `'\\''`)}'`;
}

// Validates that a local cleanup command template includes both {in} and {out} placeholders.
export function assertValidCleanupCommand(command: string): void {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new NarrationCleanupError(
      "not_configured",
      `Voice cleanup is ON by default for AIDeos narration, but no local cleanup command is configured. ` +
        `Set ${NARRATION_CLEANUP_CMD_ENV} (or narrationCleanup.command in aideos.config.json) to a local command template containing {in} and {out}, ` +
        `or disable cleanup explicitly with ${NARRATION_CLEANUP_ENV}=off.`,
    );
  }
  if (!trimmed.includes("{in}") || !trimmed.includes("{out}")) {
    throw new NarrationCleanupError(
      "invalid_config",
      `Narration cleanup command must include both {in} and {out} placeholders for the input and output WAV paths.`,
    );
  }
}

// Computes a short deterministic hash of the cleanup command for narration cache fingerprinting.
export function cleanupCommandHash(command: string): string {
  return createHash("sha256").update(command.trim()).digest("hex").slice(0, 12);
}

// Resolves cleanup settings: explicit options -> env vars -> aideos.config.json -> defaults (enabled: true, command: "").
export function resolveNarrationCleanupConfig(
  options: NarrationCleanupOptions = {},
): ResolvedNarrationCleanup {
  const env = options.env ?? environment;
  let fromFile: NarrationCleanupConfig = { enabled: true, command: "", timeoutSec: DEFAULT_CLEANUP_TIMEOUT_MS / 1000 };
  const file = options.configFile ?? configPath(env);
  if (fs.existsSync(file)) {
    const loaded = loadAideosConfig(file).narrationCleanup;
    if (loaded) fromFile = loaded;
  }

  let enabled: boolean;
  if (options.enabled !== undefined) {
    enabled = options.enabled;
  } else if (env[NARRATION_CLEANUP_ENV] !== undefined && env[NARRATION_CLEANUP_ENV]!.trim() !== "") {
    enabled = parseToggle(env[NARRATION_CLEANUP_ENV]!, NARRATION_CLEANUP_ENV);
  } else {
    enabled = fromFile.enabled;
  }

  const command = (options.command ?? env[NARRATION_CLEANUP_CMD_ENV] ?? fromFile.command ?? "").trim();

  let timeoutMs: number;
  if (options.timeoutMs !== undefined) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new NarrationCleanupError("invalid_config", `narration cleanup timeoutMs must be positive, got ${options.timeoutMs}`);
    }
    timeoutMs = options.timeoutMs;
  } else if (env[NARRATION_CLEANUP_TIMEOUT_ENV] !== undefined && env[NARRATION_CLEANUP_TIMEOUT_ENV]!.trim() !== "") {
    timeoutMs = parseTimeoutSeconds(env[NARRATION_CLEANUP_TIMEOUT_ENV]!, NARRATION_CLEANUP_TIMEOUT_ENV);
  } else {
    timeoutMs = Math.round(fromFile.timeoutSec * 1000);
  }

  return { enabled, command, timeoutMs };
}

// Returns a cache-fingerprint token representing the active voice cleanup state.
export function narrationCleanupFingerprint(options: NarrationCleanupOptions = {}): string {
  const cfg = resolveNarrationCleanupConfig(options);
  if (!cfg.enabled) return "cleanup:off";
  return cfg.command ? `cleanup:on:${cleanupCommandHash(cfg.command)}` : "cleanup:on:unconfigured";
}

// Runs the configured local shell command template on temp input/output WAV paths, strictly one process at a time.
function defaultCleanupRunner(
  command: string,
  inputWavPath: string,
  outputWavPath: string,
  timeoutMs: number,
): void {
  const expanded = command
    .replace(/\{in\}/g, shellQuote(inputWavPath))
    .replace(/\{out\}/g, shellQuote(outputWavPath));
  const run = spawnSyncBounded("/bin/sh", ["-c", expanded], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...environment,
      AIDEOS_CLEANUP_IN: inputWavPath,
      AIDEOS_CLEANUP_OUT: outputWavPath,
    },
  });
  if (isProcTimeout(run)) {
    throw new NarrationCleanupError(
      "timeout",
      `Local narration cleanup command timed out after ${Math.round(timeoutMs / 1000)} s.`,
    );
  }
  if (run.error) {
    throw new NarrationCleanupError(
      "command_failed",
      `Could not start local narration cleanup command: ${run.error.message}`,
    );
  }
  if (run.status !== 0) {
    const detail = (run.stderr || run.stdout || "").trim().slice(-400);
    throw new NarrationCleanupError(
      "command_failed",
      `Local narration cleanup command failed with exit ${run.status}${detail ? `: ${detail}` : ""}`,
    );
  }
}

// Verifies that the cleanup command wrote a valid non-empty RIFF/WAVE file.
function assertValidWavFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new NarrationCleanupError(
      "invalid_output",
      `Local narration cleanup command finished without writing the output WAV (${path.basename(filePath)}).`,
    );
  }
  const stat = fs.statSync(filePath);
  if (stat.size <= 44) {
    throw new NarrationCleanupError(
      "invalid_output",
      `Local narration cleanup command wrote an empty or truncated WAV (${stat.size} bytes).`,
    );
  }
  const head = Buffer.alloc(12);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, head, 0, 12, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") {
    throw new NarrationCleanupError(
      "invalid_output",
      "Local narration cleanup command output is not a valid RIFF/WAVE audio file.",
    );
  }
}

// Reads a WAV file's duration in seconds, failing plainly when it cannot be decoded.
function wavDurationSec(filePath: string): number {
  try {
    const wav = decodeWav(fs.readFileSync(filePath));
    return wav.samples.length / Math.max(1, wav.channels) / wav.sampleRate;
  } catch (err) {
    throw new NarrationCleanupError(
      "invalid_output",
      `Could not read ${path.basename(filePath)} to check the narration length: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Fails when the cleaned narration is not the same length as the narration it replaces, since timings are locked to the original.
function assertCleanupKeptDuration(originalPath: string, cleanedPath: string): void {
  const before = wavDurationSec(originalPath);
  const after = wavDurationSec(cleanedPath);
  if (Math.abs(after - before) > MAX_CLEANUP_DURATION_DRIFT_SEC) {
    throw new NarrationCleanupError(
      "invalid_output",
      `Local narration cleanup changed the narration length from ${before.toFixed(3)} s to ${after.toFixed(3)} s ` +
        `(more than ${MAX_CLEANUP_DURATION_DRIFT_SEC} s), so captions, shot timing and the sentence checks would no longer match the audio. ` +
        `Use a cleanup command that keeps the duration, or turn cleanup off with ${NARRATION_CLEANUP_ENV}=off.`,
    );
  }
}

// Serializes local cleanup jobs within this process so CPU-bound models never run concurrently.
let activeCleanupQueue: Promise<void> = Promise.resolve();

// Runs local post-synthesis voice cleanup on generated narration WAV in place, leaving only the single cleaned file.
export async function applyNarrationCleanup(
  voiceoverPath: string,
  options: NarrationCleanupOptions = {},
  finalizeWav?: (cleanedPath: string, targetPath: string) => void,
): Promise<NarrationCleanupReport> {
  const cfg = resolveNarrationCleanupConfig(options);
  if (!cfg.enabled) {
    return {
      status: "disabled",
      commandHash: null,
      summary: `voice cleanup disabled (${NARRATION_CLEANUP_ENV}=off or narrationCleanup.enabled=false)`,
    };
  }
  assertValidCleanupCommand(cfg.command);

  const hash = cleanupCommandHash(cfg.command);
  const runner = options.runner ?? defaultCleanupRunner;

  const runJob = async (): Promise<NarrationCleanupReport> => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-narration-cleanup-"));
    const stagedIn = path.join(tmpDir, "narration.wav");
    const stagedOut = path.join(tmpDir, "cleaned.wav");
    const stagedFinal = `${voiceoverPath}.cleaned.wav`;
    try {
      fs.copyFileSync(voiceoverPath, stagedIn);
      await runner(cfg.command, stagedIn, stagedOut, cfg.timeoutMs);
      assertValidWavFile(stagedOut);
      if (finalizeWav) finalizeWav(stagedOut, stagedFinal);
      else fs.copyFileSync(stagedOut, stagedFinal);
      assertValidWavFile(stagedFinal);
      assertCleanupKeptDuration(voiceoverPath, stagedFinal);
      fs.renameSync(stagedFinal, voiceoverPath);
      return {
        status: "applied",
        commandHash: hash,
        summary: `local voice cleanup applied to generated narration only (command ${hash})`,
      };
    } finally {
      fs.rmSync(stagedFinal, { force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };

  // Queue strictly one cleanup job at a time inside the process.
  const previous = activeCleanupQueue;
  let release!: () => void;
  activeCleanupQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await runJob();
  } finally {
    release();
  }
}
