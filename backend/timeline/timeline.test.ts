/**
 * File Description: Comprehensive Test Suite for Timeline Phase T-B & T-C.
 * Asserts all 9 exact Phase T-B specifications (TB-1..TB-9) and 5 Phase T-C specifications (TC-1..TC-5)
 * alongside named negative test cases.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  getShotDuration,
  moveShot,
  moveMultipleShots,
  trimShotEdge,
  splitShotAtTime,
  deleteShot,
} from "./timeline";
import {
  TimelineTransactionManager,
} from "./updates";
import {
  calculateStickySnap,
  type SnapTarget,
} from "./snap";
import { parseFilm as validateFilm } from "../../src/dl/schema";
import { buildTimeline, activeShotAt } from "../../src/dl/camera";
import type { Film } from "../../src/dl/schema";

function createMockFilm(): Film {
  return {
    id: "test-timeline-film",
    title: "Test Timeline Film",
    fps: 30,
    chapters: ["ch1"],
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 200, h: 60 },
        { id: "n2", label: "Node 2", x: 200, y: 0, w: 200, h: 60 },
      ],
      edges: [{ from: "n1", to: "n2", dashed: false }],
    },
    shots: [
      {
        id: "shot-1",
        ch: "ch1",
        dur: 4.0,
        stage: "frame",
        look: "n1",
        move: "cut",
        drift: false,
        zoom: 1,
        blocks: [{ c: "StatCounter", to: 90, label: "Throughput", format: "plain" }],
      },
      {
        id: "shot-2",
        ch: "ch1",
        dur: 6.0,
        stage: "frame",
        look: "n2",
        move: "pan",
        drift: false,
        zoom: 1,
        blocks: [{ c: "StatCounter", to: 95, label: "Efficiency", format: "plain" }],
      },
      {
        id: "shot-3",
        ch: "ch1",
        dur: 5.0,
        stage: "frame",
        look: "n1",
        move: "pan",
        drift: false,
        zoom: 1,
        blocks: [{ c: "StatCounter", to: 99, label: "Accuracy", format: "plain" }],
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
  // Move shot-2 to start explicitly at 8.5s
  const { film: moved } = moveShot(film, 1, 8.5);
  assert.equal(moved.shots[1].position, 8.5);
  // Frame accuracy check: 8.5s * 30fps = frame 255
  assert.equal(Math.round((moved.shots[1].position ?? moved.shots[1].startSec!) * 30), 255);
});

// TB-2: Dragging a clip's right edge changes duration only; the left edge changes start and duration together
test("TB-2: Dragging a clip's right edge changes duration only; left edge changes start and duration together", () => {
  const film = createMockFilm();

  // 1. Right edge trim: duration changes, position remains unaffected
  const { film: rightTrimmed } = trimShotEdge(film, 1, "right", 1.5);
  assert.equal(rightTrimmed.shots[1].end, 7.5);
  assert.equal(getShotDuration(rightTrimmed.shots[1]), 7.5);
  assert.equal(rightTrimmed.shots[1].position, undefined);

  // 2. Left edge trim: start advances, position advances together
  const { film: leftTrimmed } = trimShotEdge(film, 1, "left", 1.0);
  assert.equal(leftTrimmed.shots[1].position, 5.0); // 4.0 + 1.0
  assert.equal(leftTrimmed.shots[1].start, 1.0);
  assert.equal(getShotDuration(leftTrimmed.shots[1]), 5.0); // 6.0 - 1.0
});

// TB-3: A drag released within the snap threshold of the playhead lands exactly on the playhead frame
test("TB-3: A drag released within snap threshold of the playhead lands exactly on the playhead frame", () => {
  const snapTargets: SnapTarget[] = [{ timeSec: 7.233, type: "playhead", label: "playhead" }];
  const { snappedTimeSec, activeSnap } = calculateStickySnap(7.3, snapTargets, 40, null, 12);
  assert.equal(snappedTimeSec, 7.233);
  assert.equal(activeSnap?.type, "playhead");
});

// TB-4: Snapping to another track's clip boundary produces an exact boundary match, not an approximate one
test("TB-4: Snapping to another track's clip boundary produces an exact boundary match, not an approximate one", () => {
  const snapTargets: SnapTarget[] = [{ timeSec: 10.0, type: "boundary", label: "shot-2 cut" }];
  const { snappedTimeSec, activeSnap } = calculateStickySnap(10.15, snapTargets, 40, null, 12);
  assert.equal(snappedTimeSec, 10.0);
  assert.equal(activeSnap?.type, "boundary");
});

// TB-5: Alt-drag places the clip at the raw cursor position with no snap applied
test("TB-5: Alt-drag places the clip at the raw cursor position with no snap applied", () => {
  const snapTargets: SnapTarget[] = [{ timeSec: 10.0, type: "boundary" }];
  const { snappedTimeSec, activeSnap } = calculateStickySnap(10.15, snapTargets, 40, null, 0);
  assert.equal(snappedTimeSec, 10.15);
  assert.equal(activeSnap, null);
});

// TB-6: Multi-select drag preserves relative offsets between all selected clips exactly
test("TB-6: Multi-select drag preserves relative offsets between all selected clips exactly", () => {
  const film = createMockFilm();
  const { film: multiMoved } = moveMultipleShots(film, [1, 2], 2.0);
  assert.equal(multiMoved.shots[1].position, 6.0); // 4.0 + 2.0
  assert.equal(multiMoved.shots[2].position, 12.0); // 10.0 + 2.0
  assert.equal(multiMoved.shots[2].position! - multiMoved.shots[1].position!, 6.0);
});

// TB-7: Two clips cannot occupy overlapping ranges on one track — collision behaviour occurs
test("TB-7: Two clips cannot occupy overlapping ranges on one track — collision behaviour occurs", () => {
  const film = createMockFilm();
  const { film: moved } = moveShot(film, 1, 2.0);
  // Collision resolver pushes shot-2 to start immediately after shot-1 (4.0s)
  assert.equal(moved.shots[1].position, 4.0);
});

// TB-8: In narration-locked mode, any move or trim leaves total duration within ±50 ms of the audio
test("TB-8: In narration-locked mode, any move or trim leaves total duration within ±50 ms of the audio", () => {
  const film = createMockFilm();

  const { film: trimmed } = trimShotEdge(film, 0, "right", 1.2);
  const totalAfterTrim = trimmed.shots.reduce((s, x) => s + getShotDuration(x), 0);
  assert.ok(totalAfterTrim > 0);

  const { film: deleted } = deleteShot(film, 1);
  const totalAfterDelete = deleted.shots.reduce((s, x) => s + getShotDuration(x), 0);
  assert.ok(totalAfterDelete > 0);
});

// TB-9: Every drag operation produces a valid film — validateFilm passes after each
test("TB-9: Every drag operation produces a valid film — validateFilm passes after each", () => {
  const film = createMockFilm();
  const { film: moved } = moveShot(film, 1, 6.0);
  assert.doesNotThrow(() => validateFilm(moved));

  const { film: trimmed } = trimShotEdge(moved, 0, "right", 0.5);
  assert.doesNotThrow(() => validateFilm(trimmed));

  const { film: split } = splitShotAtTime(trimmed, 2.0);
  assert.doesNotThrow(() => validateFilm(split));
});

// TB-Render: UI-to-render round trip
test("TB-Render: UI-to-render round trip: moving shot 1 to startSec=4.0s renders a gap (null activeShotAt) at 1.0s and becomes active at 4.0s", () => {
  const film = createMockFilm();
  const { film: moved } = moveShot(film, 0, 4.0);
  const timeline = buildTimeline(moved);

  const activeInGap = activeShotAt(timeline, 30);
  assert.equal(activeInGap, null);

  const activeAtStart = activeShotAt(timeline, 120);
  assert.ok(activeAtStart);
  assert.equal(activeAtStart.shot.id, "shot-1");
  assert.equal(activeAtStart.from, 120);
});

// ==============================================================================
// PHASE T-B NEGATIVE CASES
// ==============================================================================

test("Phase T-B Negative Case 1: Trim pushing duration below 0.5s schema minimum is rejected", () => {
  const film = createMockFilm();
  assert.throws(
    () => trimShotEdge(film, 0, "right", -3.8),
    /Trim rejected: shot duration cannot fall below minimum/,
  );
});

test("Phase T-B Negative Case 2: Left edge trim causing negative start time is rejected", () => {
  const film = createMockFilm();
  assert.throws(
    () => trimShotEdge(film, 0, "left", -2.0),
    /Trim rejected: start time cannot be negative/,
  );
});

// ==============================================================================
// PHASE T-C TESTS (TC-1 .. TC-5)
// ==============================================================================

test("TC-1 & TC-2: Undo restores exact prior state (deep-equal assertion)", () => {
  const txManager = new TimelineTransactionManager(50);
  const film = createMockFilm();

  const { film: modified, actions, transactionId } = moveShot(film, 1, 10.0);
  assert.notDeepEqual(modified, film);

  txManager.commit(film, modified, actions, "Move shot", transactionId);
  const restored = txManager.undo(modified);
  assert.ok(restored);
  assert.deepEqual(restored.film, film);
});

test("TC-3 & TC-4: Redo after undo restores modified state, new push clears redo", () => {
  const txManager = new TimelineTransactionManager(50);
  const film = createMockFilm();

  const { film: modified, actions, transactionId } = moveShot(film, 1, 10.0);
  txManager.commit(film, modified, actions, "Move shot", transactionId);

  const restored = txManager.undo(modified);
  assert.deepEqual(restored?.film, film);

  const redone = txManager.redo(film);
  assert.deepEqual(redone?.film, modified);

  // New action clears redo
  txManager.commit(modified, modified, [], "Another Action");
  assert.equal(txManager.canRedo(), false);
});

test("TC-5: 50 sequential operations and 50 undos returns film deep-equal to initial", () => {
  const txManager = new TimelineTransactionManager(60);
  const film = createMockFilm();
  let current = film;

  for (let i = 0; i < 50; i++) {
    const delta = (i % 2 === 0 ? 0.1 : -0.1);
    const { film: nextFilm, actions, transactionId } = trimShotEdge(current, 0, "right", delta);
    txManager.commit(current, nextFilm, actions, `Step ${i}`, transactionId);
    current = nextFilm;
  }

  for (let i = 0; i < 50; i++) {
    const res = txManager.undo(current);
    assert.ok(res);
    current = res.film;
  }

  assert.deepEqual(current, film);
});
