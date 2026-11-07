/**
 * File Description: The captain-attended one-time waivers of the reel's and the long film's Gemini verdicts in the 0.5.0 release, and the review sequence that applies them.
 * Inputs and outputs: waiver requests, Gemini reports of the rendered outputs -> a refusal, recorded waivers or nothing.
 * Used by: scripts/release.ts and scripts/release_waiver.test.ts.
 */

import type { GeminiReviewReport } from "../backend/geminiReview/types";
import { validateCriterionTimestamps } from "../backend/geminiReview/rubric";

/** The six hard gates of a Gemini review: none of them can be waived for either film. */
export const UNWAIVABLE_LONG_GATES = [
  "persistent_stage", "camera_purpose", "bottom_captions", "readability", "no_overlap_clipping", "audio_sync",
] as const;

/** The long film's gates are the six hard gates only: the long film has no reel_length criterion, which is reel-only. */
export const UNWAIVABLE_REEL_GATES = [...UNWAIVABLE_LONG_GATES, "reel_length"] as const;

/** The only release version the captain approved a Gemini waiver for: a one-time exception that expires with it. */
export const WAIVED_VERSION = "0.5.0";

/** The standing rule a waiver is an exception to, stated wherever the waiver is recorded or shown. */
export const WAIVER_RULE = "Gemini review of every video and reel stays mandatory in every release other than 0.5.0 and for every other video; this is a one-time captain-attended exception for 0.5.0 only, not a way to skip review in routine releases. The review itself still runs and its verdict is recorded.";

/** What a waived Gemini review leaves in production.json and the release tag; the kind names the film whose verdict was waived. */
export interface GeminiVerdictWaiver<K extends string> {
  kind: K;
  rule: string;
  reason: string;
  verdict: GeminiReviewReport["verdict"];
  overallScore: number;
  summary: string;
  criteria: { name: string; title: string; isGate: boolean; passed: boolean; score: number }[];
  waivedAt: string;
}
export type ReelGeminiWaiver = GeminiVerdictWaiver<"reel-gemini-verdict">;
export type LongGeminiWaiver = GeminiVerdictWaiver<"long-gemini-verdict">;
export type GeminiWaiver = ReelGeminiWaiver | LongGeminiWaiver;

/** The two films a waiver can cover, each with its own flag, record kind, wording and gates; the waivers are independent. */
const FILMS = {
  reel: { kind: "reel-gemini-verdict", flag: "--waive-reel-gemini", possessive: "the reel's", gates: UNWAIVABLE_REEL_GATES,
    enforced: "all six hard gates, reel delivered length, timestamp evidence, measured reviews" },
  long: { kind: "long-gemini-verdict", flag: "--waive-long-gemini", possessive: "the long film's", gates: UNWAIVABLE_LONG_GATES,
    enforced: "all six hard gates, timestamp evidence, measured reviews" },
} as const;
export type WaivedFilm = keyof typeof FILMS;

/** Refuses a waiver unless it is for the one approved version, carries a reason, comes from a terminal and rides on a release with acceptance. */
export function requireWaiverAllowed(request: { version: string; reason?: string; acceptance?: string; interactive: boolean; film?: WaivedFilm }): string {
  const { flag, possessive } = FILMS[request.film ?? "reel"];
  if (request.version !== WAIVED_VERSION) throw new Error(`${flag} is a one-time exception for ${WAIVED_VERSION} only and is refused for ${request.version}: Gemini review of every video and reel is mandatory.`);
  const reason = (request.reason ?? "").trim();
  if (!reason || reason.startsWith("-")) throw new Error(`${flag} needs a reason (non-empty text) that says why ${possessive} Gemini verdict is waived.`);
  if (!request.acceptance) throw new Error(`${flag} is only valid with --acceptance.`);
  if (!request.interactive) throw new Error(`${flag} requires an interactive terminal; a captain must attend the release.`);
  return reason;
}

/** Lists why a review cannot be waived: any gate of the film or a criterion's evidence that is not sound. */
function waiverProblems(report: GeminiReviewReport, gates: readonly string[]): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(report.overallScore)) problems.push("the review has no numeric overall score");
  for (const name of gates) {
    const criterion = report.criteria.find((item) => item.name === name);
    if (!criterion) problems.push(`${name} was not reviewed`);
    else if (!criterion.passed || !(criterion.score >= 6)) problems.push(`${criterion.title} failed (${criterion.score}/10)`);
  }
  const evidence = validateCriterionTimestamps(report.criteria);
  if (!evidence.valid) problems.push(`no timestamp evidence for ${evidence.missing.join(", ")}`);
  return problems;
}

/** Lists why a reel review cannot be waived: any hard gate, the delivered length or a criterion's evidence that is not sound. */
export function reelWaiverProblems(report: GeminiReviewReport): string[] {
  return waiverProblems(report, UNWAIVABLE_REEL_GATES);
}

/** Lists why a long film review cannot be waived: any of the six hard gates or a criterion's evidence that is not sound. */
export function longWaiverProblems(report: GeminiReviewReport): string[] {
  return waiverProblems(report, UNWAIVABLE_LONG_GATES);
}

/** Decides one review: ACCEPT needs no waiver, a REVISE with every gate intact is waived, anything else stops the release. */
function waiveVerdict<F extends WaivedFilm>(film: F, report: GeminiReviewReport, reason: string, now: Date): GeminiVerdictWaiver<(typeof FILMS)[F]["kind"]> | undefined {
  if (report.verdict === "ACCEPT") return undefined;
  const { kind, possessive, gates } = FILMS[film];
  const problems = waiverProblems(report, gates);
  if (problems.length) throw new Error(`${possessive[0].toUpperCase()}${possessive.slice(1)} Gemini review cannot be waived: ${problems.join("; ")}.`);
  return {
    kind, rule: WAIVER_RULE, reason, verdict: report.verdict, overallScore: report.overallScore, summary: report.summary,
    criteria: report.criteria.map(({ name, title, isGate, passed, score }) => ({ name, title, isGate, passed, score })),
    waivedAt: now.toISOString(),
  };
}

/** Decides one reel review: ACCEPT needs no waiver, a REVISE with every gate intact is waived, anything else stops the release. */
export function waiveReelVerdict(report: GeminiReviewReport, reason: string, now: Date): ReelGeminiWaiver | undefined {
  return waiveVerdict("reel", report, reason, now);
}

/** Decides one long film review: ACCEPT needs no waiver, a REVISE with all six hard gates intact is waived, anything else stops the release. */
export function waiveLongVerdict(report: GeminiReviewReport, reason: string, now: Date): LongGeminiWaiver | undefined {
  return waiveVerdict("long", report, reason, now);
}

/** Reviews each output with Gemini, long film first; a film is reviewed strictly unless the captain waived its verdict, and then its report is still run, printed and recorded. */
export async function reviewFilmsWithGemini(
  outputs: { format: string; path: string }[],
  deps: {
    strictReview: (videoPath: string) => void;
    review: (videoPath: string) => Promise<GeminiReviewReport>;
    print: (report: GeminiReviewReport) => void;
    now: () => Date;
  },
  reasons: { reel?: string; long?: string },
): Promise<GeminiWaiver[]> {
  const ordered = [...outputs].sort((a, b) => Number(a.format === "reel") - Number(b.format === "reel"));
  const waivers: GeminiWaiver[] = [];
  for (const output of ordered) {
    const film = output.format === "reel" || output.format === "long" ? output.format : undefined;
    const reason = film && reasons[film];
    if (!film || reason === undefined) { deps.strictReview(output.path); continue; }
    const report = await deps.review(output.path);
    deps.print(report);
    const waiver = waiveVerdict(film, report, reason, deps.now());
    if (waiver) waivers.push(waiver);
  }
  return waivers;
}

/** Reviews each output with Gemini, long film first and strictly; only the reel may be waived here, and only when the captain asked. */
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
  const { reelReview, ...rest } = deps;
  const waivers = await reviewFilmsWithGemini(outputs, { ...rest, review: reelReview }, { reel: waiverReason });
  return waivers.find((waiver): waiver is ReelGeminiWaiver => waiver.kind === "reel-gemini-verdict");
}

/** Runs the release in its fixed order: acceptance reviews, then the typed approval, then promotion; nothing later runs if an earlier step throws. */
export async function runReleaseGates<W>(steps: {
  acceptance: () => Promise<W>;
  approve: (waivers: W) => Promise<void>;
  promote: (waivers: W) => Promise<void>;
}): Promise<void> {
  const waivers = await steps.acceptance();
  await steps.approve(waivers);
  await steps.promote(waivers);
}

/** Looks up the film a waiver covers from its record kind. */
function filmOf(waiver: GeminiWaiver): (typeof FILMS)[WaivedFilm] {
  return waiver.kind === FILMS.long.kind ? FILMS.long : FILMS.reel;
}

/** Words each waiver as a tag annotation paragraph, or nothing when no waiver was needed. */
export function waiverTagNote(waivers: GeminiWaiver | readonly GeminiWaiver[] | undefined): string {
  return ([] as GeminiWaiver[]).concat(waivers ?? []).map((waiver) =>
    `\n\nCaptain-attended waiver of ${filmOf(waiver).possessive} Gemini verdict (${waiver.verdict}, ${waiver.overallScore.toFixed(1)}/10) at ${waiver.waivedAt}. Reason: ${waiver.reason}\n${WAIVER_RULE}`).join("");
}

/** Prints the waived verdict, naming its film, where the captain cannot miss it before the typed approval. */
export function announceWaiver(waiver: GeminiWaiver, log: (line: string) => void = console.log): void {
  const failing = waiver.criteria.filter((item) => !item.passed).map((item) => `${item.title} ${item.score}/10`);
  const film = filmOf(waiver);
  log([
    "", "=".repeat(72), `WAIVED: ${film.possessive} Gemini verdict does not meet the release threshold`,
    `  verdict ${waiver.verdict}, overall ${waiver.overallScore.toFixed(1)} / 10`,
    `  criteria not passing: ${failing.length ? failing.join(", ") : "none individually"}`,
    `  reason given: ${waiver.reason}`,
    `  ${WAIVER_RULE}`,
    `  Gates still enforced: ${film.enforced}.`,
    "  The other film's Gemini review is not waived by this waiver.",
    "=".repeat(72), "",
  ].join("\n"));
}
