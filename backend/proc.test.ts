/**
 * File Description: Behavioural tests for the bounded child-process runner using real child processes: a hung child is killed at its time limit, a quick one returns its output, and a caller's own time limit wins over the default.
 * Inputs and outputs: tiny node child processes (a sleeper and an echo) -> assertions on timing, output and the ETIMEDOUT outcome.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { defaultTimeoutMs, execFileSyncBounded, isProcTimeout, PROC_TIMEOUT_MS, spawnSyncBounded } from "./proc";

const SLEEP_FOREVER = ["-e", "setTimeout(() => {}, 600000)"];

test("spawnSyncBounded kills a hung child at its time limit and reports the timeout", () => {
  const started = Date.now();
  const result = spawnSyncBounded(process.execPath, SLEEP_FOREVER, { encoding: "utf8", timeout: 300 });
  assert.ok(Date.now() - started < 10_000, "the child must not outlive its limit by anything near its 10 minute sleep");
  assert.equal(result.status, null);
  assert.equal(isProcTimeout(result), true);
});

test("execFileSyncBounded throws a timeout error for a hung child and returns text for a quick one", () => {
  assert.throws(
    () => execFileSyncBounded(process.execPath, SLEEP_FOREVER, { encoding: "utf8", timeout: 300 }),
    (err: unknown) => isProcTimeout(err),
  );
  assert.equal(execFileSyncBounded(process.execPath, ["-e", "process.stdout.write('ready')"], { encoding: "utf8" }), "ready");
});

test("a child that fails on its own is not mistaken for a timeout", () => {
  const result = spawnSyncBounded(process.execPath, ["-e", "process.exit(3)"], { encoding: "utf8" });
  assert.equal(result.status, 3);
  assert.equal(isProcTimeout(result), false);
});

test("quick tools get the short default limit (by program name, full path or not) and everything else the long one", () => {
  assert.equal(defaultTimeoutMs("ffprobe"), PROC_TIMEOUT_MS.quick);
  assert.equal(defaultTimeoutMs("/usr/bin/git"), PROC_TIMEOUT_MS.quick);
  assert.equal(defaultTimeoutMs("ffmpeg"), PROC_TIMEOUT_MS.heavy);
  assert.equal(defaultTimeoutMs("python3"), PROC_TIMEOUT_MS.heavy);
});
