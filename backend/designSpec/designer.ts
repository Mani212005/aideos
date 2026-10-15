/**
 * File Description: Delivers look planning and scene design through explicit inline, agent, server
 * or templates policies. Inline stops for the invoking agent when nobody listens; server uses the
 * configured generation model. Every authored design passes the shared build before reaching film.json.
 * Inputs and outputs: Film, briefs and delivery policy -> validated look plan or scene design outcome.
 * Used by: backend/pipeline/run.ts, backend/designSpec/motionRequests.ts.
 */

import { generationCaller } from "../aideosConfig";
import fs from "node:fs";
import path from "node:path";
import { parseFilm } from "../../src/dl/schema";
import { readFilm, writeFilm } from "../pipeline/filmStore";
import { dispatchTask } from "../agentBridge/dispatcher";
import { buildDesign, designDir, formatBuildStatus, readDesignStatus, readCheckedLookPlan, type DesignBuildStatus } from "./build";
import { renderDesignBrief, writeDesignBrief } from "./brief";
import { judgeAndRepair, type JudgeOptions, type JudgeResult } from "../visionJudge/judge";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { availableCharacters, renderLookBrief, writeLookBrief, writeLookMd, type LookPlan } from "../lookPlan";
import type { DesignMode } from "../pipeline/types";


/** Asks a text model for a completion; injectable so tests never reach a real model. */
export type DesignLlmCaller = (prompt: string, systemInstruction: string) => Promise<string>;

/** How a film's design was finally made. */
export interface DesignOutcome {
  source: "agent" | "server-model" | "templates" | "needs_design";
  note: string;
  status?: DesignBuildStatus;
  /** The vision judge's ruling on the finished design, when it ran. */
  judge?: JudgeResult;
}

/** Options for designing one film. */
export interface DesignFilmOptions {
  /** Delivery mode; defaults to inline, with no implicit server or template fallback. */
  mode?: DesignMode;
  /** How long to wait for a delivered agent (default 20 minutes). */
  agentTimeoutMs?: number;
  /** How often to look for the agent's result (default 5 seconds). */
  pollMs?: number;
  /** Skip the agent even when one is connected. */
  skipAgent?: boolean;
  /** Model used in server mode; omit to use videoModels.generation. */
  llmCaller?: DesignLlmCaller | null;
  /** Server-model attempts, counting repairs (default 3). */
  maxServerAttempts?: number;
  /** Progress messages for the pipeline's log. */
  onProgress?: (message: string) => void;
  /** Studio owner key, so the task reaches the owner's agent connected through `aideos connect`. */
  ownerKey?: string;
  /** Vision-judge settings, or false to skip it. It is off under the Node test runner unless given here. */
  judge?: JudgeOptions | false;
}

// Delivers a look or design task through the same channel ladder and waits for validated output.
async function tryAgent<T>(
  filmId: string, opts: DesignFilmOptions, kind: "look" | "design", inspect: () => T | null, instruction?: string,
): Promise<T | null> {
  if (opts.skipAgent || process.env.NODE_TEST_CONTEXT) {
    if (opts.mode === "agent") throw new Error("agent mode requires a delivered coding agent; delivery is disabled");
    return null;
  }
  const requestedAt = Date.now();
  const film = readFilm(filmId);
  const task = kind === "look"
    ? `Plan the look before making any picture. Read ${path.join(designDir(filmId), "LOOK_BRIEF.md")}, write design/look.json, and run aideos look check ${filmId}. For a character film, name a character the brief lists; a new character is authored first with aideos character check <file> --stamp and drawn with aideos character sheet <file>. Do not build the design yet.`
    : `Build the picture from design/look.json and design/BRIEF.md. For a Three look, copy every look performance into design.json performances with the same id, action, actor, prop, start, decisive cue and afterState; follow the worked mapping in the brief. Run aideos design build ${filmId} until PASS.`;
  const dispatch = await dispatchTask({
    eventType: "design_film", filmId, filmTitle: film?.title, enableFallback: false,
    customInstruction: `${task}${instruction ? `\n${instruction}` : ""}`,
    ...(opts.ownerKey ? { ownerKey: opts.ownerKey } : {}),
  });
  const delivered = dispatch.channels.some((c) => c === "agent_link" || c === "tmux" || c === "firstmate_inbox");
  if (!delivered) {
    if (opts.mode === "agent") throw new Error("agent mode requires a delivered coding agent; no agent is listening");
    opts.onProgress?.(`no coding agent is listening; ${kind} needs work from the invoking agent`);
    return null;
  }
  opts.onProgress?.(`${kind} task delivered (${dispatch.channels.join(", ")}); waiting for validated output`);
  const output = path.join(designDir(filmId), kind === "look" ? "look.json" : "status.json");
  const deadline = Date.now() + (opts.agentTimeoutMs ?? 20 * 60 * 1000);
  while (Date.now() < deadline) {
    if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= requestedAt) {
      try {
        const result = inspect();
        if (result) return result;
      } catch (err) {
        opts.onProgress?.(`${kind} output is not ready: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? 5000));
  }
  if (opts.mode === "agent") throw new Error(`the delivered coding agent did not produce a valid ${kind} in time`);
  opts.onProgress?.(`the coding agent did not produce a valid ${kind} in time`);
  return null;
}

// Parses a model's JSON output, including a surrounding Markdown fence.
function parseJsonReply(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return JSON.parse(body.slice(start, end + 1));
}

/** A passing look plan or actionable errors for the invoking agent. */
export interface LookOutcome { plan?: LookPlan; note: string; errors: string[] }

// Writes the look brief and obtains a valid plan through the requested delivery policy.
export async function planFilmLook(filmId: string, opts: DesignFilmOptions = {}): Promise<LookOutcome> {
  writeLookBrief(filmId);
  const film = readFilm(filmId);
  if (!film) throw new Error(`no film for look planning: ${filmId}`);
  let checked = readCheckedLookPlan(film);
  if (!checked.plan && (opts.mode ?? "inline") !== "server") {
    const plan = await tryAgent(filmId, opts, "look", () => readCheckedLookPlan(film).plan ?? null);
    checked = plan ? { plan, errors: [] } : readCheckedLookPlan(film);
  }
  if (!checked.plan && opts.mode === "server") {
    try {
      const caller = opts.llmCaller === undefined ? await defaultCaller() : opts.llmCaller;
      if (!caller) return { note: "server look caller is disabled", errors: checked.errors };
      const system = renderLookBrief(film, availableCharacters(resolvePackageDir(filmId))) + "\nReply with the complete look.json object and nothing else.";
      let prompt = `Plan the look of "${film.title}".`;
      for (let attempt = 1; attempt <= (opts.maxServerAttempts ?? 3); attempt++) {
        opts.onProgress?.(`server model look attempt ${attempt}`);
        try {
          const raw = parseJsonReply(await caller(prompt, system));
          fs.writeFileSync(path.join(designDir(filmId), "look.json"), JSON.stringify(raw, null, 2) + "\n");
          checked = readCheckedLookPlan(film);
          if (checked.plan) break;
        } catch (err) {
          checked = { errors: [err instanceof Error ? err.message : String(err)] };
        }
        prompt = `Fix the look plan and return the complete JSON object:\n${checked.errors.join("\n")}`;
      }
    } catch (err) {
      checked = { errors: [err instanceof Error ? err.message : String(err)] };
    }
  }
  if (checked.plan) {
    writeLookMd(filmId);
    return { ...checked, note: "look plan validated" };
  }
  return { errors: checked.errors, note: "look plan needs work; read LOOK_BRIEF.md and write a valid look.json" };
}

/** What the server model must return. */
interface ServerDesignReply {
  design: unknown;
  svgs: Record<string, string>;
}

// Pulls the JSON object out of a model reply, tolerating a code fence around it.
function parseReply(text: string): ServerDesignReply {
  const parsed = parseJsonReply(text) as ServerDesignReply;
  if (!parsed || typeof parsed !== "object" || !parsed.design || !parsed.svgs ||
    typeof parsed.svgs !== "object" || Array.isArray(parsed.svgs) ||
    Object.values(parsed.svgs).some((svg) => typeof svg !== "string")) {
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
): Promise<DesignBuildStatus> {
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(resolvePackageDir(filmId), "film.json"), "utf8")));
  const system =
    renderDesignBrief(film, readCheckedLookPlan(film).plan) +
    `\n## Accepted look plan\n${fs.existsSync(path.join(designDir(filmId), "look.json")) ? fs.readFileSync(path.join(designDir(filmId), "look.json"), "utf8") : "Legacy film without a look plan."}\n` +
    `\n## Reply format\n\nReply with one JSON object and nothing else: {"design": <the design.json object>, "svgs": {"visuals/<name>.svg": "<complete svg document>", ...}}. Every file named in design.json must be in svgs.\n`;
  // A change to an existing design edits it rather than starting over.
  const specFile = path.join(designDir(filmId), "design.json");
  const current = instruction && fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8") : null;
  let prompt = instruction
    ? `${current ? `The current design.json is:\n${current}\n\nKeep everything it does, and make this change: ` : `Design "${film.title}", and make sure of this: `}${instruction}\nReturn the whole JSON object${current ? " (every svg it names, including unchanged ones)" : ""}.`
    : `Design "${film.title}". Return the JSON object.`;
  const attempts = opts.maxServerAttempts ?? 3;
  let lastFailure: DesignBuildStatus = { state: "failed", source: "server-model", at: new Date().toISOString(), errors: ["server design made no attempt"], findings: [] };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    opts.onProgress?.(`server model design attempt ${attempt}/${attempts}`);
    let reply: ServerDesignReply;
    try {
      reply = parseReply(await caller(prompt, system));
    } catch (err) {
      lastFailure = { state: "failed", source: "server-model", at: new Date().toISOString(), errors: [err instanceof Error ? err.message : String(err)], findings: [] };
      prompt = `Your last reply could not be used: ${lastFailure.errors.join("; ")}. Return the JSON object again.`;
      continue;
    }
    const pkg = resolvePackageDir(filmId);
    fs.mkdirSync(designDir(filmId), { recursive: true });
    fs.writeFileSync(path.join(designDir(filmId), "design.json"), JSON.stringify(reply.design, null, 2) + "\n");
    for (const [file, svg] of Object.entries(reply.svgs)) {
      // Only visuals/<name>.svg is accepted, which keeps a model's paths inside the package.
      if (!/^visuals\/[a-z0-9-]+\.svg$/.test(file)) continue;
      fs.mkdirSync(path.join(pkg, "visuals"), { recursive: true });
      fs.writeFileSync(path.join(pkg, file), svg);
    }
    let status: DesignBuildStatus;
    try { status = buildDesign(filmId, "server-model"); }
    catch (err) {
      lastFailure = { state: "failed", source: "server-model", at: new Date().toISOString(), errors: [err instanceof Error ? err.message : String(err)], findings: [] };
      prompt = `Fix the design: ${lastFailure.errors.join("; ")}`;
      continue;
    }
    if (status.state === "passed") return status;
    lastFailure = status;
    prompt = `The build failed. Fix these problems and return the whole corrected JSON object:\n${formatBuildStatus(filmId, status)}`;
  }
  return lastFailure;
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
  const status = await tryServerModel(filmId, caller, { onProgress }, instruction);
  return status.state === "passed" ? status : null;
}

/** The configured generation model used for explicit server design. */
export async function serverDesignCaller(): Promise<DesignLlmCaller | null> {
  return defaultCaller();
}

// Marks a film as keeping its template design so the studio can flag it.
function markTemplates(filmId: string, note: string): void {
  const film = readFilm(filmId);
  if (!film) return;
  writeFilm(filmId, { ...film, design: { source: "templates", note } });
}

// Runs the vision judge on a finished design and sends failed frames back through the path that made it.
async function judgeDesign(filmId: string, outcome: DesignOutcome, opts: DesignFilmOptions): Promise<DesignOutcome> {
  if (readFilm(filmId)?.scene?.renderer === "three") return { ...outcome, note: `${outcome.note}; Three craft unmeasured by SVG-only vision judge. Review actual FilmView renders.` };
  if (opts.judge === false || (opts.judge === undefined && process.env.NODE_TEST_CONTEXT)) return outcome;
  const judgeOptions: JudgeOptions = { skipAgent: opts.skipAgent, ownerKey: opts.ownerKey, onProgress: opts.onProgress, ...(opts.judge ?? {}) };
  const repair = async (errors: string): Promise<boolean> => {
    if (outcome.source === "agent") return (await tryAgent(filmId, opts, "design", () => {
      const status = readDesignStatus(filmId);
      return status?.state === "passed" ? status : null;
    }, errors)) !== null;
    if (!opts.llmCaller) return false;
    return (await tryServerModel(filmId, opts.llmCaller, opts, `The vision judge ruled these frames wrong. Fix each one, exactly as reported:\n${errors}`)).state === "passed";
  };
  const judge = await judgeAndRepair(filmId, { ...judgeOptions, repair });
  if (judge.skipped) {
    const note = `${outcome.note}; visual judgment unavailable: ${judge.skipped}`;
    opts.onProgress?.(note);
    return { ...outcome, note, judge };
  }
  const note = judge.passed
    ? `${outcome.note}; vision judge: ${judge.samples.length} frames match`
    : `${outcome.note}; vision judge: ${judge.failures.length} of ${judge.samples.length} frames still fail`;
  opts.onProgress?.(note);
  return { ...outcome, note, judge };
}

// Builds existing authoring data, or requests it through the explicit mode without silent templates.
export async function designFilm(filmId: string, opts: DesignFilmOptions = {}): Promise<DesignOutcome> {
  const mode = opts.mode ?? "inline";
  if (mode === "templates") {
    const note = "template design explicitly requested";
    markTemplates(filmId, note);
    return { source: "templates", note };
  }
  writeDesignBrief(filmId);
  if (fs.existsSync(path.join(designDir(filmId), "design.json"))) {
    const source = readDesignStatus(filmId)?.source ?? "agent";
    try {
      const status = buildDesign(filmId, source);
      if (status.state === "passed") return judgeDesign(filmId, { source: source === "server-model" ? source : "agent", note: "existing design rebuilt and validated", status }, opts);
    } catch (err) {
      opts.onProgress?.(`existing design could not be built: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (mode !== "server") {
    const status = await tryAgent(filmId, opts, "design", () => {
      const built = buildDesign(filmId, "agent");
      return built.state === "passed" ? built : null;
    });
    if (status) return judgeDesign(filmId, { source: "agent", note: "designed by the connected coding agent", status }, opts);
  } else {
    try {
      const caller = opts.llmCaller === undefined ? await defaultCaller() : opts.llmCaller;
      if (caller) {
        const status = await tryServerModel(filmId, caller, opts);
        if (status.state === "passed") return judgeDesign(filmId, { source: "server-model", note: "designed by the configured generation model", status }, { ...opts, llmCaller: caller });
        return { source: "needs_design", note: "server design exhausted its validation attempts", status };
      }
    } catch (err) {
      return { source: "needs_design", note: `server design failed: ${err instanceof Error ? err.message : String(err)}`, status: readDesignStatus(filmId) ?? undefined };
    }
  }
  const note = "design needs work; read BRIEF.md, write design.json and SVGs, and run design build";
  opts.onProgress?.(note);
  return { source: "needs_design", note, status: readDesignStatus(filmId) ?? undefined };
}

// Uses the committed generation policy for server mode, with no implicit reviewer fallback.
async function defaultCaller(): Promise<DesignLlmCaller> {
  return generationCaller();
}
