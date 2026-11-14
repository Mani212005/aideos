/**
 * File Description: Behavioural tests of the durable queue on a real SQLite file with a hand-moved clock: task ids, cache hits and coalescing, lease expiry and heartbeats, three attempts with backoff then a dead letter that carries the log, priorities, per-owner fair share and caps, back-pressure that parks batch work, and the disk-low release that spends no attempt.
 * Inputs and outputs: synthetic task specs and a fake clock -> asserted queue states, outcomes and metrics.
 * Used by: npm test (Node test runner).
 */

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createSqliteQueue } from "./sqliteQueue";
import type { TaskQueue, TaskResult } from "./queue";
import { canonicalSpec, taskIdOf, type PriorityClass } from "./taskSpec";
import { digestOf, fakeClock, payloadFor, specFor, tempDir } from "../testSupport/farmFixtures";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** Opens a queue with a fake clock in a throwaway directory. */
function open(options: Parameters<typeof createSqliteQueue>[1] = {}) {
  const tmp = tempDir();
  const clock = fakeClock();
  const queue = createSqliteQueue(path.join(tmp.dir, "queue.sqlite"), { now: clock.now, backoffBaseMs: 1_000, ...options });
  cleanups.push(() => {
    queue.close();
    tmp.cleanup();
  });
  return { queue, clock };
}

/** Submits task `seed` for an owner and class. */
function submit(queue: TaskQueue, seed: number | string, owner = "studio", priorityClass: PriorityClass = "draft") {
  return queue.submit({ spec: specFor(seed), payload: payloadFor(seed), owner, priorityClass });
}

/** A finished-task result that points at a fake output. */
function result(seed: string, worker: string, attempt: number): TaskResult {
  return { outputDigest: digestOf(`out-${seed}`), sidecarDigest: null, sizeBytes: 10, workerId: worker, attempt, stageSeconds: { rendering: 1 }, workerSeconds: 1, peakDiskBytes: 1, peakMemoryBytes: 1, costUsd: 0.001 };
}

test("the task id is the SHA-256 of the canonical spec, whatever the key order", () => {
  const a = specFor(1);
  const reordered = JSON.parse(JSON.stringify({ rendererVersion: a.rendererVersion, frameRange: a.frameRange, profile: a.profile, format: a.format, assetDigests: Object.fromEntries(Object.entries(a.assetDigests).reverse()), irHash: a.irHash }));
  assert.equal(taskIdOf(reordered), taskIdOf(a));
  assert.equal(canonicalSpec(reordered), canonicalSpec(a));
  for (const changed of [{ format: "reel" as const }, { profile: "final" as const }, { frameRange: [0, 9] as [number, number] }, { rendererVersion: "other" }]) {
    assert.notEqual(taskIdOf(specFor(1, changed)), taskIdOf(a));
  }
  assert.throws(() => taskIdOf(specFor(1, { assetDigests: { "../evil.ttf": digestOf("x") } })), /inside the package/);
});

test("a duplicate submission is a cache hit once done and coalesced while in flight", async () => {
  const { queue } = open();
  const first = await submit(queue, 1);
  assert.equal(first.outcome, "enqueued");
  assert.equal((await submit(queue, 1)).outcome, "coalesced");
  const leased = await queue.claim("w1", 60_000);
  assert.ok(leased);
  assert.equal(await queue.claim("w2", 60_000), null, "the coalesced duplicate is not a second task");
  assert.equal(await queue.complete(leased.token, result("1", "w1", 1)), "done");
  const again = await submit(queue, 1);
  assert.equal(again.outcome, "cache_hit");
  assert.equal(await queue.claim("w2", 60_000), null);
  const metrics = await queue.metrics();
  assert.equal(metrics.submissions, 3);
  assert.equal(metrics.cacheHits, 1);
  assert.equal(metrics.coalesced, 1);
  assert.equal((await queue.get(first.id))?.submissions, 3);
});

test("a cache hit needs a usable output: a lost output makes the task run again", async () => {
  const { queue } = open();
  const first = await submit(queue, 1);
  const leased = await queue.claim("w1", 60_000);
  assert.ok(leased);
  await queue.complete(leased.token, result("1", "w1", 1));
  const again = await queue.submit({ spec: specFor(1), payload: payloadFor(1), owner: "studio", priorityClass: "draft", isResultValid: () => false });
  assert.equal(again.outcome, "enqueued");
  const rerun = await queue.claim("w2", 60_000);
  assert.equal(rerun?.token.taskId, first.id);
  assert.equal(rerun?.token.attempt, 1, "the attempts start over for a lost output");
});

test("a lease that expires returns the task, and a stale worker cannot extend it", async () => {
  const { queue, clock } = open();
  const { id } = await submit(queue, 1);
  const lost = await queue.claim("crashed", 10_000);
  assert.ok(lost);
  clock.advance(5_000);
  assert.equal(await queue.heartbeat(lost.token, 10_000), true, "a heartbeat keeps the lease alive");
  clock.advance(9_000);
  assert.equal(await queue.claim("w2", 10_000), null, "the lease is still held");
  clock.advance(2_000);
  assert.equal(await queue.claim("w2", 10_000), null, "the retry waits for its backoff");
  clock.advance(1_000);
  const retaken = await queue.claim("w2", 10_000);
  assert.equal(retaken?.token.taskId, id);
  assert.equal(retaken?.token.attempt, 2);
  assert.equal(await queue.heartbeat(lost.token, 10_000), false, "the crashed worker's lease is gone");
  assert.deepEqual((await queue.getLog(id)).map((e) => e.event), ["submitted", "leased", "lease_expired", "leased"]);
  assert.equal((await queue.metrics()).retries, 1);
});

test("a stale worker that finishes late is accepted once and the second finisher is told it was already done", async () => {
  const { queue, clock } = open();
  const { id } = await submit(queue, 1);
  const slow = await queue.claim("slow", 1_000);
  assert.ok(slow);
  clock.advance(1_000 + 1);
  assert.equal(await queue.claim("fast", 60_000), null, "the first claim after the expiry returns the task to the queue, which then backs off");
  clock.advance(1_000);
  const second = await queue.claim("fast", 60_000);
  assert.ok(second);
  assert.equal(await queue.complete(slow.token, result("1", "slow", 1)), "done");
  assert.equal(await queue.complete(second.token, result("1", "fast", 2)), "already_done");
  assert.equal((await queue.get(id))?.result?.workerId, "slow");
  assert.equal((await queue.metrics()).lateCompletions, 1);
});

test("three failures back off and then dead-letter the task with its log", async () => {
  const { queue, clock } = open();
  const { id } = await submit(queue, 1);
  const delays: number[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const leased = await queue.claim("w1", 60_000);
    assert.ok(leased, `attempt ${attempt} is leased`);
    assert.equal(leased.token.attempt, attempt);
    const outcome = await queue.fail(leased.token, `boom ${attempt}`);
    if (attempt < 3) {
      assert.equal(outcome.state, "queued");
      if (outcome.state === "queued") delays.push(outcome.retryAt - clock.now());
      assert.equal(await queue.claim("w1", 60_000), null, "no lease before the backoff ends");
      clock.advance(delays[delays.length - 1]);
    } else assert.deepEqual(outcome, { state: "dead", reason: "boom 3" });
  }
  assert.deepEqual(delays, [1_000, 4_000], "the backoff grows by four each time");
  assert.equal((await queue.get(id))?.state, "dead");
  assert.equal(await queue.claim("w1", 60_000), null);
  const [dead] = await queue.deadLetters();
  assert.equal(dead.taskId, id);
  assert.equal(dead.reason, "boom 3");
  assert.equal(dead.attempts, 3);
  assert.equal(dead.log.filter((e) => e.event === "attempt_failed").length, 3);
  assert.equal(dead.log[dead.log.length - 1]?.event, "dead_lettered");
  assert.equal((await submit(queue, 1)).outcome, "dead_letter", "a bad film does not retry forever");
  assert.equal(await queue.requeueDead(id), true);
  assert.equal((await queue.claim("w1", 60_000))?.token.attempt, 1);
});

test("a crash that uses the last attempt dead-letters the task", async () => {
  const { queue, clock } = open({ maxAttempts: 2 });
  const { id } = await submit(queue, 1);
  assert.ok(await queue.claim("w", 1_000));
  clock.advance(1_001);
  assert.equal(await queue.claim("w", 1_000), null, "attempt 1 expired and the task backs off");
  clock.advance(1_000);
  assert.ok(await queue.claim("w", 1_000));
  clock.advance(1_001);
  assert.equal(await queue.claim("w", 1_000), null, "attempt 2 expired and was the last");
  const task = await queue.get(id);
  assert.equal(task?.state, "dead");
  assert.match(task?.error ?? "", /lease expired on attempt 2 of 2/);
  assert.equal((await queue.deadLetters()).length, 1);
});

test("priority classes are served in order and fair share alternates between owners", async () => {
  const { queue } = open();
  await submit(queue, "batch", "owner-b", "batch_final");
  await submit(queue, "review", "owner-b", "review");
  await submit(queue, "draft", "owner-b", "draft");
  await submit(queue, "studio", "owner-b", "studio_export");
  const order: string[] = [];
  for (let i = 0; i < 4; i++) order.push((await queue.claim(`w${i}`, 60_000))?.task.priorityClass ?? "none");
  assert.deepEqual(order, ["studio_export", "draft", "review", "batch_final"]);

  const fair = open();
  for (let i = 0; i < 4; i++) await submit(fair.queue, `a${i}`, "owner-a", "batch_final");
  for (let i = 0; i < 2; i++) await submit(fair.queue, `b${i}`, "owner-b", "batch_final");
  const owners: string[] = [];
  for (let i = 0; i < 4; i++) owners.push((await fair.queue.claim(`w${i}`, 60_000))?.task.owner ?? "none");
  assert.notEqual(owners[0], owners[1], "the second worker serves the other owner");
  assert.equal(owners.filter((o) => o === "owner-a").length, 2, "four workers split two and two between a big and a small owner");
});

test("a per-owner concurrency cap holds work back while others can run", async () => {
  const { queue } = open();
  await queue.setOwnerCap("greedy", 1);
  for (let i = 0; i < 3; i++) await submit(queue, `g${i}`, "greedy", "draft");
  await submit(queue, "small", "small", "batch_final");
  const first = await queue.claim("w1", 60_000);
  assert.equal(first?.task.owner, "greedy");
  const second = await queue.claim("w2", 60_000);
  assert.equal(second?.task.owner, "small", "the capped owner is skipped even at a higher priority");
  assert.equal(await queue.claim("w3", 60_000), null);
  assert.ok(first);
  await queue.complete(first.token, result("g", "w1", 1));
  assert.equal((await queue.claim("w3", 60_000))?.task.owner, "greedy");
});

test("back-pressure parks batch work when the backlog is old, never parks urgent work, and releases it as the backlog drains", async () => {
  const { queue, clock } = open({ maxBacklogAgeMs: 60_000, resumeBelowDepth: 2 });
  const old = await submit(queue, "old", "studio", "draft");
  clock.advance(120_000);
  const parked = await submit(queue, "batch1", "batch", "batch_final");
  assert.equal(parked.outcome, "parked");
  assert.equal((await submit(queue, "batch2", "batch", "batch_final")).outcome, "parked", "order is kept once anything is parked");
  assert.equal((await submit(queue, "draft2", "studio", "draft")).outcome, "enqueued", "urgent work is never parked");
  assert.equal((await queue.metrics()).depth.parked, 2);
  assert.equal(await queue.releaseParked(), 0, "nothing is released while the backlog is old");
  const first = await queue.claim("w1", 60_000);
  assert.equal(first?.token.taskId, old.id);
  const second = await queue.claim("w2", 60_000);
  assert.equal(second?.task.priorityClass, "draft");
  const third = await queue.claim("w3", 60_000);
  assert.equal(third?.task.priorityClass, "batch_final", "parked work is released once the ready backlog is gone");
  assert.equal(third?.token.taskId, parked.id, "the oldest parked task goes first");
  assert.equal((await queue.metrics()).parkedTotal, 2);
});

test("a worker that is out of disk gives the task back without spending an attempt", async () => {
  const { queue } = open();
  const { id } = await submit(queue, 1);
  const leased = await queue.claim("w1", 60_000);
  assert.ok(leased);
  assert.equal(await queue.release(leased.token, "disk_low: 1 GiB free", 0), true);
  assert.equal(await queue.release(leased.token, "disk_low", 0), false, "a released lease cannot be released twice");
  const again = await queue.claim("w2", 60_000);
  assert.equal(again?.token.taskId, id);
  assert.equal(again?.token.attempt, 1);
  assert.equal((await queue.metrics()).releasedForDisk, 1);
});

test("a database written by a newer schema is refused", async () => {
  const tmp = tempDir();
  cleanups.push(tmp.cleanup);
  const file = path.join(tmp.dir, "queue.sqlite");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA user_version = 99");
  db.close();
  assert.throws(() => createSqliteQueue(file), /schema version 99/);
});
