/**
 * File Description: Motion you describe - the Motion stage's requests.
 * The owner says what should move in a shot; the request goes to their connected coding agent as a
 * shot-focused design task (or, with no agent, to the server model), which edits the film's
 * design.json and artwork and builds until the design check passes. Every request is recorded in
 * videos/<id>/design/motion-requests.json with a snapshot of the design it replaced, so the studio
 * can show what came of it and revert it.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Film } from "../../src/dl/schema";
import { dispatchTask } from "../agentBridge/dispatcher";
import { taskQueue } from "../agentBridge/taskQueue";
import { readFilm, writeFilm } from "../pipeline/filmStore";
import { buildDesign, designDir, readDesignStatus } from "./build";
import { writeDesignBrief } from "./brief";
import { designWithServerModel, type DesignLlmCaller } from "./designer";
import type { DesignSource } from "./compile";

/** One described motion and what came of it. */
export interface MotionRequest {
  id: string;
  filmId: string;
  shotId: string;
  prompt: string;
  at: string;
  by: "agent" | "server-model" | "none";
  state: "sent" | "passed" | "failed" | "undelivered" | "reverted";
  message?: string;
  taskId?: string;
  /** True when a design existed before this request (its snapshot is in design/history/). */
  hadDesign: boolean;
  /** Who made the design this request replaced, so a revert keeps its label. */
  prevSource?: DesignSource;
}

// The request log for a film.
function logFile(filmId: string): string {
  return path.join(designDir(filmId), "motion-requests.json");
}

// The snapshot of the design a request replaced.
function snapshotFile(filmId: string, requestId: string): string {
  return path.join(designDir(filmId), "history", `${requestId}.json`);
}

// Reads a film's request log, newest first.
function readLog(filmId: string): MotionRequest[] {
  try {
    return JSON.parse(fs.readFileSync(logFile(filmId), "utf8")) as MotionRequest[];
  } catch {
    return [];
  }
}

// Writes a film's request log.
function writeLog(filmId: string, log: MotionRequest[]): void {
  fs.mkdirSync(designDir(filmId), { recursive: true });
  fs.writeFileSync(logFile(filmId), JSON.stringify(log.slice(0, 50), null, 2) + "\n");
}

// Updates one request in the log.
function update(filmId: string, id: string, patch: Partial<MotionRequest>): MotionRequest | undefined {
  const log = readLog(filmId);
  const i = log.findIndex((r) => r.id === id);
  if (i < 0) return undefined;
  log[i] = { ...log[i], ...patch };
  writeLog(filmId, log);
  return log[i];
}

/** How long an agent may work on a request before a failing build is taken as its answer. */
const AGENT_GIVE_UP_MS = 30 * 60 * 1000;

// True when the agent's task for a request has ended (completed, failed or timed out).
function taskEnded(taskId: string | undefined): boolean {
  const status = taskId ? taskQueue.getTask(taskId)?.status : undefined;
  return status === "completed" || status === "failed" || status === "timed_out";
}

/**
 * Lists a film's requests, newest first. A request an agent is working on is settled from the
 * design build status. A passing build settles it (the build only changes the film on a pass). A
 * failing build is only the answer once the agent's task has ended, because agents build, read
 * the errors and build again; until then it stays "sent" with the latest error as its message.
 */
export function listMotionRequests(filmId: string, now: () => number = Date.now): MotionRequest[] {
  const log = readLog(filmId);
  const status = readDesignStatus(filmId);
  let changed = false;
  for (const r of log) {
    if (r.state !== "sent" || r.by !== "agent" || !status || status.at <= r.at) continue;
    // Only the newest open request can own the latest build.
    if (log.find((x) => x.state === "sent" && x.by === "agent") !== r) continue;
    const error = status.errors[0] ?? status.findings.find((f) => f.severity === "error")?.message ?? "the build failed";
    if (status.state === "passed") {
      r.state = "passed";
      r.message = "built and passed the design check";
    } else if (taskEnded(r.taskId) || now() - Date.parse(r.at) > AGENT_GIVE_UP_MS) {
      r.state = "failed";
      r.message = error;
    } else {
      const working = `the agent is still working; its last build failed: ${error}`;
      if (r.message === working) continue;
      r.message = working;
    }
    changed = true;
  }
  if (changed) writeLog(filmId, log);
  return log;
}

/** Options for a request. */
export interface MotionRequestOptions {
  ownerKey?: string;
  /** Server model for when no agent is connected; null for none. */
  llmCaller?: DesignLlmCaller | null;
  /** Runs the server-model fallback; injectable for tests. */
  runServerModel?: (filmId: string, instruction: string, caller: DesignLlmCaller) => Promise<{ state: string; errors: string[] } | null>;
  /** Sends the task; injectable so tests never reach a live agent session. */
  dispatch?: (opts: Parameters<typeof dispatchTask>[0]) => Promise<{ taskId: string; channels: string[] }>;
}

/** Sends a described motion for one shot to the connected agent, or to the server model. */
export async function requestMotion(film: Film, shotId: string, prompt: string, options: MotionRequestOptions = {}): Promise<MotionRequest> {
  const shot = film.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`the film has no shot "${shotId}"`);
  if (!prompt.trim()) throw new Error("describe what should move");

  const id = `m-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const spec = path.join(designDir(film.id), "design.json");
  const hadDesign = fs.existsSync(spec);
  fs.mkdirSync(path.dirname(snapshotFile(film.id, id)), { recursive: true });
  if (hadDesign) fs.copyFileSync(spec, snapshotFile(film.id, id));

  const prev = readFilm(film.id)?.design?.source;
  const request: MotionRequest = {
    id,
    filmId: film.id,
    shotId,
    prompt: prompt.trim(),
    at: new Date().toISOString(),
    by: "none",
    state: "sent",
    hadDesign,
    ...(prev && prev !== "templates" ? { prevSource: prev } : {}),
  };
  writeDesignBrief(film.id);
  const dispatch = await (options.dispatch ?? dispatchTask)({
    eventType: "design_film",
    filmId: film.id,
    filmTitle: film.title,
    customInstruction: request.prompt,
    metadata: { shotId, says: shot.scriptText ?? "", motion: true },
    enableFallback: false,
    ...(options.ownerKey ? { ownerKey: options.ownerKey } : {}),
  });
  request.taskId = dispatch.taskId;
  const delivered = dispatch.channels.some((c) => c === "agent_link" || c === "tmux" || c === "firstmate_inbox");

  if (delivered) {
    request.by = "agent";
    request.message = dispatch.channels.includes("agent_link") ? "sent to your connected agent" : "sent to the agent in your terminal";
    writeLog(film.id, [request, ...readLog(film.id)]);
    return request;
  }

  const caller = options.llmCaller;
  if (!caller) {
    request.state = "undelivered";
    request.message = "no coding agent is connected and no server model is configured: use Connect agent in the header";
    writeLog(film.id, [request, ...readLog(film.id)]);
    return request;
  }

  request.by = "server-model";
  request.message = "no agent connected; the server model is working on it";
  writeLog(film.id, [request, ...readLog(film.id)]);
  const run =
    options.runServerModel ??
    (async (filmId: string, instruction: string, c: DesignLlmCaller) => {
      return designWithServerModel(filmId, instruction, c);
    });
  const instruction = `In shot ${shotId} (it says: "${shot.scriptText ?? ""}"): ${request.prompt}. Change only what that shot shows.`;
  void run(film.id, instruction, caller)
    .then((status) =>
      update(film.id, id, status?.state === "passed" ? { state: "passed", message: "built and passed the design check (server model)" } : { state: "failed", message: status?.errors[0] ?? "the server model could not produce a passing design" }),
    )
    .catch((err) => update(film.id, id, { state: "failed", message: err instanceof Error ? err.message : String(err) }));
  return request;
}

/** Puts back the design a request replaced and rebuilds the film. */
export function revertMotion(filmId: string, requestId: string): MotionRequest {
  const request = readLog(filmId).find((r) => r.id === requestId);
  if (!request) throw new Error(`no motion request "${requestId}"`);
  const spec = path.join(designDir(filmId), "design.json");
  if (request.hadDesign) {
    const snap = snapshotFile(filmId, requestId);
    if (!fs.existsSync(snap)) throw new Error("the design this request replaced was not kept, so it cannot be reverted");
    fs.copyFileSync(snap, spec);
    const status = buildDesign(filmId, request.prevSource ?? "agent");
    if (status.state !== "passed") throw new Error(`the previous design no longer builds: ${status.errors[0] ?? status.findings[0]?.message ?? "unknown error"}`);
  } else {
    // The film had no design of its own: go back to the film as it was before its first build.
    const base = path.join(designDir(filmId), "base-film.json");
    if (fs.existsSync(base)) {
      const film = readFilm(filmId);
      if (film) writeFilm(filmId, JSON.parse(fs.readFileSync(base, "utf8")));
    }
    if (fs.existsSync(spec)) fs.rmSync(spec);
  }
  return update(filmId, requestId, { state: "reverted", message: "reverted to the design before this request" })!;
}
