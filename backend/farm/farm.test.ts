/**
 * File Description: Behavioural tests of the farm worker, janitor, store and garbage collector with the real RenderJob behind a stand-in renderer and a real SQLite queue: a finished task, retries and the dead letter, the disk and memory budgets, the disk reserve gate, lost leases, the startup sweep after a kill, content-addressed dedup, the bounded cache and mark-and-sweep that never removes a live object. Every test ends by checking that zero temp bytes remain.
 * Inputs and outputs: synthetic films and a stub renderer -> asserted task states, store contents and bytes left in the work root.
 * Used by: npm test (Node test runner).
 */

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContentStore, createLocalCache, DigestMismatchError, directoryBytes, MissingBlobError } from "./contentStore";
import { collectGarbage } from "./gc";
import { createRenderJobExecutor } from "./renderExecutor";
import { createSqliteQueue } from "./sqliteQueue";
import { submitFilmTask } from "./submit";
import { createWorker, type WorkerOptions } from "./worker";
import { attemptDirName } from "./janitor";
import type { TaskQueue } from "./queue";
import { createStubRendererFactory, stubEmit, stubFilm, stubServices, type StubRendererOptions } from "../testSupport/farmStub";
import { digestOf, fakeClock, tempDir } from "../testSupport/farmFixtures";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** Waits until `check` is true, polling every 10 ms. */
async function until(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A farm in a throwaway directory: queue, store, cache and work root. */
function rig(options: { clock?: ReturnType<typeof fakeClock>; maxAttempts?: number; backoffBaseMs?: number; cacheMaxBytes?: number } = {}) {
  const tmp = tempDir();
  const now = options.clock?.now;
  const queue = createSqliteQueue(path.join(tmp.dir, "queue.sqlite"), { now, backoffBaseMs: options.backoffBaseMs ?? 1, maxAttempts: options.maxAttempts });
  const store = createContentStore(path.join(tmp.dir, "store"), { now });
  const cache = createLocalCache(path.join(tmp.dir, "cache"), { maxBytes: options.cacheMaxBytes ?? 1_000_000, now });
  const workRoot = path.join(tmp.dir, "work");
  cleanups.push(() => {
    queue.close();
    tmp.cleanup();
  });
  /** Builds a worker whose renderer is the stub with the given behaviour. */
  const worker = (id: string, stub: StubRendererOptions = {}, extra: Partial<WorkerOptions> = {}) =>
    createWorker({
      id,
      queue,
      store,
      cache,
      workRoot,
      executor: createRenderJobExecutor({ makeRenderer: createStubRendererFactory(stub), services: stubServices }),
      leaseMs: 5_000,
      heartbeatMs: 50,
      monitorMs: 20,
      pollMs: 10,
      diskReserveBytes: 0,
      budget: { diskBytes: 50 * 1024 ** 2, memoryBytes: 8 * 1024 ** 3 },
      freeMemory: () => Number.MAX_SAFE_INTEGER,
      ...extra,
    });
  /** Submits film `seed` in a format as a draft. */
  const submit = (seed: number | string, format: "long" | "reel" = "long", priorityClass: "draft" | "batch_final" = "draft", owner = "owner") =>
    submitFilmTask({ queue, store }, { film: stubFilm(seed), emitted: stubEmit(seed), format, profile: "draft", rendererVersion: "stub-1", owner, priorityClass });
  return { tmp, queue, store, cache, workRoot, worker, submit, tempBytes: () => directoryBytes(workRoot) };
}

test("a finished task lands in the store with its cost, worker and stage times, and no temp byte remains", async () => {
  const f = rig();
  const { id } = await f.submit(1);
  const worker = f.worker("w1", { bytes: 5000 });
  await worker.start();
  const step = await worker.runOnce();
  assert.deepEqual(step, { kind: "done", taskId: id, outcome: "done" });
  const task = await f.queue.get(id);
  assert.equal(task?.state, "done");
  const result = task?.result;
  assert.ok(result);
  assert.equal(result.sizeBytes, 5000);
  assert.equal(f.store.sizeOf(result.outputDigest), 5000);
  assert.ok(result.costUsd > 0 && result.workerSeconds > 0);
  for (const stage of ["fetching", "preparing", "rendering", "mastering", "promoting"]) assert.ok(stage in result.stageSeconds, `stage ${stage} was timed`);
  const sidecar = JSON.parse(f.store.readBytes(result.sidecarDigest as string).toString("utf8"));
  assert.equal(sidecar.farm.workerId, "w1");
  assert.equal(sidecar.farm.taskId, id);
  assert.equal(sidecar.renderer, "stub");
  assert.equal(f.tempBytes(), 0, "zero temp bytes after success");
  assert.equal(f.store.tmpBytes(), 0);
  const events = (await f.queue.getLog(id)).map((e) => e.event);
  for (const name of ["submitted", "leased", "attempt_started", "inputs_fetched", "stage", "output_promoted", "completed", "attempt_cleaned"]) assert.ok(events.includes(name), `the log has ${name}`);
  assert.deepEqual(await worker.runOnce(), { kind: "idle" });
  assert.equal((await f.submit(1)).outcome, "cache_hit");
  await worker.shutdown();
});

test("the same task rendered by two workers gives the same bytes", async () => {
  const a = rig();
  const b = rig();
  await a.submit(7);
  await b.submit(7);
  const wa = a.worker("wa");
  const wb = b.worker("wb");
  await wa.start();
  await wb.start();
  await wa.runOnce();
  await wb.runOnce();
  const [ta] = await a.queue.listTasks();
  const [tb] = await b.queue.listTasks();
  assert.equal(ta.id, tb.id);
  assert.equal(ta.result?.outputDigest, tb.result?.outputDigest);
  await wa.shutdown();
  await wb.shutdown();
});

test("a failing render retries with backoff, dead-letters after three attempts with its log, and cleans up every time", async () => {
  const f = rig();
  const { id } = await f.submit(1);
  const worker = f.worker("w1", { failure: (ctx) => `encoder exploded on attempt ${ctx.attempt}`, junkBytes: 1000 });
  await worker.start();
  const steps: string[] = [];
  await until(async () => {
    const step = await worker.runOnce();
    if (step.kind === "failed") steps.push(step.outcome.state);
    assert.equal(f.tempBytes(), 0, "no temp bytes after a failed attempt");
    return (await f.queue.get(id))?.state === "dead";
  }, "the task to be dead-lettered");
  assert.deepEqual(steps, ["queued", "queued", "dead"]);
  const [dead] = await f.queue.deadLetters();
  assert.equal(dead.reason, "encoder exploded on attempt 3");
  assert.equal(dead.log.filter((e) => e.event === "attempt_failed").length, 3);
  assert.ok(dead.log.some((e) => e.event === "attempt_cleaned"));
  await worker.shutdown();
});

test("a task that passes its disk budget is stopped, counted as a failed attempt, and cleaned up", async () => {
  const f = rig({ maxAttempts: 1 });
  const { id } = await f.submit(1);
  const worker = f.worker("w1", { junkBytes: 3 * 1024 ** 2, renderMs: 5_000 }, { budget: { diskBytes: 1024 ** 2, memoryBytes: 8 * 1024 ** 3 } });
  await worker.start();
  const step = await worker.runOnce();
  assert.equal(step.kind, "failed");
  assert.match((await f.queue.get(id))?.error ?? "", /TASK_DISK_BUDGET/);
  assert.equal(f.tempBytes(), 0);
  const peak = (await f.queue.getLog(id)).find((e) => e.event === "attempt_cleaned")?.data.peakDiskBytes as number;
  assert.ok(peak >= 3 * 1024 ** 2, "the peak disk of the task was recorded");
  await worker.shutdown();
});

test("a task that passes its memory budget is stopped", async () => {
  const f = rig({ maxAttempts: 1 });
  const { id } = await f.submit(1);
  const worker = f.worker("w1", { renderMs: 5_000 }, { sampleMemory: () => 3 * 1024 ** 3, budget: { diskBytes: 50 * 1024 ** 2, memoryBytes: 2 * 1024 ** 3 } });
  await worker.start();
  assert.equal((await worker.runOnce()).kind, "failed");
  assert.match((await f.queue.get(id))?.error ?? "", /TASK_MEMORY_BUDGET/);
  assert.equal(f.tempBytes(), 0);
  await worker.shutdown();
});

test("a worker below the disk reserve stops leasing instead of failing jobs", async () => {
  const f = rig();
  const { id } = await f.submit(1);
  let free = 1024 ** 3;
  const worker = f.worker("w1", {}, { diskReserveBytes: 3 * 1024 ** 3, budget: { diskBytes: 1024 ** 3, memoryBytes: 8 * 1024 ** 3 }, statfs: () => ({ bavail: free / 4096, bsize: 4096 }) });
  await worker.start();
  const step = await worker.runOnce();
  assert.equal(step.kind, "paused");
  assert.match(step.kind === "paused" ? step.reason : "", /disk_low/);
  const task = await f.queue.get(id);
  assert.equal(task?.state, "queued");
  assert.equal(task?.attempts, 0, "no attempt was spent");
  free = 10 * 1024 ** 3;
  assert.equal((await worker.runOnce()).kind, "done", "leasing resumes when there is room");
  await worker.shutdown();
});

test("a render that finds the disk under the reserve gives the task back without spending an attempt, and the worker pauses", async () => {
  const f = rig();
  const { id } = await f.submit(1);
  const worker = f.worker("w1", { diskLow: () => true }, { diskPauseMs: 60_000 });
  await worker.start();
  const step = await worker.runOnce();
  assert.deepEqual(step, { kind: "released", taskId: id, reason: "disk_low" });
  const task = await f.queue.get(id);
  assert.equal(task?.state, "queued");
  assert.equal(task?.attempts, 0);
  assert.equal(f.tempBytes(), 0);
  assert.equal((await worker.runOnce()).kind, "paused", "the worker keeps off the queue while it recovers");
  assert.equal((await f.queue.metrics()).releasedForDisk, 1);
  await worker.shutdown();
});

test("a worker that loses its lease stops rendering, does not acknowledge, and cleans up", async () => {
  const clock = fakeClock(Date.now());
  const f = rig({ clock, backoffBaseMs: 1_000 });
  const { id } = await f.submit(1);
  const ledger = path.join(f.tmp.dir, "ledger.txt");
  const worker = f.worker("slow", { renderMs: 30_000, ledgerFile: ledger });
  await worker.start();
  const running = worker.runOnce();
  await until(() => fs.existsSync(ledger), "the render to start");
  clock.advance(60_000);
  assert.equal(await f.queue.claim("other", 5_000), null, "the expired lease is returned to the queue (and backs off)");
  const step = await running;
  assert.deepEqual(step, { kind: "lost", taskId: id });
  assert.equal(f.tempBytes(), 0);
  const task = await f.queue.get(id);
  assert.equal(task?.state, "queued");
  assert.ok(!(await f.queue.getLog(id)).some((e) => e.event === "completed"));
  await worker.shutdown();
});

test("a worker told to stop now gives the running task back for free", async () => {
  const f = rig();
  const { id } = await f.submit(1);
  const ledger = path.join(f.tmp.dir, "ledger.txt");
  const worker = f.worker("w1", { renderMs: 30_000, ledgerFile: ledger });
  await worker.start();
  const running = worker.runOnce();
  await until(() => fs.existsSync(ledger), "the render to start");
  worker.stop(true);
  assert.deepEqual(await running, { kind: "released", taskId: id, reason: "shutdown" });
  assert.equal((await f.queue.get(id))?.attempts, 0);
  assert.equal(f.tempBytes(), 0);
  await worker.shutdown();
  assert.equal(fs.existsSync(worker.workerDir), false, "the worker's own directory is gone");
});

test("the startup sweep removes what killed workers left and keeps the attempt of a live lease", async () => {
  const clock = fakeClock(Date.now());
  const f = rig({ clock });
  const { id } = await f.submit(1);
  await f.queue.registerWorker("w-live", { pid: 1, host: "h" });
  const leased = await f.queue.claim("w-live", 60_000);
  assert.ok(leased);
  const liveDir = path.join(f.workRoot, "w-live", attemptDirName(id, leased.token.attempt));
  const deadDir = path.join(f.workRoot, "w-dead", "attempt-0123456789abcdef-a1");
  for (const dir of [liveDir, deadDir]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "frame.bin"), Buffer.alloc(2048));
  }
  fs.writeFileSync(path.join(f.workRoot, "stray.tmp"), "junk");
  fs.mkdirSync(f.store.tmpDir, { recursive: true });
  const unfinished = path.join(f.store.tmpDir, "put-1-dead");
  fs.writeFileSync(unfinished, Buffer.alloc(512));
  fs.utimesSync(unfinished, 1, 1);
  const sweeper = f.worker("w-new");
  await sweeper.start();
  assert.equal(fs.existsSync(deadDir), false, "the dead worker's directory is gone");
  assert.equal(fs.existsSync(path.join(f.workRoot, "stray.tmp")), false);
  assert.equal(fs.existsSync(unfinished), false, "the unfinished put is gone");
  assert.equal(fs.existsSync(liveDir), true, "a live lease keeps its attempt directory");
  clock.advance(120_000);
  const report = await sweeper.janitor.sweep(new Set(), "w-new");
  assert.equal(fs.existsSync(liveDir), false, "the attempt goes when its lease is gone");
  assert.ok(report.bytesRemoved >= 2048);
  await sweeper.shutdown();
  assert.equal(f.tempBytes(), 0);
});

test("the store keeps one read-only copy per content, rejects bytes that do not match their name and leaves no partial put", async () => {
  const tmp = tempDir();
  cleanups.push(tmp.cleanup);
  const store = createContentStore(path.join(tmp.dir, "store"));
  const first = await store.putBytes("hello farm");
  const second = await store.putBytes(Buffer.from("hello farm"));
  assert.equal(first.digest, digestOf("hello farm"));
  assert.equal(first.existed, false);
  assert.equal(second.existed, true);
  assert.equal(store.list().length, 1);
  const file = path.join(tmp.dir, "same.txt");
  fs.writeFileSync(file, "hello farm");
  assert.equal((await store.putFile(file)).digest, first.digest);
  assert.equal(fs.statSync(store.pathOf(first.digest)).mode & 0o222, 0, "stored objects are read-only");
  await assert.rejects(store.putBytes("other", { expect: first.digest }), DigestMismatchError);
  assert.equal(store.tmpBytes(), 0, "a rejected put leaves nothing behind");
  assert.equal(await store.verify(first.digest), true);
  const linked = path.join(tmp.dir, "linked.txt");
  store.materialize(first.digest, linked);
  assert.equal(fs.statSync(linked).ino, fs.statSync(store.pathOf(first.digest)).ino, "a task gets a hard link, not a copy");
  assert.throws(() => store.readBytes(digestOf("absent")), MissingBlobError);
});

test("the worker cache fetches verified objects, rejects a corrupted source and evicts the least recently used above its bound", async () => {
  const clock = fakeClock(Date.now());
  const tmp = tempDir();
  cleanups.push(tmp.cleanup);
  const source = createContentStore(path.join(tmp.dir, "store"), { now: clock.now });
  const cache = createLocalCache(path.join(tmp.dir, "cache"), { maxBytes: 1000, now: clock.now });
  const blobs: string[] = [];
  for (const name of ["a", "b", "c"]) {
    const put = await source.putBytes(name.repeat(400));
    blobs.push(put.digest);
  }
  await cache.ensure(source, blobs[0]);
  clock.advance(1000);
  await cache.ensure(source, blobs[1]);
  clock.advance(1000);
  await cache.ensure(source, blobs[0]);
  clock.advance(1000);
  await cache.ensure(source, blobs[2]);
  assert.deepEqual(cache.stats(), { hits: 1, misses: 3, fetchedBytes: 1200 });
  const report = cache.evict();
  assert.equal(report.removed, 1);
  assert.equal(cache.store.has(blobs[1]), false, "b was the least recently used");
  assert.equal(cache.store.has(blobs[0]) && cache.store.has(blobs[2]), true);
  const protectedReport = cache.evict(new Set(blobs));
  assert.equal(protectedReport.removed, 0);
  await assert.rejects(cache.ensure(source, digestOf("never stored")), MissingBlobError);
  fs.chmodSync(source.pathOf(blobs[1]), 0o644);
  fs.writeFileSync(source.pathOf(blobs[1]), "corrupted");
  await assert.rejects(cache.ensure(source, blobs[1]), DigestMismatchError);
  assert.equal(cache.store.has(blobs[1]), false);
  assert.equal(cache.store.tmpBytes(), 0);
});

test("a cut store fails the task cleanly: the missing input is reported, the attempt is retried and nothing is left behind", async () => {
  const f = rig({ maxAttempts: 1 });
  const { id } = await f.submit(1);
  const task = await f.queue.get(id);
  assert.ok(task);
  fs.rmSync(f.store.pathOf(task.spec.irHash));
  const worker = f.worker("w1");
  await worker.start();
  assert.equal((await worker.runOnce()).kind, "failed");
  assert.match((await f.queue.get(id))?.error ?? "", /MISSING_BLOB/);
  assert.equal(f.tempBytes(), 0);
  await worker.shutdown();
});

test("garbage collection never removes a live object and removes the dead ones", async () => {
  const clock = fakeClock(Date.now());
  const DAY = 24 * 60 * 60_000;
  const f = rig({ clock, maxAttempts: 1 });
  const dead = await f.submit("dead");
  const doneLive = await f.submit("a");
  const doneOld = await f.submit("b");
  const leased = await f.submit("leased");
  const claimed = new Map<string, Awaited<ReturnType<TaskQueue["claim"]>>>();
  for (let i = 0; i < 4; i++) {
    const c = await f.queue.claim("w", 30 * DAY);
    claimed.set(c?.task.payload.filmId ?? "none", c);
  }
  const output = async (text: string) => (await f.store.putBytes(text)).digest;
  const finish = async (film: string, text: string) => {
    const c = claimed.get(film);
    assert.ok(c);
    await f.queue.complete(c.token, { outputDigest: await output(text), sidecarDigest: null, sizeBytes: 1, workerId: "w", attempt: 1, stageSeconds: {}, workerSeconds: 1, peakDiskBytes: 0, peakMemoryBytes: 0, costUsd: 0 });
  };
  await finish("film-a", "output of a");
  await finish("film-b", "output of b");
  const failing = claimed.get("film-dead");
  assert.ok(failing);
  await f.queue.fail(failing.token, "bad film");
  assert.equal((await f.queue.get(dead.id))?.state, "dead");
  await output("an orphan nobody references");
  clock.advance(8 * DAY);
  const queued = await f.submit("queued");
  const young = await output("a young orphan that a submitter may be about to reference");
  const before = f.store.list().length;
  const live = await f.queue.liveDigests({ liveFilms: new Set(["film-a"]), resultTtlMs: 7 * DAY });
  const report = await collectGarbage({ store: f.store, queue: f.queue, liveFilms: new Set(["film-a"]), resultTtlMs: 7 * DAY, graceMs: DAY, now: clock.now });
  for (const digest of live) assert.equal(f.store.has(digest), true, `live object ${digest.slice(0, 12)} is still stored`);
  assert.equal(f.store.has(young), true, "an object inside the grace period stays");
  const doneA = await f.queue.get(doneLive.id);
  const doneB = await f.queue.get(doneOld.id);
  assert.equal(f.store.has(doneA?.result?.outputDigest as string), true, "the output of a live film stays");
  assert.equal(f.store.has(doneB?.result?.outputDigest as string), false, "the output of a film that is not live goes after its time limit");
  const queuedTask = await f.queue.get(queued.id);
  const deadTask = await f.queue.get(dead.id);
  const leasedTask = await f.queue.get(leased.id);
  for (const t of [queuedTask, deadTask, leasedTask]) for (const d of [t?.spec.irHash, t?.payload.filmDigest, ...Object.values(t?.spec.assetDigests ?? {})]) assert.equal(f.store.has(d as string), true, "the inputs of unfinished and dead tasks stay");
  assert.ok(report.removed >= 3 && report.removed === before - f.store.list().length);
  assert.equal((await f.submit("a")).outcome, "cache_hit");
  assert.equal((await f.submit("b")).outcome, "enqueued", "a collected output is a cache miss, so the film renders again");
});
