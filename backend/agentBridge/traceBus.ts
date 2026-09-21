/**
 * File Description: Live real-time Trace Event Bus for the Aideos Agent Bridge.
 * Aggregates live execution telemetry from external coding agents, the multi-channel dispatcher,
 * and in-process pipeline stages into a single unified timeline streamed to subscribers.
 */

import type { Film } from "../../src/dl/schema";

export type TracePhase =
  | "grounding"
  | "synthesis"
  | "authoring"
  | "validation"
  | "ai_edit"
  | "broll"
  | "dispatch"
  | "complete";

export type TraceStatus = "pending" | "running" | "done" | "corrected" | "failed";

export type TraceSource =
  | "agent"
  | "pipeline"
  | "ai_edit"
  | "tts"
  | "broll"
  | "validation"
  | "bridge"
  | string;

export interface TraceStep {
  id: string;
  phase: TracePhase | string;
  title: string;
  description: string;
  timestamp: string;
  status: TraceStatus;
  details?: string[];
  source?: TraceSource;
  filmId?: string;
  durationMs?: number;
  createdAt: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface RecordStepInput {
  id?: string;
  phase?: TracePhase | string;
  title: string;
  description?: string;
  timestamp?: string;
  status?: TraceStatus;
  details?: string[];
  source?: TraceSource;
  filmId?: string;
  durationMs?: number;
  createdAt?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface GetStepsFilter {
  limit?: number;
  filmId?: string;
  phase?: string;
  source?: string;
}

export type TraceStepListener = (step: TraceStep) => void;

export interface FilmUpdateEvent {
  filmId: string;
  film: Film;
  timestamp: string;
}

export type FilmUpdateListener = (event: FilmUpdateEvent) => void;

/** Formats a Date object into a readable time string (e.g. 10:48:02 AM). */
export function formatStepTimestamp(date: Date = new Date()): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/** Generates a unique, sortable trace step identifier. */
export function generateStepId(): string {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * In-process real-time event bus capturing and broadcasting unified execution telemetry.
 */
export class TraceBus {
  private steps: TraceStep[] = [];
  private maxSteps: number;
  private listeners: Set<TraceStepListener> = new Set();
  private filmListeners: Set<FilmUpdateListener> = new Set();

  /** Initializes the trace bus with an optional max history buffer size. */
  constructor(maxSteps: number = 200) {
    this.maxSteps = maxSteps;
  }

  /** Subscribes a listener to receive new or updated trace steps in real time. */
  subscribe(listener: TraceStepListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Broadcasts a trace step to all registered active subscribers. */
  private broadcast(step: TraceStep): void {
    for (const listener of this.listeners) {
      try {
        listener(step);
      } catch (err) {
        console.error("[TraceBus] Error notifying subscriber listener:", err);
      }
    }
  }

  /** Records and broadcasts a new trace step or updates an existing one by ID. */
  recordStep(input: RecordStepInput): TraceStep {
    const now = new Date();
    const id = input.id || generateStepId();
    const step: TraceStep = {
      id,
      phase: input.phase || "authoring",
      title: input.title,
      description: input.description || "",
      timestamp: input.timestamp || formatStepTimestamp(now),
      status: input.status || "done",
      details: Array.isArray(input.details) ? [...input.details] : [],
      source: input.source || "pipeline",
      filmId: input.filmId,
      durationMs: input.durationMs,
      createdAt: input.createdAt || now.toISOString(),
      error: input.error,
      metadata: input.metadata,
    };

    const existingIndex = this.steps.findIndex((s) => s.id === id);
    if (existingIndex >= 0) {
      this.steps[existingIndex] = step;
    } else {
      this.steps.push(step);
      if (this.steps.length > this.maxSteps) {
        this.steps = this.steps.slice(-this.maxSteps);
      }
    }

    this.broadcast(step);
    return step;
  }

  /** Updates an existing recorded step with partial changes and re-broadcasts it. */
  updateStep(id: string, updates: Partial<RecordStepInput>): TraceStep | undefined {
    const existing = this.steps.find((s) => s.id === id);
    if (!existing) return undefined;

    const updated: TraceStep = {
      ...existing,
      ...updates,
      id: existing.id,
      details: updates.details !== undefined ? updates.details : existing.details,
      createdAt: existing.createdAt,
    };

    const index = this.steps.findIndex((s) => s.id === id);
    this.steps[index] = updated;
    this.broadcast(updated);
    return updated;
  }

  /** Returns recent trace steps matching optional filters in reverse chronological order. */
  getRecentSteps(filter?: GetStepsFilter): TraceStep[] {
    let filtered = [...this.steps];

    if (filter?.filmId) {
      filtered = filtered.filter((s) => !s.filmId || s.filmId === filter.filmId);
    }
    if (filter?.phase) {
      filtered = filtered.filter((s) => s.phase === filter.phase);
    }
    if (filter?.source) {
      filtered = filtered.filter((s) => s.source === filter.source);
    }

    if (typeof filter?.limit === "number" && filter.limit > 0) {
      filtered = filtered.slice(-filter.limit);
    }

    return filtered;
  }

  /** Subscribes a listener to receive film modification events in real time. */
  onFilmUpdate(listener: FilmUpdateListener): () => void {
    this.filmListeners.add(listener);
    return () => {
      this.filmListeners.delete(listener);
    };
  }

  /** Notifies all registered subscribers of a film change and records an authoring trace step. */
  notifyFilmUpdated(filmId: string, film: Film): void {
    const timestamp = new Date().toISOString();
    const event: FilmUpdateEvent = { filmId, film, timestamp };
    for (const listener of this.filmListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[TraceBus] Error notifying film update listener:", err);
      }
    }

    this.recordStep({
      phase: "authoring",
      source: "agent",
      filmId,
      title: "Studio Film Updated",
      description: `Live update for "${film.title || filmId}" (${film.shots?.length || 0} shots, ${film.canvas?.nodes?.length || 0} nodes)`,
      status: "done",
      details: [
        `Film ID: ${filmId}`,
        `Shots: ${film.shots?.length || 0}`,
        `Nodes: ${film.canvas?.nodes?.length || 0}`,
        `Edges: ${film.canvas?.edges?.length || 0}`,
      ],
    });
  }

  /** Returns the current count of active film update subscribers. */
  filmSubscriberCount(): number {
    return this.filmListeners.size;
  }

  /** Clears all recorded trace steps and resets the event bus history. */
  clear(): void {
    this.steps = [];
  }

  /** Returns the current count of active subscribers listening to the trace bus. */
  subscriberCount(): number {
    return this.listeners.size;
  }
}

/** Global singleton trace bus instance shared across the Aideos backend process. */
export const traceBus = new TraceBus();
