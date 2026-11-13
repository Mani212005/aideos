/**
 * File Description: The production run state machine. One table declares every stage state and the
 * only legal transitions between them; `createRunMachine` applies events to a run's persisted state,
 * refuses an impossible transition with a named error, and saves after every transition (including
 * `running`), so a killed process leaves `running` on disk instead of a stale `done`. "Needs input"
 * is a state with a value (`InputNeeded`), not an exception. Pure apart from the injected `persist`.
 * Inputs and outputs: RunState plus stage events -> new stage records, persisted through `persist`.
 * Used by: backend/pipeline/run.ts, backend/pipeline/runState.ts.
 */

import { PRODUCTION_STAGES, type ProductionStage, type RunState, type StageRecord, type StageState } from "./types";

/** Every event a stage can receive. */
export type StageEventType =
  | "start" | "complete" | "fail" | "need_input" | "reuse" | "adopt" | "restamp" | "invalidate" | "interrupt";

/** The legal transitions: state -> event -> next state. Anything absent is impossible. */
export const STAGE_TRANSITIONS: Readonly<Record<StageState, Readonly<Partial<Record<StageEventType, StageState>>>>> = {
  pending: { start: "running", adopt: "done", invalidate: "pending" },
  running: { complete: "done", fail: "failed", need_input: "needs_input", interrupt: "failed" },
  done: { start: "running", reuse: "done", adopt: "done", restamp: "done", invalidate: "pending" },
  failed: { start: "running", adopt: "done", invalidate: "pending" },
  needs_input: { start: "running", adopt: "done", invalidate: "pending" },
};

/** The next state for an event, or null when the transition is impossible. */
export function nextStageState(from: StageState, event: StageEventType): StageState | null {
  return STAGE_TRANSITIONS[from][event] ?? null;
}

/** Thrown when an event is not legal in the stage's current state. */
export class IllegalTransitionError extends Error {
  readonly stage: ProductionStage;
  readonly from: StageState;
  readonly event: StageEventType;
  // Names the stage, its state and the refused event.
  constructor(stage: ProductionStage, from: StageState, event: StageEventType) {
    super(`illegal transition: stage "${stage}" is ${from} and cannot ${event}`);
    this.name = "IllegalTransitionError";
    this.stage = stage;
    this.from = from;
    this.event = event;
  }
}

/** A resumable authoring stop: the stage cannot continue until someone supplies input. */
export interface InputNeeded {
  readonly kind: "needs_input";
  readonly status: "needs_look" | "needs_design" | "needs_reel_cut";
  readonly nextSteps: string[];
  readonly message: string;
}

/** Builds the value a stage's work returns when it needs authoring input. */
export function inputNeeded(status: InputNeeded["status"], nextSteps: string[], message: string): InputNeeded {
  return { kind: "needs_input", status, nextSteps, message };
}

/** True when a stage's result is a request for input rather than a produced value. */
export function isInputNeeded(value: unknown): value is InputNeeded {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "needs_input";
}

/** Who is running a stage, so a later load can tell a live run from a dead one. */
export interface RunOwner { pid: number; runId: string }

/** One event with the data it carries. */
export type StageEvent =
  | { type: "start"; fingerprint: string; owner: RunOwner; at?: string }
  | { type: "complete"; fingerprint?: string; at?: string }
  | { type: "fail"; error: string; at?: string }
  | { type: "need_input"; message: string; at?: string }
  | { type: "interrupt"; reason: string; at?: string }
  | { type: "adopt"; fingerprint: string }
  | { type: "restamp"; fingerprint: string }
  | { type: "reuse" }
  | { type: "invalidate" };

// Applies one event to a record and returns the new record, or throws on an impossible transition.
export function applyStageEvent(record: StageRecord, event: StageEvent): StageRecord {
  const to = nextStageState(record.status, event.type);
  if (!to) throw new IllegalTransitionError(record.stage, record.status, event.type);
  const at = ("at" in event && event.at) || new Date().toISOString();
  const next: StageRecord = { ...record, status: to };
  switch (event.type) {
    case "start":
      next.startedAt = at;
      next.fingerprint = event.fingerprint;
      next.owner = event.owner;
      delete next.finishedAt;
      delete next.durationMs;
      delete next.error;
      break;
    case "complete":
      next.finishedAt = at;
      next.durationMs = record.startedAt ? Math.max(0, Date.parse(at) - Date.parse(record.startedAt)) : 0;
      if (event.fingerprint !== undefined) next.fingerprint = event.fingerprint;
      delete next.owner;
      break;
    case "fail":
      next.finishedAt = at;
      next.error = event.error;
      delete next.owner;
      break;
    case "interrupt":
      next.finishedAt = at;
      next.error = event.reason;
      delete next.owner;
      break;
    case "need_input":
      next.finishedAt = at;
      next.error = event.message;
      delete next.owner;
      break;
    case "adopt":
      next.fingerprint = event.fingerprint;
      delete next.error;
      break;
    case "restamp":
      next.fingerprint = event.fingerprint;
      break;
    case "invalidate":
      delete next.owner;
      delete next.startedAt;
      delete next.finishedAt;
      delete next.durationMs;
      delete next.error;
      delete next.fingerprint;
      break;
    case "reuse":
      break;
  }
  return next;
}

/** A run's state plus the only operations that may change a stage. */
export interface RunMachine {
  readonly state: RunState;
  /** The stage's record, or a pending one when the stage has never been touched (not stored). */
  record(stage: ProductionStage): StageRecord;
  /** Starts a stage: every later stage becomes pending (and render outputs are dropped), then this one runs. */
  begin(stage: ProductionStage, fingerprint: string, owner: RunOwner): void;
  complete(stage: ProductionStage, fingerprint?: string, refreshed?: Array<{ stage: ProductionStage; fingerprint: string }>): void;
  fail(stage: ProductionStage, error: string): void;
  needInput(stage: ProductionStage, message: string): void;
  /** A done stage whose fingerprint still matches is reused as is. */
  reuse(stage: ProductionStage): void;
  /** Takes recorded work already on disk as this stage's done result. */
  adopt(stage: ProductionStage, fingerprint: string): void;
  /** Re-stamps a done stage's fingerprint after later work changed what it hashes. */
  restamp(stage: ProductionStage, fingerprint: string): void;
  /** Ends every stage this run still has running (an unexpected exit), as failed. */
  release(runId: string, reason: string): void;
  /** Saves the state, for non-stage data (b-roll clips, outputs) changed by the run. */
  save(): void;
}

// Creates the machine over a loaded state; `persist` is called after every transition.
export function createRunMachine(state: RunState, persist: (state: RunState) => void): RunMachine {
  const find = (stage: ProductionStage): StageRecord | undefined => state.stages.find((s) => s.stage === stage);
  const pending = (stage: ProductionStage): StageRecord => ({ stage, status: "pending" });
  // Replaces (or adds) one record, then persists.
  const put = (record: StageRecord): void => {
    const index = state.stages.findIndex((s) => s.stage === record.stage);
    if (index >= 0) state.stages[index] = record; else state.stages.push(record);
  };
  const apply = (stage: ProductionStage, event: StageEvent): void => {
    put(applyStageEvent(find(stage) ?? pending(stage), event));
    persist(state);
  };
  return {
    state,
    record: (stage) => find(stage) ?? pending(stage),
    begin(stage, fingerprint, owner) {
      // Validate every transition before changing anything, so a refusal leaves the state untouched.
      const index = PRODUCTION_STAGES.indexOf(stage);
      const later = state.stages.filter((s) => PRODUCTION_STAGES.indexOf(s.stage) > index);
      const invalidated = later.map((s) => applyStageEvent(s, { type: "invalidate" }));
      const started = applyStageEvent(find(stage) ?? pending(stage), { type: "start", fingerprint, owner });
      invalidated.forEach(put);
      put(started);
      if (index < PRODUCTION_STAGES.indexOf("render")) state.outputs = [];
      persist(state);
    },
    complete(stage, fingerprint, refreshed = []) {
      const completed = applyStageEvent(find(stage) ?? pending(stage), { type: "complete", ...(fingerprint !== undefined ? { fingerprint } : {}) });
      const updates = refreshed.map(({ stage: refreshedStage, fingerprint: refreshedFingerprint }) => {
        const record = find(refreshedStage) ?? pending(refreshedStage);
        return applyStageEvent(record, { type: "restamp", fingerprint: refreshedFingerprint });
      });
      put(completed);
      updates.forEach(put);
      persist(state);
    },
    fail: (stage, error) => apply(stage, { type: "fail", error }),
    needInput: (stage, message) => apply(stage, { type: "need_input", message }),
    reuse: (stage) => apply(stage, { type: "reuse" }),
    adopt: (stage, fingerprint) => apply(stage, { type: "adopt", fingerprint }),
    restamp: (stage, fingerprint) => apply(stage, { type: "restamp", fingerprint }),
    release(runId, reason) {
      let changed = false;
      for (const record of state.stages) {
        if (record.status === "running" && record.owner?.runId === runId) {
          put(applyStageEvent(record, { type: "interrupt", reason }));
          changed = true;
        }
      }
      if (changed) persist(state);
    },
    save: () => persist(state),
  };
}
