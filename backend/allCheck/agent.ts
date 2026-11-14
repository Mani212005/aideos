/**
 * File Description: Chooses which coding agent and model a replacement all-check agent runs as, and builds
 * the command that starts it with a written brief. A replacement exists only when the session the user
 * started the film with is gone, so it inherits that session's harness and model (the origin record). An
 * explicit per-run --agent / --model overrides; the optional videoModels.generation override in
 * aideos.config.json is used only when no session is recorded; with none of those it fails loudly. No
 * model is named here. A model the policy forbids (gemini-3.1-pro) is refused unless --allow-forbidden-model.
 * Inputs and outputs: flags, the film's recorded origin session and the config -> the agent, model and command to start.
 * Used by: backend/allCheck/index.ts, backend/allCheck/launch.ts.
 */

import {
  AideosConfigError,
  forbiddenGenerationMatch,
  loadAideosConfig,
  type AideosConfig,
} from "../aideosConfig";
import { LAUNCHABLE_HARNESSES, type OriginSession } from "../agentSession/originSession";
import { AllCheckError, type AgentName } from "./types";

/** The agent and model chosen, and why. */
export interface ResolvedAgent {
  agent: AgentName;
  /** The model id, or null when the harness's own default applies (the originating session's model was not exposed). */
  model: string | null;
  source: "config" | "flag" | "session";
  /** Set when the policy would have refused the model and an explicit override let it through. */
  note?: string;
}

/** The inputs of the choice, injectable for tests. */
export interface AgentEnv {
  flag?: AgentName;
  modelFlag?: string;
  allowForbiddenModel?: boolean;
  config?: AideosConfig;
  /** The session the film was started from: the replacement inherits its harness and model. */
  origin?: OriginSession | null;
}

// True for a harness aideos can start itself.
function isLaunchable(agent: string): agent is AgentName {
  return (LAUNCHABLE_HARNESSES as readonly string[]).includes(agent);
}

// Decides the replacement agent and model: flags, else the originating session, else the explicit config override, else a refusal.
export function resolveAgent({ flag, modelFlag, allowForbiddenModel, config, origin }: AgentEnv): ResolvedAgent {
  let cfg: AideosConfig;
  try {
    cfg = config ?? loadAideosConfig();
  } catch (err) {
    if (err instanceof AideosConfigError) throw new AllCheckError(err.message);
    throw err;
  }
  const { generation, reviewer, forbiddenGenerationModels } = cfg.videoModels;
  const originAgent = origin && isLaunchable(origin.agent) ? origin.agent : undefined;
  const agent: AgentName | undefined = flag ?? originAgent ?? generation?.agent;
  if (!agent) {
    throw new AllCheckError(
      origin
        ? `the session that started this film runs "${origin.agent}", which aideos cannot start as a replacement: pass --agent ${LAUNCHABLE_HARNESSES.join("|")} (and --model <id>)`
        : `no agent session is recorded for this film, so there is no agent to start: run all-check from the agent that makes the film, ` +
            `pass --agent ${LAUNCHABLE_HARNESSES.join("|")} (and --model <id>), or set videoModels.generation in aideos.config.json`,
    );
  }
  const fromOrigin = origin && origin.agent === agent ? origin.model : null;
  // The reviewer model is a last resort for agy only: never the agent's own default, which may be gemini-3.1-pro.
  const model =
    modelFlag?.trim() ||
    fromOrigin ||
    (generation && agent === generation.agent ? generation.model : "") ||
    (agent === reviewer.agent ? reviewer.model : "") ||
    null;
  if (!model && agent === "agy") throw new AllCheckError(`no model is known for the agy agent: pass --model <id>`);

  const hit = model ? forbiddenGenerationMatch(model, { generation, reviewer, forbiddenGenerationModels }) : undefined;
  let note: string | undefined;
  if (hit) {
    if (!allowForbiddenModel) {
      throw new AllCheckError(
        `${model} is not allowed for video generation (aideos.config.json forbids "${hit}"). ` +
          `Pass a different --model, or --allow-forbidden-model to override for this run`,
      );
    }
    note = `${model} is normally forbidden for generation; allowed by --allow-forbidden-model`;
  }
  const source = flag || modelFlag ? "flag" : fromOrigin || originAgent ? "session" : "config";
  return { agent, model, source, note };
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

// Builds the interactive, fully pre-approved command for an agent with its brief; a null model leaves the choice to the harness.
export function buildAgentCommand(agent: AgentName, briefPath: string, slug: string, model: string | null): AgentCommand {
  const prompt = agentPrompt(briefPath, slug);
  const modelArgs = model ? ["--model", model] : [];
  switch (agent) {
    case "claude":
      return { command: "claude", args: [...modelArgs, "--dangerously-skip-permissions", prompt] };
    case "codex":
      return { command: "codex", args: [...modelArgs, "--dangerously-bypass-approvals-and-sandbox", prompt] };
    case "opencode":
      return { command: "opencode", args: [...modelArgs, "--prompt", prompt] };
    case "agy":
      if (!model) throw new AllCheckError("the agy agent needs an explicit model: pass --model <id>");
      return { command: "agy", args: ["--model", model, "--prompt-interactive", prompt, "--dangerously-skip-permissions"] };
  }
}
