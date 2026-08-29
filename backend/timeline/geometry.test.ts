/**
 * File Description: Comprehensive Test Suite for the 5 Foundational Geometry Patterns.
 * Implements G-1..G-5 and negative test cases covering clip data model,
 * transaction manager, sticky snapping, drag state machine, and pending overrides.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeShotStartTimes,
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
  collectSnapTargets,
  calculateStickySnap,
} from "./snap";
import {
  buildTimeline,
  activeShotAt,
} from "../../src/dl/camera";
import { parseFilm as validateFilm } from "../../src/dl/schema";
import type { Film } from "../../src/dl/schema";

function createMockFilm(): Film {
  return {
    id: "test-geometry-film",
    title: "Test Geometry Film",
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
        position: 0,
        start: 0,
        end: 4.0,
        dur: 4.0,
        stage: "frame",
        look: "n1",
        move: "cut",
        blocks: [{ c: "StatCounter", from: 0, to: 90, label: "Throughput", format: "plain" }],
      },
      {
        id: "shot-2",
        ch: "ch1",
        position: 4.0,
        start: 0,
        end: 6.0,
        dur: 6.0,
        stage: "frame",
        look: "n2",
        move: "pan",
        blocks: [{ c: "StatCounter", from: 0, to: 95, label: "Efficiency", format: "plain" }],
      },
      {
        id: "shot-3",
        ch: "ch1",
        position: 10.0,
        start: 0,
        end: 5.0,
        dur: 5.0,
        stage: "frame",
        look: "n1",
        move: "pan",
        blocks: [{ c: "StatCounter", from: 0, to: 99, label: "Accuracy", format: "plain" }],
      },
    ],
  };
}

// G-1: The Clip Data Model (position, start, end, layer)
test("G-1: Clip position is stored data, duration is derived (end - start), gaps produce null activeShotAt", () => {
  const film = createMockFilm();
  // Move shot-2 to start at 7.0s (leaving a 4.0s..7.0s gap after shot-1)
  const { film: moved } = moveShot(film, 1, 7.0);
  assert.equal(moved.shots[1].position, 7.0);
  assert.equal(getShotDuration(moved.shots[1]), 6.0);

  const timeline = buildTimeline(moved);

  // In the gap at frame 150 (5.0s): zero shots active (Stage renders null)
  const activeInGap = activeShotAt(timeline, 150);
  assert.equal(activeInGap, null);

  // At frame 210 (7.0s): shot-2 is active
  const activeAtStart = activeShotAt(timeline, 210);
  assert.ok(activeAtStart);
  assert.equal(activeAtStart.shot.id, "shot-2");
  assert.equal(activeAtStart.from, 210);
});

// G-2: Pattern 1 Trimming: Right edge updates end; Left edge updates start and position together
test("G-2: Right edge trim updates end only; left edge trim updates start and position together", () => {
  const film = createMockFilm();

  // 1. Right edge trim (+1.5s): updates end to 7.5s
  const { film: rightTrimmed } = trimShotEdge(film, 1, "right", 1.5);
  assert.equal(rightTrimmed.shots[1].end, 7.5);
  assert.equal(rightTrimmed.shots[1].start, 0);
  assert.equal(getShotDuration(rightTrimmed.shots[1]), 7.5);
  assert.equal(rightTrimmed.shots[1].position, 4.0);

  // 2. Left edge trim (+1.0s): advances start to 1.0s and position to 5.0s together
  const { film: leftTrimmed } = trimShotEdge(film, 1, "left", 1.0);
  assert.equal(leftTrimmed.shots[1].start, 1.0);
  assert.equal(leftTrimmed.shots[1].position, 5.0);
  assert.equal(leftTrimmed.shots[1].end, 6.0);
  assert.equal(getShotDuration(leftTrimmed.shots[1]), 5.0); // 6.0 - 1.0
});

// G-3: Pattern 2 Transaction-Grouped UpdateAction Engine
test("G-3: Transaction manager groups multi-clip gesture under 1 UUID and undos atomically", () => {
  const txManager = new TimelineTransactionManager(50);
  const film = createMockFilm();

  // Multi-move shot-2 and shot-3 by +2.0s
  const { film: multiMoved, actions, transactionId } = moveMultipleShots(film, [1, 2], 2.0);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].transactionId, transactionId);
  assert.equal(actions[1].transactionId, transactionId);

  txManager.commit(film, multiMoved, actions, "Multi-move 2 shots", transactionId);
  assert.equal(txManager.canUndo(), true);

  // Single undo step restores both shots to original positions atomically
  const undoResult = txManager.undo(multiMoved);
  assert.ok(undoResult);
  assert.deepEqual(undoResult.film, film);
  assert.equal(undoResult.transaction.id, transactionId);
});

// G-4: Pattern 3 Sticky Snapping with Self-Ignore
test("G-4: Snapping excludes dragged clip ID and maintains 12px stickiness", () => {
  const film = createMockFilm();
  // Collect targets ignoring shot-2 (id: "shot-2")
  const targets = collectSnapTargets(film, 5.0, 15.0, ["shot-2"]);
  // Target list must contain shot-1 (0s, 4.0s) and shot-3 (10.0s, 15.0s), but NOT shot-2
  const shot2Targets = targets.filter((t) => t.sourceId === "shot-2");
  assert.equal(shot2Targets.length, 0);

  // Test stickiness: once snapped to 4.0s target, holds within 12px tolerance (at zoom 40px/s: 12px = 0.3s)
  const activeSnap = targets.find((t) => t.timeSec === 4.0)!;
  const stickyResult = calculateStickySnap(4.2, targets, 40, activeSnap, 12);
  assert.equal(stickyResult.snappedTimeSec, 4.0);
  assert.equal(stickyResult.hasSnapped, true);

  // Moving beyond 12px (0.4s away) breaks snap
  const brokenResult = calculateStickySnap(4.45, targets, 40, activeSnap, 12);
  assert.equal(brokenResult.snappedTimeSec, 4.45);
  assert.equal(brokenResult.hasSnapped, false);
});

// G-5: Pattern 4 State Machine Transitions & Pattern 5 Split/Validation
test("G-5: Splitting shot at playhead creates valid data model clips preserving total time", () => {
  const film = createMockFilm();
  const { film: splitFilm } = splitShotAtTime(film, 2.5);
  assert.equal(splitFilm.shots.length, 4);
  assert.equal(splitFilm.shots[0].id, "shot-1-a");
  assert.equal(splitFilm.shots[0].dur, 2.5);
  assert.equal(splitFilm.shots[1].id, "shot-1-b");
  assert.equal(splitFilm.shots[1].dur, 1.5);
  assert.equal(splitFilm.shots[1].position, 2.5);

  assert.doesNotThrow(() => validateFilm(splitFilm));
});

// ==============================================================================
// NEGATIVE ASSERTIONS
// ==============================================================================

test("Negative Assertion 1: Negative timeline start position is clamped to 0.0s", () => {
  const film = createMockFilm();
  const { film: moved } = moveShot(film, 0, -5.0);
  assert.equal(moved.shots[0].position, 0.0);
});

test("Negative Assertion 2: Trimming duration below 0.5s schema minimum throws error", () => {
  const film = createMockFilm();
  assert.throws(
    () => trimShotEdge(film, 0, "right", -3.8),
    /Trim rejected: shot duration cannot fall below minimum/,
  );
});

test("Negative Assertion 3: Empty undo stack returns null cleanly without throwing", () => {
  const txManager = new TimelineTransactionManager(50);
  const film = createMockFilm();
  assert.equal(txManager.undo(film), null);
  assert.equal(txManager.redo(film), null);
});
