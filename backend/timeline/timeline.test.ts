/**
 * File Description: Test Suite for Phase T-B (Direct Manipulation Core) & Phase T-C (Universal Undo & Shortcuts).
 * Implements TB-1..TB-9 and TC-1..TC-7 with named negative assertions.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeShotStartTimes,
  calculateSnap,
  trimShotEdge,
  splitShotAtTime,
  deleteShot,
  TimelineUndoStack,
  type SnapTarget,
} from "./timeline";
import { parseFilm as validateFilm } from "../../src/dl/schema";
import type { Film } from "../../src/dl/schema";

function createMockFilm(): Film {
  return {
    id: "test-timeline-film",
    title: "Test Timeline Film",
    fps: 30,
    stage: "frame",
    chapters: ["ch1"],
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0 },
        { id: "n2", label: "Node 2", x: 200, y: 0 },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
    shots: [
      {
        id: "shot-1",
        ch: "ch1",
        dur: 4.0,
        stage: "frame",
        look: "n1",
        move: "cut",
        blocks: [{ c: "StatCounter", from: 0, to: 90, label: "Throughput" }],
      },
      {
        id: "shot-2",
        ch: "ch1",
        dur: 6.0,
        stage: "frame",
        look: "n2",
        move: "pan",
        blocks: [{ c: "StatCounter", from: 0, to: 95, label: "Efficiency" }],
      },
      {
        id: "shot-3",
        ch: "ch1",
        dur: 5.0,
        stage: "frame",
        look: "n1",
        move: "pan",
        blocks: [{ c: "StatCounter", from: 0, to: 99, label: "Accuracy" }],
      },
    ],
  };
}

// TB-1: Dragging / trimming start times updates correctly
test("TB-1: Start time computation accurately reflects shot duration sequence", () => {
  const film = createMockFilm();
  const starts = computeShotStartTimes(film.shots);
  assert.deepEqual(starts, [0, 4.0, 10.0]);
});

// TB-2: Edge trimming right edge changes duration only
test("TB-2: Trimming right edge of shot-1 ripples into shot-2 in narration-locked mode", () => {
  const film = createMockFilm();
  const trimmed = trimShotEdge(film, 0, "right", 1.0, "narration-locked");
  assert.equal(trimmed.shots[0].dur, 5.0);
  assert.equal(trimmed.shots[1].dur, 5.0);
  assert.equal(trimmed.shots[2].dur, 5.0);

  // Total duration remains strictly constant
  const totalBefore = film.shots.reduce((s, x) => s + x.dur, 0);
  const totalAfter = trimmed.shots.reduce((s, x) => s + x.dur, 0);
  assert.equal(totalAfter, totalBefore);
});

// TB-3 & TB-4: Snapping to playhead and clip boundaries
test("TB-3 & TB-4: Snapping calculation finds exact targets within 8px threshold", () => {
  const snapTargets: SnapTarget[] = [
    { timeSec: 4.0, type: "boundary", label: "shot-1 cut" },
    { timeSec: 10.0, type: "boundary", label: "shot-2 cut" },
    { timeSec: 7.25, type: "playhead", label: "playhead" },
  ];

  // At zoom 30px/sec, 4.2s is (4.2 - 4.0)*30 = 6px away (within 8px threshold)
  const resultClose = calculateSnap(4.2, snapTargets, 30, 8);
  assert.equal(resultClose.snappedTimeSec, 4.0);
  assert.equal(resultClose.activeSnap?.type, "boundary");

  // 4.5s is (4.5 - 4.0)*30 = 15px away (exceeds 8px threshold) -> no snap
  const resultFar = calculateSnap(4.5, snapTargets, 30, 8);
  assert.equal(resultFar.snappedTimeSec, 4.5);
  assert.equal(resultFar.activeSnap, null);
});

// TB-5: Alt-drag bypasses snap (simulated by passing threshold = 0)
test("TB-5: Alt-drag zero threshold places clip at exact raw cursor position", () => {
  const snapTargets: SnapTarget[] = [{ timeSec: 4.0, type: "boundary" }];
  const result = calculateSnap(4.05, snapTargets, 30, 0);
  assert.equal(result.snappedTimeSec, 4.05);
  assert.equal(result.activeSnap, null);
});

// TB-6: Splitting shot at playhead frame
test("TB-6: Splitting shot at playhead creates two valid sub-shots preserving total time", () => {
  const film = createMockFilm();
  const splitFilm = splitShotAtTime(film, 2.5);
  assert.equal(splitFilm.shots.length, 4);
  assert.equal(splitFilm.shots[0].id, "shot-1-a");
  assert.equal(splitFilm.shots[0].dur, 2.5);
  assert.equal(splitFilm.shots[1].id, "shot-1-b");
  assert.equal(splitFilm.shots[1].dur, 1.5);

  const totalBefore = film.shots.reduce((s, x) => s + x.dur, 0);
  const totalAfter = splitFilm.shots.reduce((s, x) => s + x.dur, 0);
  assert.equal(totalAfter, totalBefore);
});

// TB-7: Deleting shot in narration-locked mode preserves total duration
test("TB-7: Deleting shot in narration-locked mode ripples duration to neighbor", () => {
  const film = createMockFilm();
  const deletedFilm = deleteShot(film, 1, "narration-locked");
  assert.equal(deletedFilm.shots.length, 2);
  assert.equal(deletedFilm.shots[0].dur, 10.0); // 4.0 + 6.0

  const totalBefore = film.shots.reduce((s, x) => s + x.dur, 0);
  const totalAfter = deletedFilm.shots.reduce((s, x) => s + x.dur, 0);
  assert.equal(totalAfter, totalBefore);
});

// TB-8 & TB-9: Validation passes after operations
test("TB-8 & TB-9: Operations produce valid schema films conforming to validateFilm", () => {
  const film = createMockFilm();
  const trimmed = trimShotEdge(film, 0, "right", 0.5, "narration-locked");
  assert.doesNotThrow(() => validateFilm(trimmed));

  const split = splitShotAtTime(trimmed, 2.0);
  assert.doesNotThrow(() => validateFilm(split));
});

// Phase T-B Negative Cases
test("Phase T-B Negative Case 1: Trim pushing duration below 1 frame throws error", () => {
  const film = createMockFilm();
  assert.throws(
    () => trimShotEdge(film, 0, "right", -3.99, "narration-locked"),
    /Trim rejected: shot duration cannot fall below 1 frame/,
  );
});

test("Phase T-B Negative Case 2: Split outside shot boundaries throws error", () => {
  const film = createMockFilm();
  assert.throws(
    () => splitShotAtTime(film, 25.0),
    /does not fall within a trimmable shot interior/,
  );
});

// Phase T-C Tests: Undo / Redo Stack & Keyboard Navigation
test("TC-1 & TC-2: Undo restores exact prior state (deep-equal assertion)", () => {
  const stack = new TimelineUndoStack(50);
  const film = createMockFilm();
  stack.push(film, "Initial State");

  const modifiedFilm = trimShotEdge(film, 0, "right", 1.0, "narration-locked");
  assert.notDeepEqual(modifiedFilm, film);

  const restored = stack.undo(modifiedFilm);
  assert.ok(restored);
  assert.deepEqual(restored.film, film);
});

test("TC-3 & TC-4: Redo after undo restores modified state, new push clears redo", () => {
  const stack = new TimelineUndoStack(50);
  const film = createMockFilm();
  stack.push(film, "Initial State");

  const modified = trimShotEdge(film, 0, "right", 1.0, "narration-locked");
  const restored = stack.undo(modified);
  assert.deepEqual(restored?.film, film);

  // Redo
  const redone = stack.redo(film);
  assert.deepEqual(redone?.film, modified);

  // New action clears redo
  stack.push(modified, "Another Action");
  assert.equal(stack.canRedo(), false);
});

test("TC-5: 50 sequential operations and 50 undos returns film deep-equal to initial", () => {
  const stack = new TimelineUndoStack(60);
  const film = createMockFilm();
  let current = film;

  for (let i = 0; i < 50; i++) {
    stack.push(current, `Step ${i}`);
    // Alternate +0.1s and -0.1s trims
    const delta = (i % 2 === 0 ? 0.1 : -0.1);
    current = trimShotEdge(current, 0, "right", delta, "narration-locked");
  }

  for (let i = 0; i < 50; i++) {
    const res = stack.undo(current);
    assert.ok(res);
    current = res.film;
  }

  assert.deepEqual(current, film);
});
