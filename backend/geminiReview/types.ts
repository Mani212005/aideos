/**
 * File Description: Type definitions for the Gemini 3.8 Flash video quality review engine,
 * structured rubric scoring, timestamp evidence validation, deterministic facts, and iterative review loop.
 * Inputs and outputs: TypeScript definitions -> types for rubric scoring, facts, and review reports.
 * Used by: backend/geminiReview/geminiReview.ts, backend/geminiReview/facts.ts.
 */

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

export interface GeminiReviewReport {
  overallScore: number;
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
