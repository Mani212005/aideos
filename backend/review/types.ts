/**
 * File Description: The data contract of `aideos review`.
 * A ReviewReport is the JSON an agent, a person or the Gemini review loop reads: one entry per
 * measurable criterion of the good-video rubric (numbers, a threshold, a status and evidence frame
 * timestamps), the gate failures that make the command exit non-zero, and the raw facts behind them.
 * Criterion ids follow the audit rubric (docs: section 4.2); storyline (10) is not deterministic and
 * is left to the model judge, so it never appears here.
 */

/** A spoken word with its measured offsets in seconds. */
export interface ReviewWord {
  word: string;
  start: number;
  end: number;
}

/** Outcome of one criterion: skipped means the inputs it needs were not available, never a pass. */
export type CriterionStatus = "pass" | "fail" | "skipped";

/** A moment in the video that backs a finding, with the extracted frame when one was written. */
export interface Evidence {
  /** Seconds into the video. */
  t: number;
  /** Path of the evidence still, relative to the report, when one was extracted. */
  frame?: string;
  note: string;
}

/** The criteria this tool measures, keyed by a stable slug. */
export type CriterionKey =
  | "persistent-stage"
  | "carry-over"
  | "cue-timing"
  | "camera"
  | "captions"
  | "readability"
  | "overlap"
  | "audio-sync"
  | "pacing"
  | "grounding"
  | "loudness";

/** One rubric criterion's result. */
export interface CriterionResult {
  /** Rubric number (1 to 12); see the file header. */
  id: number;
  key: CriterionKey;
  name: string;
  /** A failed gate fails the review and makes the CLI exit non-zero. */
  gate: boolean;
  status: CriterionStatus;
  /** 0 to 4 against the rubric anchors, null when skipped. */
  score: number | null;
  summary: string;
  /** Every number the verdict was computed from. */
  metrics: Record<string, number | string | boolean | null>;
  /** The thresholds the metrics were held to, in the same terms. */
  threshold: Record<string, number | string>;
  evidence: Evidence[];
  /** What to change when the criterion failed. */
  fix?: string;
}

/** Facts about the rendered file. */
export interface VideoFacts {
  path: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** Duration of the audio stream in seconds, null when there is none. */
  audioDurationSec: number | null;
}

/** Which optional inputs the review had besides the pixels and the audio. */
export interface ReviewSources {
  /** aideos film data (film.json) used for the camera, element persistence and geometry. */
  film: string | null;
  /** Word timings used for audio sync, caption matching and grounding. */
  words: string | null;
  /** True when only a plain narration text was given: no timings, grounding only. */
  narrationTextOnly: boolean;
}

/** The whole review. */
export interface ReviewReport {
  schema: "aideos.review/1";
  subject: string;
  createdAt: string;
  video: VideoFacts;
  sources: ReviewSources;
  criteria: CriterionResult[];
  /** Keys of failed gate criteria; non-empty means `passed` is false. */
  gateFailures: CriterionKey[];
  /** Keys of failed non-gate criteria. */
  softFailures: CriterionKey[];
  passed: boolean;
  /** Mean of the non-skipped criterion scores (0 to 4), a summary and never the verdict. */
  meanScore: number | null;
  /** Ordered, concrete changes derived from the failures, worst gate first. */
  recommendations: string[];
  /** Where the report and evidence were written, when they were. */
  outDir: string | null;
}
