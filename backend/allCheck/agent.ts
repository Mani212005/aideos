/**
 * File Description: Chooses which coding agent and model run the all-check loop in the background and
 * builds the command that starts it with a written brief. The choice comes from the video model
 * policy in aideos.config.json (generation agent and model), whichever agent invoked all-check; only
 * an explicit per-run --agent / --model overrides it. A generation model the policy forbids
 * (gemini-3.1-pro) is refused unless --allow-forbidden-model is given. Only claude and agy can run
 * as background agents.
 * Inputs and outputs: slug and review round results -> dispatched agent review edit tasks.
 * Used by: backend/allCheck/round.ts.
 */

import {
  AideosConfigError,
  forbiddenGenerationMatch,
  loadAideosConfig,
  type AideosConfig,
} from "../aideosConfig";
import { AllCheckError, type AgentName } from "./types";

/** The agent and model chosen, and why. */
export interface ResolvedAgent {
  agent: AgentName;
  model: string;
  source: "config" | "flag";
  /** Set when the policy would have refused the model and an explicit override let it through. */
  note?: string;
}

/** The inputs of the choice, injectable for tests. */
export interface AgentEnv {
  flag?: AgentName;
  modelFlag?: string;
  allowForbiddenModel?: boolean;
  config?: AideosConfig;
}

// Decides the background agent and model from the flags, else the configured generation policy.
export function resolveAgent({ flag, modelFlag, allowForbiddenModel, config }: AgentEnv): ResolvedAgent {
  let cfg: AideosConfig;
  try {
    cfg = config ?? loadAideosConfig();
  } catch (err) {
    if (err instanceof AideosConfigError) throw new AllCheckError(err.message);
    throw err;
  }
  const { generation, reviewer, forbiddenGenerationModels } = cfg.videoModels;
  const agent: AgentName = flag ?? generation.agent;
  // A different agent than the configured one has no configured generation model: use its reviewer
  // model if it is the reviewer agent (never the agent's own default, which may be gemini-3.1-pro).
  const model = modelFlag?.trim() || (agent === generation.agent ? generation.model : agent === reviewer.agent ? reviewer.model : "");
  if (!model) throw new AllCheckError(`no model is configured for the ${agent} agent: pass --model <id>`);

  const hit = forbiddenGenerationMatch(model, { generation, reviewer, forbiddenGenerationModels });
  let note: string | undefined;
  if (hit) {
    if (!allowForbiddenModel) {
      throw new AllCheckError(
        `${model} is not allowed for video generation (aideos.config.json forbids "${hit}"). ` +
          `Generation uses ${generation.agent} ${generation.model}; pass --allow-forbidden-model to override for this run`,
      );
    }
    note = `${model} is normally forbidden for generation; allowed by --allow-forbidden-model`;
  }
  return { agent, model, source: flag || modelFlag ? "flag" : "config", note };
}

/** An executable and its arguments. */
export interface AgentCommand {
  command: string;
  args: string[];
}

// The one-line prompt that points the agent at its brief file.
export function agentPrompt(briefPath: string, slug: string): string {
  return `You are the all-check background agent for the film "${slug}". Read ${briefPath} now and follow it exactly, to the end.`;
}

// Builds the interactive, fully pre-approved command for an agent, on an explicit model, with its brief.
export function buildAgentCommand(agent: AgentName, briefPath: string, slug: string, model: string): AgentCommand {
  const prompt = agentPrompt(briefPath, slug);
  if (agent === "claude") {
    return { command: "claude", args: ["--model", model, "--dangerously-skip-permissions", prompt] };
  }
  return { command: "agy", args: ["--model", model, "--prompt-interactive", prompt, "--dangerously-skip-permissions"] };
}
