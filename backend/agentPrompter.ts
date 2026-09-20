/**
 * File Description: Auto-Prompter and Agent Dispatcher for Aideos.
 * Automatically dispatches directing instructions, screenplay events, and voiceover updates
 * from the Aideos Studio directly into the active AI coding agent.
 * Note: Delegates to the authoritative Agent Bridge Hub in backend/agentBridge.
 */

import {
  buildDirectingPrompt as bridgeBuildDirectingPrompt,
  dispatchLocalAndTmux,
  getAgentSession as bridgeGetAgentSession,
  setAgentSession as bridgeSetAgentSession,
  dispatchTask as bridgeDispatchTask,
} from "./agentBridge";
import type { AgentEventType } from "./agentBridge";

export interface AgentSessionInfo {
  agent: string;
  sessionType: "tmux" | "process" | "standalone";
  tmuxSession?: string;
  tmuxPane?: string;
  pid?: number;
  updatedAt: string;
}

export interface AutoPromptOptions {
  event: "auto_build_scenes" | "voiceover_ready" | "script_updated" | "custom_directive";
  filmId: string;
  filmTitle?: string;
  scriptText?: string;
  voiceoverFile?: string;
  durationSec?: number;
  shotCount?: number;
  customInstruction?: string;
}

export interface DispatchResult {
  ok: boolean;
  channel: "tmux" | "file_inbox" | "none";
  session?: string;
  pane?: string;
  message: string;
  prompt: string;
  error?: string;
}

/** Reads the current active agent session configuration. */
export function getAgentSession(): AgentSessionInfo {
  return bridgeGetAgentSession();
}

/** Updates or registers the active agent session info. */
export function setAgentSession(info: Partial<AgentSessionInfo>): AgentSessionInfo {
  return bridgeSetAgentSession(info);
}

/** Builds the full directing instruction prompt to send to the AI coding agent. */
export function buildDirectingPrompt(opts: AutoPromptOptions): string {
  const eventMap: Record<string, AgentEventType> = {
    auto_build_scenes: "auto_build_scenes",
    voiceover_ready: "voiceover_ready",
    script_updated: "script_updated",
    custom_directive: "custom_directive",
  };
  return bridgeBuildDirectingPrompt({
    eventType: eventMap[opts.event] || "custom_directive",
    filmId: opts.filmId,
    filmTitle: opts.filmTitle,
    scriptText: opts.scriptText,
    voiceoverFile: opts.voiceoverFile,
    durationSec: opts.durationSec,
    shotCount: opts.shotCount,
    customInstruction: opts.customInstruction,
  });
}

/** Dispatches a prompt directly into the active tmux agent session or inbox. */
export function dispatchPromptToAgent(
  prompt: string,
  opts?: { sessionName?: string; pane?: string },
): DispatchResult {
  const res = dispatchLocalAndTmux(prompt, opts);
  if (res.tmuxSent) {
    const sessionInfo = bridgeGetAgentSession();
    const targetSession = opts?.sessionName || sessionInfo.tmuxSession || "aideos";
    return {
      ok: true,
      channel: "tmux",
      session: targetSession,
      pane: opts?.pane || sessionInfo.tmuxPane,
      message: `Directly prompted active coding agent in tmux session [${targetSession}]`,
      prompt,
    };
  }

  return {
    ok: true,
    channel: "file_inbox",
    message: "Directive written to .aideos_task.md (no active tmux session attached)",
    prompt,
  };
}
