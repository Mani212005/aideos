/**
 * File Description: Pending task queue and lifecycle manager for the Aideos Agent Bridge.
 */

import type { AgentEventType, AgentTask, AgentTaskContext, DispatchChannel } from "./types";
import { traceBus } from "./traceBus";

/** Generates a unique, sortable task identifier. */
function generateTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export type TaskLifecycleEvent = "created" | "claimed" | "completed" | "failed" | "timed_out";
export type TaskLifecycleListener = (event: TaskLifecycleEvent, task: AgentTask) => void;

export interface CreateTaskParams {
  id?: string;
  eventType: AgentEventType;
  filmId: string;
  filmTitle: string;
  prompt: string;
  context: AgentTaskContext;
  dispatchedChannels: DispatchChannel[];
  inboxMessagePath?: string;
  timeoutMs: number;
}

/** In-memory task queue managing life cycles of agent tasks across all dispatch channels. */
export class TaskQueue {
  private tasks = new Map<string, AgentTask>();
  private listeners: TaskLifecycleListener[] = [];

  /** Registers a lifecycle listener callback on the task queue. */
  addListener(listener: TaskLifecycleListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Emits a lifecycle transition event to all registered listeners. */
  private emit(event: TaskLifecycleEvent, task: AgentTask): void {
    for (const listener of this.listeners) {
      try {
        listener(event, task);
      } catch (err) {
        console.error("[TaskQueue] Error in lifecycle listener:", err);
      }
    }
  }

  /** Creates and registers a new pending agent task in the queue. */
  createTask(params: CreateTaskParams): AgentTask {
    const id = params.id || generateTaskId();
    const now = new Date().toISOString();
    const task: AgentTask = {
      id,
      eventType: params.eventType,
      filmId: params.filmId,
      filmTitle: params.filmTitle,
      prompt: params.prompt,
      context: params.context,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      dispatchedChannels: params.dispatchedChannels,
      inboxMessagePath: params.inboxMessagePath,
      timeoutMs: params.timeoutMs,
    };
    this.tasks.set(id, task);
    this.emit("created", task);
    return task;
  }

  /** Retrieves a task by its unique identifier. */
  getTask(id: string): AgentTask | undefined {
    return this.tasks.get(id);
  }

  /** Returns all pending tasks awaiting claim, optionally filtered by film slug. */
  listPendingTasks(filmId?: string): AgentTask[] {
    const pending: AgentTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === "pending") {
        if (!filmId || task.filmId === filmId) {
          pending.push(task);
        }
      }
    }
    return pending.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Lists all registered tasks in reverse chronological order. */
  listAllTasks(limit?: number): AgentTask[] {
    const all = Array.from(this.tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return typeof limit === "number" && limit > 0 ? all.slice(0, limit) : all;
  }

  /** Transitions a pending task to claimed status for a specific agent. */
  claimTask(id: string, agentId = "agent"): AgentTask {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task with id "${id}" was not found.`);
    }
    if (task.status !== "pending") {
      throw new Error(`Task "${id}" cannot be claimed because its status is "${task.status}".`);
    }
    const now = new Date().toISOString();
    task.status = "claimed";
    task.claimedBy = agentId;
    task.claimedAt = now;
    task.updatedAt = now;
    this.emit("claimed", task);
    return task;
  }

  /** Transitions a task to completed status with optional execution results. */
  completeTask(id: string, result?: any): AgentTask {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task with id "${id}" was not found.`);
    }
    const now = new Date().toISOString();
    task.status = "completed";
    task.completedAt = now;
    task.result = result;
    task.updatedAt = now;
    this.emit("completed", task);
    return task;
  }

  /** Transitions a task to failed status with the associated error explanation. */
  failTask(id: string, error: string): AgentTask {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task with id "${id}" was not found.`);
    }
    const now = new Date().toISOString();
    task.status = "failed";
    task.error = error;
    task.updatedAt = now;
    this.emit("failed", task);
    return task;
  }

  /** Transitions an unclaimed pending task to timed_out status. */
  timeoutTask(id: string): AgentTask {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task with id "${id}" was not found.`);
    }
    if (task.status === "pending") {
      const now = new Date().toISOString();
      task.status = "timed_out";
      task.updatedAt = now;
      this.emit("timed_out", task);
    }
    return task;
  }

  /** Clears all tasks from the queue (used for resets and isolated testing). */
  clear(): void {
    this.tasks.clear();
  }
}

/** Global singleton task queue instance shared across the Aideos backend process. */
export const taskQueue = new TaskQueue();

// Automatically report task queue lifecycle transitions into the unified trace bus
taskQueue.addListener((event, task) => {
  if (event === "created") {
    traceBus.recordStep({
      id: `task-create-${task.id}`,
      phase: "dispatch",
      source: "bridge",
      filmId: task.filmId,
      title: `Task Dispatched: ${task.eventType}`,
      description: `Dispatched task [${task.id}] for film "${task.filmTitle}" across channels: ${task.dispatchedChannels.join(", ")}`,
      status: "pending",
      details: [
        `Prompt: ${task.prompt.slice(0, 100)}...`,
        `Channels: ${task.dispatchedChannels.join(", ")}`,
        `Timeout: ${(task.timeoutMs / 1000).toFixed(0)}s`,
      ],
    });
  } else if (event === "claimed") {
    traceBus.recordStep({
      id: `task-claim-${task.id}`,
      phase: "dispatch",
      source: "agent",
      filmId: task.filmId,
      title: `Task Claimed by ${task.claimedBy || "Agent"}`,
      description: `Active coding agent claimed task [${task.id}] (hybrid fallback timer defused)`,
      status: "running",
      details: [
        `Agent: ${task.claimedBy || "agent"}`,
        `Claimed at: ${task.claimedAt || new Date().toISOString()}`,
      ],
    });
  } else if (event === "completed") {
    traceBus.recordStep({
      id: `task-complete-${task.id}`,
      phase: "complete",
      source: "agent",
      filmId: task.filmId,
      title: `Task Completed: ${task.eventType}`,
      description: `Task [${task.id}] completed successfully by coding agent`,
      status: "done",
      details: task.result ? [`Result: ${typeof task.result === "object" ? JSON.stringify(task.result).slice(0, 120) : String(task.result)}`] : [],
    });
  } else if (event === "timed_out") {
    traceBus.recordStep({
      id: `task-timeout-${task.id}`,
      phase: "dispatch",
      source: "bridge",
      filmId: task.filmId,
      title: "Task Timed Out (Fallback Triggered)",
      description: `No external coding agent claimed task [${task.id}] within ${(task.timeoutMs / 1000).toFixed(0)}s; falling back to in-process execution`,
      status: "corrected",
    });
  } else if (event === "failed") {
    traceBus.recordStep({
      id: `task-fail-${task.id}`,
      phase: "dispatch",
      source: "bridge",
      filmId: task.filmId,
      title: `Task Failed: ${task.eventType}`,
      description: `Task [${task.id}] failed: ${task.error || "Unknown error"}`,
      status: "failed",
      error: task.error,
    });
  }
});
