/**
 * File Description: The entry points of `aideos all-check`: start a run (preflight, lock, config,
 * brief, tmux window for the background agent), read its status, wait for its result, and roll the
 * film back to a round's backup. Rounds and the finish step live in round.ts and finish.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { writeRepoBaseline } from "./best";
import { resolveAgent, type ResolvedAgent } from "./agent";
import { buildBrief } from "./brief";
import { launchAgentWindow, realTmux, tmuxWindowAlive, writeLaunchScript, type LaunchedWindow, type TmuxRun } from "./launch";
import { acquireLock, attachWindowToLock, describeLock, lockIsLive, readLock, realLockDeps, releaseLock, type LockDeps } from "./lock";
import { formatPreflight, packageProblems, REAL_PREFLIGHT_DEPS, runPreflight, type PreflightDeps } from "./preflight";
import { finishRun } from "./finish";
import { latestRound, readConfig, readRecords } from "./round";
import { allCheckDir, AllCheckError, type AllCheckConfig, type AllCheckOptions, type AllCheckResult } from "./types";

export * from "./types";
export { parseAllCheckOptions } from "./options";
export { rollbackFilm, settleRound, strayFiles, rankRecord } from "./best";
export { runRound, recordFrameCheck, evaluateRecord, realRoundDeps, readRecords, readConfig } from "./round";
export { finishRun } from "./finish";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** The outside world a start touches; the defaults are real. */
export interface StartDeps {
  env: NodeJS.ProcessEnv;
  preflight: PreflightDeps;
  lock: LockDeps;
  tmux: TmuxRun;
  studioRunning: () => boolean;
  now: () => Date;
  /** Opens the agent window; replaced in tests so none is opened. */
  launch: (slug: string, scriptPath: string) => LaunchedWindow;
}

// The real dependencies of a start.
export function realStartDeps(): StartDeps {
  const tmux = realTmux;
  return {
    env: process.env,
    preflight: REAL_PREFLIGHT_DEPS,
    lock: realLockDeps((id) => tmuxWindowAlive(id, tmux)),
    tmux,
    studioRunning: () => {
      const r = spawnSync("lsof", ["-tiTCP:3001", "-sTCP:LISTEN"], { encoding: "utf8" });
      return r.status === 0 && r.stdout.trim().length > 0;
    },
    now: () => new Date(),
    launch: (slug, scriptPath) => launchAgentWindow(slug, scriptPath, { env: process.env, tmux }),
  };
}

/** What a start reports back. */
export interface StartResult {
  slug: string;
  agent: ResolvedAgent;
  window: LaunchedWindow;
  briefPath: string;
  resultPath: string;
  tookOverStaleLock: boolean;
}

// Moves the files of an earlier run aside so the new run starts from an empty folder.
function archivePreviousRun(slug: string, stamp: string): void {
  const dir = allCheckDir(slug);
  if (!fs.existsSync(dir)) return;
  const keep = new Set(["archive", "lock.json"]);
  const old = fs.readdirSync(dir).filter((name) => !keep.has(name));
  if (old.length === 0) return;
  const dest = path.join(dir, "archive", stamp.replace(/[:.]/g, "-"));
  fs.mkdirSync(dest, { recursive: true });
  for (const name of old) fs.renameSync(path.join(dir, name), path.join(dest, name));
}

// Starts a run: refuses a second one, checks preflight, then opens the agent's tmux window.
export function startAllCheck(options: AllCheckOptions, deps: StartDeps = realStartDeps()): StartResult {
  const slug = options.slug;
  const agent = resolveAgent({ flag: options.agent, modelFlag: options.model, allowForbiddenModel: options.allowForbiddenModel });
  const startedAt = deps.now().toISOString();

  // One run per video: the lock is taken first so a second start is refused before any slower check.
  const dir = allCheckDir(slug);
  const missingPackage = packageProblems(slug);
  if (missingPackage.length) throw new AllCheckError(formatPreflight(slug, missingPackage));
  const { tookOverStale } = acquireLock({ slug, agent: agent.agent, startedAt, launcherPid: process.pid }, deps.lock);
  try {
    const problems = runPreflight({ slug, agent: agent.agent }, deps.preflight);
    if (problems.length) throw new AllCheckError(formatPreflight(slug, problems));

    archivePreviousRun(slug, startedAt);
    const config: AllCheckConfig = {
      schema: "aideos.all-check.config/1",
      slug,
      reference: options.reference,
      rounds: options.rounds,
      target: options.target,
      agent: agent.agent,
      model: agent.model,
      startedAt,
      studioWasRunning: deps.studioRunning(),
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n");
    writeRepoBaseline(slug, REPO_ROOT);
    const briefPath = path.join(dir, "brief.md");
    fs.writeFileSync(briefPath, buildBrief(config, REPO_ROOT));
    const scriptPath = writeLaunchScript(slug, agent.agent, briefPath, agent.model);

    const window = deps.launch(slug, scriptPath);
    attachWindowToLock(slug, window.windowId, window.session);
    return { slug, agent, window, briefPath, resultPath: path.join(dir, "result.json"), tookOverStaleLock: tookOverStale };
  } catch (err) {
    releaseLock(slug);
    throw err;
  }
}

/** A snapshot of a run. */
export interface RunStatus {
  state: "idle" | "running" | "finished" | "stopped";
  detail: string;
  roundsMeasured: number;
  lines: string[];
  result?: AllCheckResult;
}

// Reads the saved result of the current run, when there is one.
export function readResult(slug: string): AllCheckResult | null {
  try {
    const result = JSON.parse(fs.readFileSync(path.join(allCheckDir(slug), "result.json"), "utf8")) as AllCheckResult;
    const config = readConfig(slug);
    return result.startedAt === config.startedAt ? result : null;
  } catch {
    return null;
  }
}

// Summarizes where a run stands: running, finished, stopped without a result, or never started.
export function runStatus(slug: string, lockDeps: LockDeps = realStartDeps().lock): RunStatus {
  const result = readResult(slug);
  const records = fs.existsSync(allCheckDir(slug)) ? readRecords(slug) : [];
  const lines = records.map(
    (r) => `round ${r.round} ${r.format}: ${r.review.error ? "review error" : `${r.review.score?.toFixed(1)} ${r.review.verdict}`}, measured ${r.measured.passed === null ? "n/a" : r.measured.passed ? "pass" : "fail"}, frame check ${r.frameCheck.status} -> ${r.passed ? "PASSED" : "not passed"}`,
  );
  const base = { roundsMeasured: latestRound(slug), lines };
  if (result) return { state: "finished", detail: `${result.status}: see ${result.reportPath}`, result, ...base };
  const lock = readLock(slug);
  if (lock && lockIsLive(lock, lockDeps)) return { state: "running", detail: describeLock(lock), ...base };
  if (lock || records.length) return { state: "stopped", detail: "the agent window is gone and no result was written; run: aideos all-check finish " + slug, ...base };
  return { state: "idle", detail: "no all-check run for this video", ...base };
}

/** How a wait ended. */
export interface WaitOutcome {
  outcome: "result" | "timeout" | "stopped" | "idle";
  result?: AllCheckResult;
  status: RunStatus;
  /** True when the result was written by the wait itself because the agent went idle without finishing. */
  finishedByWatchdog?: boolean;
}

/**
 * A watchdog for an agent that stops without running `finish`: an interactive agent that has said
 * its piece just sits at its prompt, so its window never closes. When its screen has not changed for
 * `thresholdMs` and no round or finish command is running, the wait writes the result itself from the
 * tool-written records (it scores nothing).
 */
export interface IdleWatchdog {
  thresholdMs: number;
  paneText: (windowId: string) => string | null;
  roundInFlight: () => boolean;
  finish: (slug: string) => AllCheckResult;
  now?: () => number;
}

// The real watchdog: the tmux pane text, a process check for a running round, and the real finish.
export function realIdleWatchdog(thresholdMs: number): IdleWatchdog {
  return {
    thresholdMs,
    paneText: (windowId) => {
      const r = realTmux(["capture-pane", "-p", "-t", windowId]);
      return r.status === 0 ? r.stdout : null;
    },
    roundInFlight: () => spawnSync("pgrep", ["-f", "all-check[ -](round|finish|frames)"], { encoding: "utf8" }).status === 0,
    finish: (slug) => finishRun(slug),
  };
}

// Polls until the run writes its result, its window disappears, the agent goes idle, or the timeout passes.
export async function waitForResult(
  slug: string,
  opts: { timeoutMs: number; pollMs: number; onProgress?: (line: string) => void; lockDeps?: LockDeps; sleep?: (ms: number) => Promise<void>; idle?: IdleWatchdog },
): Promise<WaitOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.idle?.now ?? Date.now;
  const deadline = now() + opts.timeoutMs;
  let printed = 0;
  let lastScreen: string | null = null;
  let lastChange = now();
  for (;;) {
    const status = runStatus(slug, opts.lockDeps);
    for (; printed < status.lines.length; printed++) opts.onProgress?.(status.lines[printed]);
    if (status.state === "finished") return { outcome: "result", result: status.result, status };
    if (status.state === "stopped") return { outcome: "stopped", status };
    if (status.state === "idle") return { outcome: "idle", status };
    if (opts.idle) {
      const windowId = readLock(slug)?.tmuxWindowId;
      const screen = windowId ? opts.idle.paneText(windowId) : null;
      if (screen !== lastScreen) {
        lastScreen = screen;
        lastChange = now();
      }
      if (screen !== null && !opts.idle.roundInFlight() && now() - lastChange >= opts.idle.thresholdMs) {
        opts.onProgress?.("the agent has gone quiet without finishing: closing the run from the measured records");
        const result = opts.idle.finish(slug);
        return { outcome: "result", result, status: runStatus(slug, opts.lockDeps), finishedByWatchdog: true };
      }
    }
    if (now() >= deadline) return { outcome: "timeout", status };
    await sleep(opts.pollMs);
  }
}
