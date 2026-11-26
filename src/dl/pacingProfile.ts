/**
 * File Description: The house pacing profile: one place that says how fast aideos narrates and edits a new
 * film, in both formats (the long 16:9 cut and the 9:16 reel share one narration-locked timeline). The
 * narration rate, the silences between lines and the pace numbers the review and the briefs hold a film to
 * all derive from here, so a later pace decision changes one constant instead of a dozen copies.
 * Pure data and arithmetic with no Node imports: the editor bundle, the review and the audio pipeline import it.
 * Inputs and outputs: none -> pacing constants and derived gaps.
 * Used by: backend/audio.ts, backend/pcm.ts, backend/pipeline/run.ts, backend/sceneKit/voiceover.ts,
 * backend/stageTimeline.ts, backend/review/thresholds.ts, backend/designSpec/brief.ts, backend/lookPlan/brief.ts,
 * backend/geminiReview/rubric.ts, editor/vite.config.ts.
 *
 * Decision (captain, 2026-11-21, after watching the Signal video and reel): "I feel that 1.2x of the speed would
 * really fit this nicely. Honestly, I think that the reels that we produce are a bit slow to watch. I want a bit
 * more faster editing. By faster editing, I mean the story needs to pace up a bit by like 20-30% more speed."
 * The profile below is that decision: narration 1.2x of the pace before it, and every timeline silence and pace
 * target scaled by the same factor, so the whole story plays about 20% faster rather than only the words.
 */

/** Narration speed relative to the house pace before the 2026-11-21 decision (1 = that pace). */
export const NARRATION_RATE = 1.2;

/** The silences and holds of the house pace before the 2026-11-21 decision, kept so each derived value shows its origin. */
const PRE_2026_11_21 = {
  /** Silence between two narration lines (two shots) in the production pipeline, ms. */
  segmentGapMs: 200,
  /** Silence before a line that opens a new chapter (decision D4), ms. */
  chapterGapMs: 900,
  /** Silence between chunks of one long line, ms. */
  chunkGapMs: 110,
  /** Silence between lines in a scene-kit film, ms. */
  sceneLineGapMs: 420,
  /** Longest a story picture may hold unchanged, seconds. */
  storyHoldMaxSec: 3,
  /** Longest pause inside narration before it counts as dead air, seconds. */
  deadAirMaxSec: 0.7,
  /** Camera: at least one purposeful move per this many seconds. */
  cameraMovePerSec: 20,
  /** Camera: hold on a subject after a move, seconds. */
  cameraHoldSec: [3, 5] as const,
  /** Design target for narration pace, words per minute. */
  wpmTarget: [130, 170] as const,
  /** Review pass window for narration pace, words per minute. */
  wpmWindow: [120, 180] as const,
  /** Longest the mean beat (shot) length may be, seconds. */
  meanBeatMaxSec: 12,
  /** Opt-in reel-fast profile: top of the narration pace window, words per minute. */
  reelFastWpmMax: 200,
  /** Hard cuts allowed per minute before the picture reads as separate panels. */
  hardCutsPerMinMax: 2,
  /** Carry-over with transformation: at least one beat boundary per this many seconds. */
  carryOverPerSec: 20,
  /** Reel hook: the first spoken word must start before this many seconds. */
  hookFirstWordMaxSec: 0.3,
};

// Scales a duration of the old pace onto the faster timeline, rounded to `step`.
function faster(value: number, step: number): number {
  return Number((Math.round(value / NARRATION_RATE / step) * step).toFixed(3));
}

// Scales a rate of the old pace (words per minute) onto the faster timeline, rounded to 5.
function quicker(value: number): number {
  return Math.round((value * NARRATION_RATE) / 5) * 5;
}

/** Shortest film in seconds at the pace before the 2026-11-21 decision (narration rate 1). */
const BASE_MIN_FILM_SEC = 10;

/**
 * The shortest film the schema accepts at a narration rate: the 10 s floor of rate 1 scaled by the rate, so a
 * script that narrates to the same length of speech clears the floor at every pace (8.3 s at the 1.2x house pace).
 * Rounded to 0.1 s so the schema message can state it. A rate that is not a positive finite number keeps the 10 s floor.
 */
export function minFilmSecAt(rate: number): number {
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return Number((Math.round(BASE_MIN_FILM_SEC / safeRate / 0.1) * 0.1).toFixed(1));
}

/** The house pace every new film is made and reviewed at. */
export const HOUSE_PACE = {
  narrationRate: NARRATION_RATE,
  minFilmSec: minFilmSecAt(NARRATION_RATE),
  segmentGapMs: faster(PRE_2026_11_21.segmentGapMs, 10),
  chapterGapMs: faster(PRE_2026_11_21.chapterGapMs, 10),
  chunkGapMs: faster(PRE_2026_11_21.chunkGapMs, 10),
  sceneLineGapMs: faster(PRE_2026_11_21.sceneLineGapMs, 10),
  storyHoldMaxSec: faster(PRE_2026_11_21.storyHoldMaxSec, 0.5),
  deadAirMaxSec: faster(PRE_2026_11_21.deadAirMaxSec, 0.1),
  cameraMovePerSec: faster(PRE_2026_11_21.cameraMovePerSec, 1),
  cameraHoldSec: [faster(PRE_2026_11_21.cameraHoldSec[0], 0.5), faster(PRE_2026_11_21.cameraHoldSec[1], 0.5)] as const,
  wpmTarget: [quicker(PRE_2026_11_21.wpmTarget[0]), quicker(PRE_2026_11_21.wpmTarget[1])] as const,
  wpmWindow: [quicker(PRE_2026_11_21.wpmWindow[0]), quicker(PRE_2026_11_21.wpmWindow[1])] as const,
  meanBeatMaxSec: faster(PRE_2026_11_21.meanBeatMaxSec, 0.5),
  reelFastWpmMax: quicker(PRE_2026_11_21.reelFastWpmMax),
  hardCutsPerMinMax: Number((PRE_2026_11_21.hardCutsPerMinMax * NARRATION_RATE).toFixed(1)),
  carryOverPerSec: faster(PRE_2026_11_21.carryOverPerSec, 1),
  hookFirstWordMaxSec: faster(PRE_2026_11_21.hookFirstWordMaxSec, 0.05),
} as const;
