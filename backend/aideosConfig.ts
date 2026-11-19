/**
 * File Description: Loads `aideos.config.json` (repo root), the committed home of the video model
 * policy: which agent and model review a film (gemini-review, all-check, pairwise), which generation
 * models are refused unless a run passes an explicit override, and an optional `generation` override.
 * Generation and fixing follow the user's own agent session by default (the agent and model recorded
 * in backend/agentSession/originSession.ts); `generation` is used only when no session is recorded. It also validates the delivery settings (the
 * end card and the reel length budget) through `src/dl/delivery.ts`, which owns their shape so the
 * browser bundle and Node agree. Node-only, with the file path injectable so tests never read the
 * real config.
 * Inputs and outputs: config file on disk or environment variables -> loaded AideosConfig object.
 * Used by: backend/modelClient.ts, backend/jev.ts, backend/geminiReview/geminiReview.ts, backend/designSpec/designer.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { parseDeliveryConfig, type DeliveryConfig } from "../src/dl/delivery";
import { readOriginSession } from "./agentSession/originSession";
import { assertLoopbackVcdUrl, DEFAULT_VCD_URL, type VcdLanguagePreference } from "./vcdClient";

/** Local cloned-voice (`vcd`) configuration stored in aideos.config.json. */
export interface VoiceCloneConfig {
  /** Loopback URL of the local vcd service (default http://127.0.0.1:8740). */
  url: string;
  /** Optional enrolled voice id (`voice_...`). When empty, vcd's enrolled voice is auto-discovered. */
  voiceId: string;
  /** Default language preference for cloned-voice narration ("auto", "en", or "hi"). */
  language: VcdLanguagePreference;
}

/** An agent CLI plus the model id it is run with. */
export interface AgentModel {
  agent: "claude" | "agy";
  model: string;
}

/** The video model policy. */
export interface VideoModelPolicy {
  /**
   * Optional override for generation and fixing when no agent session is recorded (a headless step). Absent by
   * default: a fix runs in, or inherits, the session the user started the film with, never a model fixed here.
   */
  generation?: AgentModel;
  reviewer: AgentModel;
  /** Model id fragments refused for generation (case-insensitive, "." and "-" interchangeable). */
  forbiddenGenerationModels: string[];
}

/** The parsed config file. */
export interface AideosConfig {
  schema: "aideos.config/1";
  videoModels: VideoModelPolicy;
  /** End card and reel length settings (absent sections take their defaults). */
  delivery: DeliveryConfig;
  /** Local cloned-voice (`vcd`) service settings (absent section takes loopback defaults). */
  voiceClone?: VoiceCloneConfig;
}

/** An unusable config or a refused model, as one clear message. */
export class AideosConfigError extends Error {}

/** Server-side generation is unavailable for this film: no session or override is known, the recorded harness cannot run headless, or its model is unusable. Callers fall back to the session instead of failing. */
export class NoGenerationModelError extends AideosConfigError {}

const REPO_ROOT = path.resolve(__dirname, "..");

/** Where the committed config lives; AIDEOS_CONFIG points elsewhere. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.AIDEOS_CONFIG ? path.resolve(env.AIDEOS_CONFIG) : path.join(REPO_ROOT, "aideos.config.json");
}

// Reads one { agent, model } entry, failing with the field name.
function parseAgentModel(value: unknown, field: string): AgentModel {
  const v = value as Partial<AgentModel> | undefined;
  if (!v || (v.agent !== "claude" && v.agent !== "agy") || typeof v.model !== "string" || !v.model.trim()) {
    throw new AideosConfigError(`aideos.config.json: ${field} must be { "agent": "claude" | "agy", "model": "<model id>" }`);
  }
  return { agent: v.agent, model: v.model.trim() };
}

// Loads and validates the config; a missing or malformed file is an error, never a silent default.
export function loadAideosConfig(file: string = configPath()): AideosConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new AideosConfigError(`cannot read the video model config ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const models = (raw as { videoModels?: Record<string, unknown> })?.videoModels;
  if (!models) throw new AideosConfigError(`aideos.config.json: missing "videoModels"`);
  const forbidden = models.forbiddenGenerationModels ?? [];
  if (!Array.isArray(forbidden) || forbidden.some((m) => typeof m !== "string")) {
    throw new AideosConfigError(`aideos.config.json: videoModels.forbiddenGenerationModels must be a list of strings`);
  }
  return {
    schema: "aideos.config/1",
    videoModels: {
      ...(models.generation === undefined ? {} : { generation: parseAgentModel(models.generation, "videoModels.generation") }),
      reviewer: parseAgentModel(models.reviewer, "videoModels.reviewer"),
      forbiddenGenerationModels: forbidden as string[],
    },
    delivery: parseDelivery(raw),
    voiceClone: parseVoiceClone(raw),
  };
}

// Validates the optional voiceClone section, defaulting to the local loopback vcd endpoint.
function parseVoiceClone(raw: unknown): VoiceCloneConfig {
  const section = (raw as { voiceClone?: Record<string, unknown> } | undefined)?.voiceClone;
  if (section === undefined) {
    return { url: DEFAULT_VCD_URL, voiceId: "", language: "auto" };
  }
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    throw new AideosConfigError(`aideos.config.json: voiceClone must be an object`);
  }
  const rawUrl = section.url === undefined ? DEFAULT_VCD_URL : section.url;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new AideosConfigError(`aideos.config.json: voiceClone.url must be a non-empty loopback URL string`);
  }
  let url: string;
  try {
    url = assertLoopbackVcdUrl(rawUrl);
  } catch (err) {
    throw new AideosConfigError(`aideos.config.json: voiceClone.url: ${err instanceof Error ? err.message : String(err)}`);
  }
  const rawVoiceId = section.voiceId === undefined ? "" : section.voiceId;
  if (typeof rawVoiceId !== "string") {
    throw new AideosConfigError(`aideos.config.json: voiceClone.voiceId must be a string`);
  }
  const rawLang = section.language === undefined ? "auto" : section.language;
  if (rawLang !== "auto" && rawLang !== "en" && rawLang !== "hi") {
    throw new AideosConfigError(`aideos.config.json: voiceClone.language must be "auto", "en", or "hi"`);
  }
  return { url, voiceId: rawVoiceId.trim(), language: rawLang };
}

// Resolves local voice-clone settings: explicit overrides, then environment variables, then aideos.config.json, then defaults.
export function resolveVoiceCloneSettings(
  overrides: Partial<VoiceCloneConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
  file?: string,
): VoiceCloneConfig {
  let fromFile: VoiceCloneConfig = { url: DEFAULT_VCD_URL, voiceId: "", language: "auto" };
  const configFile = file ?? configPath(env);
  if (fs.existsSync(configFile)) fromFile = loadAideosConfig(configFile).voiceClone ?? fromFile;
  const rawUrl = overrides.url?.trim() || env.AIDEOS_VCD_URL?.trim() || fromFile.url || DEFAULT_VCD_URL;
  const url = assertLoopbackVcdUrl(rawUrl);
  const voiceId = (overrides.voiceId ?? env.AIDEOS_VCD_VOICE_ID ?? fromFile.voiceId ?? "").trim();
  const envLang = env.AIDEOS_VCD_LANGUAGE?.trim();
  const candidateLang = overrides.language ?? (envLang === "auto" || envLang === "en" || envLang === "hi" ? envLang : undefined) ?? fromFile.language;
  const language: VcdLanguagePreference = candidateLang === "en" || candidateLang === "hi" ? candidateLang : "auto";
  return { url, voiceId, language };
}

// Validates the delivery sections, rethrowing a bad value as a config error.
function parseDelivery(raw: unknown): DeliveryConfig {
  try {
    return parseDeliveryConfig(raw);
  } catch (err) {
    throw new AideosConfigError(err instanceof Error ? err.message : String(err));
  }
}

// Lowercases a model id and treats "." and "-" alike so "gemini-3.1-pro" matches "gemini-3-1-pro-high".
function canon(model: string): string {
  return model.toLowerCase().replace(/\./g, "-");
}

// Returns the forbidden entry a generation model matches, or undefined when it is allowed.
export function forbiddenGenerationMatch(model: string, policy: VideoModelPolicy): string | undefined {
  return policy.forbiddenGenerationModels.find((f) => canon(model).includes(canon(f)));
}

// The reviewer model: an explicit value, else AIDEOS_GEMINI_REVIEW_MODEL / GEMINI_MODEL, else the config.
export function reviewerModel(explicit?: string, env: NodeJS.ProcessEnv = process.env, file?: string): string {
  return explicit || env.AIDEOS_GEMINI_REVIEW_MODEL || env.GEMINI_MODEL || loadAideosConfig(file).videoModels.reviewer.model;
}

/** Executes a text-only model command; injectable without launching a real agent in tests. */
export type GenerationRunner = (command: string, args: string[]) => Promise<string>;

// Runs the configured model without tools, workspace edits or persistent sessions.
function runGeneration(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 20 * 60_000, maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

// Creates the server text caller for a film: the film's recorded originating session (agent and model) when
// there is one, else the explicit videoModels.generation override, else a clear refusal. Never the reviewer model.
export function generationCaller(file?: string, runner: GenerationRunner = runGeneration, filmId?: string): (prompt: string, system: string) => Promise<string> {
  const policy = loadAideosConfig(file).videoModels;
  const origin = filmId ? readOriginSession(filmId) : null;
  const chosen: { agent: string; model: string | null } | undefined = origin ?? policy.generation;
  if (!chosen) {
    throw new NoGenerationModelError(
      `server design needs a model to run and none is known: no agent session is recorded for ${filmId ? `"${filmId}"` : "this film"} ` +
        `(aideos all-check records the session you start it from) and aideos.config.json has no videoModels.generation override. ` +
        `Use the connected-agent design mode, or set videoModels.generation.`,
    );
  }
  const { agent, model } = chosen;
  if (agent !== "claude" || (model !== null && (/gemini/i.test(model) || forbiddenGenerationMatch(model, policy)))) {
    throw new NoGenerationModelError(
      `server design requires an allowed Claude generation model; ${origin ? "the session recorded for this film" : "configured"} is ${agent} ${model ?? "(its own default model)"}, ` +
        `so server-side generation is not available for it and the work goes to the session instead`,
    );
  }
  return (prompt, system) => runner("claude", [
    "--print", ...(model ? ["--model", model] : []), "--output-format", "text", "--tools", "",
    "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence",
    "--system-prompt", system, prompt,
  ]);
}

// Like generationCaller, but a film with no usable server-side generation yields null (after one notice line) so the caller falls back to agent or inline delivery instead of failing.
export function generationCallerOrNull(
  filmId?: string,
  runner: GenerationRunner = runGeneration,
  notify: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  file?: string,
): ((prompt: string, system: string) => Promise<string>) | null {
  try {
    return generationCaller(file, runner, filmId);
  } catch (err) {
    if (!(err instanceof NoGenerationModelError)) throw err;
    notify(err.message);
    return null;
  }
}
