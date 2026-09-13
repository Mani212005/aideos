/**
 * File Description: Regression suite for the pure pointer-drag state machine.
 * Covers every transition the timeline relies on: the click versus drag threshold, moving a clip
 * with a preserved grab offset, dragging across lanes, trimming either edge, scrubbing, marquee
 * selection, snap bypass, Escape restoring the exact prior geometry, and the guarantee that a
 * gesture always returns to idle no matter how it ends.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  IDLE_DRAG,
  DRAG_THRESHOLD_PX,
  beginDrag,
  updateDrag,
  cancelDrag,
  endDrag,
  autoScrollVelocity,
  type DragClipGeometry,
} from "./drag_machine";
import type { SnapTarget } from "./snap";

/** Build a clip geometry fixture positioned at `position` with a four second duration. */
function clipAt(id: string, position: number, layerId = "layer-a"): DragClipGeometry {
  return { id, layerId, position, start: 0, end: 4 };
}

test("Drag: a press that never passes the threshold is a click, not an edit", () => {
  const clip = clipAt("c1", 10);
  let state = beginDrag({ mode: "move", pointerX: 100, pointerY: 40, timeSec: 11, clip });
  assert.equal(state.hasMoved, false);

  state = updateDrag(state, { pointerX: 100 + DRAG_THRESHOLD_PX - 1, pointerY: 40, timeSec: 11.02 });
  assert.equal(state.hasMoved, false);

  const { commit } = endDrag(state);
  assert.ok(commit);
  assert.equal(commit!.hasMoved, false, "the caller must select rather than move");
});

test("Drag: moving preserves the grab offset so the clip does not jump under the cursor", () => {
  const clip = clipAt("c1", 10);
  // Grab 1.5s into the clip, then move the pointer to 20s.
  let state = beginDrag({ mode: "move", pointerX: 100, pointerY: 40, timeSec: 11.5, clip });
  assert.equal(state.grabOffsetSec, 1.5);

  state = updateDrag(state, { pointerX: 400, pointerY: 40, timeSec: 20 });
  assert.equal(state.hasMoved, true);
  assert.equal(state.candidateSec, 18.5, "candidate is the pointer time minus the grab offset");
  assert.equal(state.deltaSec, 8.5);
});

test("Drag: a candidate position can never go negative", () => {
  const clip = clipAt("c1", 2);
  let state = beginDrag({ mode: "move", pointerX: 100, pointerY: 40, timeSec: 3, clip });
  state = updateDrag(state, { pointerX: 0, pointerY: 40, timeSec: -5 });
  assert.equal(state.candidateSec, 0);
});

test("Drag: moving across lanes records the lane under the pointer as the drop target", () => {
  const clip = clipAt("c1", 10, "layer-a");
  let state = beginDrag({ mode: "move", pointerX: 100, pointerY: 40, timeSec: 10, clip });
  assert.equal(state.targetLayerId, "layer-a");

  state = updateDrag(state, { pointerX: 140, pointerY: 120, timeSec: 11, layerId: "layer-b" });
  assert.equal(state.targetLayerId, "layer-b");
  assert.equal(state.originLayerId, "layer-a");

  const { commit } = endDrag(state);
  assert.equal(commit!.targetLayerId, "layer-b");
  assert.equal(commit!.originLayerId, "layer-a");
});

test("Drag: a multi-clip gesture carries every selected clip and its origin geometry", () => {
  const selection = [clipAt("c1", 10), clipAt("c2", 20), clipAt("c3", 30)];
  const state = beginDrag({
    mode: "move",
    pointerX: 100,
    pointerY: 40,
    timeSec: 10,
    clip: selection[0],
    selection,
  });

  assert.deepEqual(state.clipIds, ["c1", "c2", "c3"]);
  assert.equal(state.originById["c2"].position, 20);
  assert.equal(state.originById["c3"].position, 30);
});

test("Drag: snapping replaces the raw candidate and reports what was snapped to", () => {
  const clip = clipAt("c1", 10);
  const target: SnapTarget = { timeSec: 18, type: "boundary", sourceId: "c9", label: "c9 cut" };

  let state = beginDrag({ mode: "move", pointerX: 100, pointerY: 40, timeSec: 10, clip });
  state = updateDrag(state, {
    pointerX: 400,
    pointerY: 40,
    timeSec: 18.14,
    snapped: { timeSec: 18, target },
  });

  assert.equal(state.candidateSec, 18);
  assert.equal(state.snapTarget?.sourceId, "c9");
});

test("Drag: holding the bypass modifier drops the snap and keeps the raw candidate", () => {
  const clip = clipAt("c1", 10);
  let state = beginDrag({ mode: "move", pointerX: 100, pointerY: 40, timeSec: 10, clip });
  state = updateDrag(state, { pointerX: 400, pointerY: 40, timeSec: 18.14, snapEnabled: false });

  assert.equal(state.snapEnabled, false);
  assert.equal(state.snapTarget, null);
  assert.equal(state.candidateSec, 18.14);
});

test("Drag: trimming the start edge tracks the pointer time directly", () => {
  const clip = clipAt("c1", 10);
  let state = beginDrag({ mode: "trim-start", pointerX: 100, pointerY: 40, timeSec: 10, clip });
  assert.equal(state.candidateSec, 10);

  state = updateDrag(state, { pointerX: 130, pointerY: 40, timeSec: 11.25 });
  assert.equal(state.candidateSec, 11.25);
  assert.equal(state.deltaSec, 1.25, "delta is measured against the original start edge");
});

test("Drag: trimming the end edge measures its delta against the original out point", () => {
  const clip = clipAt("c1", 10); // 10s..14s
  let state = beginDrag({ mode: "trim-end", pointerX: 300, pointerY: 40, timeSec: 14, clip });
  assert.equal(state.candidateSec, 14);

  state = updateDrag(state, { pointerX: 340, pointerY: 40, timeSec: 15.5 });
  assert.equal(state.deltaSec, 1.5);
});

test("Drag: scrubbing produces a clamped playhead candidate", () => {
  let state = beginDrag({ mode: "scrub", pointerX: 100, pointerY: 10, timeSec: 4 });
  state = updateDrag(state, { pointerX: 40, pointerY: 10, timeSec: -2 });
  assert.equal(state.candidateSec, 0);

  state = updateDrag(state, { pointerX: 500, pointerY: 10, timeSec: 22.5 });
  assert.equal(state.candidateSec, 22.5);
});

test("Drag: a marquee tracks a rectangle anchored at the press point", () => {
  let state = beginDrag({ mode: "marquee", pointerX: 50, pointerY: 60, timeSec: 2 });
  state = updateDrag(state, { pointerX: 220, pointerY: 180, timeSec: 9 });

  assert.deepEqual(state.marquee, { x1: 50, y1: 60, x2: 220, y2: 180 });
  const { commit } = endDrag(state);
  assert.deepEqual(commit!.marquee, { x1: 50, y1: 60, x2: 220, y2: 180 });
});

test("Drag: cancelling returns to idle and hands back the exact origin geometry", () => {
  const selection = [clipAt("c1", 10), clipAt("c2", 20)];
  let state = beginDrag({
    mode: "move",
    pointerX: 100,
    pointerY: 40,
    timeSec: 10,
    clip: selection[0],
    selection,
  });
  state = updateDrag(state, { pointerX: 600, pointerY: 200, timeSec: 44, layerId: "layer-z" });

  const { next, restored } = cancelDrag(state);
  assert.deepEqual(next, IDLE_DRAG, "a cancelled gesture must leave no residue");
  assert.equal(restored.length, 2);
  assert.equal(restored.find((c) => c.id === "c1")!.position, 10);
  assert.equal(restored.find((c) => c.id === "c2")!.position, 20);
  assert.equal(restored.find((c) => c.id === "c1")!.layerId, "layer-a");
});

test("Drag: ending always returns to idle so an interrupted gesture cannot stick", () => {
  const clip = clipAt("c1", 10);
  const state = beginDrag({ mode: "move", pointerX: 100, pointerY: 40, timeSec: 10, clip });
  const { next } = endDrag(state);
  assert.deepEqual(next, IDLE_DRAG);

  // Ending again from idle is a no-op rather than an error, which is what a stray pointerup does.
  const again = endDrag(next);
  assert.deepEqual(again.next, IDLE_DRAG);
  assert.equal(again.commit, null);
});

test("Drag: updating an idle machine is a no-op", () => {
  const state = updateDrag(IDLE_DRAG, { pointerX: 10, pointerY: 10, timeSec: 1 });
  assert.deepEqual(state, IDLE_DRAG);
});

test("Drag: auto-scroll only engages near the viewport edges", () => {
  assert.equal(autoScrollVelocity(400, 100, 900), 0, "the comfortable middle does not scroll");
  assert.ok(autoScrollVelocity(110, 100, 900) < 0, "near the left edge scrolls left");
  assert.ok(autoScrollVelocity(890, 100, 900) > 0, "near the right edge scrolls right");

  // Speed ramps up the deeper into the edge zone the pointer goes.
  const shallow = Math.abs(autoScrollVelocity(140, 100, 900));
  const deep = Math.abs(autoScrollVelocity(101, 100, 900));
  assert.ok(deep > shallow);
});
