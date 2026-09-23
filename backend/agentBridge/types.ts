/**
 * File Description: Type definitions for the Aideos Agent Bridge Hub, task queue, and multi-channel dispatcher.
 */

import type { Film } from "../../src/dl/schema";

export type AgentEventType =
  | "auto_build_scenes"
  | "voiceover_ready"
  | "script_updated"
  | "ai_edit"
  | "custom_directive"
  | "produce_film"
  | "canvas_updated"
  | "critique"
  | "design_film";

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
}

export interface DispatchResult {
  ok: boolean;
  taskId: string;
  task: AgentTask;
  channels: DispatchChannel[];
  inboxMessagePath?: string;
  prompt: string;
  fallbackScheduled: boolean;
  fallbackTimeoutMs: number;
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
