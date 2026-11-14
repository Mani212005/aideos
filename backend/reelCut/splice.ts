/**
 * File Description: Pure splice rules for dropped reel shots: window constants, clip splice placement and camera pose spacing.
 * Inputs and outputs: cut frames, idle gaps and pose frames -> bounded splice windows and spaced pose frames.
 * Used by: backend/designSpec/compile.ts (reel compile with a spliced cut) and backend/reelCut/schema.ts.
 */

/** Default splice window in frames: 0.6 s at 30 fps, long enough to read as a move, short enough to stay a transition. */
export const SPLICE_DEFAULT_FRAMES = 18;
/** Shortest splice window: anything shorter reads as a snap, so a gap below this is left to the snap check. */
export const SPLICE_MIN_FRAMES = 6;
/** Longest splice window a cut may request. */
export const SPLICE_MAX_FRAMES = 45;
/** Easing of a spliced clip: it leaves and arrives at rest, so the carried state never jerks. */
export const SPLICE_EASING = "expoInOut" as const;

export interface SpliceOptions {
  /** Splice window length in frames. */
  frames: number;
}

// Resolves the splice options a cut asks for, or undefined when the cut does not opt in.
export function spliceOptionsFor(splice: { frames?: number } | undefined): SpliceOptions | undefined {
  if (!splice) return undefined;
  return { frames: Math.min(SPLICE_MAX_FRAMES, Math.max(SPLICE_MIN_FRAMES, splice.frames ?? SPLICE_DEFAULT_FRAMES)) };
}

// Places one eased carry inside the idle gap [gapStart, gapEnd] of an element's slot, preferring to start at the cut.
export function planSpliceWindow(input: { gapStart: number; gapEnd: number; cutFrame: number; frames: number }): { start: number; end: number } | undefined {
  const { gapStart, gapEnd, cutFrame, frames } = input;
  const afterStart = Math.max(gapStart, cutFrame);
  const afterEnd = Math.min(afterStart + frames, gapEnd);
  if (afterEnd - afterStart >= SPLICE_MIN_FRAMES) return { start: afterStart, end: afterEnd };
  const beforeStart = Math.max(gapStart, gapEnd - frames);
  if (gapEnd - beforeStart >= SPLICE_MIN_FRAMES) return { start: beforeStart, end: gapEnd };
  return undefined;
}

// Spaces kept camera poses that would collide at a cut by pulling the earlier pose back; returns the changed frames by index.
export function spacePosesAtCuts(frames: Array<number | undefined>, cuts: readonly number[], gap: number): Map<number, number> {
  const out = new Map<number, number>();
  const known = frames.flatMap((frame, index) => frame === undefined ? [] : [index]);
  const at = (index: number) => out.get(index) ?? frames[index]!;
  for (let k = known.length - 1; k > 0; k--) {
    const prev = known[k - 1], next = at(known[k]), before = at(prev);
    const straddles = cuts.some((cut) => cut >= before && cut <= next);
    if (before >= next || (straddles && before > next - gap)) out.set(prev, next - gap);
  }
  return out;
}
