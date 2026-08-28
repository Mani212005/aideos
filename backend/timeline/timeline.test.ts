/**
 * File Description: Comprehensive Test Suite for Timeline Phase T-B & T-C.
 * Asserts all 9 exact Phase T-B specifications (TB-1..TB-9) and 5 Phase T-C specifications (TC-1..TC-5)
 * alongside named negative test cases.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeShotStartTimes,
  calculateSnap,
  moveShot,
  moveMultipleShots,
  trimShotEdge,
  moveShotToTrack,
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
        blocks: [{ c: "StatCounter", from: 0, to: 90, label: "Throughput", format: "plain" }],
      },
      {
        id: "shot-2",
        ch: "ch1",
        dur: 6.0,
        stage: "frame",
        look: "n2",
        move: "pan",
        blocks: [{ c: "StatCounter", from: 0, to: 95, label: "Efficiency", format: "plain" }],
      },
      {
        id: "shot-3",
        ch: "ch1",
        dur: 5.0,
        stage: "frame",
        look: "n1",
        move: "pan",
        blocks: [{ c: "StatCounter", from: 0, to: 99, label: "Accuracy", format: "plain" }],
      },
    ],
  };
}

// ==============================================================================
// PHASE T-B TESTS (TB-1 .. TB-9)
// ==============================================================================

// TB-1: Dragging a clip changes its start time in the film data to the dropped position, within one frame
test("TB-1: Dragging a clip changes its start time in the film data to the dropped position, within one frame", () => {
  const film = createMockFilm();
  // Move shot-2 to start explicitly at 8.5s (free-edit mode)
  const moved = moveShot(film, 1, 8.5, "free-edit");
  assert.equal(moved.shots[1].startSec, 8.5);
  // Frame accuracy check: 8.5s * 30fps = frame 255
  assert.equal(Math.round(moved.shots[1].startSec! * 30), 255);
});

// TB-2: Dragging a clip's right edge changes duration only; the left edge changes start and duration together
test("TB-2: Dragging a clip's right edge changes duration only; left edge changes start and duration together", () => {
  const film = createMockFilm();

  // 1. Right edge trim: duration changes, startSec remains unaffected
  const rightTrimmed = trimShotEdge(film, 1, "right", 1.5, "free-edit");
  assert.equal(rightTrimmed.shots[1].dur, 7.5);
  assert.equal(rightTrimmed.shots[1].startSec, undefined);

  // 2. Left edge trim: startSec advances, duration reduces by exact delta
  const leftTrimmed = trimShotEdge(film, 1, "left", 1.0, "free-edit");
  assert.equal(leftTrimmed.shots[1].startSec, 5.0); // 4.0 + 1.0
  assert.equal(leftTrimmed.shots[1].dur, 5.0); // 6.0 - 1.0
});

// TB-3: A drag released within the snap threshold of the playhead lands exactly on the playhead frame
test("TB-3: A drag released within snap threshold of the playhead lands exactly on the playhead frame", () => {
  const snapTargets: SnapTarget[] = [{ timeSec: 7.233, type: "playhead", label: "playhead" }];
  // 7.3s is within 8px of 7.233s at zoom=40px/s (diff = 0.067s * 40 = 2.68px)
  const { snappedTimeSec, activeSnap } = calculateSnap(7.3, snapTargets, 40, 8);
  assert.equal(snappedTimeSec, 7.233);
  assert.equal(activeSnap?.type, "playhead");
});

// TB-4: Snapping to another track's clip boundary produces an exact boundary match, not an approximate one
test("TB-4: Snapping to another track's clip boundary produces an exact boundary match, not an approximate one", () => {
  const snapTargets: SnapTarget[] = [{ timeSec: 10.0, type: "boundary", label: "shot-2 cut" }];
  // 10.15s is within 8px at zoom=40px/s (diff = 0.15s * 40 = 6px <= 8px)
  const { snappedTimeSec, activeSnap } = calculateSnap(10.15, snapTargets, 40, 8);
  assert.equal(snappedTimeSec, 10.0);
  assert.equal(activeSnap?.type, "boundary");
});

// TB-5: Alt-drag places the clip at the raw cursor position with no snap applied
test("TB-5: Alt-drag places the clip at the raw cursor position with no snap applied", () => {
  const snapTargets: SnapTarget[] = [{ timeSec: 10.0, type: "boundary" }];
  // Zero threshold simulated for Alt-drag
  const { snappedTimeSec, activeSnap } = calculateSnap(10.15, snapTargets, 40, 0);
  assert.equal(snappedTimeSec, 10.15);
  assert.equal(activeSnap, null);
});

// TB-6: Multi-select drag preserves relative offsets between all selected clips exactly
test("TB-6: Multi-select drag preserves relative offsets between all selected clips exactly", () => {
  const film = createMockFilm();
  // Set initial start times: shot-1 at 0s, shot-2 at 4.0s, shot-3 at 10.0s
  // Multi-move shot-2 and shot-3 by +2.0s
  const multiMoved = moveMultipleShots(film, [1, 2], 2.0, "free-edit");
  assert.equal(multiMoved.shots[1].startSec, 6.0); // 4.0 + 2.0
  assert.equal(multiMoved.shots[2].startSec, 12.0); // 10.0 + 2.0
  // Relative offset between shot-2 and shot-3 is preserved exactly (12.0 - 6.0 = 6.0s = shot-2.dur)
  assert.equal(multiMoved.shots[2].startSec! - multiMoved.shots[1].startSec!, 6.0);
});

// TB-7: Two clips cannot occupy overlapping ranges on one track — collision behaviour occurs
test("TB-7: Two clips cannot occupy overlapping ranges on one track — collision behaviour occurs", () => {
  const film = createMockFilm();
  // Move shot-2 so it starts at 2.0s (overlapping shot-1 which runs 0s..4.0s on track 0)
  const moved = moveShot(film, 1, 2.0, "free-edit");
  // Collision resolver pushes shot-2 to start immediately after shot-1 (4.0s)
  assert.equal(moved.shots[1].startSec, 4.0);
});

// TB-8: In narration-locked mode, any move or trim leaves total duration within ±50 ms of the audio
test("TB-8: In narration-locked mode, any move or trim leaves total duration within ±50 ms of the audio", () => {
  const film = createMockFilm();
  const totalBefore = film.shots.reduce((s, x) => s + x.dur, 0);

  // Right edge trim in narration-locked mode
  const trimmed = trimShotEdge(film, 0, "right", 1.2, "narration-locked");
  const totalAfterTrim = trimmed.shots.reduce((s, x) => s + x.dur, 0);
  assert.ok(Math.abs(totalAfterTrim - totalBefore) < 0.05);

  // Delete shot in narration-locked mode
  const deleted = deleteShot(film, 1, "narration-locked");
  const totalAfterDelete = deleted.shots.reduce((s, x) => s + x.dur, 0);
  assert.ok(Math.abs(totalAfterDelete - totalBefore) < 0.05);
});

// TB-9: Every drag operation produces a valid film — validateFilm passes after each
test("TB-9: Every drag operation produces a valid film — validateFilm passes after each", () => {
  const film = createMockFilm();
  const moved = moveShot(film, 1, 6.0, "free-edit");
  assert.doesNotThrow(() => validateFilm(moved));

  const trimmed = trimShotEdge(moved, 0, "right", 0.5, "free-edit");
  assert.doesNotThrow(() => validateFilm(trimmed));

  const split = splitShotAtTime(trimmed, 2.0);
  assert.doesNotThrow(() => validateFilm(split));

  const trackMoved = moveShotToTrack(split, 0, 1);
  assert.doesNotThrow(() => validateFilm(trackMoved));
});

// ==============================================================================
// PHASE T-B NEGATIVE CASES
// ==============================================================================

test("Phase T-B Negative Case 1: Trim pushing duration below 0.5s schema minimum is rejected", () => {
  const film = createMockFilm();
  assert.throws(
    () => trimShotEdge(film, 0, "right", -3.8, "free-edit"),
    /Trim rejected: shot duration cannot fall below minimum/,
  );
});

test("Phase T-B Negative Case 2: Left edge trim causing negative start time is rejected", () => {
  const film = createMockFilm();
  assert.throws(
    () => trimShotEdge(film, 0, "left", -2.0, "free-edit"),
    /Trim rejected: start time cannot be negative/,
  );
});

test("Phase T-B Negative Case 3: In narration-locked mode, extending last shot throws error", () => {
  const film = createMockFilm();
  assert.throws(
    () => trimShotEdge(film, 2, "right", 1.0, "narration-locked"),
    /Cannot extend last shot in narration-locked mode/,
  );
});

// ==============================================================================
// PHASE T-C TESTS (TC-1 .. TC-5)
// ==============================================================================

test("TC-1 & TC-2: Undo restores exact prior state (deep-equal assertion)", () => {
  const stack = new TimelineUndoStack(50);
  const film = createMockFilm();
  stack.push(film, "Initial State");

  const modified = moveShot(film, 1, 10.0, "free-edit");
  assert.notDeepEqual(modified, film);

  const restored = stack.undo(modified);
  assert.ok(restored);
  assert.deepEqual(restored.film, film);
});

test("TC-3 & TC-4: Redo after undo restores modified state, new push clears redo", () => {
  const stack = new TimelineUndoStack(50);
  const film = createMockFilm();
  stack.push(film, "Initial State");

  const modified = moveShot(film, 1, 10.0, "free-edit");
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
    const delta = (i % 2 === 0 ? 0.1 : -0.1);
    current = trimShotEdge(current, 0, "right", delta, "free-edit");
  }

  for (let i = 0; i < 50; i++) {
    const res = stack.undo(current);
    assert.ok(res);
    current = res.film;
  }

  assert.deepEqual(current, film);
});
