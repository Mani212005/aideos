/**
 * File Description: The originating agent session of a film: which coding agent (harness), which model and
 * which Herdr pane the user started the film with. It is detected from the calling process (environment,
 * the Herdr pane's detected agent, the agent's own command line) and recorded in the video package so that
 * review feedback is delivered to that same session and, when that session is gone, a replacement agent
 * inherits its harness and model. Nothing here names a model of its own: an unknown model stays null (the
 * harness then uses the model the user configured for it) and is never guessed. Process access is injectable.
 * Inputs and outputs: process environment, Herdr pane facts and the process ancestry -> OriginSession record on disk.
 * Used by: backend/allCheck/index.ts, backend/allCheck/agent.ts, backend/allCheck/feedback.ts, backend/aideosConfig.ts.
 */

import { environment } from "../env";

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePackageDir } from "../videoPackageLoader";
import { herdrSocket, paneInfo, realHerdr, type HerdrLocation, type HerdrRun } from "../allCheck/herdr";

/** The coding agents aideos can start itself (a replacement) and recognize as an originating session. */
export const LAUNCHABLE_HARNESSES = ["claude", "agy", "codex", "opencode"] as const;
export type Harness = (typeof LAUNCHABLE_HARNESSES)[number];

/** The session a film was started from. */
export interface OriginSession {
  schema: "aideos.origin-session/1";
  /** The harness name; one of LAUNCHABLE_HARNESSES, or another name Herdr detected (which aideos cannot start itself). */
  agent: string;
  /** The model the session runs, or null when the harness does not expose it (never a guess). */
  model: string | null;
  /** Where the session's pane is, when it runs inside Herdr. */
  herdr?: HerdrLocation;
  /** The agent process, when it could be found in the caller's ancestry. */
  pid?: number;
  /** How each fact was learned, for the record. */
  source: { agent: string; model: string };
  recordedAt: string;
}

/** One process in the caller's ancestry. */
export interface AncestorProcess {
  pid: number;
  args: string;
}

/** The outside world detection reads; the defaults are real. */
export interface DetectDeps {
  env: NodeJS.ProcessEnv;
  herdr: HerdrRun;
  /** The caller's ancestors, nearest first. */
  ancestors: () => AncestorProcess[];
  now: () => Date;
}

// Maps any agent name or alias to the harness name aideos uses; unknown names pass through lowercased.
export function normalizeHarness(value: string | undefined | null): string | undefined {
  const v = value?.trim().toLowerCase();
  if (!v) return undefined;
  if (v.startsWith("claude")) return "claude";
  if (v.startsWith("codex")) return "codex";
  if (v.startsWith("opencode")) return "opencode";
  if (v === "agy" || v.startsWith("antigravity") || v === "gemini") return "agy";
  return v;
}

// Reads the model flag out of an agent command line: --model X, --model=X or -m X.
export function modelFromArgs(args: string): string | undefined {
  const match = /(?:^|\s)(?:--model|-m)(?:=|\s+)([^\s"']+)/.exec(args);
  return match?.[1];
}

// True when a command line is the given harness (its binary or its node script), not a tool that mentions it.
function runsHarness(args: string, harness: string): boolean {
  const bins = harness === "agy" ? ["agy", "antigravity"] : [harness];
  const parts = args.trim().split(/\s+/).slice(0, 3);
  return parts.some((part) => bins.includes(path.basename(part).replace(/\.(js|mjs|cjs)$/, "")));
}

// The nearest ancestor that is the harness, with its command line.
function findAgentProcess(harness: string, ancestors: AncestorProcess[]): AncestorProcess | undefined {
  return ancestors.find((p) => runsHarness(p.args, harness));
}

// Walks up the process tree from this process with `ps`, nearest first, at most 16 levels.
export function realAncestors(startPid: number = process.ppid): AncestorProcess[] {
  const out: AncestorProcess[] = [];
  let pid = startPid;
  for (let depth = 0; depth < 16 && pid > 1; depth++) {
    const r = spawnSync("ps", ["-o", "ppid=,args=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 });
    if (r.status !== 0) break;
    const match = /^\s*(\d+)\s+(.*)$/s.exec(r.stdout.trim());
    if (!match) break;
    out.push({ pid, args: match[2].trim() });
    pid = Number(match[1]);
  }
  return out;
}

// The real dependencies of detection.
export function realDetectDeps(): DetectDeps {
  return { env: environment, herdr: realHerdr, ancestors: () => realAncestors(), now: () => new Date() };
}

// The harness the environment names, with the variable that said so.
function harnessFromEnv(env: NodeJS.ProcessEnv): { agent: string; source: string } | undefined {
  const explicit = normalizeHarness(env.AIDEOS_AGENT);
  if (explicit) return { agent: explicit, source: "AIDEOS_AGENT" };
  const ai = normalizeHarness(env.AI_AGENT);
  if (ai) return { agent: ai, source: "AI_AGENT" };
  if (env.CLAUDECODE === "1" || env.CLAUDE_CODE_SESSION_ID) return { agent: "claude", source: "CLAUDECODE" };
  if (env.CODEX_THREAD_ID || env.CODEX_CI || env.CODEX_SANDBOX) return { agent: "codex", source: "CODEX_*" };
  if (env.OPENCODE || env.OPENCODE_PID) return { agent: "opencode", source: "OPENCODE" };
  return undefined;
}

// This process's own Herdr pane, when it runs inside one.
function herdrLocationFromEnv(env: NodeJS.ProcessEnv): HerdrLocation | undefined {
  if (env.HERDR_ENV !== "1" || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID) return undefined;
  return { socketPath: herdrSocket(env), workspaceId: env.HERDR_WORKSPACE_ID, paneId: env.HERDR_PANE_ID, agentName: null };
}

/**
 * Detects the agent session the caller is running in, or null when it is not an agent session (a plain
 * terminal, a script, the studio server). Model: an explicit AIDEOS_AGENT_MODEL, then ANTHROPIC_MODEL for
 * claude, then the --model on the agent's own command line; otherwise null (the harness's own default).
 */
export function detectOriginSession(deps: DetectDeps = realDetectDeps()): OriginSession | null {
  const { env } = deps;
  const herdr = herdrLocationFromEnv(env);
  let agent = harnessFromEnv(env);
  if (!agent && herdr) {
    try {
      const detected = normalizeHarness(paneInfo(herdr, deps.herdr)?.agent);
      if (detected) agent = { agent: detected, source: "herdr pane" };
    } catch {
      // Herdr unreachable: the pane's agent stays unknown.
    }
  }
  if (!agent) return null;

  const ancestors = deps.ancestors();
  const proc = findAgentProcess(agent.agent, ancestors);
  let model: string | null = null;
  let modelSource = "unknown (the harness does not expose it; its own default applies)";
  const fromEnv = env.AIDEOS_AGENT_MODEL?.trim() || (agent.agent === "claude" ? env.ANTHROPIC_MODEL?.trim() : undefined);
  const fromArgs = proc ? modelFromArgs(proc.args) : undefined;
  if (fromEnv) {
    model = fromEnv;
    modelSource = env.AIDEOS_AGENT_MODEL?.trim() ? "AIDEOS_AGENT_MODEL" : "ANTHROPIC_MODEL";
  } else if (fromArgs) {
    model = fromArgs;
    modelSource = "--model on the agent command line";
  }
  return {
    schema: "aideos.origin-session/1",
    agent: agent.agent,
    model,
    ...(herdr ? { herdr } : {}),
    ...(proc ? { pid: proc.pid } : {}),
    source: { agent: agent.source, model: modelSource },
    recordedAt: deps.now().toISOString(),
  };
}

// Where a film's originating session is recorded.
export function originSessionPath(slug: string): string {
  return path.join(resolvePackageDir(slug), "origin-session.json");
}

// Records the session a film was started from, replacing an earlier record.
export function recordOriginSession(slug: string, session: OriginSession): void {
  const file = originSessionPath(slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(session, null, 2) + "\n");
}

// Reads a film's recorded originating session, or null when none (or an unreadable one) is recorded.
export function readOriginSession(slug: string): OriginSession | null {
  try {
    const raw = JSON.parse(fs.readFileSync(originSessionPath(slug), "utf8")) as Partial<OriginSession>;
    if (raw.schema !== "aideos.origin-session/1" || typeof raw.agent !== "string" || !raw.agent) return null;
    return { ...(raw as OriginSession), model: typeof raw.model === "string" && raw.model ? raw.model : null };
  } catch {
    return null;
  }
}
