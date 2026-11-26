/**
 * File Description: Leaf types for the vision judge: options, per-sample records, results and the injectable runner.
 * Inputs and outputs: None -> typed judge contracts.
 * Used by: backend/visionJudge/judge.ts, backend/visionJudge/agentReview.ts, backend/pipeline/deliveryTypes.ts.
 */

import type { DispatchOptions, DispatchResult } from "../agentBridge/types";
import type { FrameVerdict, JevDecisionOptions, SuggestionVerdict } from "../jev";
import type { SampleOptions } from "./sampler";

/** Scores a rendered still against the intent text (0..1); injectable so tests and real embedders plug in. */
export type EmbedFn = (pngPath: string, intent: string) => Promise<number> | number;

/** Where one frame's image-text score came from. */
export type EmbeddingSource = "agent" | "injected" | "none";

/** Options for one judging pass. */
export interface JudgeOptions extends SampleOptions {
  /** Image-text score below which a frame does not match its intent (default 0.5). */
  threshold?: number;
  /** Skip the agent round even when one is connected (the default under the Node test runner). */
  skipAgent?: boolean;
  agentTimeoutMs?: number;
  pollMs?: number;
  /** Studio owner key, so the task reaches the owner's agent connected through `aideos connect`. */
  ownerKey?: string;
  /** Overrides where the score comes from; by default it is the coding model's own report. */
  embed?: EmbedFn;
  jevOptions?: JevDecisionOptions;
  /** Sends the review task; injectable so a test never messages a live session. */
  dispatch?: (opts: DispatchOptions) => Promise<DispatchResult>;
  onProgress?: (message: string) => void;
}

/** One sample with everything the judge learned about it. */
export interface JudgedSample {
  frame: number;
  shotId: string;
  png: string;
  embedding: { score: number | null; threshold: number; pass: boolean | null; source: EmbeddingSource };
  note: string;
  suggestions: string[];
  repaired: boolean;
  verdict: FrameVerdict;
  verdictSource: "jev" | "confidence-fallback" | "heuristic-fallback";
  suggestionVerdicts: SuggestionVerdict[];
}

/** A sample that did not match, with the exact text to hand back to synthesis. */
export interface JudgeFailure {
  frame: number;
  shotId: string;
  verdict: FrameVerdict;
  error: string;
}

/** The outcome of judging one film. */
export interface JudgeResult {
  filmId: string;
  /** Why nothing was judged (no scene, no Chrome), or undefined when the pass ran. */
  skipped?: string;
  agentRound: "reported" | "skipped" | "no-agent" | "timed-out";
  samples: JudgedSample[];
  failures: JudgeFailure[];
  /** True or false when image evidence was judged, null when visual judgment was unavailable. */
  passed: boolean | null;
}

/** Repairs a film from a judge failure report; true only when a passing design build was written. */
export type RepairFn = (errors: string) => Promise<boolean>;

/** Judges a film and repairs it while samples fail; injectable so a test or another renderer supplies the evidence. */
export type JudgeRunner = (
  filmId: string,
  options?: JudgeOptions & { repair?: RepairFn; maxRepairRounds?: number },
) => Promise<JudgeResult>;
