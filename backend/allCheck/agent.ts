/**
 * File Description: Chooses which coding agent runs the all-check loop in the background and builds
 * the command that starts it with a written brief. Order: --agent, the agent the user invoked
 * all-check from (Claude Code announces itself through CLAUDECODE), the default saved by the
 * `aideos` menu in ~/.config/aideos/agent, then agy. Only claude and agy are supported background
 * agents: any other saved default falls back to agy and says so.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentName } from "./types";

/** Where the `aideos` menu stores the user's locked default agent. */
export function savedAgentFile(home: string = os.homedir()): string {
  return path.join(home, ".config", "aideos", "agent");
}

/** The agent chosen, why, and a note when a saved default could not be honoured. */
export interface ResolvedAgent {
  agent: AgentName;
  source: "flag" | "invoking-agent" | "saved-default" | "fallback";
  note?: string;
}

/** The inputs of the choice, injectable for tests. */
export interface AgentEnv {
  flag?: AgentName;
  env: NodeJS.ProcessEnv;
  home?: string;
}

// Decides the background agent from the flag, the invoking agent, the saved default, then agy.
export function resolveAgent({ flag, env, home }: AgentEnv): ResolvedAgent {
  if (flag) return { agent: flag, source: "flag" };
  if (env.CLAUDECODE === "1") return { agent: "claude", source: "invoking-agent" };

  let saved = "";
  try {
    saved = fs.readFileSync(savedAgentFile(home), "utf8").trim().toLowerCase();
  } catch {
    // No saved default.
  }
  if (saved === "claude") return { agent: "claude", source: "saved-default" };
  if (saved === "agy" || saved === "antigravity") return { agent: "agy", source: "saved-default" };
  if (saved && saved !== "none") {
    return { agent: "agy", source: "fallback", note: `saved default "${saved}" cannot run all-check; using agy (pass --agent claude to use Claude Code)` };
  }
  return { agent: "agy", source: "fallback" };
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

// Builds the interactive, fully pre-approved command for an agent with its brief.
export function buildAgentCommand(agent: AgentName, briefPath: string, slug: string): AgentCommand {
  const prompt = agentPrompt(briefPath, slug);
  if (agent === "claude") {
    return { command: "claude", args: ["--dangerously-skip-permissions", prompt] };
  }
  return { command: "agy", args: ["--prompt-interactive", prompt, "--dangerously-skip-permissions"] };
}
