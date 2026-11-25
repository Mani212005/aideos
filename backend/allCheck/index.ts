/**
 * File Description: The entry points of `aideos all-check`: start a run (preflight, lock, config,
 * brief), read its status, wait for its result, and roll the film back to a round's backup. The fixing
 * agent is the session the user started the film with: when all-check is run from that agent session
 * nothing new is started and the session itself runs the rounds and fixes (so its own harness and model
 * do the work). When the caller is no agent session but the recorded originating session is still running
 * (or its liveness cannot be told) nothing new is started either: the round runs and its feedback goes to
 * that session. Only when that session is verified gone (or --agent / --model is named) is a replacement
 * agent started in its own Herdr workspace, inheriting the recorded session's harness and model. Rounds and the finish step live in round.ts and finish.ts.
 * Inputs and outputs: slug and options -> full multi-round all-check execution result.
 * Used by: backend/allCheck/cli.ts, backend/allCheck/agent.ts.
 */

import { DEFAULT_STUDIO_PORT } from "../../src/dl/defaults";

import { environment } from "../env";
import { REPO_ROOT as repositoryRoot } from "../paths";

import { formatScore } from "../geminiReview/verdictPolicy";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { writeRepoBaseline } from "./best";
import { resolveAgent, type ResolvedAgent } from "./agent";
import { detectOriginSession, readOriginSession, realDetectDeps, recordOriginSession, type OriginSession } from "../agentSession/originSession";
import { buildBrief } from "./brief";
import { launchAgentWorkspace, writeLaunchScript, type LaunchedWorkspace } from "./launch";
import { attachCommand, closeIdleWorkspace, herdrSocket, paneInfo, paneLive, readPane, realHerdr, type AgentStatus, type HerdrLocation, type HerdrRun } from "./herdr";
import { acquireLock, attachWorkspaceToLock, readOwnedWorkspace, recordOwnedWorkspace, describeLock, lockIsLive, readLock, realLockDeps, releaseLock, type LockDeps } from "./lock";
import { formatPreflight, packageProblems, REAL_PREFLIGHT_DEPS, runPreflight, type PreflightDeps } from "./preflight";
import { finishRun } from "./finish";
import { latestRound, readConfig, readRecords } from "./round";
import { allCheckDir, AllCheckError, type AgentName, type AllCheckConfig, type AllCheckOptions, type AllCheckResult } from "./types";
import { spawnSyncBounded } from "../proc";

export * from "./types";
export { parseAllCheckOptions } from "./options";
export { rollbackFilm, settleRound, strayFiles, rankRecord } from "./best";
export { runRound, recordFrameCheck, evaluateRecord, realRoundDeps, readRecords, readConfig } from "./round";
export { finishRun } from "./finish";

const REPO_ROOT = repositoryRoot;

/** The outside world a start touches; the defaults are real. */
export interface StartDeps {
  env: NodeJS.ProcessEnv;
  preflight: PreflightDeps;
  lock: LockDeps;
  herdr: HerdrRun;
  studioRunning: () => boolean;
  now: () => Date;
  /** The agent session this command runs in, or null when it is not one (a plain terminal, a script). */
  session?: () => OriginSession | null;
  /** Opens only the run's own workspace; tests replace it. */
  launch: (slug: string, scriptPath: string, agent: AgentName, onCreated: (location: HerdrLocation) => void) => LaunchedWorkspace;
}

// The real dependencies of a start.
export function realStartDeps(): StartDeps {
  const herdr = realHerdr;
  return {
    env: environment,
    preflight: REAL_PREFLIGHT_DEPS,
    lock: realLockDeps((location) => paneLive(location, herdr)),
    herdr,
    studioRunning: () => {
      const r = spawnSyncBounded("lsof", [`-tiTCP:${DEFAULT_STUDIO_PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" });
      return r.status === 0 && r.stdout.trim().length > 0;
    },
    now: () => new Date(),
    session: () => detectOriginSession(realDetectDeps()),
    launch: (slug, scriptPath, agent, onCreated) => launchAgentWorkspace(slug, scriptPath, { agent, onCreated, env: environment, herdr }),
  };
}

/** The agent doing the fixing and how it was chosen. */
export type StartedAgent = Omit<ResolvedAgent, "agent"> & { agent: string };

/** What a start reports back. */
export interface StartResult {
  slug: string;
  agent: StartedAgent;
  /** "in-session": the caller's own session runs the rounds and fixes, nothing was started. "origin-session": the caller is no agent session but the one that started the film is still running (or unconfirmed), so it keeps the work and nothing was started. "launched": a replacement agent was started. */
  mode: "in-session" | "origin-session" | "launched";
  /** For "origin-session": whether that session was confirmed running or its liveness could not be determined. */
  originState?: "alive" | "unknown";
  /** The replacement agent's Herdr workspace; null in-session. */
  workspace: LaunchedWorkspace | null;
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

// True when the lock names the very session that is starting again (same pane or same agent process).
function isSameSession(lock: ReturnType<typeof readLock>, live: OriginSession): boolean {
  if (!lock?.inSession) return false;
  return (lock.herdr && live.herdr && lock.herdr.paneId === live.herdr.paneId && lock.herdr.socketPath === live.herdr.socketPath) || (live.pid !== undefined && lock.launcherPid === live.pid);
}

// Tells whether a recorded session is still running: "gone" only when a probe said so; a probe that cannot answer is "unknown" and is treated as running.
function originLiveness(origin: OriginSession, deps: StartDeps): "alive" | "gone" | "unknown" {
  try {
    if (origin.herdr) return deps.lock.paneLive(origin.herdr) ? "alive" : "gone";
    if (origin.pid !== undefined) return deps.lock.pidAlive(origin.pid) ? "alive" : "gone";
  } catch {
    return "unknown";
  }
  return "unknown";
}

// Starts a run: refuses a second one, checks preflight, records the originating session, then either keeps the work in that session (the caller's own, or the recorded one while it still runs) or (when it is verified gone) opens a replacement agent's Herdr workspace.
export function startAllCheck(options: AllCheckOptions, deps: StartDeps = realStartDeps()): StartResult {
  const slug = options.slug;
  const live = deps.session?.() ?? null;
  // Naming an agent or model is an explicit request for that agent; otherwise the session that started the film does the work.
  const explicit = Boolean(options.agent || options.model);
  const recorded = live || explicit ? null : readOriginSession(slug);
  const recordedState = recorded ? originLiveness(recorded, deps) : "gone";
  const owner: OriginSession | null = explicit ? null : (live ?? (recorded && recordedState !== "gone" ? recorded : null));
  if (owner && !owner.herdr && owner.pid === undefined) {
    throw new AllCheckError(
      live
        ? `cannot tell when this ${owner.agent} session ends (no Herdr pane and no agent process found), so the run could not be locked to it: run all-check inside Herdr, or pass --agent to start a replacement on purpose`
        : `the ${owner.agent} session that started this film is recorded without a Herdr pane or process, so aideos cannot tell whether it is still running and will not start a second agent: run all-check from that session, or pass --agent (and --model) to start a replacement on purpose`,
    );
  }
  const agent: StartedAgent = owner
    ? { agent: owner.agent, model: owner.model, source: "session" }
    : resolveAgent({ flag: options.agent, modelFlag: options.model, allowForbiddenModel: options.allowForbiddenModel, origin: live ?? readOriginSession(slug) });
  const startedAt = deps.now().toISOString();

  // One run per video: the lock is taken first so a second start is refused before any slower check.
  const dir = allCheckDir(slug);
  const missingPackage = packageProblems(slug);
  if (missingPackage.length) throw new AllCheckError(formatPreflight(slug, missingPackage));
  const previousWorkspace = readOwnedWorkspace(slug);
  // The session that holds the lock asking again is a restart, not a second run.
  if (live && isSameSession(readLock(slug), live)) releaseLock(slug);
  const { tookOverStale } = acquireLock(
    { slug, agent: agent.agent, startedAt, launcherPid: owner ? (owner.pid ?? process.pid) : process.pid, ...(owner ? { inSession: true, ...(owner.herdr ? { herdr: owner.herdr } : {}) } : {}) },
    deps.lock,
  );
  try {
    const problems = runPreflight({ slug, agent: owner ? null : (agent.agent as AgentName), socketPath: herdrSocket(deps.env) }, deps.preflight, deps.herdr);
    if (problems.length) throw new AllCheckError(formatPreflight(slug, problems));

    if (previousWorkspace) closeIdleWorkspace(previousWorkspace, deps.herdr);
    archivePreviousRun(slug, startedAt);
    if (live) recordOriginSession(slug, live);
    const config: AllCheckConfig = {
      schema: "aideos.all-check.config/1",
      slug,
      reference: options.reference,
      rounds: options.rounds,
      target: options.target,
      agent: agent.agent,
      model: agent.model,
      inSession: owner !== null,
      startedAt,
      studioWasRunning: deps.studioRunning(),
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n");
    writeRepoBaseline(slug, REPO_ROOT);
    const briefPath = path.join(dir, "brief.md");
    fs.writeFileSync(briefPath, buildBrief(config, REPO_ROOT));
    const resultPath = path.join(dir, "result.json");

    if (owner) {
      const base = { slug, agent, workspace: null, briefPath, resultPath, tookOverStaleLock: tookOverStale };
      if (live) return { ...base, mode: "in-session" };
      return { ...base, mode: "origin-session", originState: recordedState === "alive" ? "alive" : "unknown" };
    }
    const scriptPath = writeLaunchScript(slug, agent.agent as AgentName, briefPath, agent.model, deps.env);
    const workspace = deps.launch(slug, scriptPath, agent.agent as AgentName, (location) => recordOwnedWorkspace(slug, location));
    attachWorkspaceToLock(slug, workspace);
    return { slug, agent, mode: "launched", workspace, briefPath, resultPath, tookOverStaleLock: tookOverStale };
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
    (r) => `round ${r.round} ${r.format}: ${r.review.error ? "review error" : `${r.review.score === null ? "n/a" : formatScore(r.review.score)} ${r.review.verdict}`}, measured ${r.measured.passed === null ? "n/a" : r.measured.passed ? "pass" : "fail"}, frame check ${r.frameCheck.status} -> ${r.passed ? "PASSED" : "not passed"}`,
  );
  const base = { roundsMeasured: latestRound(slug), lines };
  if (result) return { state: "finished", detail: `${result.status}: see ${result.reportPath}`, result, ...base };
  const lock = readLock(slug);
  if (lock && lockIsLive(lock, lockDeps)) return { state: "running", detail: describeLock(lock), ...base };
  if (lock || records.length) return { state: "stopped", detail: "the agent pane is gone or has returned to its shell and no result was written; run: aideos all-check finish " + slug, ...base };
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
 * its piece just sits at its prompt, so its pane never closes. When its screen has not changed for
 * `thresholdMs` and no round or finish command is running, the wait writes the result itself from the
 * tool-written records (it scores nothing).
 */
export interface IdleWatchdog {
  thresholdMs: number;
  paneText: (location: HerdrLocation) => string | null;
  agentStatus: (location: HerdrLocation) => AgentStatus;
  roundInFlight: (slug: string) => boolean;
  finish: (slug: string) => AllCheckResult;
  now?: () => number;
}

// Quotes the slug in pgrep's extended regular expression.
export function roundProcessPattern(slug: string): string {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `all-check[ -](round|finish|frames)[[:space:]]+${escaped}([[:space:]]|$)`;
}

// The real watchdog reads Herdr's status and screen, and checks only this video's round processes.
export function realIdleWatchdog(thresholdMs: number): IdleWatchdog {
  return {
    thresholdMs,
    paneText: (location) => readPane(location),
    agentStatus: (location) => {
      const pane = paneInfo(location);
      return pane?.agent ? pane.agent_status : "unknown";
    },
    roundInFlight: (slug) => spawnSync("pgrep", ["-f", roundProcessPattern(slug)], { encoding: "utf8" }).status === 0,
    finish: (slug) => finishRun(slug),
  };
}

// Polls until the run writes its result, its pane disappears, the agent goes idle, or the timeout passes.
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
  let reportedBlocked = false;
  for (;;) {
    const status = runStatus(slug, opts.lockDeps);
    for (; printed < status.lines.length; printed++) opts.onProgress?.(status.lines[printed]);
    if (status.state === "finished") return { outcome: "result", result: status.result, status };
    if (status.state === "stopped") return { outcome: "stopped", status };
    if (status.state === "idle") return { outcome: "idle", status };
    if (opts.idle && !readLock(slug)?.inSession) {
      const location = readLock(slug)?.herdr;
      const agentStatus = location ? opts.idle.agentStatus(location) : "unknown";
      const fallback = agentStatus === "unknown";
      const screen = fallback && location ? opts.idle.paneText(location) : null;
      if (agentStatus === "working" || (fallback && screen !== lastScreen)) lastChange = now();
      lastScreen = screen;
      if (agentStatus === "blocked" && location && !reportedBlocked) {
        opts.onProgress?.(`agent is waiting for input in Herdr pane ${location.paneId} (${attachCommand(location)})`);
        reportedBlocked = true;
      }
      const roundRunning = opts.idle.roundInFlight(slug);
      if (roundRunning) lastChange = now();
      if (location && (fallback ? screen !== null : agentStatus !== "working") && !roundRunning && now() - lastChange >= opts.idle.thresholdMs) {
        opts.onProgress?.("the agent has gone quiet without finishing: closing the run from the measured records");
        const result = opts.idle.finish(slug);
        return { outcome: "result", result, status: runStatus(slug, opts.lockDeps), finishedByWatchdog: true };
      }
    }
    if (now() >= deadline) return { outcome: "timeout", status };
    await sleep(opts.pollMs);
  }
}
