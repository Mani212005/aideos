/**
 * File Description: Loads `aideos.config.json` (repo root), the committed home of the video model
 * policy: which agent and model generate and fix a film (all-check's background agent), which
 * agent and model review it (gemini-review, all-check, pairwise), and which generation models are
 * refused unless a run passes an explicit override. Node-only, dependency-free, with the file path
 * injectable so tests never read the real config.
 */

import fs from "node:fs";
import path from "node:path";

/** An agent CLI plus the model id it is run with. */
export interface AgentModel {
  agent: "claude" | "agy";
  model: string;
}

/** The video model policy. */
export interface VideoModelPolicy {
  generation: AgentModel;
  reviewer: AgentModel;
  /** Model id fragments refused for generation (case-insensitive, "." and "-" interchangeable). */
  forbiddenGenerationModels: string[];
}

/** The parsed config file. */
export interface AideosConfig {
  schema: "aideos.config/1";
  videoModels: VideoModelPolicy;
}

/** An unusable config or a refused model, as one clear message. */
export class AideosConfigError extends Error {}

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
      generation: parseAgentModel(models.generation, "videoModels.generation"),
      reviewer: parseAgentModel(models.reviewer, "videoModels.reviewer"),
      forbiddenGenerationModels: forbidden as string[],
    },
  };
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
