/**
 * File Description: The durable task queue contract of the farm: types, defaults and the TaskQueue interface. The interface is asynchronous so a Postgres table claimed with `FOR UPDATE SKIP LOCKED` can replace the SQLite file without touching a caller. Delivery is at least once and output is idempotent (same spec, same bytes), so a duplicate run is harmless.
 * Inputs and outputs: submissions, lease claims, heartbeats, acknowledgements and failures -> task records, leases, task logs, dead letters and queue metrics.
 * Used by: backend/farm/sqliteQueue.ts, backend/farm/worker.ts, backend/farm/janitor.ts, backend/farm/gc.ts, backend/farm/submit.ts, backend/farm/metrics.ts, scripts/farm.ts.
 */

import type { Digest, PriorityClass, TaskPayload, TaskSpec } from "./taskSpec";

/** `parked` is held back by admission control, `queued` is ready or waiting for its retry time. */
export type TaskState = "parked" | "queued" | "leased" | "done" | "dead";

/** What a finished task records: where the output is and what it cost. */
export interface TaskResult {
  outputDigest: Digest;
  sidecarDigest: Digest | null;
  sizeBytes: number;
  workerId: string;
  attempt: number;
  /** Seconds spent in each phase of the winning attempt (fetching, preparing, rendering, mastering, promoting ...). */
  stageSeconds: Record<string, number>;
  /** Wall seconds the winning attempt held the worker. */
  workerSeconds: number;
  peakDiskBytes: number;
  peakMemoryBytes: number;
  /** Worker seconds times the machine price. */
  costUsd: number;
}

/** The lease a worker holds on a task; every later call names it. */
export interface LeaseToken {
  taskId: Digest;
  worker: string;
  attempt: number;
}

/** A task as the queue stores it. */
export interface TaskRecord {
  id: Digest;
  spec: TaskSpec;
  payload: TaskPayload;
  owner: string;
  priorityClass: PriorityClass;
  state: TaskState;
  attempts: number;
  maxAttempts: number;
  /** Earliest time (epoch ms) a queued task may be leased; later than now while it backs off. */
  availableAt: number;
  lease: { worker: string; attempt: number; expiresAt: number } | null;
  submittedAt: number;
  /** When the task became ready (after parking, the release time). */
  queuedAt: number;
  firstStartedAt: number | null;
  finishedAt: number | null;
  /** How many submissions named this task (a repeat is a cache hit or coalesced). */
  submissions: number;
  result: TaskResult | null;
  error: string | null;
}

/** A claimed task and the token for it. */
export interface LeasedTask {
  token: LeaseToken;
  task: TaskRecord;
}

/** One structured log line kept with its task. */
export interface LogEntry {
  seq: number;
  at: number;
  worker: string | null;
  attempt: number | null;
  event: string;
  data: Record<string, unknown>;
}

/** What a worker sends when it logs. */
export interface LogInput {
  worker?: string | null;
  attempt?: number | null;
  event: string;
  data?: Record<string, unknown>;
}

/** A dead-lettered task with the reason and the log of every attempt. */
export interface DeadLetter {
  taskId: Digest;
  deadAt: number;
  reason: string;
  attempts: number;
  log: LogEntry[];
}

export interface SubmitInput {
  spec: TaskSpec;
  payload: TaskPayload;
  /** Who asked (a studio owner key or a batch name); fair share and the concurrency cap apply per owner. */
  owner: string;
  priorityClass: PriorityClass;
  maxAttempts?: number;
  /** Decides whether a finished task's output is still usable (for example, still in the store). */
  isResultValid?: (result: TaskResult) => boolean;
}

/** `cache_hit` means the output already exists, `coalesced` that the same task is already in flight, `dead_letter` that it already failed for good. */
export type SubmitOutcome = "enqueued" | "parked" | "cache_hit" | "coalesced" | "dead_letter";

export interface SubmitResult {
  id: Digest;
  outcome: SubmitOutcome;
  state: TaskState;
}

/** What `fail` did with the task. */
export type FailOutcome = { state: "queued"; retryAt: number } | { state: "dead"; reason: string } | { state: "lost" };

/** What `complete` did: `done` for the first finisher, `already_done` or `lost` for a late or stale one. */
export type CompleteOutcome = "done" | "already_done" | "lost";

/** A summary of a list of numbers. */
export interface Distribution {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

export interface QueueMetrics {
  at: number;
  depth: Record<TaskState, number>;
  /** Ready tasks per class. */
  readyByClass: Record<PriorityClass, number>;
  /** Age of the oldest ready task, the back-pressure signal; 0 when none is ready. */
  oldestReadyAgeMs: number;
  submissions: number;
  cacheHits: number;
  /** cacheHits / submissions, 0 when nothing was submitted. */
  cacheHitRate: number;
  coalesced: number;
  /** Failed attempts and expired leases that returned a task to the queue. */
  retries: number;
  deadLetters: number;
  lateCompletions: number;
  releasedForDisk: number;
  parkedTotal: number;
  /** Submission to first lease, over finished tasks. */
  queueWaitMs: Distribution;
  /** Worker seconds of the winning attempt, over finished tasks. */
  renderSeconds: Distribution;
  stageSeconds: Record<string, Distribution>;
  peakDiskBytes: Distribution;
  peakMemoryBytes: Distribution;
  totalCostUsd: number;
}

/** A worker as the registry knows it. */
export interface WorkerInfo {
  id: string;
  pid: number;
  host: string;
  startedAt: number;
  heartbeatAt: number;
  stoppedAt: number | null;
}

/** A lease the queue still honours; the janitor keeps the attempt directory of each. */
export interface LiveLease {
  taskId: Digest;
  worker: string;
  attempt: number;
  expiresAt: number;
}

/** Which stored objects the garbage collector must keep. */
export interface ReferencePolicy {
  /** Films whose finished outputs stay; when absent every finished output within `resultTtlMs` stays. */
  liveFilms?: ReadonlySet<string>;
  /** How long the output of a finished task of a film that is not live stays in the store. */
  resultTtlMs: number;
}

/** The tunables of a queue. */
export interface QueueOptions {
  /** Clock in epoch milliseconds. */
  now?: () => number;
  maxAttempts?: number;
  /** First retry delay; each further retry multiplies it by four. */
  backoffBaseMs?: number;
  backoffCapMs?: number;
  /** Batch work submitted while the oldest ready task is older than this is parked. */
  maxBacklogAgeMs?: number;
  /** Parked work is released only while fewer than this many tasks are ready. */
  resumeBelowDepth?: number;
  /** Tasks one owner may have leased at once, unless the owner has its own cap. */
  defaultOwnerCap?: number;
}

export const QUEUE_DEFAULTS = Object.freeze({
  maxAttempts: 3,
  backoffBaseMs: 2_000,
  backoffCapMs: 5 * 60_000,
  maxBacklogAgeMs: 30 * 60_000,
  resumeBelowDepth: 8,
  defaultOwnerCap: 1_000_000,
});

/** The delay before a retry: base * 4^(attempt - 1), capped. */
export function backoffMs(attempt: number, baseMs: number, capMs: number): number {
  return Math.min(capMs, baseMs * 4 ** Math.max(0, attempt - 1));
}

/** The durable queue every worker and submitter talks to. */
export interface TaskQueue {
  /** Adds a task, or answers a repeat with a cache hit, a coalesced duplicate or the dead letter. */
  submit(input: SubmitInput): Promise<SubmitResult>;
  /** Leases the best ready task for a worker, or null; expired leases are returned to the queue first. */
  claim(worker: string, leaseMs: number): Promise<LeasedTask | null>;
  /** Extends a lease; false means the lease is gone and the worker must stop. */
  heartbeat(token: LeaseToken, leaseMs: number): Promise<boolean>;
  /** Acknowledges a finished task. A late finisher is accepted while the task is not done, because output is idempotent. */
  complete(token: LeaseToken, result: TaskResult): Promise<CompleteOutcome>;
  /** Records a failed attempt: retry with backoff, or dead-letter after the last attempt. */
  fail(token: LeaseToken, error: string): Promise<FailOutcome>;
  /** Gives a task back without spending its attempt (the worker is out of disk or is shutting down). */
  release(token: LeaseToken, reason: string, delayMs?: number): Promise<boolean>;
  /** Appends a structured log line to a task. */
  log(taskId: Digest, entry: LogInput): Promise<void>;
  /** Reads a task, or null. */
  get(taskId: Digest): Promise<TaskRecord | null>;
  /** Reads the log of a task in order. */
  getLog(taskId: Digest): Promise<LogEntry[]>;
  /** Lists dead letters, newest first. */
  deadLetters(): Promise<DeadLetter[]>;
  /** Puts a dead-lettered task back in the queue with its attempts reset (an explicit human action). */
  requeueDead(taskId: Digest): Promise<boolean>;
  /** Sets the number of tasks one owner may have leased at once. */
  setOwnerCap(owner: string, cap: number): Promise<void>;
  /** Returns tasks whose lease expired to the queue (or the dead letters); returns how many were reclaimed. */
  reclaimExpired(): Promise<number>;
  /** Releases parked work that the backlog now has room for; returns how many were released. */
  releaseParked(): Promise<number>;
  /** Counts and distributions for dashboards and the load test. */
  metrics(): Promise<QueueMetrics>;
  /** Digests the garbage collector must keep. */
  liveDigests(policy: ReferencePolicy): Promise<Set<Digest>>;
  /** Registers a worker process. */
  registerWorker(id: string, info: { pid: number; host: string }): Promise<void>;
  /** Marks a worker alive. */
  workerHeartbeat(id: string): Promise<void>;
  /** Marks a worker stopped. */
  stopWorker(id: string): Promise<void>;
  /** Workers heard from within `staleMs`. */
  liveWorkers(staleMs: number): Promise<WorkerInfo[]>;
  /** Every lease that has not expired. */
  liveLeases(): Promise<LiveLease[]>;
  /** Lists all tasks (for the CLI and tests). */
  listTasks(filter?: { state?: TaskState }): Promise<TaskRecord[]>;
  /** Closes the connection. */
  close(): void;
}
