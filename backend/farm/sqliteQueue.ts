/**
 * File Description: The durable task queue on one SQLite file (WAL mode, `BEGIN IMMEDIATE` for every write), the one-machine implementation of TaskQueue. It holds state and queue in one transaction: leases with expiry, priorities (studio export, draft, review, batch final), fair share and a concurrency cap per owner, parking of batch work when the backlog is too old, three attempts with exponential backoff, dead-letter rows that carry the task log, and the counters behind the metrics.
 * Inputs and outputs: a database path and queue options -> a TaskQueue.
 * Used by: backend/farm/worker.ts, backend/farm/loadTest.ts, backend/farm/submit.ts, scripts/farm.ts and the farm tests.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  backoffMs,
  QUEUE_DEFAULTS,
  type CompleteOutcome,
  type DeadLetter,
  type FailOutcome,
  type LeaseToken,
  type LeasedTask,
  type LiveLease,
  type LogEntry,
  type LogInput,
  type QueueMetrics,
  type QueueOptions,
  type ReferencePolicy,
  type SubmitInput,
  type SubmitResult,
  type TaskQueue,
  type TaskRecord,
  type TaskResult,
  type TaskState,
  type WorkerInfo,
} from "./queue";
import { summarize } from "./stats";
import { inputDigests, parseTaskPayload, parseTaskSpec, priorityRank, PRIORITY_CLASSES, taskIdOf, type Digest, type PriorityClass } from "./taskSpec";

/** The schema version this build reads and writes; a newer database is refused. */
const SCHEMA_VERSION = 1;

type Row = Record<string, string | number | null>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  spec_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  film_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  class TEXT NOT NULL,
  rank INTEGER NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  available_at INTEGER NOT NULL,
  lease_owner TEXT,
  lease_attempt INTEGER,
  lease_expires_at INTEGER,
  submitted_at INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,
  first_started_at INTEGER,
  finished_at INTEGER,
  submissions INTEGER NOT NULL DEFAULT 1,
  result_json TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS tasks_ready ON tasks(state, rank, available_at);
CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(owner, state);
CREATE TABLE IF NOT EXISTS task_logs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  worker TEXT,
  attempt INTEGER,
  event TEXT NOT NULL,
  data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_logs_task ON task_logs(task_id, seq);
CREATE TABLE IF NOT EXISTS dead_letters (
  task_id TEXT PRIMARY KEY,
  dead_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  log_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS owner_limits (owner TEXT PRIMARY KEY, cap INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  host TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  stopped_at INTEGER
);
`;

/** A number column, or 0. */
function num(value: string | number | null | undefined): number {
  return typeof value === "number" ? value : 0;
}

/** Opens (and if needed creates) the queue database at `file` and returns the queue. */
export function createSqliteQueue(file: string, options: QueueOptions = {}): TaskQueue {
  const now = options.now ?? Date.now;
  const config = {
    maxAttempts: options.maxAttempts ?? QUEUE_DEFAULTS.maxAttempts,
    backoffBaseMs: options.backoffBaseMs ?? QUEUE_DEFAULTS.backoffBaseMs,
    backoffCapMs: options.backoffCapMs ?? QUEUE_DEFAULTS.backoffCapMs,
    maxBacklogAgeMs: options.maxBacklogAgeMs ?? QUEUE_DEFAULTS.maxBacklogAgeMs,
    resumeBelowDepth: options.resumeBelowDepth ?? QUEUE_DEFAULTS.resumeBelowDepth,
    defaultOwnerCap: options.defaultOwnerCap ?? QUEUE_DEFAULTS.defaultOwnerCap,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 20000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  const version = num((db.prepare("PRAGMA user_version").get() as Row).user_version);
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(`The queue database ${file} has schema version ${version}; this build supports ${SCHEMA_VERSION}. Update the worker.`);
  }
  db.exec(SCHEMA);
  if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  /** Runs `fn` inside an immediate write transaction and commits, or rolls back on a throw. */
  const tx = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // The transaction already ended; the original error matters more.
      }
      throw error;
    }
  };

  /** Adds `by` to a named counter. */
  const bump = (name: string, by = 1): void => {
    db.prepare("INSERT INTO counters(name, value) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET value = value + excluded.value").run(name, by);
  };

  /** Reads a named counter. */
  const counter = (name: string): number => num((db.prepare("SELECT value FROM counters WHERE name = ?").get(name) as Row | undefined)?.value);

  /** Appends a log line to a task. */
  const writeLog = (taskId: Digest, entry: LogInput, at = now()): void => {
    db.prepare("INSERT INTO task_logs(task_id, at, worker, attempt, event, data_json) VALUES(?, ?, ?, ?, ?, ?)").run(
      taskId,
      at,
      entry.worker ?? null,
      entry.attempt ?? null,
      entry.event,
      JSON.stringify(entry.data ?? {}),
    );
  };

  /** Turns a database row into a task record. */
  const toRecord = (row: Row): TaskRecord => ({
    id: String(row.id),
    spec: parseTaskSpec(JSON.parse(String(row.spec_json))),
    payload: parseTaskPayload(JSON.parse(String(row.payload_json))),
    owner: String(row.owner),
    priorityClass: String(row.class) as PriorityClass,
    state: String(row.state) as TaskState,
    attempts: num(row.attempts),
    maxAttempts: num(row.max_attempts),
    availableAt: num(row.available_at),
    lease: row.lease_owner === null ? null : { worker: String(row.lease_owner), attempt: num(row.lease_attempt), expiresAt: num(row.lease_expires_at) },
    submittedAt: num(row.submitted_at),
    queuedAt: num(row.queued_at),
    firstStartedAt: row.first_started_at === null ? null : num(row.first_started_at),
    finishedAt: row.finished_at === null ? null : num(row.finished_at),
    submissions: num(row.submissions),
    result: row.result_json === null ? null : (JSON.parse(String(row.result_json)) as TaskResult),
    error: row.error === null ? null : String(row.error),
  });

  /** Reads one task row. */
  const row = (id: Digest): Row | undefined => db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row | undefined;

  /** Reads the log of a task. */
  const readLog = (taskId: Digest): LogEntry[] =>
    (db.prepare("SELECT * FROM task_logs WHERE task_id = ? ORDER BY seq").all(taskId) as Row[]).map((r) => ({
      seq: num(r.seq),
      at: num(r.at),
      worker: r.worker === null ? null : String(r.worker),
      attempt: r.attempt === null ? null : num(r.attempt),
      event: String(r.event),
      data: JSON.parse(String(r.data_json)) as Record<string, unknown>,
    }));

  /** Moves a task to the dead state and writes its dead-letter row with the whole log. */
  const kill = (id: Digest, reason: string, attempts: number, at: number): void => {
    writeLog(id, { event: "dead_lettered", data: { reason, attempts } }, at);
    db.prepare("UPDATE tasks SET state = 'dead', error = ?, finished_at = ?, lease_owner = NULL, lease_attempt = NULL, lease_expires_at = NULL WHERE id = ?").run(reason, at, id);
    db.prepare("INSERT OR REPLACE INTO dead_letters(task_id, dead_at, reason, attempts, log_json) VALUES(?, ?, ?, ?, ?)").run(id, at, reason, attempts, JSON.stringify(readLog(id)));
    bump("dead_letters");
  };

  /** Age in ms of the oldest ready task (0 when none), and how many are ready. */
  const backlog = (at: number): { ageMs: number; ready: number } => {
    const r = db.prepare("SELECT COUNT(*) AS n, MIN(queued_at) AS oldest FROM tasks WHERE state = 'queued' AND available_at <= ?").get(at) as Row;
    return { ageMs: r.oldest === null ? 0 : Math.max(0, at - num(r.oldest)), ready: num(r.n) };
  };

  /** Returns the leases that expired to the queue, or kills a task that used its last attempt. */
  const reclaimExpiredTx = (at: number): number => {
    const expired = db.prepare("SELECT id, attempts, max_attempts, lease_owner, lease_attempt FROM tasks WHERE state = 'leased' AND lease_expires_at <= ?").all(at) as Row[];
    for (const r of expired) {
      const id = String(r.id);
      const attempts = num(r.attempts);
      writeLog(id, { worker: String(r.lease_owner), attempt: num(r.lease_attempt), event: "lease_expired" }, at);
      bump("lease_expiries");
      if (attempts >= num(r.max_attempts)) {
        kill(id, `lease expired on attempt ${attempts} of ${num(r.max_attempts)} (worker ${String(r.lease_owner)} stopped answering)`, attempts, at);
      } else {
        db.prepare("UPDATE tasks SET state = 'queued', available_at = ?, lease_owner = NULL, lease_attempt = NULL, lease_expires_at = NULL WHERE id = ?").run(
          at + backoffMs(attempts, config.backoffBaseMs, config.backoffCapMs),
          id,
        );
        bump("retries");
      }
    }
    return expired.length;
  };

  /** Releases parked batch work while the backlog has room: few ready tasks and a young oldest one. */
  const releaseParkedTx = (at: number): number => {
    const { ageMs, ready } = backlog(at);
    if (ready >= config.resumeBelowDepth || ageMs > config.maxBacklogAgeMs) return 0;
    const room = config.resumeBelowDepth - ready;
    const parked = db.prepare("SELECT id FROM tasks WHERE state = 'parked' ORDER BY rank, submitted_at, rowid LIMIT ?").all(room) as Row[];
    for (const r of parked) {
      db.prepare("UPDATE tasks SET state = 'queued', queued_at = ?, available_at = ? WHERE id = ?").run(at, at, String(r.id));
      writeLog(String(r.id), { event: "released_from_park" }, at);
    }
    return parked.length;
  };

  /** True when the token still names the lease on the row. */
  const holds = (r: Row | undefined, token: LeaseToken): r is Row =>
    r !== undefined && r.state === "leased" && r.lease_owner === token.worker && r.lease_attempt === token.attempt;

  const batchRank = priorityRank("batch_final");

  const queue: TaskQueue = {
    async submit(input: SubmitInput): Promise<SubmitResult> {
      const spec = parseTaskSpec(input.spec);
      const payload = parseTaskPayload(input.payload);
      const rank = priorityRank(input.priorityClass);
      if (typeof input.owner !== "string" || input.owner.trim() === "") throw new Error("a task needs an owner");
      const id = taskIdOf(spec);
      return tx((): SubmitResult => {
        const at = now();
        bump("submissions");
        const existing = row(id);
        if (existing) {
          db.prepare("UPDATE tasks SET submissions = submissions + 1 WHERE id = ?").run(id);
          const state = String(existing.state) as TaskState;
          if (state === "done") {
            const result = JSON.parse(String(existing.result_json)) as TaskResult;
            if (input.isResultValid && !input.isResultValid(result)) {
              db.prepare("UPDATE tasks SET state = 'queued', attempts = 0, result_json = NULL, error = NULL, finished_at = NULL, queued_at = ?, available_at = ?, class = ?, rank = ? WHERE id = ?").run(
                at,
                at,
                input.priorityClass,
                rank,
                id,
              );
              writeLog(id, { event: "cache_invalidated", data: { outputDigest: result.outputDigest } }, at);
              bump("cache_invalidated");
              return { id, outcome: "enqueued", state: "queued" };
            }
            bump("cache_hits");
            return { id, outcome: "cache_hit", state: "done" };
          }
          if (state === "dead") return { id, outcome: "dead_letter", state: "dead" };
          bump("coalesced");
          if (rank < num(existing.rank)) {
            db.prepare("UPDATE tasks SET class = ?, rank = ? WHERE id = ?").run(input.priorityClass, rank, id);
            writeLog(id, { event: "priority_raised", data: { to: input.priorityClass } }, at);
            if (state === "parked" && rank < batchRank) {
              db.prepare("UPDATE tasks SET state = 'queued', queued_at = ?, available_at = ? WHERE id = ?").run(at, at, id);
              return { id, outcome: "coalesced", state: "queued" };
            }
          }
          return { id, outcome: "coalesced", state };
        }
        const { ageMs } = backlog(at);
        const parkedNow = num((db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE state = 'parked'").get() as Row).n);
        const park = rank === batchRank && (parkedNow > 0 || ageMs > config.maxBacklogAgeMs);
        db.prepare(
          `INSERT INTO tasks(id, spec_json, payload_json, film_id, owner, class, rank, state, attempts, max_attempts, available_at, submitted_at, queued_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        ).run(id, JSON.stringify(spec), JSON.stringify(payload), payload.filmId, input.owner, input.priorityClass, rank, park ? "parked" : "queued", input.maxAttempts ?? config.maxAttempts, at, at, at);
        writeLog(id, { event: "submitted", data: { owner: input.owner, class: input.priorityClass, format: spec.format, filmId: payload.filmId } }, at);
        if (park) {
          bump("parked_total");
          writeLog(id, { event: "parked", data: { backlogAgeMs: ageMs, limitMs: config.maxBacklogAgeMs } }, at);
          releaseParkedTx(at);
        }
        const state = String(row(id)?.state) as TaskState;
        return { id, outcome: state === "parked" ? "parked" : "enqueued", state };
      });
    },

    async claim(worker: string, leaseMs: number): Promise<LeasedTask | null> {
      return tx((): LeasedTask | null => {
        const at = now();
        reclaimExpiredTx(at);
        releaseParkedTx(at);
        const pick = db
          .prepare(
            `WITH running AS (SELECT owner, COUNT(*) AS n FROM tasks WHERE state = 'leased' GROUP BY owner)
             SELECT t.id FROM tasks t
             LEFT JOIN running r ON r.owner = t.owner
             LEFT JOIN owner_limits o ON o.owner = t.owner
             WHERE t.state = 'queued' AND t.available_at <= :now AND COALESCE(r.n, 0) < COALESCE(o.cap, :cap)
             ORDER BY t.rank ASC, COALESCE(r.n, 0) ASC, t.queued_at ASC, t.rowid ASC
             LIMIT 1`,
          )
          .get({ now: at, cap: config.defaultOwnerCap }) as Row | undefined;
        if (!pick) return null;
        const id = String(pick.id);
        const current = row(id) as Row;
        const attempt = num(current.attempts) + 1;
        db.prepare("UPDATE tasks SET state = 'leased', attempts = ?, lease_owner = ?, lease_attempt = ?, lease_expires_at = ?, first_started_at = COALESCE(first_started_at, ?) WHERE id = ?").run(
          attempt,
          worker,
          attempt,
          at + leaseMs,
          at,
          id,
        );
        writeLog(id, { worker, attempt, event: "leased", data: { leaseMs, waitedMs: at - num(current.queued_at) } }, at);
        return { token: { taskId: id, worker, attempt }, task: toRecord(row(id) as Row) };
      });
    },

    async heartbeat(token: LeaseToken, leaseMs: number): Promise<boolean> {
      return tx(() => {
        if (!holds(row(token.taskId), token)) return false;
        db.prepare("UPDATE tasks SET lease_expires_at = ? WHERE id = ?").run(now() + leaseMs, token.taskId);
        return true;
      });
    },

    async complete(token: LeaseToken, result: TaskResult): Promise<CompleteOutcome> {
      return tx((): CompleteOutcome => {
        const at = now();
        const r = row(token.taskId);
        if (!r) return "lost";
        const state = String(r.state);
        if (state === "done") return "already_done";
        if (state === "dead") return "lost";
        const holder = holds(r, token);
        db.prepare("UPDATE tasks SET state = 'done', result_json = ?, error = NULL, finished_at = ?, lease_owner = NULL, lease_attempt = NULL, lease_expires_at = NULL WHERE id = ?").run(
          JSON.stringify(result),
          at,
          token.taskId,
        );
        if (!holder) {
          bump("late_completions");
          writeLog(token.taskId, { worker: token.worker, attempt: token.attempt, event: "late_completion", data: { stateWas: state } }, at);
        }
        writeLog(token.taskId, { worker: token.worker, attempt: token.attempt, event: "completed", data: { outputDigest: result.outputDigest, workerSeconds: result.workerSeconds, costUsd: result.costUsd } }, at);
        return "done";
      });
    },

    async fail(token: LeaseToken, error: string): Promise<FailOutcome> {
      return tx((): FailOutcome => {
        const at = now();
        const r = row(token.taskId);
        if (!holds(r, token)) return { state: "lost" };
        const attempts = num(r.attempts);
        writeLog(token.taskId, { worker: token.worker, attempt: token.attempt, event: "attempt_failed", data: { error } }, at);
        if (attempts >= num(r.max_attempts)) {
          kill(token.taskId, error, attempts, at);
          return { state: "dead", reason: error };
        }
        const retryAt = at + backoffMs(attempts, config.backoffBaseMs, config.backoffCapMs);
        db.prepare("UPDATE tasks SET state = 'queued', available_at = ?, error = ?, lease_owner = NULL, lease_attempt = NULL, lease_expires_at = NULL WHERE id = ?").run(retryAt, error, token.taskId);
        bump("retries");
        return { state: "queued", retryAt };
      });
    },

    async release(token: LeaseToken, reason: string, delayMs = 0): Promise<boolean> {
      return tx(() => {
        const at = now();
        if (!holds(row(token.taskId), token)) return false;
        db.prepare("UPDATE tasks SET state = 'queued', attempts = MAX(0, attempts - 1), available_at = ?, lease_owner = NULL, lease_attempt = NULL, lease_expires_at = NULL WHERE id = ?").run(at + delayMs, token.taskId);
        writeLog(token.taskId, { worker: token.worker, attempt: token.attempt, event: "released", data: { reason } }, at);
        if (reason.startsWith("disk")) bump("released_for_disk");
        return true;
      });
    },

    async log(taskId: Digest, entry: LogInput): Promise<void> {
      tx(() => writeLog(taskId, entry));
    },

    async get(taskId: Digest): Promise<TaskRecord | null> {
      const r = row(taskId);
      return r ? toRecord(r) : null;
    },

    async getLog(taskId: Digest): Promise<LogEntry[]> {
      return readLog(taskId);
    },

    async deadLetters(): Promise<DeadLetter[]> {
      return (db.prepare("SELECT * FROM dead_letters ORDER BY dead_at DESC, task_id").all() as Row[]).map((r) => ({
        taskId: String(r.task_id),
        deadAt: num(r.dead_at),
        reason: String(r.reason),
        attempts: num(r.attempts),
        log: JSON.parse(String(r.log_json)) as LogEntry[],
      }));
    },

    async requeueDead(taskId: Digest): Promise<boolean> {
      return tx(() => {
        const at = now();
        const r = row(taskId);
        if (!r || r.state !== "dead") return false;
        db.prepare("UPDATE tasks SET state = 'queued', attempts = 0, error = NULL, finished_at = NULL, queued_at = ?, available_at = ? WHERE id = ?").run(at, at, taskId);
        db.prepare("DELETE FROM dead_letters WHERE task_id = ?").run(taskId);
        writeLog(taskId, { event: "requeued_from_dead" }, at);
        return true;
      });
    },

    async setOwnerCap(owner: string, cap: number): Promise<void> {
      if (!Number.isInteger(cap) || cap < 1) throw new Error("an owner cap must be a whole number of at least 1");
      tx(() => void db.prepare("INSERT INTO owner_limits(owner, cap) VALUES(?, ?) ON CONFLICT(owner) DO UPDATE SET cap = excluded.cap").run(owner, cap));
    },

    async releaseParked(): Promise<number> {
      return tx(() => releaseParkedTx(now()));
    },

    async reclaimExpired(): Promise<number> {
      return tx(() => reclaimExpiredTx(now()));
    },

    async metrics(): Promise<QueueMetrics> {
      const at = now();
      const depth: Record<TaskState, number> = { parked: 0, queued: 0, leased: 0, done: 0, dead: 0 };
      for (const r of db.prepare("SELECT state, COUNT(*) AS n FROM tasks GROUP BY state").all() as Row[]) depth[String(r.state) as TaskState] = num(r.n);
      const readyByClass = Object.fromEntries(PRIORITY_CLASSES.map((c) => [c, 0])) as Record<PriorityClass, number>;
      for (const r of db.prepare("SELECT class, COUNT(*) AS n FROM tasks WHERE state = 'queued' AND available_at <= ? GROUP BY class").all(at) as Row[]) {
        readyByClass[String(r.class) as PriorityClass] = num(r.n);
      }
      const waits: number[] = [];
      const renders: number[] = [];
      const disks: number[] = [];
      const mems: number[] = [];
      const stages = new Map<string, number[]>();
      let cost = 0;
      for (const r of db.prepare("SELECT first_started_at, submitted_at, result_json FROM tasks WHERE state = 'done' AND result_json IS NOT NULL").all() as Row[]) {
        const result = JSON.parse(String(r.result_json)) as TaskResult;
        if (r.first_started_at !== null) waits.push(num(r.first_started_at) - num(r.submitted_at));
        renders.push(result.workerSeconds);
        disks.push(result.peakDiskBytes);
        mems.push(result.peakMemoryBytes);
        cost += result.costUsd;
        for (const [stage, seconds] of Object.entries(result.stageSeconds)) stages.set(stage, [...(stages.get(stage) ?? []), seconds]);
      }
      const submissions = counter("submissions");
      const cacheHits = counter("cache_hits");
      return {
        at,
        depth,
        readyByClass,
        oldestReadyAgeMs: backlog(at).ageMs,
        submissions,
        cacheHits,
        cacheHitRate: submissions === 0 ? 0 : cacheHits / submissions,
        coalesced: counter("coalesced"),
        retries: counter("retries"),
        deadLetters: counter("dead_letters"),
        lateCompletions: counter("late_completions"),
        releasedForDisk: counter("released_for_disk"),
        parkedTotal: counter("parked_total"),
        queueWaitMs: summarize(waits),
        renderSeconds: summarize(renders),
        stageSeconds: Object.fromEntries([...stages].map(([stage, values]) => [stage, summarize(values)])),
        peakDiskBytes: summarize(disks),
        peakMemoryBytes: summarize(mems),
        totalCostUsd: cost,
      };
    },

    async liveDigests(policy: ReferencePolicy): Promise<Set<Digest>> {
      const at = now();
      const live = new Set<Digest>();
      const rows = db.prepare("SELECT * FROM tasks").all() as Row[];
      const latest = new Map<string, Row>();
      for (const r of rows) {
        if (String(r.state) !== "done" || r.result_json === null) continue;
        const spec = parseTaskSpec(JSON.parse(String(r.spec_json)));
        const key = JSON.stringify([String(r.film_id), spec.format, spec.profile, spec.frameRange ?? null]);
        const best = latest.get(key);
        if (!best || num(r.finished_at) >= num(best.finished_at)) latest.set(key, r);
      }
      const newest = new Set([...latest.values()].map((r) => String(r.id)));
      for (const r of rows) {
        const state = String(r.state);
        if (state === "dead") continue;
        if (state !== "done") {
          for (const d of inputDigests(parseTaskSpec(JSON.parse(String(r.spec_json))), parseTaskPayload(JSON.parse(String(r.payload_json))))) live.add(d);
          continue;
        }
        const keep = newest.has(String(r.id)) && (policy.liveFilms?.has(String(r.film_id)) || num(r.finished_at) >= at - policy.resultTtlMs);
        if (!keep || r.result_json === null) continue;
        const result = JSON.parse(String(r.result_json)) as TaskResult;
        live.add(result.outputDigest);
        if (result.sidecarDigest) live.add(result.sidecarDigest);
      }
      return live;
    },

    async registerWorker(id: string, info: { pid: number; host: string }): Promise<void> {
      const at = now();
      tx(() => void db.prepare("INSERT INTO workers(id, pid, host, started_at, heartbeat_at, stopped_at) VALUES(?, ?, ?, ?, ?, NULL) ON CONFLICT(id) DO UPDATE SET pid = excluded.pid, host = excluded.host, heartbeat_at = excluded.heartbeat_at, stopped_at = NULL").run(id, info.pid, info.host, at, at));
    },

    async workerHeartbeat(id: string): Promise<void> {
      tx(() => void db.prepare("UPDATE workers SET heartbeat_at = ? WHERE id = ?").run(now(), id));
    },

    async stopWorker(id: string): Promise<void> {
      tx(() => void db.prepare("UPDATE workers SET stopped_at = ? WHERE id = ?").run(now(), id));
    },

    async liveWorkers(staleMs: number): Promise<WorkerInfo[]> {
      return (db.prepare("SELECT * FROM workers WHERE stopped_at IS NULL AND heartbeat_at >= ? ORDER BY id").all(now() - staleMs) as Row[]).map((r) => ({
        id: String(r.id),
        pid: num(r.pid),
        host: String(r.host),
        startedAt: num(r.started_at),
        heartbeatAt: num(r.heartbeat_at),
        stoppedAt: null,
      }));
    },

    async liveLeases(): Promise<LiveLease[]> {
      return (db.prepare("SELECT id, lease_owner, lease_attempt, lease_expires_at FROM tasks WHERE state = 'leased' AND lease_expires_at > ?").all(now()) as Row[]).map((r) => ({
        taskId: String(r.id),
        worker: String(r.lease_owner),
        attempt: num(r.lease_attempt),
        expiresAt: num(r.lease_expires_at),
      }));
    },

    async listTasks(filter: { state?: TaskState } = {}): Promise<TaskRecord[]> {
      const rows = (filter.state ? db.prepare("SELECT * FROM tasks WHERE state = ? ORDER BY submitted_at, rowid").all(filter.state) : db.prepare("SELECT * FROM tasks ORDER BY submitted_at, rowid").all()) as Row[];
      return rows.map(toRecord);
    },

    close(): void {
      db.close();
    },
  };
  return queue;
}
