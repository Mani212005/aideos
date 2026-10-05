/**
 * File Description: Preflight of `aideos all-check`. Before any agent starts it checks the things a
 * run cannot recover from halfway: the video package, its voiceover, ffmpeg and tesseract, tmux, the
 * background agent's CLI and the agy login that the Gemini review runs on. Each failure carries the
 * exact fix, and all failures are reported together as one message. Process access is injectable.
 * Inputs and outputs: slug and environment -> preflight readiness check result.
 * Used by: backend/allCheck/index.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getVideosDir, resolvePackageDir, resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import type { AgentName } from "./types";

/** One thing that must be fixed before a run can start. */
export interface PreflightProblem {
  check: "package" | "voiceover" | "ffmpeg" | "tesseract" | "tmux" | "agent" | "agy-login";
  message: string;
  fix: string;
}

/** A finished child process, reduced to what the checks read. */
export interface ProcResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

/** The outside world the checks read; the defaults are real, tests inject fakes. */
export interface PreflightDeps {
  /** Resolves a command on PATH, or null. */
  which: (command: string) => string | null;
  run: (command: string, args: string[], timeoutMs: number) => ProcResult;
}

// Resolves a command on PATH.
function realWhich(command: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

// Runs a command with a timeout and no stdin, never throwing.
function realRun(command: string, args: string[], timeoutMs: number): ProcResult {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error?.message };
}

export const REAL_PREFLIGHT_DEPS: PreflightDeps = { which: realWhich, run: realRun };

// Checks the video package: it exists in the personal videos folder and its film.json parses.
function checkPackage(slug: string, problems: PreflightProblem[]): { film: Record<string, unknown> | null; dir: string } {
  const dir = resolvePackageDir(slug);
  const filmFile = path.join(dir, "film.json");
  if (!fs.existsSync(filmFile)) {
    problems.push({
      check: "package",
      message: `no video package "${slug}": ${filmFile} does not exist`,
      fix: `make the film first (aideos direct "<prompt>" or aideos film --script-file <script.md> --slug ${slug}), or check the slug against: ls ${getVideosDir()}`,
    });
    return { film: null, dir };
  }
  if (!dir.startsWith(getVideosDir() + path.sep)) {
    problems.push({
      check: "package",
      message: `"${slug}" is a read-only example, and all-check edits the film and writes reports into its folder`,
      fix: `copy it into your videos folder: cp -R ${dir} ${path.join(getVideosDir(), slug)}`,
    });
    return { film: null, dir };
  }
  try {
    const film = JSON.parse(fs.readFileSync(filmFile, "utf8")) as Record<string, unknown>;
    if (!Array.isArray(film.shots) || film.shots.length === 0) throw new Error("it has no shots");
    return { film, dir };
  } catch (err) {
    problems.push({
      check: "package",
      message: `${filmFile} is not a usable film: ${err instanceof Error ? err.message : String(err)}`,
      fix: `repair it, or rebuild the package: aideos validate (after making ${slug} the active film), or re-run aideos film for ${slug}`,
    });
    return { film: null, dir };
  }
}

// Checks that the film's voiceover audio exists on disk.
function checkVoiceover(slug: string, film: Record<string, unknown> | null, dir: string, problems: PreflightProblem[]): void {
  if (!film) return;
  const voiceover = film.voiceover as { src?: unknown } | undefined;
  const named = typeof voiceover?.src === "string" ? resolveRepoAssetPath(voiceover.src) : null;
  const fallback = path.join(dir, "voiceover.wav");
  if ((named && fs.existsSync(named)) || fs.existsSync(fallback)) return;
  problems.push({
    check: "voiceover",
    message: `the voiceover of "${slug}" is missing (${named ?? fallback})`,
    fix: `generate it with the audio step: aideos produce (or re-run aideos film --script-file videos/${slug}/script.md --slug ${slug}); all-check never reviews a silent film`,
  });
}

// Checks that the Gemini review's engine, plain agy, is installed and signed in.
function checkAgyLogin(deps: PreflightDeps, problems: PreflightProblem[]): void {
  if (!deps.which("agy")) {
    problems.push({
      check: "agy-login",
      message: "agy (Antigravity CLI) is not on PATH, and the Gemini review runs on it",
      fix: "install the Antigravity CLI, then run: agy",
    });
    return;
  }
  const probe = deps.run("agy", ["models"], 30000);
  const text = `${probe.stdout}\n${probe.stderr}\n${probe.error ?? ""}`;
  if (/sign in|signed in|log ?in|authenticat/i.test(text) || (probe.status !== 0 && probe.status !== null)) {
    problems.push({
      check: "agy-login",
      message: "agy is not signed in, and the Gemini review runs on plain agy",
      fix: "run `agy` once in a terminal and sign in with your Google account, then re-run all-check",
    });
  } else if (probe.status === null) {
    problems.push({
      check: "agy-login",
      message: `agy did not answer within 30 seconds (${probe.error ?? "timed out"})`,
      fix: "check your network, run `agy models` yourself, then re-run all-check",
    });
  }
}

// Checks only that the video package exists and is usable: the cheap check run before the lock is taken.
export function packageProblems(slug: string): PreflightProblem[] {
  const problems: PreflightProblem[] = [];
  checkPackage(slug, problems);
  return problems;
}

// Runs every check and returns the problems found (empty means ready to start).
export function runPreflight(
  input: { slug: string; agent: AgentName },
  deps: PreflightDeps = REAL_PREFLIGHT_DEPS,
): PreflightProblem[] {
  const problems: PreflightProblem[] = [];
  const { film, dir } = checkPackage(input.slug, problems);
  checkVoiceover(input.slug, film, dir, problems);

  if (!deps.which("ffmpeg") || !deps.which("ffprobe")) {
    problems.push({ check: "ffmpeg", message: "ffmpeg and ffprobe are not both on PATH, and rendering and the measured review need them", fix: "brew install ffmpeg" });
  }
  if (!deps.which("tesseract")) {
    problems.push({ check: "tesseract", message: "tesseract is not on PATH, and the measured review reads on-screen text with it", fix: "brew install tesseract" });
  }
  if (!deps.which("tmux")) {
    problems.push({ check: "tmux", message: "tmux is not on PATH, and the background agent runs in its own tmux window", fix: "brew install tmux" });
  }
  if (!deps.which(input.agent)) {
    problems.push({
      check: "agent",
      message: `the background agent "${input.agent}" is not on PATH`,
      fix: input.agent === "claude" ? "install Claude Code, or pass --agent agy" : "install the Antigravity CLI, or pass --agent claude",
    });
  }
  checkAgyLogin(deps, problems);
  return problems;
}

// Formats the problems as the single message the command prints before exiting.
export function formatPreflight(slug: string, problems: PreflightProblem[]): string {
  const lines = [`all-check cannot start for "${slug}" (${problems.length} thing${problems.length === 1 ? "" : "s"} to fix first):`];
  problems.forEach((p, i) => {
    lines.push(`  ${i + 1}. ${p.message}`, `     fix: ${p.fix}`);
  });
  return lines.join("\n");
}
