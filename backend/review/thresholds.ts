/**
 * File Description: The thresholds `aideos review` holds a video to.
 * Every number here was set from the calibration videos (see scripts/calibrate_review.ts and the
 * table in the review README), not guessed. Change a value only by re-running the calibration and
 * keeping the recorded reference ordering.
 * Inputs and outputs: none -> calibrated threshold constants for review criteria.
 * Used by: backend/review/criteria.ts.
 */

/** Calibrated on 2026-10-01 against references A, B and RAG (frames at 10 fps, 480x270, ink = 28 levels off the median). */
export const THRESHOLDS = {
  /** Frames decoded for pixel analysis. */
  analysis: { fps: 10, width: 480, height: 270, inkLevels: 28 },
  persistence: {
    /**
     * Median correlation of the ink layout with the layout two seconds earlier. A 0.85, selected
     * reference B 0.69, and accepted DNS 0.68 pass; rejected RAG 0.50 fails. The 0.65 cutoff leaves
     * 0.15 below the weakest accepted measurement and 0.15 above RAG, while the element-boundary
     * carry and stage-clear limits remain independent checks against actual clears.
     */
    medianMin: 0.65,
    /** Stage-clear events (ink collapses below 45% of its trailing 3 s median) per 30 s; A 1.7, B 2.6, RAG 5.5. */
    clearsPer30sMax: 2.2,
    /** Element-level (film data): share of beat boundaries that keep the previous beat's elements on stage. */
    boundaryCarryMin: 0.6,
  },
  captions: {
    /** Share of narrated sample times with a caption band in the bottom quarter. */
    coverageMin: 0.6,
    /** A word in the band at least this tall (px at 1080 short side) counts as caption text. */
    wordHeightMin: 28,
    /** Caption lines allowed at once. */
    maxLines: 2,
    /** The band is the bottom quarter of the frame. */
    bandTopRatio: 0.75,
    /** Seconds between OCR samples. */
    sampleEverySec: 2,
  },
  readability: {
    /** An OCR word shorter than this (px at 1080 short side) is too small to read at normal size. */
    wordHeightMin: 18,
    /** Share of confident OCR words that may be under the minimum height. */
    smallShareMax: 0.58,
    /** WCAG contrast ratio for text against its local background. */
    contrastMin: 3,
    /** Share of confident OCR words that may fall under the contrast minimum. */
    lowContrastShareMax: 0.1,
    /** OCR confidence a word needs to be counted at all. */
    confidenceMin: 60,
  },
  overlap: {
    /** Intersection over the smaller box above which two OCR words are overlapping text. */
    overlapRatio: 0.3,
    /** Only words OCR read at least this confidently are tested for overlap. */
    confidenceMin: 80,
    /** A box wider than this many glyph-heights per character is an OCR artefact, not a word. */
    maxCharAspect: 1.3,
    /** Margin kept clear of the frame edge, px at 1080 short side. */
    safeMarginPx: 24,
    /** Frames (of those sampled) allowed to show overlapping or off-safe-area text. */
    badFrameShareMax: 0.1,
  },
  audioSync: {
    /** Seconds a cue may sit from its word start: about one frame at 30 fps, because word edges are so dense that a looser window is met by chance. */
    cueToleranceSec: 0.04,
    /** Seconds a shot boundary may sit from the nearest word edge, with no word spoken across it. */
    boundaryToleranceSec: 0.12,
    /** Seconds the film length may differ from the voiceover length. */
    lengthToleranceSec: 0.1,
  },
  pacing: {
    /** Longest the picture may hold unchanged, seconds. */
    staticRunMaxSec: 3,
    /** Frame difference (0 to 255) below which two frames count as unchanged. */
    staticDiff: 0.05,
    /** Silence longer than this inside narrated speech is dead air, seconds. */
    deadAirMaxSec: 0.7,
    /** Narration pace window, words per minute. */
    wpmMin: 120,
    wpmMax: 180,
    /** Hard cuts (frame difference above this at 10 fps) allowed per minute. */
    hardCutDiff: 12,
    hardCutsPerMinMax: 2,
  },
  loudness: {
    lufsMin: -18,
    lufsMax: -14,
    truePeakMaxDb: -1,
  },
  camera: {
    /** At least one purposeful move per this many seconds. */
    movePerSec: 20,
    /** No move faster than this share of the frame width per second. */
    maxSpeedWidthPerSec: 0.2,
    /** A move must change the framing by at least this share of the frame width (or zoom ratio). */
    minShiftWidth: 0.04,
    minZoomRatio: 1.05,
  },
  planAdherence: {
    /** Plan-directed scene motion must start this close to its spoken cue. */
    cueToleranceSec: 0.4,
    /** A visible object must remain present for at least this opacity. */
    visibleOpacityMin: 0.05,
    /**
     * A drawn stage cast member counts as present in an output when at least this share of its
     * projected posed box (outline included) lies inside that output's frame.
     */
    stagePresentShareMin: 0.5,
    /**
     * A performance's evaluated contact must land within this many frames of its decisive cue
     * resolved from the timed words: one frame absorbs rounding a word time to a frame, nothing more.
     */
    contactCueToleranceFrames: 1,
  },
  grounding: {
    /** On-screen numbers not said in the narration that still pass (the rubric allows zero). */
    ungroundedMax: 0,
  },
} as const;
