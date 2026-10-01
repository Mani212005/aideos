/**
 * File Description: Type definitions for the Gemini 3.8 Flash video quality review engine,
 * structured rubric scoring, timestamp evidence validation, and iterative review loop.
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
}

export interface ReviewLoopResult {
  slug: string;
  finalScore: number;
  finalVerdict: "ACCEPT" | "REVISE";
  passed: boolean;
  rounds: ReviewLoopRound[];
  outputPath?: string;
}

export interface ReviewLoopOptions {
  maxRounds?: number;
  targetScore?: number;
  format?: "long" | "reel";
  autoRefine?: boolean;
  onProgress?: (message: string) => void;
  mockReviewer?: (videoPath: string, round: number) => Promise<GeminiReviewReport>;
  mockRenderer?: (slug: string, format: string) => Promise<string>;
}
