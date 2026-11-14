/**
 * File Description: The stateless farm worker. One render at a time: lease a task, fetch its inputs into the bounded local cache, render in a private attempt directory with the injected executor, promote the output into the content store, acknowledge, and always remove the attempt directory. It stops leasing (instead of failing jobs) when the disk is below the reserve or memory is short, keeps the lease alive with heartbeats, enforces the per-task disk and memory budgets, records peaks, per-stage seconds and cost in the task result, and writes one structured log per task into the queue.
 * Inputs and outputs: a queue, a store, a cache, a work root and an executor -> finished task results in the store and the queue, and nothing left in the work root.
 * Used by: scripts/farm.ts (the worker command), backend/farm/loadTest.ts and the farm tests.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RENDER_RESERVE_BYTES } from "../renderProcess";
import { directoryBytes, type ContentStore, type LocalCache } from "./contentStore";
import { attemptDirName, createJanitor } from "./janitor";
import type { CompleteOutcome, FailOutcome, LeasedTask, TaskQueue, TaskRecord, TaskResult } from "./queue";
import { freeDiskBytes, freeMemoryBytes, processTreeRssBytes, type StatFs } from "./resources";
import { inputDigests, type Digest } from "./taskSpec";

const GIB = 1024 ** 3;

/** The memory and disk one task may use (the plan's measurements: 2 GB and 1 GB). */
export const DEFAULT_TASK_BUDGET = Object.freeze({ memoryBytes: 2 * GIB, diskBytes: 1 * GIB });

/** What the machine costs per hour; the plan's 16 vCPU on-demand price. */
export const DEFAULT_PRICE_PER_HOUR_USD = 0.714;

/** What an executor sees. */
export interface ExecutionContext {
  task: TaskRecord;
  attempt: number;
  /** The private directory of this attempt; everything the task writes goes here. */
  attemptDir: string;
  /** Local path of each input object (inside the attempt directory). */
  inputs: ReadonlyMap<Digest, string>;
  /** Aborts when the lease is lost, a budget is exceeded or the worker is stopped. */
  signal: AbortSignal;
  /** Marks the start of a phase for the seconds-per-state metric. */
  stage(name: string): void;
  /** Appends a structured line to the task log. */
  log(event: string, data?: Record<string, unknown>): void;
  /** Receives the renderer's progress output. */
  onOutput(text: string): void;
}

/** What an executor returns: the finished file, and the sidecar that describes it. */
export interface ExecutionResult {
  outputPath: string;
  sidecarPath?: string;
}

export type Executor = (context: ExecutionContext) => Promise<ExecutionResult>;

/** Raised into the executor when the queue no longer honours the lease. */
export class LeaseLostError extends Error {
  /** Names the task whose lease was lost. */
  constructor(taskId: Digest) {
    super(`LEASE_LOST: the lease on task ${taskId.slice(0, 12)} is gone`);
    this.name = "LeaseLostError";
  }
}

/** Raised into the executor when the task passes its disk or memory budget. */
export class BudgetExceededError extends Error {
  readonly kind: "disk" | "memory";
  /** Says which budget and by how much. */
  constructor(kind: "disk" | "memory", used: number, budget: number) {
    super(`TASK_${kind.toUpperCase()}_BUDGET: the task used ${(used / 1024 ** 2).toFixed(0)} MiB of ${kind} and its budget is ${(budget / 1024 ** 2).toFixed(0)} MiB`);
    this.name = "BudgetExceededError";
    this.kind = kind;
  }
}

/** Raised into the executor when the worker is told to stop now. */
export class WorkerStoppedError extends Error {
  /** Marks a deliberate stop. */
  constructor() {
    super("WORKER_STOPPED: the worker is shutting down");
    this.name = "WorkerStoppedError";
  }
}

export interface WorkerOptions {
  id: string;
  queue: TaskQueue;
  /** The shared store inputs come from and outputs go to. */
  store: ContentStore;
  /** The bounded local cache (shared by the workers of one machine). */
  cache: LocalCache;
  /** Parent of every worker's private directory: the one temp root. */
  workRoot: string;
  executor: Executor;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
  /** How often the disk and memory of a running task are sampled. */
  monitorMs?: number;
  budget?: { memoryBytes?: number; diskBytes?: number };
  /** Free bytes that must remain on the work disk; defaults to the render reserve. */
  diskReserveBytes?: number;
  pricePerHourUsd?: number;
  /** How long to stop leasing after a task hit the disk reserve. */
  diskPauseMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  statfs?: StatFs;
  freeMemory?: () => number;
  sampleMemory?: () => number;
  /** How often the loop runs the janitor (default 30 seconds). */
  sweepMs?: number;
  /** Receives one line per notable worker event (not per task; those go to the queue). */
  onEvent?: (line: string) => void;
}

/** What one pass of the worker did. */
export type WorkerStep =
  | { kind: "idle" }
  | { kind: "paused"; reason: string }
  | { kind: "stopped" }
  | { kind: "done"; taskId: Digest; outcome: CompleteOutcome }
  | { kind: "failed"; taskId: Digest; outcome: FailOutcome; error: string }
  | { kind: "released"; taskId: Digest; reason: string }
  | { kind: "lost"; taskId: Digest };

/** Waits for `ms` milliseconds. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Creates a worker. `runOnce` does one pass; `run` loops until `stop`. */
export function createWorker(options: WorkerOptions) {
  const { id, queue, store, cache, workRoot, executor } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const leaseMs = options.leaseMs ?? 60_000;
  const heartbeatMs = options.heartbeatMs ?? Math.max(50, Math.floor(leaseMs / 3));
  const pollMs = options.pollMs ?? 500;
  const monitorMs = options.monitorMs ?? 500;
  const budget = { memoryBytes: options.budget?.memoryBytes ?? DEFAULT_TASK_BUDGET.memoryBytes, diskBytes: options.budget?.diskBytes ?? DEFAULT_TASK_BUDGET.diskBytes };
  const reserve = options.diskReserveBytes ?? RENDER_RESERVE_BYTES;
  const price = options.pricePerHourUsd ?? DEFAULT_PRICE_PER_HOUR_USD;
  const diskPauseMs = options.diskPauseMs ?? 10_000;
  const freeMemory = options.freeMemory ?? freeMemoryBytes;
  const sampleMemory = options.sampleMemory ?? (() => processTreeRssBytes());
  const workerDir = path.join(workRoot, id);
  const janitor = createJanitor({ workRoot, queue, stores: [store, cache.store], workerStaleMs: Math.max(leaseMs * 3, 30_000) });

  let pausedUntil = 0;
  let stopping = false;
  let running: AbortController | undefined;
  let currentDir: string | undefined;
  let tasksRun = 0;

  /** Reports a notable worker event. */
  const event = (line: string): void => options.onEvent?.(`[worker ${id}] ${line}`);

  /** Why the worker must not lease now, or null when it may. */
  const gate = (): string | null => {
    if (now() < pausedUntil) return `recovering after a disk shortage until ${new Date(pausedUntil).toISOString()}`;
    const free = freeDiskBytes(workRoot, options.statfs);
    if (free < reserve + budget.diskBytes) return `disk_low: ${(free / GIB).toFixed(2)} GiB free, the reserve plus one task needs ${((reserve + budget.diskBytes) / GIB).toFixed(2)} GiB`;
    const memory = freeMemory();
    if (memory < budget.memoryBytes) return `memory_low: ${(memory / GIB).toFixed(2)} GiB free, one task needs ${(budget.memoryBytes / GIB).toFixed(2)} GiB`;
    return null;
  };

  /** Copies the task's inputs into the cache and links them into the attempt directory. */
  const fetchInputs = async (task: TaskRecord, attemptDir: string, signal: AbortSignal): Promise<{ inputs: Map<Digest, string>; hits: number; misses: number; bytes: number }> => {
    const inputs = new Map<Digest, string>();
    let hits = 0;
    let misses = 0;
    let bytes = 0;
    for (const digest of inputDigests(task.spec, task.payload)) {
      signal.throwIfAborted();
      const dest = path.join(attemptDir, "inputs", digest);
      for (let tries = 0; ; tries++) {
        const fetched = await cache.ensure(store, digest);
        try {
          cache.store.materialize(digest, dest);
          if (fetched.hit) hits++;
          else misses++;
          bytes += cache.store.sizeOf(digest) ?? 0;
          break;
        } catch (error) {
          // Another worker's eviction removed it between the fetch and the link; fetch once more.
          if (tries >= 1) throw error;
        }
      }
      inputs.set(digest, dest);
    }
    return { inputs, hits, misses, bytes };
  };

  /** Runs one leased task to its end, and removes its attempt directory whatever happens. */
  const runTask = async (leased: LeasedTask): Promise<WorkerStep> => {
    const { token, task } = leased;
    const attemptDir = path.join(workerDir, attemptDirName(task.id, token.attempt));
    currentDir = attemptDir;
    const started = now();
    const stageSeconds: Record<string, number> = {};
    let stageName: string | null = "fetching";
    let stageStart = started;
    const controller = new AbortController();
    running = controller;
    let peakDisk = 0;
    let peakMemory = 0;
    let lineChain: Promise<void> = Promise.resolve();

    /** Closes the current phase and opens the next; "done" closes without opening. */
    const stage = (name: string): void => {
      const t = now();
      if (stageName) stageSeconds[stageName] = (stageSeconds[stageName] ?? 0) + (t - stageStart) / 1000;
      stageName = name === "done" ? null : name;
      stageStart = t;
      log("stage", { name });
    };
    /** Appends to the task log; lines keep their order. */
    const log = (eventName: string, data: Record<string, unknown> = {}): void => {
      lineChain = lineChain.then(() => queue.log(task.id, { worker: id, attempt: token.attempt, event: eventName, data })).catch(() => {});
    };
    /** Samples the attempt directory and memory; aborts the task over budget. */
    const sample = (): void => {
      const disk = directoryBytes(attemptDir);
      const memory = sampleMemory();
      peakDisk = Math.max(peakDisk, disk);
      peakMemory = Math.max(peakMemory, memory);
      if (controller.signal.aborted) return;
      if (disk > budget.diskBytes) controller.abort(new BudgetExceededError("disk", disk, budget.diskBytes));
      else if (memory > budget.memoryBytes) controller.abort(new BudgetExceededError("memory", memory, budget.memoryBytes));
    };
    let beating = false;
    const heartbeat = setInterval(() => {
      if (beating) return;
      beating = true;
      queue
        .heartbeat(token, leaseMs)
        .then((ok) => {
          if (!ok && !controller.signal.aborted) controller.abort(new LeaseLostError(task.id));
          return queue.workerHeartbeat(id);
        })
        .catch(() => {})
        .finally(() => {
          beating = false;
        });
    }, heartbeatMs);
    const monitor = setInterval(sample, monitorMs);

    try {
      fs.mkdirSync(attemptDir, { recursive: true });
      log("attempt_started", { attemptDir, maxAttempts: task.maxAttempts, class: task.priorityClass });
      const fetched = await fetchInputs(task, attemptDir, controller.signal);
      log("inputs_fetched", { objects: fetched.inputs.size, cacheHits: fetched.hits, cacheMisses: fetched.misses, bytes: fetched.bytes });
      sample();
      controller.signal.throwIfAborted();
      stage("preparing");
      const execution = await executor({ task, attempt: token.attempt, attemptDir, inputs: fetched.inputs, signal: controller.signal, stage, log, onOutput: () => {} });
      sample();
      controller.signal.throwIfAborted();
      stage("promoting");
      const output = await store.putFile(execution.outputPath);
      let sidecarDigest: Digest | null = null;
      if (execution.sidecarPath && fs.existsSync(execution.sidecarPath)) {
        const elapsed = (now() - started) / 1000;
        const sidecar = JSON.parse(fs.readFileSync(execution.sidecarPath, "utf8")) as Record<string, unknown>;
        sidecar.farm = {
          taskId: task.id,
          workerId: id,
          attempt: token.attempt,
          rendererVersion: task.spec.rendererVersion,
          secondsBeforePromotion: elapsed,
          stageSeconds: { ...stageSeconds },
          costUsdBeforePromotion: (elapsed / 3600) * price,
          peakDiskBytes: peakDisk,
          peakMemoryBytes: peakMemory,
        };
        const annotated = `${execution.sidecarPath}.farm`;
        fs.writeFileSync(annotated, JSON.stringify(sidecar, null, 2) + "\n");
        sidecarDigest = (await store.putFile(annotated)).digest;
      }
      stage("done");
      sample();
      const workerSeconds = (now() - started) / 1000;
      const result: TaskResult = {
        outputDigest: output.digest,
        sidecarDigest,
        sizeBytes: output.size,
        workerId: id,
        attempt: token.attempt,
        stageSeconds,
        workerSeconds,
        peakDiskBytes: peakDisk,
        peakMemoryBytes: peakMemory,
        costUsd: (workerSeconds / 3600) * price,
      };
      controller.signal.throwIfAborted();
      log("output_promoted", { outputDigest: output.digest, sizeBytes: output.size, existed: output.existed });
      await lineChain;
      const outcome = await queue.complete(token, result);
      return { kind: "done", taskId: task.id, outcome };
    } catch (error) {
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      const message = (reason instanceof Error ? reason.message : String(reason)).slice(0, 4000);
      await lineChain;
      if (reason instanceof LeaseLostError) {
        log("lease_lost", {});
        return { kind: "lost", taskId: task.id };
      }
      if (reason instanceof WorkerStoppedError) {
        await queue.release(token, "shutdown");
        return { kind: "released", taskId: task.id, reason: "shutdown" };
      }
      if (message.includes("RENDER_DISK_LOW")) {
        pausedUntil = now() + diskPauseMs;
        await queue.release(token, `disk_low: ${message}`, diskPauseMs);
        event(`task ${task.id.slice(0, 12)} hit the disk reserve; leasing paused`);
        return { kind: "released", taskId: task.id, reason: "disk_low" };
      }
      const outcome = await queue.fail(token, message);
      return { kind: "failed", taskId: task.id, outcome, error: message };
    } finally {
      clearInterval(heartbeat);
      clearInterval(monitor);
      running = undefined;
      const bytes = directoryBytes(attemptDir);
      fs.rmSync(attemptDir, { recursive: true, force: true, maxRetries: 3 });
      currentDir = undefined;
      tasksRun++;
      cache.evict();
      await lineChain;
      await queue.log(task.id, { worker: id, attempt: token.attempt, event: "attempt_cleaned", data: { tempBytesRemoved: bytes, tempBytesLeft: directoryBytes(attemptDir), peakDiskBytes: peakDisk, peakMemoryBytes: peakMemory } }).catch(() => {});
    }
  };

  return {
    id,
    workerDir,
    janitor,

    /** Registers the worker and sweeps what killed workers left behind. */
    async start(): Promise<void> {
      fs.mkdirSync(workerDir, { recursive: true });
      await queue.registerWorker(id, { pid: process.pid, host: os.hostname() });
      const report = await janitor.sweep(new Set(), id);
      if (report.attemptDirsRemoved || report.workerDirsRemoved || report.strayEntriesRemoved || report.storeTmpRemoved) {
        event(`startup sweep removed ${report.attemptDirsRemoved} attempt dirs, ${report.workerDirsRemoved} dead worker dirs, ${report.strayEntriesRemoved} stray entries, ${report.storeTmpRemoved} unfinished puts (${report.bytesRemoved + report.storeTmpBytes} bytes)`);
      }
    },

    /** One pass: check the gates, lease, run. */
    async runOnce(): Promise<WorkerStep> {
      if (stopping) return { kind: "stopped" };
      await queue.workerHeartbeat(id);
      const blocked = gate();
      if (blocked) return { kind: "paused", reason: blocked };
      const leased = await queue.claim(id, leaseMs);
      if (!leased) return { kind: "idle" };
      return runTask(leased);
    },

    /** Loops until `stop` is called, sweeping on a timer; leaves no directory behind. */
    async run(): Promise<void> {
      await this.start();
      const sweepMs = options.sweepMs ?? 30_000;
      let lastSweep = now();
      while (!stopping) {
        const step = await this.runOnce();
        if (step.kind === "idle" || step.kind === "paused") await sleep(pollMs);
        if (now() - lastSweep > sweepMs) {
          lastSweep = now();
          await janitor.sweep(new Set(currentDir ? [currentDir] : []), id).catch(() => {});
        }
      }
      await this.shutdown();
    },

    /** Stops the loop; with `abortCurrent` the running task is given back, otherwise it finishes first. */
    stop(abortCurrent = false): void {
      stopping = true;
      if (abortCurrent && running && !running.signal.aborted) running.abort(new WorkerStoppedError());
    },

    /** Deregisters the worker and removes its directory. */
    async shutdown(): Promise<void> {
      stopping = true;
      fs.rmSync(workerDir, { recursive: true, force: true, maxRetries: 3 });
      await queue.stopWorker(id).catch(() => {});
    },

    /** How many tasks this worker has run, for tests and logs. */
    get tasksRun(): number {
      return tasksRun;
    },
  };
}

export type Worker = ReturnType<typeof createWorker>;
