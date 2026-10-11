/**
 * File Description: Regression coverage for scene camera compilation: a track with no easing flows through its
 * keyframes smoothly, a track eased at every keyframe stops and bursts, and the measured stats tell them apart.
 * Inputs and outputs: camera keyframe fixtures -> compiled per-frame curves and motion stats assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { compileCameraTrack, measureCameraMotion } from "../../src/dl/scene/cameraTrack";
import { evaluateMonotoneSpline } from "../../src/dl/motion/spline";
import type { CameraTrack } from "../../src/dl/scene/types";

const SIZE = { w: 1920, h: 1920 };
const FPS = 30;
const TOTAL = 900;

// The proof-b look-first film's pose list (frames, centre, zoom), the track the captain called jittery.
const POSES: Array<[number, number, number, number]> = [
  [0, 960, 960, 1.0], [120, 840, 980, 1.22], [286, 845, 985, 1.25], [382, 960, 960, 1.0],
  [481, 960, 900, 1.15], [616, 960, 960, 1.0], [777, 975, 965, 1.02], [899, 960, 960, 0.97],
];

// Builds a camera track from the pose list, eased at every keyframe or with no easing at all.
const track = (easing?: "expoInOut"): CameraTrack => ({
  keyframes: POSES.map(([frame, x, y, zoom]) => ({ frame, center: { x, y }, zoom, ...(easing ? { easing } : {}) })),
});

// Verifies the monotone spline never overshoots a knot and is flat where the data holds.
test("monotone spline stays inside its knots and rests on holds", () => {
  const knots = [{ t: 0, val: 0 }, { t: 0.4, val: 10 }, { t: 0.6, val: 10 }, { t: 1, val: 0 }];
  for (let i = 0; i <= 200; i++) {
    const v = evaluateMonotoneSpline(knots, i / 200);
    assert.ok(v >= -1e-9 && v <= 10 + 1e-9, `overshoot ${v} at ${i / 200}`);
  }
  assert.equal(evaluateMonotoneSpline(knots, 0.5), 10);
});

// Verifies a track with no easing keeps the authored poses on its keyframes (the move is not flattened).
test("an un-eased camera still reaches every authored pose", () => {
  const curves = compileCameraTrack(track(), TOTAL, SIZE);
  for (const [frame, x, y, zoom] of POSES) {
    const cam = curves[frame];
    assert.ok(Math.abs(cam.center.x - x) < 1e-6 && Math.abs(cam.center.y - y) < 1e-6, `frame ${frame} centre`);
    assert.ok(Math.abs(cam.zoom - zoom) < 1e-6, `frame ${frame} zoom ${cam.zoom}`);
  }
  const zooms = curves.map((c) => c.zoom);
  assert.ok(Math.max(...zooms) <= 1.25 + 1e-9 && Math.min(...zooms) >= 0.97 - 1e-9, "zoom left the authored range");
});

// Verifies the un-eased track is far gentler than the same poses eased at every keyframe, yet still moves.
test("an un-eased camera has no burst: lower peak zoom step, lower acceleration, same travel", () => {
  const eased = measureCameraMotion(compileCameraTrack(track("expoInOut"), TOTAL, SIZE), FPS);
  const smooth = measureCameraMotion(compileCameraTrack(track(), TOTAL, SIZE), FPS);
  assert.ok(smooth.peakZoomStep < eased.peakZoomStep / 3, `zoom step ${smooth.peakZoomStep} vs ${eased.peakZoomStep}`);
  assert.ok(smooth.peakPanAccel < eased.peakPanAccel / 5, `accel ${smooth.peakPanAccel} vs ${eased.peakPanAccel}`);
  assert.ok(smooth.peakPanSpeed < eased.peakPanSpeed, "peak pan speed did not drop");
  assert.ok(smooth.peakPanSpeed > 20, `pan speed ${smooth.peakPanSpeed} px/s is too small to read as a move`);
  assert.ok(smooth.peakZoomStep > 0.001, "zoom change per frame is too small to read as a move");
  assert.ok(smooth.moveSeconds > eased.moveSeconds, "the camera should spend more time moving than stopped");
});

// Verifies velocity is continuous where a move meets a hold, so the camera eases to rest instead of braking at once.
test("an un-eased camera arrives at a hold with no velocity jump", () => {
  const curves = compileCameraTrack(
    { keyframes: [
      { frame: 0, center: { x: 100, y: 100 }, zoom: 1 },
      { frame: 60, center: { x: 500, y: 500 }, zoom: 2 },
      { frame: 120, center: { x: 500, y: 500 }, zoom: 2 },
      { frame: 179, center: { x: 900, y: 900 }, zoom: 1 },
    ] },
    180,
    SIZE,
  );
  const speed = (f: number) => Math.hypot(curves[f].center.x - curves[f - 1].center.x, curves[f].center.y - curves[f - 1].center.y);
  assert.ok(speed(60) < 2, `still moving ${speed(60)} px per frame when the hold begins`);
  assert.ok(speed(122) < 2, `jumps to ${speed(122)} px per frame right after the hold ends`);
});

// Verifies a scene with no camera yields one constant centred state per frame.
test("no camera track compiles to a constant centred camera", () => {
  const curves = compileCameraTrack(undefined, 10, SIZE);
  assert.equal(curves.length, 10);
  assert.deepEqual(curves[9], { center: { x: 960, y: 960 }, zoom: 1, rotation: 0 });
});
