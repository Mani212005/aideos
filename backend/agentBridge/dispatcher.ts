/**
 * File Description: Multi-channel outbound dispatcher and hybrid fallback manager for the Aideos Agent Bridge.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "../pipeline/filmStore";
import { buildDirectingPrompt, buildTaskContext } from "./contextBuilder";
import { taskQueue } from "./taskQueue";
import type { AgentSessionInfo, AgentTask, DispatchChannel, DispatchOptions, DispatchResult } from "./types";

/** Default timeout in milliseconds before falling back to in-process server-side execution. */
export const DEFAULT_AGENT_TIMEOUT_MS = 15000;

const SESSION_FILE = path.join(ROOT, ".aideos_session.json");
const EVENTS_LOG = path.join(ROOT, "state", "agent_events.jsonl");

/** Map storing active fallback timers by task identifier. */
const activeFallbackTimers = new Map<string, NodeJS.Timeout>();

// Automatically defuse fallback timers when a task is claimed or completed
taskQueue.addListener((event, task) => {
  if (event === "claimed" || event === "completed" || event === "failed") {
    cancelFallbackTimer(task.id);
  }
});

/** Reads the current active agent session configuration. */
export function getAgentSession(): AgentSessionInfo {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      return {
        agent: data.agent || "claude",
        sessionType: data.sessionType || "tmux",
        tmuxSession: data.tmuxSession || "aideos",
        tmuxPane: data.tmuxPane,
        pid: data.pid,
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    } catch (_) {}
  }

  return {
    agent: "claude",
    sessionType: "tmux",
    tmuxSession: "aideos",
    updatedAt: new Date().toISOString(),
  };
}

/** Updates and persists the active agent session info. */
export function setAgentSession(info: Partial<AgentSessionInfo>): AgentSessionInfo {
  const current = getAgentSession();
  const next: AgentSessionInfo = {
    ...current,
    ...info,
    updatedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(next, null, 2), "utf8");
  } catch (err) {
    console.warn("[AgentBridge] Failed to save session info:", err);
  }

  return next;
}

/** Cancels any active fallback timer registered for a specific task. */
export function cancelFallbackTimer(taskId: string): boolean {
  const timer = activeFallbackTimers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    activeFallbackTimers.delete(taskId);
    return true;
  }
  return false;
}

/** Clears all active fallback timers (used for clean resets in test environments). */
export function clearAllFallbackTimers(): void {
  for (const timer of activeFallbackTimers.values()) {
    clearTimeout(timer);
  }
  activeFallbackTimers.clear();
}

/** Writes a durable sequential steering message file for Firstmate crewmate agents. */
export function writeFirstmateInboxMessage(
  task: AgentTask,
  targetInboxDir?: string,
): { written: boolean; filePath?: string; error?: string } {
  const inboxDir = targetInboxDir || process.env.FIRSTMATE_STEERING_INBOX || process.env.AIDEOS_AGENT_INBOX;
  if (!inboxDir || typeof inboxDir !== "string" || !inboxDir.trim()) {
    return { written: false };
  }

  try {
    if (!fs.existsSync(inboxDir)) {
      fs.mkdirSync(inboxDir, { recursive: true });
    }

    // Find highest existing numeric sequence in inbox directory
    const files = fs.readdirSync(inboxDir);
    let maxSeq = 0;
    for (const file of files) {
      const match = file.match(/^(\d+)\.msg$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    }

    const nextSeq = maxSeq + 1;
    const msgFileName = `${String(nextSeq).padStart(3, "0")}.msg`;
    const fullPath = path.join(inboxDir, msgFileName);

    const messageContent = `# Aideos Studio Task Directive: ${task.eventType}
**Task ID:** ${task.id}
**Film:** ${task.filmTitle} (${task.filmId})
**Created:** ${task.createdAt}

## Directing Prompt
${task.prompt}

## Working Context
- Screenplay: ${task.context.scriptPath || `videos/${task.filmId}/script.md`}
- Film Spec: ${task.context.filmPath || `videos/${task.filmId}/film.json`}
- Voiceover Audio: ${task.context.voiceoverPath || "Not synthesized"}
- Word Timings: ${task.context.voiceoverWordsPath || "None"}
- Duration: ${task.context.durationSec !== undefined ? `${task.context.durationSec}s` : "Unknown"}
- Shots: ${task.context.shotCount !== undefined ? task.context.shotCount : "Unknown"}

## Actions
Claim this task via MCP tool \`aideos_claim_task({ taskId: "${task.id}" })\` or complete work and report back via \`aideos_complete_task({ taskId: "${task.id}" })\`.
`;

    fs.writeFileSync(fullPath, messageContent, "utf8");
    return { written: true, filePath: fullPath };
  } catch (err: any) {
    console.warn("[AgentBridge] Failed to write Firstmate inbox message:", err);
    return { written: false, error: String(err) };
  }
}

/** Writes local task files (.aideos_task.md) and attempts tmux dispatch. */
export function dispatchLocalAndTmux(
  prompt: string,
  opts?: { sessionName?: string; pane?: string },
): { tmuxSent: boolean; fileWritten: boolean } {
  let fileWritten = false;
  let tmuxSent = false;

  try {
    fs.writeFileSync(path.join(ROOT, ".aideos_task.md"), prompt, "utf8");
    fileWritten = true;

    const stateDir = path.join(ROOT, "state");
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    const logEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      session: opts?.sessionName || "default",
      promptSnippet: prompt.slice(0, 100),
    });
    fs.appendFileSync(EVENTS_LOG, `${logEntry}\n`, "utf8");
  } catch (_) {}

  const sessionInfo = getAgentSession();
  const targetSession = opts?.sessionName || sessionInfo.tmuxSession || "aideos";
  const targetPane = opts?.pane || sessionInfo.tmuxPane;
  const target = targetPane || targetSession;

  try {
    const hasSess = spawnSync("tmux", ["has-session", "-t", targetSession], { encoding: "utf8" });
    if (hasSess.status === 0) {
      const bufName = `aideos_${Date.now()}`;
      const setBuf = spawnSync("tmux", ["set-buffer", "-b", bufName, prompt], { encoding: "utf8" });
      if (setBuf.status === 0) {
        spawnSync("tmux", ["paste-buffer", "-b", bufName, "-t", target, "-d"], { encoding: "utf8" });
        spawnSync("tmux", ["send-keys", "-t", target, "Enter"], { encoding: "utf8" });
        tmuxSent = true;
      }
    }
  } catch (_) {}

  return { tmuxSent, fileWritten };
}

/** Dispatches a rich task across all active channels with automatic hybrid fallback. */
export async function dispatchTask(opts: DispatchOptions): Promise<DispatchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const context = buildTaskContext(opts);
  const prompt = buildDirectingPrompt(opts, context);

  const channels: DispatchChannel[] = ["mcp_queue", "file_inbox"];

  // 1. Channel A: Firstmate Steering Inbox
  const inboxResult = writeFirstmateInboxMessage({
    id: "temp",
    eventType: opts.eventType,
    filmId: opts.filmId,
    filmTitle: context.filmTitle,
    prompt,
    context,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "pending",
    dispatchedChannels: [],
    timeoutMs,
  }, opts.inboxDir);

  if (inboxResult.written) {
    channels.push("firstmate_inbox");
  }

  // 2. Channel C: Local file & tmux
  const localResult = dispatchLocalAndTmux(prompt, {
    sessionName: opts.sessionName,
    pane: opts.pane,
  });
  if (localResult.tmuxSent) {
    channels.push("tmux");
  }

  // 3. Channel B: Enqueue task in TaskQueue
  const task = taskQueue.createTask({
    eventType: opts.eventType,
    filmId: opts.filmId,
    filmTitle: context.filmTitle,
    prompt,
    context,
    dispatchedChannels: channels,
    inboxMessagePath: inboxResult.filePath,
    timeoutMs,
  });

  // 4. Hybrid Fallback (Approved Decision 1)
  const enableFallback = opts.enableFallback !== false;
  let fallbackScheduled = false;

  if (enableFallback) {
    fallbackScheduled = true;
    const timer = setTimeout(async () => {
      activeFallbackTimers.delete(task.id);
      const current = taskQueue.getTask(task.id);
      if (current && current.status === "pending") {
        taskQueue.timeoutTask(task.id);
        if (opts.fallbackHandler) {
          try {
            await opts.fallbackHandler(current);
          } catch (err) {
            console.error(`[AgentBridge] Fallback execution failed for task ${task.id}:`, err);
            taskQueue.failTask(task.id, String(err));
          }
        }
      }
    }, timeoutMs);

    // Unref timer so it does not keep node processes or tests artificially alive
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    activeFallbackTimers.set(task.id, timer);
  }

  return {
    ok: true,
    taskId: task.id,
    task,
    channels,
    inboxMessagePath: inboxResult.filePath,
    prompt,
    fallbackScheduled,
    fallbackTimeoutMs: timeoutMs,
    message: `Dispatched task ${task.id} across channels: ${channels.join(", ")}`,
  };
}
