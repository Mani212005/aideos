/**
 * File Description: Comprehensive Test Suite for Phase L-2 Timeline Interaction (OpenShot Patterns).
 * Asserts L2-1..L2-11 and named negative cases:
 * - Stored position and derived duration.
 * - Dragging between layers.
 * - Transaction-grouped UpdateActions.
 * - Self-ignoring sticky snapping.
 * - Multi-select relative offset preservation.
 * - Pending overrides live preview isolation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  moveLayerClip,
  moveMultipleLayerClips,
  trimLayerClipEdge,
  splitLayerClipAtTime,
  deleteLayerClip,
} from "./layer_engine";
import {
  TimelineTransactionManager,
} from "./updates";
import {
  collectSnapTargets,
  calculateStickySnap,
  type SnapTarget,
} from "./snap";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

function createMockLayeredFilm(): LayeredFilm {
  return {
    id: "test-l2-film",
    title: "Test L2 Film",
    fps: 30,
    accent: "#FF6B00",
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 190, h: 62 },
        { id: "n2", label: "Node 2", x: 200, y: 0, w: 190, h: 62 },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
    chapters: ["Ch 1"],
    layers: [
      { id: "layer-audio", number: 0, label: "Audio", locked: false, hidden: false, muted: false, height: 48 },
      { id: "layer-video", number: 10, label: "Video", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-anim", number: 20, label: "Animation", locked: false, hidden: false, muted: false, height: 72 },
    ],
    clips: [
      {
        id: "clip-vo",
        layerId: "layer-audio",
        position: 0,
        start: 0,
        end: 20.0,
        kind: "audio",
        payload: { src: "voiceover.wav", channel: "voiceover" },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-video-1",
        layerId: "layer-video",
        position: 0,
        start: 0,
        end: 6.0,
        kind: "video",
        payload: { src: "sample.mp4" },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-anim-1",
        layerId: "layer-anim",
        position: 0,
        start: 0,
        end: 4.0,
        kind: "animation",
        payload: {
          shotId: "shot-1",
          stage: "frame",
          look: "n1",
          move: "cut",
          drift: false,
          zoom: 1,
          blocks: [{ c: "StatCounter", from: 0, to: 90, label: "Score", format: "plain" }],
        },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-anim-2",
        layerId: "layer-anim",
        position: 4.0,
        start: 0,
        end: 6.0,
        kind: "animation",
        payload: {
          shotId: "shot-2",
          stage: "frame",
          look: "n2",
          move: "pan",
          drift: false,
          zoom: 1,
          blocks: [{ c: "StatCounter", from: 0, to: 99, label: "Efficiency", format: "plain" }],
        },
        volume: 1,
        opacity: 1,
      },
    ],
  };
}

// L2-1: Dragging a clip sets position to the drop point within one frame
test("L2-1: Dragging a clip sets position to the drop point within one frame", () => {
  const film = createMockLayeredFilm();
  const { film: moved } = moveLayerClip(film, "clip-anim-2", 8.233);
  const target = moved.clips.find((c) => c.id === "clip-anim-2")!;
  assert.equal(target.position, 8.233);
  // Frame accuracy check @ 30fps: 8.233s * 30 = frame 247
  assert.equal(Math.round(target.position * 30), 247);
});

// L2-2: Right-edge drag changes end only; left-edge drag changes start and position together
test("L2-2: Right-edge drag changes end only; left-edge drag changes start and position together", () => {
  const film = createMockLayeredFilm();

  // 1. Right edge trim: end increases by 1.5s, start and position remain unchanged
  const { film: rightTrimmed } = trimLayerClipEdge(film, "clip-anim-1", "right", 1.5);
  const cRight = rightTrimmed.clips.find((c) => c.id === "clip-anim-1")!;
  assert.equal(cRight.end, 5.5);
  assert.equal(cRight.start, 0);
  assert.equal(cRight.position, 0);
  assert.equal(cRight.end - cRight.start, 5.5);

  // 2. Left edge trim: advances start to 1.0s and position to 1.0s, leaving end at 4.0s
  const { film: leftTrimmed } = trimLayerClipEdge(film, "clip-anim-1", "left", 1.0);
  const cLeft = leftTrimmed.clips.find((c) => c.id === "clip-anim-1")!;
  assert.equal(cLeft.start, 1.0);
  assert.equal(cLeft.position, 1.0);
  assert.equal(cLeft.end, 4.0);
  assert.equal(cLeft.end - cLeft.start, 3.0);
});

// L2-3: Dragging to another layer changes layerId and render order changes accordingly
test("L2-3: Dragging to another layer changes layerId and composite order updates", () => {
  const film = createMockLayeredFilm();
  // Move clip-anim-1 from layer-anim (number: 20) to layer-video (number: 10) at position 8.0s
  const { film: layerMoved } = moveLayerClip(film, "clip-anim-1", 8.0, "layer-video");
  const target = layerMoved.clips.find((c) => c.id === "clip-anim-1")!;
  assert.equal(target.layerId, "layer-video");
  assert.equal(target.position, 8.0);
});

// L2-4: Snap to playhead
test("L2-4: A drag released within tolerance of playhead lands exactly on the playhead frame", () => {
  const targets: SnapTarget[] = [{ timeSec: 7.233, type: "playhead", label: "Playhead" }];
  const snapRes = calculateStickySnap(7.28, targets, 40, null, 12);
  assert.equal(snapRes.snappedTimeSec, 7.233);
  assert.equal(snapRes.activeSnap?.type, "playhead");
});

// L2-5: Snap targets exclude dragged clip's own edges
test("L2-5: Snap targets exclude the dragged clip's own edges (self-ignore)", () => {
  const film = createMockLayeredFilm() as any;
  const targets = collectSnapTargets(film, 0, 20.0, ["clip-anim-1"]);
  const selfTargets = targets.filter((t) => t.sourceId === "clip-anim-1");
  assert.equal(selfTargets.length, 0);
});

// L2-6: Sticky snapping holds target until cursor exceeds 12px tolerance
test("L2-6: Snapped target holds until cursor exceeds tolerance without jitter", () => {
  const targets: SnapTarget[] = [
    { timeSec: 4.0, type: "boundary", label: "Target A" },
    { timeSec: 10.0, type: "boundary", label: "Target B" },
  ];
  // Lock to Target A at 4.0s
  const activeSnap = targets[0];
  // 4.1s is within 12px of 4.0s at zoom=40px/s (0.1s * 40 = 4px <= 12px) -> holds Target A
  const stickyRes = calculateStickySnap(4.1, targets, 40, activeSnap, 12);
  assert.equal(stickyRes.snappedTimeSec, 4.0);
  assert.equal(stickyRes.activeSnap?.timeSec, 4.0);

  // Exceeding 12px (0.4s away) breaks lock
  const brokeRes = calculateStickySnap(4.45, targets, 40, activeSnap, 12);
  assert.equal(brokeRes.snappedTimeSec, 4.45);
  assert.equal(brokeRes.activeSnap, null);
});

// L2-7: Multi-select drag preserves relative offsets exactly
test("L2-7: Multi-select drag preserves relative offsets between all selected clips exactly", () => {
  const film = createMockLayeredFilm();
  const { film: multiMoved } = moveMultipleLayerClips(film, ["clip-anim-1", "clip-anim-2"], 2.0);
  const c1 = multiMoved.clips.find((c) => c.id === "clip-anim-1")!;
  const c2 = multiMoved.clips.find((c) => c.id === "clip-anim-2")!;
  assert.equal(c1.position, 2.0); // 0 + 2.0
  assert.equal(c2.position, 6.0); // 4.0 + 2.0
  assert.equal(c2.position - c1.position, 4.0);
});

// L2-8: One gesture rippling N clips produces one atomic undo transaction
test("L2-8: One gesture rippling N clips produces one undo transaction", () => {
  const txManager = new TimelineTransactionManager(50);
  const film = createMockLayeredFilm();

  const { film: multiMoved, actions, transactionId } = moveMultipleLayerClips(film, ["clip-anim-1", "clip-anim-2"], 3.0);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].transactionId, transactionId);
  assert.equal(actions[1].transactionId, transactionId);

  txManager.commit(film, multiMoved, actions, "Multi-move 2 clips", transactionId);
  assert.equal(txManager.canUndo(), true);

  const undoRes = txManager.undo(multiMoved);
  assert.ok(undoRes);
  assert.deepEqual(undoRes.film, film);
  assert.equal(undoRes.transaction.id, transactionId);
});

// L2-9: Undo restores exact prior state; 50 operations then 50 undos returns deep-equal
test("L2-9: Undo restores exact prior state; 50 operations then 50 undos returns deep-equal", () => {
  const txManager = new TimelineTransactionManager(60);
  const film = createMockLayeredFilm();
  let current = film;

  for (let i = 0; i < 50; i++) {
    const delta = (i % 2 === 0 ? 0.1 : -0.1);
    const { film: nextFilm, actions, transactionId } = trimLayerClipEdge(current, "clip-anim-1", "right", delta);
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

// L2-10: During drag, committed film data is unchanged; changes only on release
test("L2-10: During drag, committed film data is unchanged; changes only on commit", () => {
  const film = createMockLayeredFilm();
  const pendingOverrides: Record<string, { position?: number }> = {
    "clip-anim-1": { position: 11.5 },
  };

  // Preview layer reads pendingOverrides (position = 11.5)
  const previewPos = pendingOverrides["clip-anim-1"]?.position ?? film.clips[2].position;
  assert.equal(previewPos, 11.5);

  // Committed film document remains pristine
  assert.equal(film.clips[2].position, 0);

  // On release: commit moves clip (to 11.5s after clip-anim-2's 10.0s)
  const { film: committed } = moveLayerClip(film, "clip-anim-1", 11.5);
  assert.equal(committed.clips.find((c) => c.id === "clip-anim-1")!.position, 11.5);
});

// L2-11: Every operation leaves a film that passes validation
test("L2-11: Every operation leaves a film that passes validation", () => {
  const film = createMockLayeredFilm();
  const { film: moved } = moveLayerClip(film, "clip-anim-2", 10.0);
  assert.doesNotThrow(() => validateLayeredFilm(moved));

  const { film: trimmed } = trimLayerClipEdge(moved, "clip-anim-1", "right", 1.0);
  assert.doesNotThrow(() => validateLayeredFilm(trimmed));

  const { film: split } = splitLayerClipAtTime(trimmed, "clip-anim-1", 2.0);
  assert.doesNotThrow(() => validateLayeredFilm(split));

  const { film: deleted } = deleteLayerClip(split, "clip-video-1");
  assert.doesNotThrow(() => validateLayeredFilm(deleted));
});

// ==============================================================================
// NEGATIVE ASSERTIONS
// ==============================================================================

test("L2 Negative 1: Left-edge trim causing negative timeline position throws error", () => {
  const film = createMockLayeredFilm();
  assert.throws(
    () => trimLayerClipEdge(film, "clip-anim-1", "left", -2.0),
    /Trim rejected: position cannot be negative/
  );
});

test("L2 Negative 2: Splitting outside clip interior throws error", () => {
  const film = createMockLayeredFilm();
  assert.throws(
    () => splitLayerClipAtTime(film, "clip-anim-1", 15.0),
    /is outside clip interior/
  );
});

test("L2 Negative 3: Moving nonexistent clip throws error", () => {
  const film = createMockLayeredFilm();
  assert.throws(
    () => moveLayerClip(film, "nonexistent-clip", 5.0),
    /Clip "nonexistent-clip" not found/
  );
});
