/**
 * File Description: The farm load test (plan section 5.6) on one machine. It starts real worker processes (the `farm worker` command with the stub renderer behind the real RenderJob), submits N films in both formats and then every film a second time, SIGKILLs workers in the middle of a render in waves (each replaced by a fresh worker), waits until every task is done or dead-lettered, sweeps, and checks the pass bar: every task ends done or in the dead letter with a reason, zero temp bytes left, no task rendered more than its attempts, every output identical to the deterministic expectation, and p95 completion within 1.5 times the ideal. It reports films per hour, queue wait and render time percentiles, cache hit rate and peak disk and memory per worker.
 * Inputs and outputs: a farm root directory and the load shape -> a LoadTestReport and its text table.
 * Used by: scripts/farm.ts (load-test command) and backend/farm/loadTest.test.ts.
 */

import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createContentStore, directoryBytes } from "./contentStore";
import { createJanitor } from "./janitor";
import { farmPaths } from "./paths";
import { percentile } from "./stats";
import { createSqliteQueue } from "./sqliteQueue";
import { submitFilmTask } from "./submit";
import type { TaskRecord } from "./queue";
import type { PriorityClass } from "./taskSpec";
import { stubBytes, stubEmit, stubFilm } from "../testSupport/farmStub";
import { freeDiskBytes } from "./resources";

const REPO_ROOT = path.resolve(__dirname, "../..");

export interface LoadTestOptions {
  /** Farm root; the test creates its queue, store, cache, work root and logs here. */
  root: string;
  films: number;
  workers: number;
  formats?: Array<"long" | "reel">;
  /** Time the stand-in renderer takes per task. */
  renderMs?: number;
  outputBytes?: number;
  junkBytes?: number;
  /** How many waves of kills (each wave kills ceil(killFraction x workers) workers in the middle of a render). */
  killWaves?: number;
  killFraction?: number;
  /** Submit every film twice. */
  submitTwice?: boolean;
  leaseMs?: number;
  /** p95 completion must be within this many times the ideal makespan. */
  p95Factor?: number;
  timeoutMs?: number;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LoadTestReport {
  films: number;
  tasks: number;
  workers: number;
  killedWorkers: number;
  wallSeconds: number;
  filmsPerHour: number;
  queueWaitSeconds: { p50: number; p95: number };
  renderSeconds: { p50: number; p95: number };
  completionSeconds: { p50: number; p95: number };
  idealMakespanSeconds: number;
  p95OverIdeal: number;
  submissions: number;
  cacheHits: number;
  coalesced: number;
  /** (cache hits + coalesced) / submissions: the share of submissions that cost no render. */
  dedupRate: number;
  cacheHitRate: number;
  retries: number;
  rendersTotal: number;
  maxRendersOfOneTask: number;
  doneTasks: number;
  deadTasks: number;
  /** Bytes the killed workers left in their directories right after the kill. */
  killLeftBytes: number;
  tempBytesAfterStop: number;
  tempBytesAfterSweep: number;
  storeTmpBytesAfterSweep: number;
  sweepRemovedBytes: number;
  peakDiskBytesPerWorker: number;
  peakMemoryBytesPerWorker: number;
  costPerFilmUsd: number;
  freeDiskBytesStart: number;
  freeDiskBytesEnd: number;
  checks: Check[];
  pass: boolean;
}

/** Waits `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until `check` is true or the deadline passes; returns whether it became true. */
async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs: number, everyMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(everyMs);
  }
  return check();
}

/** Resolves when a child process has exited. */
function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
  });
}

/** Runs the load test and returns its report; never throws for a failed check, only for a broken harness. */
export async function runLoadTest(options: LoadTestOptions): Promise<LoadTestReport> {
  const formats = options.formats ?? ["long", "reel"];
  const renderMs = options.renderMs ?? 200;
  const outputBytes = options.outputBytes ?? 8192;
  /** Bytes the stand-in writes next to its output while rendering, so a kill leaves something to sweep. */
  const junkBytes = options.junkBytes ?? 256 * 1024;
  const leaseMs = options.leaseMs ?? 2_000;
  const killWaves = options.killWaves ?? 3;
  const killFraction = options.killFraction ?? 0.1;
  const submitTwice = options.submitTwice ?? true;
  const p95Factor = options.p95Factor ?? 1.5;
  const timeoutMs = options.timeoutMs ?? 240_000;
  const paths = farmPaths(options.root);
  for (const dir of [paths.root, paths.logsDir, paths.workRoot]) fs.mkdirSync(dir, { recursive: true });
  const ledger = path.join(paths.root, "renders.ledger");
  fs.writeFileSync(ledger, "");
  const queue = createSqliteQueue(paths.queueFile, { backoffBaseMs: 400, maxBacklogAgeMs: 24 * 3_600_000 });
  const store = createContentStore(paths.storeDir);
  const freeDiskBytesStart = freeDiskBytes(paths.root);

  const children = new Map<string, ChildProcess>();
  let spawned = 0;
  /** Starts one worker process; its output goes to its own log file. */
  const spawnWorker = (id: string): void => {
    const log = fs.openSync(path.join(paths.logsDir, `${id}.log`), "a");
    const child = spawn(
      process.execPath,
      [
        "--import", "tsx", "--disable-warning=ExperimentalWarning", path.join(REPO_ROOT, "scripts/farm.ts"), "worker",
        "--root", paths.root, "--id", id, "--executor", "stub", "--stub-ms", String(renderMs), "--stub-bytes", String(outputBytes), "--stub-junk-bytes", String(junkBytes),
        "--ledger", ledger, "--lease-ms", String(leaseMs), "--poll-ms", "25", "--sweep-ms", "1000", "--monitor-ms", "100",
      ],
      { cwd: REPO_ROOT, stdio: ["ignore", log, log] },
    );
    fs.closeSync(log);
    children.set(id, child);
    spawned++;
  };

  for (let i = 0; i < options.workers; i++) spawnWorker(`w${i}`);
  const ready = await waitUntil(async () => (await queue.liveWorkers(60_000)).length >= options.workers, 90_000, 100);
  if (!ready) throw new Error(`the ${options.workers} workers did not start; see ${paths.logsDir}`);

  const classes: PriorityClass[] = ["batch_final", "review", "batch_final", "draft"];
  const totalTasks = options.films * formats.length;
  const startedAt = Date.now();
  /** Submits every film in every format once. */
  const submitPass = async (): Promise<void> => {
    for (let i = 0; i < options.films; i++) {
      for (const format of formats) {
        await submitFilmTask(
          { queue, store },
          { film: stubFilm(i), emitted: stubEmit(i), format, profile: "draft", rendererVersion: "stub-1", owner: `owner-${i % 5}`, priorityClass: classes[i % classes.length] },
        );
      }
    }
  };
  await submitPass();
  let secondPass = !submitTwice;

  // Kill waves: when a share of the tasks is done, SIGKILL workers that are in the middle of a render (the stand-in already logged the start) and start replacements.
  let killed = 0;
  let killLeftBytes = 0;
  let wavesDone = 0;
  const killsPerWave = Math.max(1, Math.ceil(killFraction * options.workers));
  /** Reads which task each worker's render has started, from the append-only ledger. */
  const rendering = (): Map<string, number> => {
    const started = new Map<string, number>();
    for (const line of fs.readFileSync(ledger, "utf8").split("\n")) {
      const [taskId, attempt, pid] = line.split(" ");
      if (taskId) started.set(`${taskId}:${attempt}:${pid}`, 1);
    }
    return started;
  };
  /** Kills up to `killsPerWave` workers that hold a first-attempt lease and have started rendering it. */
  const killWave = async (): Promise<number> => {
    const started = rendering();
    let count = 0;
    for (const lease of await queue.liveLeases()) {
      if (count >= killsPerWave) break;
      const child = children.get(lease.worker);
      if (!child || child.pid === undefined || lease.attempt !== 1 || !started.has(`${lease.taskId}:${lease.attempt}:${child.pid}`)) continue;
      child.kill("SIGKILL");
      await exited(child);
      killLeftBytes += directoryBytes(path.join(paths.workRoot, lease.worker));
      children.delete(lease.worker);
      spawnWorker(`${lease.worker}-r${spawned}`);
      count++;
    }
    return count;
  };

  const finished = await waitUntil(async () => {
    const depth = (await queue.metrics()).depth;
    // The repeat submissions arrive while the first ones are running: some find a finished output (cache hit), some a task in flight (coalesced).
    if (!secondPass && depth.done >= 0.4 * totalTasks) {
      secondPass = true;
      await submitPass();
    }
    if (wavesDone < killWaves && depth.done >= ((wavesDone + 1) / (killWaves + 1)) * totalTasks) {
      const count = await killWave();
      if (count > 0) {
        killed += count;
        wavesDone++;
      }
    }
    return secondPass && depth.done + depth.dead >= totalTasks;
  }, timeoutMs, 20);
  const finishedAt = Date.now();

  for (const child of children.values()) child.kill("SIGTERM");
  await Promise.all([...children.values()].map((child) => Promise.race([exited(child), sleep(15_000).then(() => void child.kill("SIGKILL"))])));
  await Promise.all([...children.values()].map(exited));

  const tempBytesAfterStop = directoryBytes(paths.workRoot);
  const cacheStore = createContentStore(paths.cacheDir);
  const janitor = createJanitor({ workRoot: paths.workRoot, queue, stores: [store, cacheStore], workerStaleMs: 0, tmpMaxAgeMs: 0 });
  const sweep = await janitor.sweep();
  const tempBytesAfterSweep = directoryBytes(paths.workRoot);
  const storeTmpBytesAfterSweep = store.tmpBytes() + cacheStore.tmpBytes();

  const metrics = await queue.metrics();
  const tasks = await queue.listTasks();
  const dead = await queue.deadLetters();
  const done = tasks.filter((t) => t.state === "done");
  const rendersByTask = new Map<string, number>();
  for (const line of fs.readFileSync(ledger, "utf8").split("\n")) {
    const taskId = line.split(" ")[0];
    if (taskId) rendersByTask.set(taskId, (rendersByTask.get(taskId) ?? 0) + 1);
  }
  const rendersTotal = [...rendersByTask.values()].reduce((a, b) => a + b, 0);
  const maxRendersOfOneTask = Math.max(0, ...rendersByTask.values());
  const rendersWithinAttempts = tasks.every((t) => (rendersByTask.get(t.id) ?? 0) <= t.attempts && t.attempts <= t.maxAttempts);

  let identical = 0;
  for (const task of done) {
    const irText = store.readBytes(task.spec.irHash).toString("utf8");
    const expected = createHash("sha256").update(stubBytes(`${irText}|${task.spec.format}|${task.spec.profile}`, outputBytes)).digest("hex");
    if (task.result?.outputDigest === expected && (await store.verify(expected))) identical++;
  }

  const finishSeconds = done.map((t) => ((t.finishedAt ?? finishedAt) - startedAt) / 1000);
  const wallSeconds = (finishedAt - startedAt) / 1000;
  const meanWorkerSeconds = done.length ? done.reduce((sum, t) => sum + (t.result?.workerSeconds ?? 0), 0) / done.length : 0;
  const idealMakespanSeconds = (totalTasks * meanWorkerSeconds) / options.workers;
  const p95Finish = percentile(finishSeconds, 95);
  const perWorker = new Map<string, { disk: number; memory: number }>();
  for (const t of done) {
    const r = t.result;
    if (!r) continue;
    const cur = perWorker.get(r.workerId) ?? { disk: 0, memory: 0 };
    perWorker.set(r.workerId, { disk: Math.max(cur.disk, r.peakDiskBytes), memory: Math.max(cur.memory, r.peakMemoryBytes) });
  }
  const killedTasks = tasks.filter((t: TaskRecord) => t.attempts >= 2).length;
  const dedupRate = metrics.submissions === 0 ? 0 : (metrics.cacheHits + metrics.coalesced) / metrics.submissions;
  const expectedDuplicates = submitTwice ? totalTasks : 0;

  const checks: Check[] = [
    { name: "every task ends done or dead-lettered with a reason", ok: finished && done.length + tasks.filter((t) => t.state === "dead" && dead.some((d) => d.taskId === t.id && d.reason)).length === totalTasks, detail: `${done.length} done, ${tasks.filter((t) => t.state === "dead").length} dead of ${totalTasks}` },
    { name: "no dead letters under chaos that kills only first attempts", ok: dead.length === 0, detail: `${dead.length} dead letters` },
    { name: "zero bytes left in temp after the sweep", ok: tempBytesAfterSweep === 0 && storeTmpBytesAfterSweep === 0 && (killWaves === 0 || killLeftBytes > 0), detail: `kills left ${killLeftBytes} bytes, the janitor removed them (${tempBytesAfterStop} left when the workers stopped, ${sweep.bytesRemoved + sweep.storeTmpBytes} by the last sweep), ${tempBytesAfterSweep + storeTmpBytesAfterSweep} left at the end` },
    { name: "no task rendered more than its attempts (one plus its retries)", ok: rendersWithinAttempts, detail: `max ${maxRendersOfOneTask} renders of one task, ${rendersTotal} renders for ${totalTasks} tasks` },
    { name: "a repeated submission costs no render", ok: metrics.cacheHits + metrics.coalesced === expectedDuplicates, detail: `${metrics.cacheHits} cache hits and ${metrics.coalesced} coalesced for ${expectedDuplicates} repeats` },
    { name: "every output equals the deterministic expectation (so a repeated task gives the same bytes)", ok: identical === done.length && done.length > 0, detail: `${identical} of ${done.length} identical` },
    { name: "killed workers' tasks were repeated", ok: killWaves === 0 || (killed > 0 && killedTasks >= killed), detail: `${killed} workers killed mid-render, ${killedTasks} tasks needed a second attempt` },
    { name: `p95 completion within ${p95Factor} times the ideal`, ok: idealMakespanSeconds > 0 && p95Finish <= p95Factor * idealMakespanSeconds, detail: `p95 ${p95Finish.toFixed(1)} s, ideal ${idealMakespanSeconds.toFixed(1)} s, ratio ${(idealMakespanSeconds ? p95Finish / idealMakespanSeconds : 0).toFixed(2)}` },
  ];

  queue.close();
  return {
    films: options.films,
    tasks: totalTasks,
    workers: options.workers,
    killedWorkers: killed,
    wallSeconds,
    filmsPerHour: wallSeconds > 0 ? (options.films / wallSeconds) * 3600 : 0,
    queueWaitSeconds: { p50: metrics.queueWaitMs.p50 / 1000, p95: metrics.queueWaitMs.p95 / 1000 },
    renderSeconds: { p50: metrics.renderSeconds.p50, p95: metrics.renderSeconds.p95 },
    completionSeconds: { p50: percentile(finishSeconds, 50), p95: p95Finish },
    idealMakespanSeconds,
    p95OverIdeal: idealMakespanSeconds ? p95Finish / idealMakespanSeconds : 0,
    submissions: metrics.submissions,
    cacheHits: metrics.cacheHits,
    coalesced: metrics.coalesced,
    dedupRate,
    cacheHitRate: metrics.cacheHitRate,
    retries: metrics.retries,
    rendersTotal,
    maxRendersOfOneTask,
    doneTasks: done.length,
    deadTasks: tasks.filter((t) => t.state === "dead").length,
    killLeftBytes,
    tempBytesAfterStop,
    tempBytesAfterSweep,
    storeTmpBytesAfterSweep,
    sweepRemovedBytes: sweep.bytesRemoved + sweep.storeTmpBytes,
    peakDiskBytesPerWorker: Math.max(0, ...[...perWorker.values()].map((w) => w.disk)),
    peakMemoryBytesPerWorker: Math.max(0, ...[...perWorker.values()].map((w) => w.memory)),
    costPerFilmUsd: options.films ? metrics.totalCostUsd / options.films : 0,
    freeDiskBytesStart,
    freeDiskBytesEnd: freeDiskBytes(paths.root),
    checks,
    pass: checks.every((c) => c.ok),
  };
}

/** Renders a report as the table the PR and the handoff carry. */
export function formatLoadReport(r: LoadTestReport): string {
  const mib = (b: number): string => `${(b / 1024 ** 2).toFixed(1)} MiB`;
  const rows: Array<[string, string]> = [
    ["films (both formats), tasks, workers", `${r.films}, ${r.tasks}, ${r.workers}`],
    ["workers killed mid-render (replaced)", String(r.killedWorkers)],
    ["wall time", `${r.wallSeconds.toFixed(1)} s`],
    ["films per hour", r.filmsPerHour.toFixed(0)],
    ["queue wait p50 / p95", `${r.queueWaitSeconds.p50.toFixed(2)} s / ${r.queueWaitSeconds.p95.toFixed(2)} s`],
    ["render time p50 / p95 (worker seconds per task)", `${r.renderSeconds.p50.toFixed(3)} s / ${r.renderSeconds.p95.toFixed(3)} s`],
    ["completion time p50 / p95 (since first submit)", `${r.completionSeconds.p50.toFixed(1)} s / ${r.completionSeconds.p95.toFixed(1)} s`],
    ["ideal makespan, p95 over ideal", `${r.idealMakespanSeconds.toFixed(1)} s, ${r.p95OverIdeal.toFixed(2)}`],
    ["submissions, cache hits, coalesced", `${r.submissions}, ${r.cacheHits}, ${r.coalesced}`],
    ["cache hit rate (hits / submissions), dedup rate (hits + coalesced)", `${(r.cacheHitRate * 100).toFixed(1)} percent, ${(r.dedupRate * 100).toFixed(1)} percent`],
    ["retries (failed attempts and expired leases)", String(r.retries)],
    ["renders in total, most renders of one task", `${r.rendersTotal}, ${r.maxRendersOfOneTask}`],
    ["done, dead-lettered", `${r.doneTasks}, ${r.deadTasks}`],
    ["temp bytes: left by kills, at stop, at the end", `${r.killLeftBytes}, ${r.tempBytesAfterStop}, ${r.tempBytesAfterSweep + r.storeTmpBytesAfterSweep}`],
    ["peak disk, peak memory per worker", `${mib(r.peakDiskBytesPerWorker)}, ${mib(r.peakMemoryBytesPerWorker)}`],
    ["cost per film (worker seconds times 0.714 USD per hour)", `${r.costPerFilmUsd.toFixed(6)} USD`],
    ["free disk start, end", `${(r.freeDiskBytesStart / 1024 ** 3).toFixed(2)} GiB, ${(r.freeDiskBytesEnd / 1024 ** 3).toFixed(2)} GiB`],
  ];
  const table = ["| Measure | Value |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`)];
  const checks = r.checks.map((c) => `- ${c.ok ? "PASS" : "FAIL"}: ${c.name} (${c.detail})`);
  return [...table, "", ...checks, "", r.pass ? "LOAD TEST PASS" : "LOAD TEST FAIL"].join("\n");
}
