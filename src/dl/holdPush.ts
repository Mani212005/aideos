/**
 * File Description: The opt-in slow push-in for held camera shots: a 1 to 3 percent zoom that creeps in over a
 * hold so a held composition is alive instead of frozen. Pure maths with no Remotion or Node imports, shared by
 * the scene camera track (src/dl/scene/cameraTrack.ts) and the node-graph camera (src/dl/camera.ts) so preview
 * and export, and both formats, read one definition. The push is a zoom about the camera's own centre, rises on a
 * smoothstep (no velocity jump where it starts or stops), is slower for a shorter hold, and is handed back to the
 * next move so the camera still lands exactly on every authored pose.
 * Inputs and outputs: hold runs (frame range plus the frames of travel after it), an amount and fps -> log-zoom offsets.
 * Used by: src/dl/scene/cameraTrack.ts, src/dl/camera.ts, backend/designCheck/designCheck.ts, backend/holdPush.test.ts.
 */

/** Smallest push a film or shot may ask for (1% extra zoom over a hold). */
export const MIN_HOLD_PUSH = 0.01;
/** Largest push a film or shot may ask for (3% extra zoom over a hold). */
export const MAX_HOLD_PUSH = 0.03;
/** A hold shorter than this is left still: a push over under a second is a twitch, not a drift. */
export const HOLD_PUSH_MIN_HOLD_SECONDS = 1;
/** A hold this long or longer gets the full amount; a shorter one gets proportionally less, so the pace stays slow. */
export const HOLD_PUSH_FULL_HOLD_SECONDS = 3;
/** The push is handed back over at most this long after a hold, so an authored pose later in a long move is still hit exactly. */
export const HOLD_PUSH_HANDBACK_SECONDS = 3;
/** Largest zoom change per frame the hand-back into the next move may add, as a fraction (the camera cap is 0.8%). */
export const HOLD_PUSH_HANDBACK_STEP = 0.0025;

/** The steepest zoom change per frame the push itself makes while a hold rests, plus margin: below this a frame still counts as at rest. */
export function holdPushRestStep(fps: number): number {
  // A hold under the full length gets amount * (seconds / 3) spread over seconds * fps frames at 1.5x the mean slope.
  return (1.5 * MAX_HOLD_PUSH) / (HOLD_PUSH_FULL_HOLD_SECONDS * fps) * 1.1;
}

/** One hold: the inclusive frame range the camera rests, and how many frames of travel follow before the next hold. */
export interface HoldRun {
  start: number;
  end: number;
  /** Frames of travel after `end` that hand the push back to the next pose (0 when the film ends or the next shot cuts). */
  travelAfter: number;
}

// Smoothstep: zero slope at both ends, so the push eases in and the hand-back eases out.
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** The log-zoom peak a hold reaches: the asked amount, scaled for a short hold and for a short hand-back, or 0 for a hold too short to push. */
export function holdPushPeak(run: HoldRun, amount: number, fps: number): number {
  if (!(amount > 0)) return 0;
  const seconds = (run.end - run.start + 1) / fps;
  if (seconds < HOLD_PUSH_MIN_HOLD_SECONDS) return 0;
  let scaled = Math.min(amount, MAX_HOLD_PUSH) * Math.min(1, seconds / HOLD_PUSH_FULL_HOLD_SECONDS);
  // The hand-back spreads the peak over the travel after the hold with a smoothstep whose steepest frame is 1.5x the mean.
  if (run.travelAfter > 0) scaled = Math.min(scaled, Math.exp((HOLD_PUSH_HANDBACK_STEP * (run.travelAfter + 1)) / 1.5) - 1);
  return Math.log1p(scaled);
}

/** The log-zoom offset at a frame: 0 before the hold, rising to `peakLog` across it, then handed back to 0 over the travel after it. */
export function holdPushAt(run: HoldRun, peakLog: number, frame: number): number {
  if (peakLog === 0 || frame < run.start) return 0;
  if (frame <= run.end) return peakLog * smooth((frame - run.start) / Math.max(1, run.end - run.start));
  if (run.travelAfter > 0 && frame <= run.end + run.travelAfter) return peakLog * (1 - smooth((frame - run.end) / (run.travelAfter + 1)));
  return 0;
}
