/**
 * File Description: Gets every new film a bespoke design, in order of preference.
 * 1. The connected coding agent: it is sent the design task and given time to write design.json
 *    and the artwork and to get `aideos design build` to PASS (watched through design/status.json).
 * 2. The server model: it is given the same brief and returns the spec and artwork as JSON, which
 *    goes through the same build; the build's errors are fed back for a bounded number of repairs.
 * 3. Templates: the film keeps its compiled template design, marked so the studio flags it.
 * Every path passes the same design check; nothing reaches the film without it.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFilm } from "../../src/dl/schema";
import { readFilm, writeFilm } from "../pipeline/filmStore";
import { dispatchTask } from "../agentBridge/dispatcher";
import { buildDesign, designDir, formatBuildStatus, readDesignStatus, type DesignBuildStatus } from "./build";
import { renderDesignBrief, writeDesignBrief } from "./brief";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** Asks a text model for a completion; injectable so tests never reach a real model. */
export type DesignLlmCaller = (prompt: string, systemInstruction: string) => Promise<string>;

/** How a film's design was finally made. */
export interface DesignOutcome {
  source: "agent" | "server-model" | "templates";
  note: string;
  status?: DesignBuildStatus;
}

/** Options for designing one film. */
export interface DesignFilmOptions {
  /** How long to wait for the connected agent before falling back (default 20 minutes). */
  agentTimeoutMs?: number;
  /** How often to look for the agent's result (default 5 seconds). */
  pollMs?: number;
  /** Skip the agent even when one is connected. */
  skipAgent?: boolean;
  /** Model used for the server fallback; omit to use Gemini when it is configured. */
  llmCaller?: DesignLlmCaller | null;
  /** Server-model attempts, counting repairs (default 3). */
  maxServerAttempts?: number;
  /** Progress messages for the pipeline's log. */
  onProgress?: (message: string) => void;
  /** Studio owner key, so the task reaches the owner's agent connected through `aideos connect`. */
  ownerKey?: string;
}

// Sends the design task to the connected agent and waits for a passing build or the timeout.
async function tryAgent(filmId: string, opts: DesignFilmOptions): Promise<DesignBuildStatus | null> {
  const requestedAt = new Date().toISOString();
  const film = readFilm(filmId);
  const dispatch = await dispatchTask({
    eventType: "design_film",
    filmId,
    filmTitle: film?.title,
    enableFallback: false,
    ...(opts.ownerKey ? { ownerKey: opts.ownerKey } : {}),
  });
  // The prompt only reaches an agent through a connector, tmux or a steering inbox; the queue and
  // the task file are written regardless, so on their own they mean nobody is listening.
  const delivered = dispatch.channels.some((c) => c === "agent_link" || c === "tmux" || c === "firstmate_inbox");
  if (!delivered) {
    opts.onProgress?.("no coding agent is connected; skipping to the server model");
    return null;
  }
  opts.onProgress?.(`design task sent to the coding agent (${dispatch.channels.join(", ")}); waiting for a passing build`);
  const deadline = Date.now() + (opts.agentTimeoutMs ?? 20 * 60 * 1000);
  while (Date.now() < deadline) {
    const status = readDesignStatus(filmId);
    if (status && status.at > requestedAt && status.state === "passed") return status;
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 5000));
  }
  opts.onProgress?.("the coding agent did not produce a passing design in time");
  return null;
}

/** What the server model must return. */
interface ServerDesignReply {
  design: unknown;
  svgs: Record<string, string>;
}

// Pulls the JSON object out of a model reply, tolerating a code fence around it.
function parseReply(text: string): ServerDesignReply {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  const parsed = JSON.parse(body.slice(start, end + 1)) as ServerDesignReply;
  if (!parsed || typeof parsed !== "object" || !parsed.design || !parsed.svgs) {
    throw new Error('the reply must be {"design": {...}, "svgs": {"visuals/<name>.svg": "<svg ...>"}}');
  }
  return parsed;
}

// Asks the server model for a design and repairs it with the build's own errors.
async function tryServerModel(
  filmId: string,
  caller: DesignLlmCaller,
  opts: DesignFilmOptions,
  instruction?: string,
): Promise<DesignBuildStatus | null> {
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "videos", filmId, "film.json"), "utf8")));
  const system =
    renderDesignBrief(film) +
    `\n## Reply format\n\nReply with one JSON object and nothing else: {"design": <the design.json object>, "svgs": {"visuals/<name>.svg": "<complete svg document>", ...}}. Every file named in design.json must be in svgs.\n`;
  // A change to an existing design edits it rather than starting over.
  const specFile = path.join(designDir(filmId), "design.json");
  const current = instruction && fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8") : null;
  let prompt = instruction
    ? `${current ? `The current design.json is:\n${current}\n\nKeep everything it does, and make this change: ` : `Design "${film.title}", and make sure of this: `}${instruction}\nReturn the whole JSON object${current ? " (every svg it names, including unchanged ones)" : ""}.`
    : `Design "${film.title}". Return the JSON object.`;
  const attempts = opts.maxServerAttempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    opts.onProgress?.(`server model design attempt ${attempt}/${attempts}`);
    let reply: ServerDesignReply;
    try {
      reply = parseReply(await caller(prompt, system));
    } catch (err) {
      prompt = `Your last reply could not be used: ${err instanceof Error ? err.message : String(err)}. Return the JSON object again.`;
      continue;
    }
    const pkg = path.join(REPO_ROOT, "videos", filmId);
    fs.mkdirSync(designDir(filmId), { recursive: true });
    fs.writeFileSync(path.join(designDir(filmId), "design.json"), JSON.stringify(reply.design, null, 2) + "\n");
    for (const [file, svg] of Object.entries(reply.svgs)) {
      // Only visuals/<name>.svg is accepted, which keeps a model's paths inside the package.
      if (!/^visuals\/[a-z0-9-]+\.svg$/.test(file)) continue;
      fs.mkdirSync(path.join(pkg, "visuals"), { recursive: true });
      fs.writeFileSync(path.join(pkg, file), svg);
    }
    const status = buildDesign(filmId, "server-model");
    if (status.state === "passed") return status;
    prompt = `The build failed. Fix these problems and return the whole corrected JSON object:\n${formatBuildStatus(filmId, status)}`;
  }
  return null;
}

/**
 * Applies one design change with the server model (the fallback when no coding agent is connected).
 * Returns the passing build, or null when the model could not produce one.
 */
export async function designWithServerModel(
  filmId: string,
  instruction: string,
  caller: DesignLlmCaller,
  onProgress?: (message: string) => void,
): Promise<DesignBuildStatus | null> {
  return tryServerModel(filmId, caller, { onProgress }, instruction);
}

/** The server model the design fallback uses (Gemini when configured), or null. */
export async function serverDesignCaller(): Promise<DesignLlmCaller | null> {
  return defaultCaller();
}

// Marks a film as keeping its template design so the studio can flag it.
function markTemplates(filmId: string, note: string): void {
  const film = readFilm(filmId);
  if (!film) return;
  writeFilm(filmId, { ...film, design: { source: "templates", note } });
}

// Gives a film a bespoke design: the agent first, then the server model, then flagged templates.
export async function designFilm(filmId: string, opts: DesignFilmOptions = {}): Promise<DesignOutcome> {
  writeDesignBrief(filmId);
  if (!opts.skipAgent) {
    const status = await tryAgent(filmId, opts);
    if (status) return { source: "agent", note: "designed by the connected coding agent", status };
  }
  const caller = opts.llmCaller === undefined ? await defaultCaller() : opts.llmCaller;
  if (caller) {
    const status = await tryServerModel(filmId, caller, opts);
    if (status) return { source: "server-model", note: "designed by the server model", status };
  }
  const note = caller
    ? "bespoke design failed the design check; kept the template design"
    : "no coding agent connected and no server model configured; kept the template design";
  markTemplates(filmId, note);
  opts.onProgress?.(note);
  return { source: "templates", note };
}

// Uses Gemini for the server fallback when it is configured, or nothing.
async function defaultCaller(): Promise<DesignLlmCaller | null> {
  const { generateText, isGoogleAiConfigured } = await import("../modelClient");
  if (!isGoogleAiConfigured()) return null;
  return (prompt, systemInstruction) => generateText(prompt, { systemInstruction, temperature: 0.4 });
}
