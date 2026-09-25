/**
 * File Description: The text the studio shows for linking the owner's own coding agent through MCP:
 * the one command that adds the studio's aideos MCP endpoint to each supported agent, and the one
 * line to paste into that agent so it starts taking studio tasks in its own normal session.
 * Pure string building, no I/O, so it is unit tested and shared by the pairing route.
 */

import { LINK_AGENT_LABEL, type LinkAgent } from "./store";

/** What the studio shows for the agent-native link. */
export interface AgentInstructions {
  agent: LinkAgent;
  agentLabel: string;
  /** The shell command (or config snippet) that registers the studio's MCP endpoint. */
  addCommand: string;
  /** Where the command is run, in plain words. */
  addHint: string;
  /** The line to paste into the running agent. */
  prompt: string;
}

/** The paste-in prompt: it makes the agent loop on aideos_wait_for_task, visibly, in its own UI. */
export const AGENT_LINK_PROMPT =
  "Link this session to my Aideos studio. Call the aideos_wait_for_task tool. When it returns a task, do exactly what the task instructions say using the aideos tools, " +
  "finish with aideos_complete_task, then call aideos_wait_for_task again. Keep doing this until it says the studio disconnected. Tell me briefly what you are doing at each step.";

// Builds the add-MCP command for one agent from the studio's API url and a link token.
export function buildAgentInstructions(agent: LinkAgent, apiUrl: string, token: string): AgentInstructions {
  const mcpUrl = `${apiUrl}/api/mcp`;
  const base = { agent, agentLabel: LINK_AGENT_LABEL[agent], prompt: AGENT_LINK_PROMPT };
  if (agent === "claude") {
    return { ...base, addCommand: `claude mcp add --transport http aideos ${mcpUrl} --header "Authorization: Bearer ${token}"`, addHint: "Run once in any terminal, then start (or restart) claude." };
  }
  if (agent === "codex") {
    return { ...base, addCommand: `export AIDEOS_LINK_TOKEN=${token} && codex mcp add aideos --url ${mcpUrl} --bearer-token-env-var AIDEOS_LINK_TOKEN`, addHint: "Run once, then start codex from the same shell." };
  }
  if (agent === "agy") {
    return { ...base, addCommand: `agy mcp add --header "Authorization: Bearer ${token}" aideos ${mcpUrl}`, addHint: "Run once, then start agy." };
  }
  const snippet = JSON.stringify({ mcp: { aideos: { type: "remote", url: mcpUrl, headers: { Authorization: `Bearer ${token}` }, enabled: true } } }, null, 2);
  return { ...base, addCommand: snippet, addHint: "Merge this into opencode.json (project or ~/.config/opencode/opencode.json), then start opencode." };
}
