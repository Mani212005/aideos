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
/** Maximum gap between a camera arrival and its planned narration cue. */
export const CAMERA_CUE_LANDING_TOLERANCE_SECONDS = 1.5;

/** Compiles keyframes into one camera state per frame (a constant centred camera when there are none). */
export function compileCameraTrack(
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
