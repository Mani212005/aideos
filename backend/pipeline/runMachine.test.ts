/**
 * File Description: Behavioural tests for the production run state machine (M8): the legal and
 * impossible stage transitions, saving on every transition including `running`, invalidation of later
 * stages, a corrupt state file, a run that died while a stage was running, and a stage owned by a run
 * that is still alive. They execute the machine and the loader, not their source text.
 * Inputs and outputs: synthetic run states and throwaway package folders -> test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import {
  IllegalTransitionError, STAGE_TRANSITIONS, applyStageEvent, createRunMachine, inputNeeded, isInputNeeded, nextStageState,
  type StageEventType,
} from "./runMachine";
import { loadRunState, runStatePath, saveRunState } from "./runState";
import { ProductionError, type RunState, type StageRecord } from "./types";

const OWNER = { pid: process.pid, runId: "run-a" };

// A run state with no stages yet.
function emptyState(slug = "zz-run-machine"): RunState {
  return { slug, title: "t", updatedAt: "2026-01-01T00:00:00.000Z", stages: [], brollClips: [], outputs: [] };
}

// A throwaway package folder under the test videos dir, removed afterwards.
function withPackage(slug: string, body: () => void): void {
  const dir = path.join(TEST_VIDEOS_DIR, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try { body(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("RunMachine: a stage walks pending -> running -> done and saves at every step, running included", () => {
  const saved: string[] = [];
  const machine = createRunMachine(emptyState(), (state) => saved.push(state.stages.map((s) => `${s.stage}:${s.status}`).join(",")));
  assert.equal(machine.record("narrate").status, "pending");
  machine.begin("narrate", "fp-1", OWNER);
  machine.complete("narrate");
  assert.deepEqual(saved, ["narrate:running", "narrate:done"]);
  const record = machine.record("narrate");
  assert.equal(record.fingerprint, "fp-1");
  assert.equal(record.owner, undefined, "the owner is held only while running");
  assert.ok(record.finishedAt && record.durationMs !== undefined);
});

test("RunMachine: failure and needs_input are states, and each can be started again", () => {
  const machine = createRunMachine(emptyState(), () => {});
  machine.begin("look", "a", OWNER);
  machine.needInput("look", "write look.json");
  assert.equal(machine.record("look").status, "needs_input");
  assert.equal(machine.record("look").error, "write look.json");
  machine.begin("look", "a", OWNER);
  machine.fail("look", "boom");
  assert.deepEqual([machine.record("look").status, machine.record("look").error], ["failed", "boom"]);
  machine.begin("look", "a", OWNER);
  assert.equal(machine.record("look").error, undefined, "a new start clears the old error");
});

test("RunMachine: a stage that runs again sends every later stage back to pending and drops render outputs", () => {
  const state = emptyState();
  const machine = createRunMachine(state, () => {});
  for (const stage of ["narrate", "design"] as const) { machine.begin(stage, stage, OWNER); machine.complete(stage); }
  machine.begin("render", "render-old", OWNER);
  machine.fail("render", "old render failure");
  state.outputs = [{ format: "long", path: "x.mp4", width: 1, height: 1, fps: 30, durationSec: 1, sizeBytes: 1 }];
  machine.begin("narrate", "again", OWNER);
  assert.equal(machine.record("design").status, "pending");
  assert.equal(machine.record("render").status, "pending");
  assert.deepEqual(
    [machine.record("render").startedAt, machine.record("render").finishedAt, machine.record("render").durationMs, machine.record("render").error, machine.record("render").fingerprint],
    [undefined, undefined, undefined, undefined, undefined],
    "invalidated work carries no metadata from its previous execution",
  );
  assert.deepEqual(state.outputs, []);
  assert.equal(machine.record("narrate").status, "running");
});

test("RunMachine: a done stage is reused and re-stamped without leaving done; recorded work is adopted", () => {
  const machine = createRunMachine(emptyState(), () => {});
  machine.adopt("narrate", "recorded");
  assert.deepEqual([machine.record("narrate").status, machine.record("narrate").fingerprint], ["done", "recorded"]);
  machine.reuse("narrate");
  machine.restamp("narrate", "after");
  assert.deepEqual([machine.record("narrate").status, machine.record("narrate").fingerprint], ["done", "after"]);
});

test("RunMachine: impossible transitions are refused with a named error and change nothing", () => {
  const saved: number[] = [];
  const machine = createRunMachine(emptyState(), () => saved.push(1));
  // Completing, failing or re-stamping a stage that never started.
  for (const act of [() => machine.complete("design"), () => machine.fail("design", "x"), () => machine.restamp("design", "x"), () => machine.reuse("design")]) {
    assert.throws(act, (err: unknown) => err instanceof IllegalTransitionError && err.stage === "design" && err.from === "pending");
  }
  machine.begin("design", "a", OWNER);
  // Starting a stage that is already running, and invalidating one that is running (a second live run).
  assert.throws(() => machine.begin("design", "b", OWNER), (err: unknown) => err instanceof IllegalTransitionError && err.from === "running" && err.event === "start");
  assert.throws(() => machine.begin("narrate", "b", OWNER), /illegal transition: stage "design" is running and cannot invalidate/);
  assert.equal(machine.record("narrate").status, "pending", "a refused begin leaves the earlier stage untouched");
  assert.equal(machine.record("design").fingerprint, "a");
  assert.equal(saved.length, 1, "only the one legal transition was saved");
  machine.complete("design");
  assert.throws(() => machine.complete("design"), /stage "design" is done and cannot complete/);
});

test("RunMachine: the table has no way out of a state except the declared ones", () => {
  const events: StageEventType[] = ["start", "complete", "fail", "need_input", "reuse", "adopt", "restamp", "invalidate", "interrupt"];
  const legal = Object.entries(STAGE_TRANSITIONS).flatMap(([from, row]) => Object.keys(row).map((event) => `${from}.${event}`)).sort();
  const probed = (Object.keys(STAGE_TRANSITIONS) as Array<keyof typeof STAGE_TRANSITIONS>)
    .flatMap((from) => events.filter((event) => nextStageState(from, event) !== null).map((event) => `${from}.${event}`)).sort();
  assert.deepEqual(probed, legal);
  assert.equal(nextStageState("pending", "complete"), null);
  assert.equal(nextStageState("running", "start"), null);
});

test("RunMachine: input needed is a value, not an exception", () => {
  const needed = inputNeeded("needs_design", ["step"], "write design.json");
  assert.equal(isInputNeeded(needed), true);
  assert.equal(isInputNeeded({ stage: "design" }), false);
  assert.equal(isInputNeeded(null), false);
  assert.deepEqual([needed.status, needed.nextSteps, needed.message], ["needs_design", ["step"], "write design.json"]);
});

test("RunState: `running` reaches the disk before the stage finishes, and a killed run is read back as interrupted", () => {
  const slug = "zz-run-machine-killed";
  withPackage(slug, () => {
    const machine = createRunMachine(loadRunState(slug, "t", "run-a").state, saveRunState);
    machine.begin("narrate", "n", { pid: 2 ** 22 + 12345, runId: "run-a" });
    machine.complete("narrate");
    machine.begin("design", "d", { pid: 2 ** 22 + 12345, runId: "run-a" });
    // The process dies here: nothing else is saved. The disk says running, not a stale done.
    const onDisk = JSON.parse(fs.readFileSync(runStatePath(slug), "utf8")) as RunState;
    assert.deepEqual(onDisk.stages.map((s) => [s.stage, s.status]), [["narrate", "done"], ["design", "running"]]);

    const resumed = loadRunState(slug, "t", "run-b");
    assert.deepEqual(resumed.state.stages.map((s) => [s.stage, s.status]), [["narrate", "done"], ["design", "failed"]]);
    assert.match(resumed.state.stages[1].error ?? "", /interrupted/);
    assert.match(resumed.notices.join("\n"), /design stage was left running/);
    assert.equal(resumed.state.stages[1].owner, undefined);
    const persisted = JSON.parse(fs.readFileSync(runStatePath(slug), "utf8")) as RunState;
    assert.equal(persisted.stages[1].status, "failed", "the interruption is saved, so it is not reported twice");
  });
});

test("RunState: a stage running under another live run refuses this run as already in flight", () => {
  const slug = "zz-run-machine-inflight";
  withPackage(slug, () => {
    const machine = createRunMachine(loadRunState(slug, "t", "run-a").state, saveRunState);
    machine.begin("narrate", "n", { pid: process.pid, runId: "run-a" });
    assert.throws(() => loadRunState(slug, "t", "run-b"), (err: unknown) => err instanceof ProductionError && err.stage === "narrate" && /already in flight|is in flight/.test(err.message));
    const onDisk = JSON.parse(fs.readFileSync(runStatePath(slug), "utf8")) as RunState;
    assert.equal(onDisk.stages[0].status, "running", "the live run's stage is not disturbed");
    machine.release("run-a", "ended");
    assert.equal(loadRunState(slug, "t", "run-b").state.stages[0].status, "failed", "once released, the next run sees an interrupted stage");
  });
});

test("RunState: a corrupt file is moved aside and reported, not silently replaced", () => {
  const slug = "zz-run-machine-corrupt";
  withPackage(slug, () => {
    fs.writeFileSync(runStatePath(slug), "{ not json");
    const loaded = loadRunState(slug, "t", "run-a");
    assert.deepEqual(loaded.state.stages, []);
    assert.match(loaded.notices[0], /run-state\.json could not be read; it was moved to run-state\.corrupt-\d+\.json/);
    const kept = fs.readdirSync(path.dirname(runStatePath(slug))).filter((f) => f.startsWith("run-state.corrupt-"));
    assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(path.join(path.dirname(runStatePath(slug)), kept[0]), "utf8"), "{ not json");

    // A readable file with an unknown stage state is just as corrupt.
    fs.writeFileSync(runStatePath(slug), JSON.stringify({ ...emptyState(slug), stages: [{ stage: "design", status: "almost" }] }));
    assert.match(loadRunState(slug, "t", "run-a").notices[0], /could not be read/);
  });
});

test("RunState: a legacy file without owners loads and keeps its done stages", () => {
  const slug = "zz-run-machine-legacy";
  withPackage(slug, () => {
    const done: StageRecord = { stage: "narrate", status: "done", fingerprint: "f" };
    fs.writeFileSync(runStatePath(slug), JSON.stringify({ ...emptyState(slug), stages: [done] }));
    const loaded = loadRunState(slug, "t", "run-a");
    assert.deepEqual(loaded.notices, []);
    assert.deepEqual(loaded.state.stages, [done]);
    assert.equal(applyStageEvent(done, { type: "reuse" }).status, "done");
  });
});
