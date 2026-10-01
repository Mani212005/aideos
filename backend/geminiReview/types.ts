/**
 * File Description: Type definitions for the Gemini 3.8 Flash video quality review engine,
 * structured rubric scoring, timestamp evidence validation, deterministic facts, and iterative review loop.
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

export interface PairwiseComparisonResult {
  orderKey: string;
  video1Path: string;
  video2Path: string;
  video1Score: number;
  video2Score: number;
  choice: "Video 1" | "Video 2" | "Tie";
  reasoning: string;
  timestampsCited: string[];
}

export interface PairwiseRunReport {
  orderAB: PairwiseComparisonResult;
  orderBA: PairwiseComparisonResult;
  consistentWinner: "Video A" | "Video B" | "Inconsistent";
  evaluatedAt: string;
}

export interface ReviewLoopRound {
  round: number;
  score: number;
  verdict: "ACCEPT" | "REVISE";
  feedback: ReviewFeedbackItem[];
  videoHash: string;
  videoPath: string;
  timestamp: string;
  report: GeminiReviewReport;
  pairwiseReport?: PairwiseRunReport;
}

export interface ReviewLoopResult {
  slug: string;
  finalScore: number;
  finalVerdict: "ACCEPT" | "REVISE";
  passed: boolean;
  rounds: ReviewLoopRound[];
  outputPath?: string;
  referenceVideo?: string;
  pairwisePassed?: boolean;
}

export interface ReviewLoopOptions {
  maxRounds?: number;
  targetScore?: number;
  referenceVideo?: string;
  format?: "long" | "reel";
  autoRefine?: boolean;
  onProgress?: (message: string) => void;
  mockReviewer?: (videoPath: string, round: number) => Promise<GeminiReviewReport>;
  mockRenderer?: (slug: string, format: string) => Promise<string>;
  mockPairwise?: (path1: string, path2: string) => Promise<PairwiseRunReport>;
}
