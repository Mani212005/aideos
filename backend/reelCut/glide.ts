/**
 * File Description: Plans stretched camera glides for a spliced reel: when a camera move across a dropped span cannot fit the splice window under the camera rule, it keeps its duration and finishes inside the next kept shot.
 * Inputs and outputs: kept camera poses with resolved frames, cut frames, kept shot spans and the camera limits -> pose frames with the glides stretched, or errors naming the kept shot and the missing frames.
 * Used by: backend/designSpec/compile.ts (camera compile of a spliced reel).
 */
import type { CameraTrack } from "../../src/dl/scene/types";
import { compileCameraTrack, measureCameraMotion, MIN_CAMERA_HOLD_SHARE } from "../../src/dl/scene/cameraTrack";
import { Timeline } from "../sceneKit";
import type { CameraGlideLimits } from "./splice";

/** One kept camera pose: where the camera looks and how it arrives. */
export interface GlidePose {
  id: string;
  center: readonly [number, number];
  zoom: number;
  easing?: "linear" | "expoOut" | "expoIn" | "expoInOut" | "hold";
}

/** The frame span of one kept shot of the reel. */
export interface GlideShot {
  id: string;
  from: number;
  to: number;
}

export interface GlideInput {
  poses: readonly GlidePose[];
  /** Resolved pose frames in pose order; undefined for a pose whose cue failed (the planner then leaves everything to the caller). */
  frames: ReadonlyArray<number | undefined>;
  /** Frames at which dropped shots collapse. */
  cuts: readonly number[];
  keptShots: readonly GlideShot[];
  totalFrames: number;
  fps: number;
  sceneSize: { w: number; h: number };
  limits: CameraGlideLimits;
  /** Splice window in frames: a move that fits this window is left to the plain splice. */
  gap: number;
  /** The design's hold push-in, so the measured curve is the one the design check will see. */
  holdPush?: number;
}

export interface GlidePlan {
  frames: Array<number | undefined>;
  errors: string[];
}

// Whether two poses ask for the same camera state.
function samePose(a: GlidePose, b: GlidePose): boolean {
  return a.center[0] === b.center[0] && a.center[1] === b.center[1] && a.zoom === b.zoom;
}

// Builds the camera track the compile would build from the first `count` poses at these frames, or undefined when they are not a valid timeline.
function trackOf(input: GlideInput, frames: ReadonlyArray<number | undefined>, count = input.poses.length): CameraTrack | undefined {
  const timeline = new Timeline("glide", input.totalFrames);
  let prev = -1;
  for (let i = 0; i < count; i++) {
    const frame = frames[i];
    if (frame === undefined) return undefined;
    if (prev >= 0) {
      // The compile skips a repeated identical pose on the same frame; mirror it so this track is the compiled one.
      if (frame === frames[prev] && samePose(input.poses[i], input.poses[prev])) continue;
      if (frame <= frames[prev]!) return undefined;
      const from = input.poses[prev], to = input.poses[i];
      try {
        timeline.camera({ id: to.id, from: { center: { x: from.center[0], y: from.center[1] }, zoom: from.zoom }, to: { center: { x: to.center[0], y: to.center[1] }, zoom: to.zoom },
          start: frames[prev]!, end: frame, ...(to.easing ? { easing: to.easing } : {}) });
      } catch {
        return undefined;
      }
    }
    prev = i;
  }
  const built = timeline.buildCamera();
  return built && input.holdPush !== undefined ? { ...built, holdPush: input.holdPush } : built;
}

// Moves pose `index` to `frame` and pushes any later pure hold pose (same camera state as its predecessor) just past it.
function withPoseAt(input: GlideInput, frames: ReadonlyArray<number | undefined>, index: number, frame: number): Array<number | undefined> {
  const out = [...frames];
  out[index] = frame;
  for (let j = index + 1; j < input.poses.length; j++) {
    const here = out[j];
    if (here === undefined || !samePose(input.poses[j], input.poses[j - 1]) || here > out[j - 1]!) break;
    out[j] = out[j - 1]! + 1;
  }
  return out;
}

// Whether the compiled curve of the first `count` poses keeps the speed, acceleration and zoom step limits within [from, to] frames.
function curveFits(input: GlideInput, frames: ReadonlyArray<number | undefined>, count: number, from: number, to: number): boolean {
  const track = trackOf(input, frames, count);
  if (!track) return false;
  const curve = compileCameraTrack(track, input.totalFrames, input.sceneSize, input.fps);
  const stats = measureCameraMotion(curve.slice(Math.max(0, from - 2), Math.min(curve.length - 1, to + 2) + 1), input.fps);
  const { limits, sceneSize } = input;
  return stats.peakPanSpeed <= sceneSize.w * limits.panWidthsPerSec
    && stats.peakPanAccel <= sceneSize.w * limits.panAccelWidthsPerSec2
    && stats.peakZoomStep <= limits.zoomStepPerFrame;
}

// Finds the fewest frames the move into pose `index` needs from `start` under the camera limits when it ends in a hold, or undefined when none is feasible.
function framesNeeded(input: GlideInput, frames: ReadonlyArray<number | undefined>, index: number, start: number): number | undefined {
  const a = input.poses[index - 1], b = input.poses[index];
  const panPx = Math.hypot(b.center[0] - a.center[0], b.center[1] - a.center[1]);
  const fits = (length: number) => curveFits(input, withPoseAt(input, frames, index, start + length), index + 1, start, start + length);
  // The average speed cannot exceed the peak speed, so a move shorter than this bound is infeasible; start the search at it.
  let low = 0;
  let high = Math.max(1, Math.ceil(panPx / (input.sceneSize.w * input.limits.panWidthsPerSec) * input.fps));
  while (!fits(high)) {
    low = high;
    high *= 2;
    if (start + high > input.totalFrames) return undefined;
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) high = mid;
    else low = mid;
  }
  return high;
}

// Names the kept shot that holds a frame, or the film end when none does.
function shotAt(shots: readonly GlideShot[], frame: number): string {
  return shots.find((s) => frame >= s.from && frame < s.to)?.id ?? "the end of the film";
}

// Counts the frames of a shot in which the camera is travelling between two different poses; the stretched move is counted whole, so a shot that cannot hold it shows a negative rest.
function movingFramesIn(input: GlideInput, frames: ReadonlyArray<number | undefined>, shot: GlideShot, stretchedIndex: number): number {
  let moving = 0;
  for (let j = 1; j < input.poses.length; j++) {
    if (samePose(input.poses[j], input.poses[j - 1])) continue;
    const a = Math.min(Math.max(frames[j - 1]!, shot.from), shot.to);
    const b = j === stretchedIndex ? Math.max(frames[j]!, shot.from) : Math.min(Math.max(frames[j]!, shot.from), shot.to);
    moving += b - a;
  }
  return moving;
}

// Reports the first later pose whose own move no longer has the frames it needs after the pose at `index` moved, or undefined when all fit.
function laterPoseConflict(input: GlideInput, before: ReadonlyArray<number | undefined>, after: ReadonlyArray<number | undefined>, index: number): string | undefined {
  for (let j = index + 1; j < input.poses.length && after[j - 1] !== before[j - 1]; j++) {
    if (samePose(input.poses[j], input.poses[j - 1])) continue;
    const own = framesNeeded(input, after, j, after[j - 1]!);
    const have = after[j]! - after[j - 1]!;
    if (own !== undefined && own <= have) continue;
    const shot = shotAt(input.keptShots, after[j]!);
    return `camera "${input.poses[j].id}": kept shot "${shot}" has no room: the glide to "${input.poses[index].id}" now finishes at frame ${after[index]} and the move on to "${input.poses[j].id}" needs ${own ?? "more"} frames but has ${have}; missing ${own === undefined ? "frames" : `${own - have} frames`} in "${shot}"`;
  }
  return undefined;
}

/**
 * Stretches every camera glide across a dropped span that the splice window cannot hold under the camera rule.
 * The glide starts where its earlier pose lands and keeps the duration the limits need; its later pose arrives that
 * many frames later, inside the kept shot that follows the dropped span. A move that fits the window is untouched.
 * When the following kept shot cannot absorb the glide (its hold share or the next pose's own move would break), the
 * plan carries an error naming the shot and the missing frames and the frames are left as given.
 */
export function planStretchedGlides(input: GlideInput): GlidePlan {
  const raw = input.frames;
  if (raw.some((f) => f === undefined) || input.poses.length < 2) return { frames: [...raw], errors: [] };
  let out: Array<number | undefined> = [...raw];
  for (let i = 1; i < input.poses.length; i++) {
    const cutsBetween = input.cuts.filter((c) => c >= raw[i - 1]! && c <= raw[i]!);
    if (!cutsBetween.length || samePose(input.poses[i], input.poses[i - 1])) continue;
    const start = out[i - 1]!;
    const available = Math.max(out[i]! - start, input.gap);
    const needed = framesNeeded(input, out, i, start);
    const from = input.poses[i - 1].id, to = input.poses[i].id;
    if (needed === undefined) return { frames: [...raw], errors: [`camera "${to}": the glide from "${from}" cannot keep the camera speed, acceleration and zoom step limits at any length that fits the film`] };
    if (needed <= available) continue;
    const next = input.keptShots.find((s) => s.from >= Math.min(...cutsBetween));
    if (!next) return { frames: [...raw], errors: [`camera "${to}": the glide from "${from}" needs ${needed} frames across the dropped shots but no kept shot follows them to finish in; keep a shot after the dropped span`] };
    // The move keeps the duration its own limits need; the poses after it must still fit and the real curve, with its neighbours, must hold the limits.
    let length = needed;
    let stretched = withPoseAt(input, out, i, start + length);
    for (;;) {
      const conflict = laterPoseConflict(input, out, stretched, i);
      if (conflict) return { frames: [...raw], errors: [conflict] };
      if (curveFits(input, stretched, input.poses.length, start, start + length)) break;
      length++;
      if (start + length >= input.totalFrames) return { frames: [...raw], errors: [`camera "${to}": the glide from "${from}" cannot keep the camera speed, acceleration and zoom step limits at any length that fits the film`] };
      stretched = withPoseAt(input, out, i, start + length);
    }
    const holdFrames = Math.ceil(MIN_CAMERA_HOLD_SHARE * (next.to - next.from));
    const restFrames = next.to - next.from - movingFramesIn(input, stretched, next, i);
    if (restFrames < holdFrames) {
      return { frames: [...raw], errors: [`camera "${to}": the glide from "${from}" needs ${length} frames and finishes at frame ${start + length}, leaving kept shot "${next.id}" ${restFrames} of ${next.to - next.from} frames at rest against the ${holdFrames} its hold share needs; missing ${holdFrames - restFrames} frames in "${next.id}" (give it more narration or drop fewer shots)`] };
    }
    out = stretched;
  }
  return { frames: out, errors: [] };
}
