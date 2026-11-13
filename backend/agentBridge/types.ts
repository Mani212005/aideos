/**
 * File Description: Type definitions for the Aideos Agent Bridge Hub, task queue, and multi-channel dispatcher.
 * Inputs and outputs: TypeScript definitions -> types for agent tasks, events, and bridge state.
 * Used by: backend/agentBridge/contextBuilder.ts, backend/agentBridge/dispatcher.ts.
 */

import type { Film } from "../../src/dl/schema";
import type { PaneDelivery } from "./paneDelivery";

export type AgentEventType =
  | "auto_build_scenes"
  | "voiceover_ready"
  | "script_updated"
  | "ai_edit"
  | "custom_directive"
  | "produce_film"
  | "canvas_updated"
  | "critique"
  | "design_film"
  | "reel_cut"
  | "frame_review";

export type AgentTaskStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed"
  | "timed_out";

export type DispatchChannel =
  | "firstmate_inbox"
  | "mcp_queue"
  | "tmux"
  | "file_inbox"
  | "agent_link";

export interface AgentTaskContext {
  filmId: string;
  filmTitle: string;
  scriptText?: string;
  scriptPath?: string;
  film?: Film | null;
  /** The theme and accent the user chose for this project; binding on every design the agent makes. */
  theme?: { background: string; accent: string } | null;
  filmPath?: string;
  voiceoverPath?: string;
  voiceoverWordsPath?: string;
  voiceoverWords?: any[];
  durationSec?: number;
  shotCount?: number;
  directorGuideRef?: string;
  designInvariants?: string[];
  customInstruction?: string;
  metadata?: Record<string, any>;
}

export interface AgentTask {
  id: string;
  eventType: AgentEventType;
  filmId: string;
  filmTitle: string;
  prompt: string;
  context: AgentTaskContext;
  createdAt: string;
  updatedAt: string;
  status: AgentTaskStatus;
  claimedBy?: string;
  claimedAt?: string;
  completedAt?: string;
  result?: any;
  error?: string;
  dispatchedChannels: DispatchChannel[];
  inboxMessagePath?: string;
  timeoutMs: number;
}

export interface DispatchOptions {
  eventType: AgentEventType;
  filmId: string;
  filmTitle?: string;
  scriptText?: string;
  voiceoverFile?: string;
  voiceoverWordsFile?: string;
  durationSec?: number;
  shotCount?: number;
  customInstruction?: string;
  metadata?: Record<string, any>;
  inboxDir?: string;
  timeoutMs?: number;
  enableFallback?: boolean;
  fallbackHandler?: (task: AgentTask) => Promise<any>;
  sessionName?: string;
  pane?: string;
  /**
   * The studio owner key the request carried (the X-Aideos-Owner header). When the owner has an
   * agent connected through `aideos connect`, the task goes to that agent and nowhere else.
   */
  ownerKey?: string;
  /**
   * Reuse an equivalent task instead of creating another. Equivalent means the same owner, film, event and
   * prompt, and still open: younger than OPEN_AFTER_TIMEOUT_MS (10 minutes, measured from when the task was created
   * or last sent) regardless of whether it is pending, claimed, or timed out with a sent pane. A task that finished,
   * failed, or whose prompt could not be sent does not count. Off by default, so dispatches that legitimately repeat
   * (a second canvas edit) are never merged: each gets its own task, and its prompt is typed into the terminal again
   * unless an identical one is still waiting there unsent.
   */
  idempotent?: boolean;
}

export interface DispatchResult {
  ok: boolean;
  /** True when an equivalent open task already existed, so this call reused it and sent nothing new. */
  duplicate?: boolean;
  taskId: string;
  task: AgentTask;
  channels: DispatchChannel[];
  inboxMessagePath?: string;
  prompt: string;
  fallbackScheduled: boolean;
  fallbackTimeoutMs: number;
  /** Where the prompt stands in the agent's terminal pane: sending now, queued behind a busy agent, or dropped as a duplicate. */
  pane?: PaneDelivery;
  message: string;
  error?: string;
}

export interface AgentSessionInfo {
  agent: string;
  sessionType: "tmux" | "process" | "standalone";
  tmuxSession?: string;
  tmuxPane?: string;
  pid?: number;
  updatedAt: string;
}
