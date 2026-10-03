/**
 * File Description: Shared types and path helpers of `aideos all-check`: the options of a run, the
 * per-format round record the background agent's measurements are saved as, and the final result
 * file the calling agent waits for. Everything a run writes lives in videos/<slug>/all-check/.
 */

import path from "node:path";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";

/** The two deliverables of a film: 16:9 long-form and 9:16 reel. */
export type CheckFormat = "long" | "reel";
export const CHECK_FORMATS: readonly CheckFormat[] = ["long", "reel"];

/** Coding agents that can run as the background agent. */
export type AgentName = "claude" | "agy";
export const AGENT_NAMES: readonly AgentName[] = ["claude", "agy"];

export const DEFAULT_ROUNDS = 6;
export const DEFAULT_TARGET = 9.0;

/** An error whose message is already the one clear line (plus the fix) a user should read. */
export class AllCheckError extends Error {}

/** What a run was asked to do. */
export interface AllCheckOptions {
  slug: string;
  /** Absolute path of a reference mp4 the long cut must win or tie against. */
  reference?: string;
  /** Round budget: the most measure-and-fix rounds the agent may spend. */
  rounds: number;
  /** Reviewer score each format must reach. */
  target: number;
  /** Background agent, when named on the command line. */
  agent?: AgentName;
}

/** Saved at launch so the round and finish commands enforce the same rules the run started with. */
export interface AllCheckConfig {
  schema: "aideos.all-check.config/1";
  slug: string;
  reference?: string;
  rounds: number;
  target: number;
  agent: AgentName;
  startedAt: string;
  /** Whether the studio was already listening when the run started: only a studio all-check owns is shut down at the end. */
  studioWasRunning: boolean;
}

/** The agent's own frame check of a round: stills viewed, looking for clipping, overlap or off-frame content. */
export interface FrameCheck {
  status: "pending" | "clean" | "issues";
  issues: string[];
  /** Folder of the stills, relative to the round folder. */
  stillsDir: string;
  stills: string[];
  recordedAt?: string;
}

/** The result of measuring one format in one round. */
export interface FormatRoundRecord {
  schema: "aideos.all-check.round/1";
  round: number;
  format: CheckFormat;
  videoPath: string;
  /** SHA-256 of film.json at render time: ties the long, the reel and the final film together. */
  filmHash: string;
  createdAt: string;
  review: {
    score: number | null;
    verdict: "ACCEPT" | "REVISE" | null;
    /** False when a hard gate of the rubric failed, whatever the mean score. */
    gatesPassed: boolean | null;
    summary: string;
    /** Criteria the reviewer scored under 9 or failed, with their reasons. */
    failedCriteria: string[];
    /** The hard gates that failed (not passed, or under 6), with their reasons: the part of failedCriteria that blocks a pass. */
    failedGates?: string[];
    feedback: Array<{ priority: string; timestamp?: string; issue: string; recommendation: string }>;
    reportPath: string | null;
    /** Set when the review could not run at all (not signed in, quota): never read as a pass. */
    error?: string;
  };
  measured: {
    passed: boolean | null;
    gateFailures: string[];
    softFailures: string[];
    recommendations: string[];
    reportPath: string | null;
    error?: string;
  };
  pairwise?: {
    reference: string;
    winner: string | null;
    candidateScore: number | null;
    referenceScore: number | null;
    passed: boolean | null;
    reportPath: string | null;
    error?: string;
  };
  frameCheck: FrameCheck;
  /** True only when the reviewer, the measured checks, the pairwise check (if any) and the frame check are all clean. */
  passed: boolean;
  /** Every reason `passed` is false, in the words the agent should act on. */
  failing: string[];
}

/** The file the calling agent waits for. */
export interface AllCheckResult {
  schema: "aideos.all-check.result/1";
  slug: string;
  status: "passed" | "failed";
  target: number;
  roundBudget: number;
  roundsUsed: number;
  reference?: string;
  agent: AgentName;
  /** The round the verdict is taken from (the passing re-check of both, or the best round). */
  bestRound: number | null;
  long: { score: number | null; passed: boolean; round: number | null; finalPath: string | null } | null;
  reel: { score: number | null; passed: boolean; round: number | null; finalPath: string | null } | null;
  stillFailing: string[];
  /** When the run did not pass: the round whose film.json was put back on disk so the package matches the best round (null when nothing was restored). */
  restoredFilmFromRound: number | null;
  /** Files the agent created outside videos/<slug>/ during the run, which its rules forbid. */
  strayFiles: string[];
  reportPath: string;
  startedAt: string;
  finishedAt: string;
}

// The all-check working folder of a video package.
export function allCheckDir(slug: string): string {
  return path.join(resolvePackageDir(slug), "all-check");
}

// The folder of one round.
export function roundDir(slug: string, round: number): string {
  return path.join(allCheckDir(slug), `round-${round}`);
}

// Path of the record of one format in one round.
export function recordPath(slug: string, round: number, format: CheckFormat): string {
  return path.join(roundDir(slug, round), `${format}.json`);
}
