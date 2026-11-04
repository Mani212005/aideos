/**
 * File Description: The captain-attended waiver of the reel's Gemini verdict in a release, and the review sequence that applies it.
 * Inputs and outputs: waiver request, Gemini reports of the rendered outputs -> a refusal, a recorded waiver or nothing.
 * Used by: scripts/release.ts and scripts/release_waiver.test.ts.
 */

import type { GeminiReviewReport } from "../backend/geminiReview/types";
import { validateCriterionTimestamps } from "../backend/geminiReview/rubric";

/** The six hard gates plus the reel's delivered length: none of them can be waived. */
export const UNWAIVABLE_REEL_GATES = [
  "persistent_stage", "camera_purpose", "bottom_captions", "readability", "no_overlap_clipping", "audio_sync", "reel_length",
] as const;

/** The standing rule a waiver is an exception to, stated wherever the waiver is recorded or shown. */
export const WAIVER_RULE = "Gemini review of every video and reel stays mandatory; this is a one-time captain-attended exception, not a way to skip review in routine releases.";

/** What a waived reel review leaves in production.json and the release tag. */
export interface ReelGeminiWaiver {
  kind: "reel-gemini-verdict";
  rule: string;
  reason: string;
  verdict: GeminiReviewReport["verdict"];
  overallScore: number;
  summary: string;
  criteria: { name: string; title: string; isGate: boolean; passed: boolean; score: number }[];
  waivedAt: string;
}

/** Refuses a waiver unless it carries a reason, comes from a terminal and rides on a release with acceptance. */
export function requireWaiverAllowed(request: { reason?: string; acceptance?: string; interactive: boolean }): string {
  const reason = (request.reason ?? "").trim();
  if (!reason || reason.startsWith("-")) throw new Error("--waive-reel-gemini needs a reason (non-empty text) that says why the reel's Gemini verdict is waived.");
  if (!request.acceptance) throw new Error("--waive-reel-gemini is only valid with --acceptance.");
  if (!request.interactive) throw new Error("--waive-reel-gemini requires an interactive terminal; a captain must attend the release.");
  return reason;
}

/** Lists why a reel review cannot be waived: any hard gate, the delivered length or a criterion's evidence that is not sound. */
export function reelWaiverProblems(report: GeminiReviewReport): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(report.overallScore)) problems.push("the review has no numeric overall score");
  for (const name of UNWAIVABLE_REEL_GATES) {
    const criterion = report.criteria.find((item) => item.name === name);
    if (!criterion) problems.push(`${name} was not reviewed`);
    else if (!criterion.passed || !(criterion.score >= 6)) problems.push(`${criterion.title} failed (${criterion.score}/10)`);
  }
  const evidence = validateCriterionTimestamps(report.criteria);
  if (!evidence.valid) problems.push(`no timestamp evidence for ${evidence.missing.join(", ")}`);
  return problems;
}

/** Decides one reel review: ACCEPT needs no waiver, a REVISE with every gate intact is waived, anything else stops the release. */
export function waiveReelVerdict(report: GeminiReviewReport, reason: string, now: Date): ReelGeminiWaiver | undefined {
  if (report.verdict === "ACCEPT") return undefined;
  const problems = reelWaiverProblems(report);
  if (problems.length) throw new Error(`The reel's Gemini review cannot be waived: ${problems.join("; ")}.`);
  return {
    kind: "reel-gemini-verdict", rule: WAIVER_RULE, reason, verdict: report.verdict, overallScore: report.overallScore, summary: report.summary,
    criteria: report.criteria.map(({ name, title, isGate, passed, score }) => ({ name, title, isGate, passed, score })),
    waivedAt: now.toISOString(),
  };
}

/** Reviews each output with Gemini, long film first and strictly; only the reel may be waived, and only when the captain asked. */
export async function reviewWithGemini(
  outputs: { format: string; path: string }[],
  deps: {
    strictReview: (videoPath: string) => void;
    reelReview: (videoPath: string) => Promise<GeminiReviewReport>;
    print: (report: GeminiReviewReport) => void;
    now: () => Date;
  },
  waiverReason?: string,
): Promise<ReelGeminiWaiver | undefined> {
  const ordered = [...outputs].sort((a, b) => Number(a.format === "reel") - Number(b.format === "reel"));
  let waiver: ReelGeminiWaiver | undefined;
  for (const output of ordered) {
    if (output.format !== "reel" || waiverReason === undefined) { deps.strictReview(output.path); continue; }
    const report = await deps.reelReview(output.path);
    deps.print(report);
    waiver = waiveReelVerdict(report, waiverReason, deps.now());
  }
  return waiver;
}

/** Words the waiver as the tag annotation's second paragraph, or nothing when no waiver was needed. */
export function waiverTagNote(waiver: ReelGeminiWaiver | undefined): string {
  if (!waiver) return "";
  return `\n\nCaptain-attended waiver of the reel's Gemini verdict (${waiver.verdict}, ${waiver.overallScore.toFixed(1)}/10) at ${waiver.waivedAt}. Reason: ${waiver.reason}\n${WAIVER_RULE}`;
}

/** Prints the waived verdict where the captain cannot miss it before the typed approval. */
export function announceWaiver(waiver: ReelGeminiWaiver, log: (line: string) => void = console.log): void {
  const failing = waiver.criteria.filter((item) => !item.passed).map((item) => `${item.title} ${item.score}/10`);
  log([
    "", "=".repeat(72), "WAIVED: the reel's Gemini verdict does not meet the release threshold",
    `  verdict ${waiver.verdict}, overall ${waiver.overallScore.toFixed(1)} / 10`,
    `  criteria not passing: ${failing.length ? failing.join(", ") : "none individually"}`,
    `  reason given: ${waiver.reason}`,
    `  ${WAIVER_RULE}`,
    "  Gates still enforced: all six hard gates, reel delivered length, the long film's review, measured reviews.",
    "=".repeat(72), "",
  ].join("\n"));
}
