/**
 * File Description: The data contract of `aideos review`.
 * A ReviewReport is the JSON an agent, a person or the Gemini review loop reads: one entry per
 * measurable criterion of the good-video rubric (numbers, a threshold, a status and evidence frame
 * timestamps), the gate failures that make the command exit non-zero, and the raw facts behind them.
 * Criterion ids follow the audit rubric (docs: section 4.2), with supplemental plan adherence as 13,
 * reel delivered length as 14 and the reel hook as 15;
 * storyline (10) is not deterministic and is left to the model judge, so it never appears here.
 * Inputs and outputs: TypeScript definitions -> ReviewReport, CriterionResult, and Facts interfaces.
 * Used by: backend/review/review.ts, backend/review/criteria.ts.
 */
import type { FilmFacts } from "./source";
import type { VideoFacts } from "../media/probe";
import type { TimedWord } from "../pcm";

/** The truthful stage description for one output. */
export interface StageTruth {
  renderer: "three";
  treatments: FilmFacts["stageTreatments"];
  fps: number;
  format: "long" | "reel";
  viewport: { width: number; height: number };
  characters: Array<{ castId: string; id: string | null; version: number | null; rig: string | null; hash: string | null; name: string | null }>;
  props: string[];
  /** Cast members no performance draws: never on screen. */
  hidden: string[];
  shots: Array<{ id: string; startSec: number; endSec: number; inFrameAtStart: string[]; inFrameAtEnd: string[]; offFrameAtStart: string[]; offFrameAtEnd: string[] }>;
  performances: Array<{
    id: string; action: string; actor: string; prop: string; character: string | null;
    decisive: { shotId: string; phrase: string; edge: "start" | "end" };
    /** Frame of the decisive word from the timed words, null when they are missing or do not contain it. */
    cueFrame: number | null;
    contactFrame: number | null;
    ownership: NonNullable<FilmFacts["performances"]>[number]["ownership"];
    /** Contact minus cue, in frames; null when either is unknown. */
    offsetFrames: number | null;
    presentAtContact: string[];
    afterState: string;
  }>;
  camera: { moves: number; maxSpeedWidthsPerSec: number; summary: string };
  measured: readonly string[];
  unmeasured: readonly string[];
}

/** Facts about the rendered file: one definition, beside the one probe that measures them. */
export type { VideoFacts };

/** A spoken word with its measured offsets in seconds (the shared TimedWord). */
export type ReviewWord = TimedWord;

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
  | "plan-adherence"
  | "cue-timing"
  | "camera"
  | "captions"
  | "readability"
  | "overlap"
  | "audio-sync"
  | "pacing"
  | "grounding"
  | "loudness"
  | "reel-length"
  | "hook"
  | "narration-flow";

/** One rubric criterion's result. */
export interface CriterionResult {
  /** Rubric number (1 to 12), or supplemental criterion 13; see the file header. */
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
  format?: "long" | "reel";
  /** Format-indexed stage facts distinguish projected geometry from unmeasured visual craft. */
  stage?: FilmFacts["stage"];
  /** The stage as measured in this video's own output: drawn cast, per-shot presence, contact against the cue, camera, and what is unmeasured. */
  stageTruth?: StageTruth;
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
