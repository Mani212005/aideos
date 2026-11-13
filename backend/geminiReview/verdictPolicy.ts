/**
 * File Description: The Gemini review verdict policy (audit machine M4, option C). One draw of the reviewer model is
 * not stable (the same bytes were ACCEPT 9.2 and then REVISE 8.6), so the verdict never rests on the model's own
 * overall number. (1) A draw's score is the MEAN OF ITS INDIVIDUAL CRITERIA SCORES, computed here. (2) When that mean
 * is within 0.5 of the 9.0 bar (8.5 up to 9.5, both ends included) and the draw could still be an ACCEPT, exactly ONE
 * second draw of the same bytes is run, never a loop, so a review costs at most two reviewer calls. (3) With two
 * draws the combined score is the mean of the two draw scores, and ACCEPT needs combined >= 9.0 with every hard gate
 * passing and every criterion carrying timestamp evidence in EVERY draw. The 9.0 bar, the hard gates and the timestamp
 * rule are exactly the ones that were there before; only the way the score is computed, and when a second draw runs,
 * changed. Worked example (release 0.5.0, long film): the first draw was ACCEPT 9.2 and the second REVISE 8.6, both
 * the model's own numbers. Its twelve criteria in the second draw averaged 8.81, not 8.6. Say the first draw's
 * criteria also averaged 9.2: that is inside the band, so a second draw runs; combined = (9.2 + 8.81) / 2 = 9.005,
 * which is >= 9.0, so with the gates and timestamps passing the verdict is ACCEPT. If the second draw's criteria had
 * averaged 8.6 the combined score would be 8.9 and the verdict REVISE. A first draw that already averages 9.6 is
 * ACCEPT alone, and one that averages 8.4 is REVISE alone, in both cases with a single reviewer call.
 * Inputs and outputs: criteria evaluations or per-draw scores -> a draw score, whether a second draw is needed, the
 * combined score and verdict, and the plain-words description of how many draws ran.
 * Used by: backend/geminiReview/geminiReview.ts, backend/allCheck/round.ts, backend/filmAcceptance/machine.ts.
 */

import type { CriterionEvaluation } from "./types";

/** The score a review must reach to be an ACCEPT. */
export const VERDICT_BAR = 9.0;
/** A draw whose score is within this distance of the bar (either side) earns a second draw. */
export const SECOND_DRAW_BAND = 0.5;
/** A review is never more than this many draws of the reviewer: one, plus at most one more. */
export const MAX_REVIEW_DRAWS = 2;
/** The score a failed hard gate caps a draw at, as before (a gate failure never reads as 9.0 or better). */
export const FAILED_GATE_SCORE_CAP = 8.5;
// Float noise only (a mean of one-decimal scores can land a hair under the exact value), never a looser bar.
const EPSILON = 1e-9;

/** What the policy needs to know about one draw. */
export interface DrawScore {
  /** The mean of the draw's individual criteria scores (capped when a hard gate failed). */
  score: number;
  /** True when no hard gate failed (failed, or scored under 6.0) in this draw. */
  gatesPassed: boolean;
  /** True when every criterion of this draw carried timestamp evidence. */
  timestampsValid: boolean;
}

// The arithmetic mean of the individual criteria scores (0 for an empty list, which never passes).
export function criteriaMean(criteria: readonly Pick<CriterionEvaluation, "score">[]): number {
  if (criteria.length === 0) return 0;
  return criteria.reduce((sum, criterion) => sum + criterion.score, 0) / criteria.length;
}

// The score of one draw: the criteria mean, held under the cap while a hard gate failed.
export function drawScoreOf(criteria: readonly Pick<CriterionEvaluation, "score">[], gatesPassed: boolean): number {
  const mean = criteriaMean(criteria);
  return gatesPassed ? mean : Math.min(mean, FAILED_GATE_SCORE_CAP);
}

// Whether a score reaches the bar (float noise tolerated, nothing else).
export function reachesBar(score: number, bar: number = VERDICT_BAR): boolean {
  return score >= bar - EPSILON;
}

// Whether a draw by itself could still end as an ACCEPT: its gates and timestamps hold.
export function drawCanAccept(draw: DrawScore): boolean {
  return draw.gatesPassed && draw.timestampsValid;
}

// Whether a score lies within 0.5 of the bar (8.5 up to 9.5, both ends included).
export function withinSecondDrawBand(score: number): boolean {
  return Math.abs(score - VERDICT_BAR) <= SECOND_DRAW_BAND + EPSILON;
}

// Whether the first draw is close enough to the bar to be settled by a second draw. A draw that already fails a gate or a timestamp can never be rescued by one, so it costs no second call.
export function needsSecondDraw(first: DrawScore): boolean {
  return drawCanAccept(first) && withinSecondDrawBand(first.score);
}

/** The decision over one or two draws. */
export interface ReviewDecision {
  /** The mean of the draw scores: the one number the verdict was decided on. */
  score: number;
  verdict: "ACCEPT" | "REVISE";
  gatesPassed: boolean;
  timestampsValid: boolean;
}

// Decides a review from its draws: combined score at the bar or better, and the gates and timestamps held in every draw.
export function decideReview(draws: readonly DrawScore[]): ReviewDecision {
  if (draws.length === 0) return { score: 0, verdict: "REVISE", gatesPassed: false, timestampsValid: false };
  const score = draws.reduce((sum, draw) => sum + draw.score, 0) / draws.length;
  const gatesPassed = draws.every((draw) => draw.gatesPassed);
  const timestampsValid = draws.every((draw) => draw.timestampsValid);
  return { score, verdict: reachesBar(score) && gatesPassed && timestampsValid ? "ACCEPT" : "REVISE", gatesPassed, timestampsValid };
}

// Shows a score to two decimals, cut rather than rounded, so a failing score never reads as 9.00 and a passing one never reads below it.
export function formatScore(score: number): string {
  return (Math.floor(score * 100 + 1e-6) / 100).toFixed(2);
}

// The score a report was decided on: the criteria mean, or the reviewer's own number for a report written before the verdict policy.
export function decisionScore(report: { criteriaMeanScore?: number; overallScore: number }): number {
  return report.criteriaMeanScore ?? report.overallScore;
}

// Says in plain words how many reviewer draws ran and which score decided, for the CLI, the round notes and the Export dialog.
export function describeDraws(scores: readonly number[], combined: number): string {
  const fmt = formatScore;
  if (scores.length <= 1) return `1 reviewer draw (score ${fmt(combined)}, the mean of its criteria scores), not within 0.5 of the ${VERDICT_BAR.toFixed(1)} bar, so no second draw was needed.`;
  return `${scores.length} reviewer draws of the same video (${scores.map(fmt).join(" and ")}) because the first was within 0.5 of the ${VERDICT_BAR.toFixed(1)} bar; the combined score ${fmt(combined)} (their mean) decides.`;
}
