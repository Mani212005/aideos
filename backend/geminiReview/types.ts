/**
 * File Description: Type definitions for the Gemini 3.8 Flash video quality review engine,
 * structured rubric scoring, timestamp evidence validation, deterministic facts, and iterative review loop.
 * Inputs and outputs: TypeScript definitions -> types for rubric scoring, facts, and review reports.
 * Used by: backend/geminiReview/geminiReview.ts, backend/geminiReview/facts.ts.
 */

import type { StageTruth } from "../review/stageTruth";

export interface CriterionEvaluation {
  name: string;
  title: string;
  isGate: boolean;
  score: number;
  passed: boolean;
  evidenceTimestamps: string[];
  reason: string;
}

export interface ReviewFeedbackItem {
  priority: "high" | "medium" | "low";
  timestamp?: string;
  issue: string;
  recommendation: string;
}

export interface DeterministicVideoFacts {
  reelLength?: { capSec: number; passed: boolean; summary: string };
  endCard?: { startSec: number; endSec: number } | null;
  /** A Three stage film measured in this video's own output (see backend/review/stageTruth.ts). */
  stage?: StageTruth;
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  audio: {
    measured: boolean;
    hasAudio: boolean;
    integratedLufs: number;
    truePeakDb: number;
    summary: string;
  };
  bottomCaptions: {
    measured: boolean;
    hasCaptions: boolean;
    coverageRatio: number;
    sampledFrames: number;
    captionFrames: number;
    /** Seconds of the sampled frames that showed a caption band. */
    captionTimesSec?: number[];
    score: number;
    summary: string;
  };
  camera: {
    measured: boolean;
    hasCameraMoves: boolean;
    moveCount: number;
    score: number;
    summary: string;
  };
  readability: {
    measured: boolean;
    smallWordShare?: number;
    summary: string;
  };
  rawSummaryText: string;
}

/** One draw of the reviewer model over the same video bytes. */
export interface ReviewDrawReport {
  /** 1 for the first draw, 2 for the one extra draw the verdict policy allows. */
  draw: number;
  /** The reviewer's own overall number for this draw, kept for the record only. */
  overallScore: number;
  /** The mean of this draw's individual criteria scores (held at 8.5 while a hard gate failed): the number the verdict uses. */
  score: number;
  gatesPassed: boolean;
  timestampsValid: boolean;
  /** What this draw alone would have been: ACCEPT only at the bar with gates and timestamps held. */
  verdict: "ACCEPT" | "REVISE";
  criteria: CriterionEvaluation[];
  evaluatedAt: string;
}

export interface GeminiReviewReport {
  /** The reviewer's own overall number (of the first draw), kept for the record. It never decides the verdict: criteriaMeanScore does. */
  overallScore: number;
  /** The score the verdict was decided on: the mean of the individual criteria scores, combined over both draws when two ran. Absent in reports written before the verdict policy. */
  criteriaMeanScore?: number;
  /** Every draw of the reviewer behind this report (one, or two when the first was within 0.5 of the bar). */
  draws?: ReviewDrawReport[];
  /** Plain words on how many draws ran and why. */
  drawNote?: string;
  verdict: "ACCEPT" | "REVISE";
  summary: string;
  criteria: CriterionEvaluation[];
  feedback: ReviewFeedbackItem[];
  model: string;
  evaluatedAt: string;
  videoHash?: string;
  videoPath?: string;
  facts?: DeterministicVideoFacts;
}

export interface WatchReport {
  rating: number;
  likes: string[];
  dislikes: string[];
  neutral: string[];
  timestamps: string[];
}

export interface PairwiseRunReport {
  videoA: {
    path: string;
    watchReport: WatchReport;
    ratingByWatcher: number;
    ratingByOther: number;
    finalRating: number;
  };
  videoB: {
    path: string;
    watchReport: WatchReport;
    ratingByWatcher: number;
    ratingByOther: number;
    finalRating: number;
  };
  winner: "Video A" | "Video B" | "Tie";
  evaluatedAt?: string;
}

export interface AgyRunnerOptions {
  model?: string;
  timeoutSeconds?: number;
  schema?: object;
  cwd?: string;
  conversationId?: string;
  onProgress?: (message: string) => void;
}

export type AgyRunner = (
  prompt: string,
  options?: AgyRunnerOptions,
) => Promise<string | Record<string, any>>;

export interface AgyReviewClient {
  runReviewPrompt(
    prompt: string,
    options?: AgyRunnerOptions,
  ): Promise<string | Record<string, any>>;
}
