/**
 * File Description: Data contract and fixed method constants of `aideos study`, the numbers-only reference study. A study bible holds
 * metrics (each with the methods that measured it, a stated tolerance and an agreement flag), what no tool measured, and the series behind them.
 * Inputs and outputs: TypeScript definitions and constants -> StudyBible, Metric, MethodReading and the STUDY method constants.
 * Used by: backend/study/*.ts, backend/cli.ts.
 */

/** Schema id written into every study bible. */
export const STUDY_SCHEMA = "aideos.study/1";
/** Schema id of the seed file (a proposal for design/look.json, never a valid look plan by itself). */
export const SEED_SCHEMA = "aideos.look.seed/1";

/** The boundary every study output repeats: craft measurements only. */
export const IP_BOUNDARY =
  "Craft measurements only: cut cadence, camera speed, tone, caption cadence and pacing as numbers. No identity, likeness, script, voice, character or channel cloning. " +
  "Reference videos are local files you are allowed to analyse; aideos does not download or scrape anything.";

/** Every fixed number a study method uses, stated so a bible can name its own method and threshold. None of these are review thresholds. */
export const STUDY = {
  /** Longest side of the frames decoded for pixel analysis, px (the other side keeps the aspect). */
  analysisLongSide: 320,
  /** Pixel analysis never decodes faster than this many frames per second. */
  analysisMaxFps: 30,
  cuts: {
    /** Method A: ffmpeg `select=gt(scene,T)` score threshold (0 to 1). */
    sceneThreshold: 0.3,
    /** Method B: a block counts as changed when its mean absolute gray difference (0 to 255) exceeds this. */
    blockChangeLevels: 20,
    /** Method B: a frame pair is a cut when at least this share of 8x8 blocks changed. */
    changedBlockShareMin: 0.6,
    /** Cuts the two methods place within this many seconds are the same cut. */
    matchWithinSec: 0.1,
    /** The cut list agrees when at most this share of all cuts found by either method are unmatched. */
    unmatchedShareMax: 0.15,
  },
  camera: {
    /** A frame pair is moving when the fastest frame corner moves at least this many frame widths per second. */
    moveMinWidthsPerSec: 0.01,
    /** Moving runs shorter than this many frame pairs are noise; gaps up to this many pairs inside a move are bridged. */
    minMoveFrames: 3,
    bridgeGapFrames: 2,
    /** Method A: tile grid, and the bottom share of the frame masked out as the caption band. */
    tiles: { cols: 4, rows: 4, maskBottomShare: 0.3, minTextureEnergy: 4 },
    /** Method B: block size, and the coarse search radius (px at half size; the fine step adds 1 px at full size) of the block matcher. */
    blocks: { size: 16, coarseRadius: 2, minVariance: 20 },
    /** Agreement tolerances between the two camera methods. */
    tolerance: { movingShareAbs: 0.1, speedRel: 0.3, speedAbsWidthsPerSec: 0.01, moveFramesRel: 0.35, moveFramesAbs: 3, moveCountAbs: 1 },
  },
  tone: {
    /** Frames per second sampled for luma, contrast and saturation. */
    sampleFps: 5,
    /** Agreement tolerance (absolute, on the 0 to 1 scales used). */
    toleranceAbs: 0.05,
  },
  captions: {
    /** The caption band is the bottom share of the frame; the review's own band top ratio (0.75). */
    bandTopRatio: 0.75,
    /** Seconds between OCR samples; the review's own cadence. */
    sampleEverySec: 2,
    /** Pixel presence test: ink (more than this many gray levels off the band median) covers between these shares of the band. */
    inkLevels: 28,
    inkShareMin: 0.004,
    inkShareMax: 0.35,
    /** Agreement tolerance on the share of samples with a caption. */
    presenceToleranceAbs: 0.15,
  },
  audio: {
    /** Pauses are silences at least this long, seconds. */
    pauseMinSec: 0.3,
    /** Method A: ffmpeg silencedetect noise floor. */
    silenceNoiseDb: -45,
    /** Method B: a 20 ms window is silent when it is this far below the 95th percentile window level, dB (floor -70 dB). */
    silenceBelowPeakDb: 35,
    windowSec: 0.02,
    /** Agreement tolerances. */
    tolerance: { pauseCountAbs: 1, pauseTotalAbsSec: 0.3, pauseTotalRel: 0.2, speechShareAbs: 0.05 },
  },
} as const;

/** One method's reading of a metric (null when it could not measure it). */
export interface MethodReading {
  /** Method name, stating what it is and any threshold it uses. */
  method: string;
  value: number | null;
  /** Why the method could not measure, or a caveat. */
  note?: string;
}

/** How a metric stands: agreed (two methods inside tolerance), unresolved (they disagree or one could not run), single-method (only one method exists for it), not-pixel (measured from metadata or audio by one named method, no pixel claim). */
export type MetricStatus = "agreed" | "unresolved" | "single-method" | "not-pixel";

/** One measured number with its methods and agreement. Only `agreed` and `not-pixel` metrics seed a look. */
export interface Metric {
  id: string;
  label: string;
  unit: string;
  status: MetricStatus;
  /** The value the bible stands behind: the first method's reading when the methods agree, null otherwise. */
  value: number | null;
  methods: MethodReading[];
  /** The stated tolerance the agreement used, in words. */
  tolerance: string | null;
  /** Absolute difference between the two methods when both read. */
  delta: number | null;
  /** True when the metric may seed a look. */
  seedEligible: boolean;
  /** Why a metric is unresolved or single-method. */
  reason?: string;
}

/** A cut the study found, with each method's score and whether both found it. */
export interface CutRecord {
  t: number;
  sceneScore: number | null;
  changedBlockShare: number | null;
  agreed: boolean;
}

/** One camera move from method A, for the speed profile. */
export interface MoveRecord {
  startSec: number;
  frames: number;
  peakWidthsPerSec: number;
  meanWidthsPerSec: number;
}

/** What the study could not measure, with the reason, so a reader never mistakes a gap for a zero. */
export interface NotMeasured {
  what: string;
  why: string;
}

/** The bible for one reference. */
export interface StudyBible {
  schema: typeof STUDY_SCHEMA;
  /** Always true: a study is a measurement proposal, never a plan or a verdict. */
  proposal: true;
  boundary: string;
  generatedAt: string;
  source: { file: string; sizeBytes: number };
  media: { durationSec: number; width: number; height: number; aspect: string; fps: number; hasAudio: boolean };
  metrics: Metric[];
  series: {
    cuts: CutRecord[];
    shotLengthsSec: number[];
    moves: MoveRecord[];
    pauseMap: Array<{ start: number; end: number }>;
  };
  notMeasured: NotMeasured[];
}

/** Rounds to a fixed number of decimals for readable JSON. */
export function round(value: number, digits = 4): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}
