import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE — MOTION GRAMMAR
 * ---------------------------------------------------------------------------
 * Implements §03. One curve, four durations, one entrance. The point of fixing
 * these is that independently animated elements read as one piece: if every
 * component picks its own easing you get a pile of tweens, not a film.
 */

/**
 * ease-out-expo. The only curve in the system.
 *
 * It is chosen for what it *feels* like rather than what it looks like on a
 * graph: it has already arrived while a linear move is still crossing, which
 * reads as a UI responding rather than an object falling. No springs, no
 * bounce — overshoot implies mass, and none of this has mass.
 */
export const EXPO = Easing.bezier(0.16, 1, 0.3, 1);

/** Fixed durations, in milliseconds. Nothing in the system invents its own. */
export const MS = {
  /** Anything entering frame. */
  enter: 400,
  /** Leaving is always faster than arriving. */
  exit: 220,
  /** Between siblings. Order defines stagger; no block declares its own delay. */
  stagger: 70,
  /** A camera pan or zoom between two stations. */
  move: 900,
  /** An edge drawing itself in, before its target node enters. */
  edge: 400,
} as const;

/** How far below its resting position a thing starts. Authored pixels. */
export const RISE = 12;

/** The whole frame drifts 100% → 104% across a held shot, and never further. */
export const DRIFT = 1.04;

export const frames = (milliseconds: number, fps: number) =>
  (milliseconds / 1000) * fps;

export type Entrance = { opacity: number; transform: string };

/**
 * The one entrance in the system: invisible, sitting 12px low, fading up into
 * place over 400ms on the curve. Never a slide across the screen — horizontal
 * entrances imply the thing came from somewhere, and on a canvas where position
 * carries meaning that is a lie.
 *
 * `index` is the element's position among its siblings, which is the only thing
 * that decides its delay.
 */
export const useEntrance = (
  startFrame: number,
  index = 0,
  risePx = RISE,
): Entrance => {
  let frame = 30;
  let fps = 30;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    frame = useCurrentFrame();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    fps = useVideoConfig().fps;
  } catch {
    // Fallback in unit test environment
  }
  const from = startFrame + frames(MS.stagger * index, fps);
  const isPoster = frame === 0 && startFrame === 0;
  const p = isPoster
    ? 1
    : interpolate(frame, [from, from + frames(MS.enter, fps)], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: EXPO,
      });
  return { opacity: p, transform: `translateY(${(1 - p) * risePx}px)` };
};

/**
 * Progress 0..1 through a timed move that begins at `startFrame`, on the curve.
 * Used for anything that is not an entrance — camera moves, bars growing, edges
 * drawing, counters counting.
 */
export const useProgress = (
  startFrame: number,
  durationMs: number,
  delayMs = 0,
): number => {
  let frame = 30;
  let fps = 30;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    frame = useCurrentFrame();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    fps = useVideoConfig().fps;
  } catch {
    // Fallback in unit test environment
  }
  const from = startFrame + frames(delayMs, fps);
  return interpolate(frame, [from, from + frames(durationMs, fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EXPO,
  });
};

/** Pure form of the same easing, for values computed outside a hook. */
export const easeExpo = (t: number) => EXPO(Math.max(0, Math.min(1, t)));
