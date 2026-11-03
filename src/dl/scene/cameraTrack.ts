/**
 * File Description: Compiles a scene's camera keyframes into one dense per-frame camera state and measures
 * how that track moves (pan speed, zoom change per frame, acceleration, time at rest), so the compiler
 * and the design check read the same curve. A keyframe with no `easing` flows through its neighbours on a
 * monotone spline (it only rests where the data holds or turns); a named `easing` governs that segment
 * and stops at both of its keyframes.
 * Inputs and outputs: CameraTrack keyframes, frame count and fps -> per-frame camera states and motion stats.
 * Used by: src/dl/scene/compile.ts, backend/designCheck/designCheck.ts, backend/scene/cameraTrack.test.ts.
 */

import type { CameraTrack } from "./types";
import type { SvgEasing } from "./svgAnimation";
import { applySvgEasing } from "./svgAnimation";
import { evaluateMonotoneSpline, type KnotPoint } from "../motion/spline";
import { HOLD_PUSH_HANDBACK_SECONDS, holdPushAt, holdPushPeak, type HoldRun } from "../holdPush";

export interface CompiledCameraState {
  center: { x: number; y: number };
  zoom: number;
  rotation: number;
}

export interface CameraMotionStats {
  /** Fastest translation in scene px per second. */
  peakPanSpeed: number;
  /** Largest single-frame zoom change as a fraction of the zoom before it (0.02 is 2%). */
  peakZoomStep: number;
  /** Largest change of pan speed in scene px per second squared. */
  peakPanAccel: number;
  /** Seconds the camera is effectively at rest (not translating, zooming or rotating). */
  restSeconds: number;
  /** Seconds the camera is moving. */
  moveSeconds: number;
  /** Fraction of the film spent at rest, between zero and one. */
  holdShare: number;
  /** Longest uninterrupted run of camera motion, in seconds. */
  maxContinuousMoveSeconds: number;
}

const HOLD_EPSILON = 1e-6;
/** Minimum fraction of a film that should let the viewer read a settled composition. */
export const MIN_CAMERA_HOLD_SHARE = 0.3;
/** Maximum uninterrupted camera motion before the composition needs another hold. */
export const MAX_CAMERA_CONTINUOUS_MOVE_SECONDS = 6;
/** Largest zoom change allowed in a single frame, as a fraction of the zoom (0.8% a frame is about 24% a second at 30 fps). */
export const CAMERA_ZOOM_STEP_CEILING = 0.008;
/** Maximum gap between a camera arrival and its planned narration cue. */
export const CAMERA_CUE_LANDING_TOLERANCE_SECONDS = 1.5;

/**
 * Compiles keyframes into one camera state per frame (a constant centred camera when there are none). A track
 * that opts into `holdPush` then gets the slow push-in over each of its holds; one that does not is untouched.
 */
export function compileCameraTrack(
  camera: CameraTrack | undefined,
  totalFrames: number,
  sceneSize: { w: number; h: number },
  fps = 30,
): CompiledCameraState[] {
  const curves = compileKeyframes(camera, totalFrames, sceneSize);
  return camera?.holdPush ? applyHoldPush(curves, camera.holdPush, fps) : curves;
}

// Compiles the authored keyframes alone into one camera state per frame.
function compileKeyframes(
  camera: CameraTrack | undefined,
  totalFrames: number,
  sceneSize: { w: number; h: number },
): CompiledCameraState[] {
  const curves: CompiledCameraState[] = new Array(totalFrames);
  const kfs = camera?.keyframes;
  if (!kfs || kfs.length === 0) {
    const rest: CompiledCameraState = { center: { x: sceneSize.w / 2, y: sceneSize.h / 2 }, zoom: 1.0, rotation: 0 };
    for (let f = 0; f < totalFrames; f++) curves[f] = rest;
    return curves;
  }

  const sortedKfs = [...kfs].sort((a, b) => a.frame - b.frame);

  // Builds spline knots from keyframes using a given property extractor, padded flat to both ends of the film.
  const buildSpline = (extractor: (k: (typeof sortedKfs)[0]) => number): KnotPoint[] => {
    const knots = sortedKfs.map((k) => ({
      t: totalFrames > 1 ? k.frame / (totalFrames - 1) : 0,
      val: extractor(k),
    }));
    if (knots[0].t > 0) knots.unshift({ t: 0, val: knots[0].val });
    if (knots[knots.length - 1].t < 1) knots.push({ t: 1, val: knots[knots.length - 1].val });
    return knots;
  };
  const splineX = buildSpline((k) => k.center.x);
  const splineY = buildSpline((k) => k.center.y);
  const splineZoom = buildSpline((k) => k.zoom);
  const splineRot = buildSpline((k) => k.rotation ?? 0);

  for (let f = 0; f < totalFrames; f++) {
    if (sortedKfs.length === 1 || f <= sortedKfs[0].frame) {
      const k = sortedKfs[0];
      curves[f] = { center: { ...k.center }, zoom: k.zoom, rotation: k.rotation ?? 0 };
    } else if (f >= sortedKfs[sortedKfs.length - 1].frame) {
      const k = sortedKfs[sortedKfs.length - 1];
      curves[f] = { center: { ...k.center }, zoom: k.zoom, rotation: k.rotation ?? 0 };
    } else {
      const nextIdx = sortedKfs.findIndex((k) => k.frame > f);
      const k0 = sortedKfs[nextIdx - 1];
      const k1 = sortedKfs[nextIdx];

      if (k0.easing) {
        const t = (f - k0.frame) / (k1.frame - k0.frame);
        const easedT = applySvgEasing(k0.easing as SvgEasing, t);
        curves[f] = {
          center: {
            x: k0.center.x + (k1.center.x - k0.center.x) * easedT,
            y: k0.center.y + (k1.center.y - k0.center.y) * easedT,
          },
          zoom: k0.zoom + (k1.zoom - k0.zoom) * easedT,
          rotation: (k0.rotation ?? 0) + ((k1.rotation ?? 0) - (k0.rotation ?? 0)) * easedT,
        };
      } else {
        const normT = totalFrames > 1 ? f / (totalFrames - 1) : 0;
        const isHoldX = Math.abs(k0.center.x - k1.center.x) < HOLD_EPSILON;
        const isHoldY = Math.abs(k0.center.y - k1.center.y) < HOLD_EPSILON;
        const isHoldZoom = Math.abs(k0.zoom - k1.zoom) < HOLD_EPSILON;
        const isHoldRot = Math.abs((k0.rotation ?? 0) - (k1.rotation ?? 0)) < HOLD_EPSILON;

        curves[f] = {
          center: {
            x: isHoldX ? k0.center.x : evaluateMonotoneSpline(splineX, normT),
            y: isHoldY ? k0.center.y : evaluateMonotoneSpline(splineY, normT),
          },
          zoom: isHoldZoom ? k0.zoom : evaluateMonotoneSpline(splineZoom, normT),
          rotation: isHoldRot ? (k0.rotation ?? 0) : evaluateMonotoneSpline(splineRot, normT),
        };
      }
    }
  }
  return curves;
}

// Whether two compiled camera states are the same pose (a hold keeps the exact coordinates, so this is exact up to rounding).
function samePose(a: CompiledCameraState, b: CompiledCameraState): boolean {
  return Math.abs(a.center.x - b.center.x) < HOLD_EPSILON && Math.abs(a.center.y - b.center.y) < HOLD_EPSILON
    && Math.abs(a.zoom - b.zoom) < HOLD_EPSILON && Math.abs(a.rotation - b.rotation) < HOLD_EPSILON;
}

// Finds every hold (two or more frames in the same pose) and the frames of travel that follow it before the next one.
function findHoldRuns(curves: CompiledCameraState[], fps: number): HoldRun[] {
  const runs: HoldRun[] = [];
  for (let i = 0; i < curves.length; ) {
    let j = i;
    while (j + 1 < curves.length && samePose(curves[j + 1], curves[i])) j++;
    if (j > i) runs.push({ start: i, end: j, travelAfter: 0 });
    i = j + 1;
  }
  // The offset is back to zero within a few seconds, and always by the next hold or the film's last frame, so authored poses are still landed on exactly.
  runs.forEach((run, index) => {
    const landing = index + 1 < runs.length ? runs[index + 1].start : curves.length - 1;
    run.travelAfter = Math.max(0, Math.min(landing - run.end - 1, Math.round(HOLD_PUSH_HANDBACK_SECONDS * fps)));
  });
  return runs;
}

// Largest single-frame relative zoom change over a frame range of a track.
function peakZoomStepIn(track: CompiledCameraState[], from: number, to: number): number {
  let peak = 0;
  for (let f = Math.max(1, from); f <= Math.min(track.length - 1, to); f++) peak = Math.max(peak, Math.abs(track[f].zoom - track[f - 1].zoom) / track[f - 1].zoom);
  return peak;
}

/**
 * Adds the slow push-in to every hold of a compiled track: zoom about the camera's own centre, rising over the hold
 * and handed back across the move that follows. The push never makes the track break the zoom-step ceiling: a hold
 * whose hand-back would, pushes less (down to nothing).
 */
export function applyHoldPush(curves: CompiledCameraState[], amount: number, fps: number): CompiledCameraState[] {
  const out = curves.slice();
  for (const run of findHoldRuns(curves, fps)) {
    let peak = holdPushPeak(run, amount, fps);
    const span = Math.min(curves.length - 1, run.end + run.travelAfter);
    const baseStep = peakZoomStepIn(curves, run.start, span);
    for (let attempt = 0; peak > 0 && attempt < 8; attempt++) {
      for (let f = run.start; f <= span; f++) out[f] = { ...curves[f], zoom: curves[f].zoom * Math.exp(holdPushAt(run, peak, f)) };
      // A base move already over the ceiling is the author's to fix; the push only has to add nothing beyond it.
      if (peakZoomStepIn(out, run.start, span) <= Math.max(CAMERA_ZOOM_STEP_CEILING * 0.999, baseStep)) break;
      peak = attempt === 7 ? 0 : peak / 2;
    }
    if (peak === 0) for (let f = run.start; f <= span; f++) out[f] = curves[f];
  }
  return out;
}

/** Measures peak pan speed, zoom step per frame, pan acceleration and rest time of a compiled camera track. */
export function measureCameraMotion(curves: CompiledCameraState[], fps: number): CameraMotionStats {
  let peakPanSpeed = 0;
  let peakZoomStep = 0;
  let peakPanAccel = 0;
  let rest = 0;
  let moving = 0;
  let longestMovingRun = 0;
  let movingRun = 0;
  let prevSpeed = 0;
  for (let i = 1; i < curves.length; i++) {
    const a = curves[i - 1];
    const b = curves[i];
    const speed = Math.hypot(b.center.x - a.center.x, b.center.y - a.center.y) * fps;
    const zoomStep = Math.abs(b.zoom - a.zoom) / a.zoom;
    const turn = Math.abs(b.rotation - a.rotation);
    peakPanSpeed = Math.max(peakPanSpeed, speed);
    peakZoomStep = Math.max(peakZoomStep, zoomStep);
    if (i > 1) peakPanAccel = Math.max(peakPanAccel, Math.abs(speed - prevSpeed) * fps);
    if (speed < 0.3 && zoomStep < 1e-4 && turn < 1e-3) {
      rest++;
      longestMovingRun = Math.max(longestMovingRun, movingRun);
      movingRun = 0;
    } else {
      moving++;
      movingRun++;
    }
    prevSpeed = speed;
  }
  longestMovingRun = Math.max(longestMovingRun, movingRun);
  const intervals = Math.max(0, curves.length - 1);
  return {
    peakPanSpeed,
    peakZoomStep,
    peakPanAccel,
    restSeconds: rest / fps,
    moveSeconds: moving / fps,
    holdShare: intervals ? rest / intervals : 1,
    maxContinuousMoveSeconds: longestMovingRun / fps,
  };
}
