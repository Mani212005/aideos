/**
 * File Description: One measured round of an all-check run, for one format or both. It backs up
 * film.json, renders the film through Remotion, runs the deterministic `aideos review`, the Gemini
 * 3.8 Flash review (and, for the long cut, the cross-review against the reference video when one was
 * given), extracts stills every few seconds for the agent's own frame check, and writes a record the
 * agent reads. The agent never scores its own work: `passed` needs the reviewer's score, the measured
 * checks, the pairwise result and the agent's frame check, and only the first three come from tools.
 * Every step is injectable so the logic runs in tests without rendering or calling a model.
 * Inputs and outputs: film slug, format, and round index -> executed review round facts and scores.
 * Used by: backend/allCheck/index.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { reviewPairwise, reviewVideo as geminiReview, formatReviewSummary, renderVideoForSlug, assertSlugDeliverable } from "../geminiReview";
import { decisionScore, formatScore } from "../geminiReview";
import type { GeminiReviewReport, PairwiseRunReport } from "../geminiReview";
import { extractStill, probeVideo } from "../review/media";
import { reviewVideo as measuredReview } from "../review/review";
import { formatInputs, reelForRender } from "../reelCut/store";
import { applyEvents, hashBytes, hashFileOrNull, readRecord } from "../filmAcceptance/store";
import type { AcceptanceEvent } from "../filmAcceptance/machine";
import type { ReviewReport } from "../review/types";
import {
  allCheckDir,
  AllCheckError,
  recordPath,
  roundDir,
  type AllCheckConfig,
  type CheckFormat,
  type FormatRoundRecord,
} from "./types";

/** The tools a round uses; the defaults are the real ones. */
export interface RoundDeps {
  render: (slug: string, format: CheckFormat) => Promise<string>;
  measure: (req: { target: string; film: string; words?: string; outDir: string }) => Promise<ReviewReport>;
  gemini: (video: string, opts: { filmPath: string; reviewContextPath?: string }) => Promise<GeminiReviewReport>;
  pairwise: (video: string, reference: string) => Promise<PairwiseRunReport>;
  durationOf: (video: string) => number;
  still: (video: string, t: number, out: string) => string | null;
  onProgress: (message: string) => void;
}

// The real tools.
export function realRoundDeps(onProgress: (message: string) => void): RoundDeps {
  return {
    render: (slug, format) => {
      // The final videos come from this render, so refuse before it starts when music, sound effects or the end card is missing.
      assertSlugDeliverable(slug, format);
      return renderVideoForSlug(slug, format);
    },
    measure: (req) => measuredReview({ target: req.target, film: req.film, words: req.words, outDir: req.outDir, onProgress }),
    gemini: (video, opts) => geminiReview(video, { filmPath: opts.filmPath, reviewContextPath: opts.reviewContextPath, onProgress }),
    pairwise: (video, reference) => reviewPairwise(video, reference, { onProgress }),
    durationOf: (video) => probeVideo(video).durationSec,
    still: extractStill,
    onProgress,
  };
}

// SHA-256 of a file that must exist.
function hashFile(file: string): string {
  return hashBytes(fs.readFileSync(file));
}

// Feeds a saved round record to the acceptance machine as the render, measured and review events it stands for. Replaying a record is harmless: the same draw is never counted twice.
export function recordRoundAcceptance(slug: string, rec: FormatRoundRecord, target: number): void {
  const mp4Hash = hashFileOrNull(rec.videoPath);
  if (mp4Hash === null) return;
  const events: AcceptanceEvent[] = [{ type: "rendered", filmHash: rec.filmHash, mp4Hash, at: rec.createdAt }];
  if (!rec.measured.error && rec.measured.passed !== null) {
    events.push({ type: "measured", mp4Hash, passed: rec.measured.passed, gateFailures: rec.measured.gateFailures, at: rec.createdAt });
  }
  if (!rec.review.error && rec.review.score !== null && rec.review.verdict !== null && rec.review.gatesPassed !== null) {
    // The draw passes the way the round's own bar says: the score reached the target and no hard gate failed.
    const decided = rec.review.gatesPassed && rec.review.score >= target;
    const reviewKey = `round-${rec.round}`;
    const drawList = rec.review.draws ?? [];
    if (drawList.length > 1) {
      // Two draws of the same bytes are appended to the same record; the last one carries the decision over both.
      drawList.forEach((item, i) => {
        const last = i === drawList.length - 1;
        events.push({
          type: "judged",
          draw: {
            key: i === 0 ? reviewKey : `${reviewKey}-draw-${item.draw}`,
            mp4Hash,
            score: item.score,
            verdict: last ? rec.review.verdict! : item.verdict,
            gatesPassed: last ? rec.review.gatesPassed! : item.gatesPassed,
            passed: last ? decided : item.gatesPassed && item.score >= target,
            reviewKey,
            drawNumber: item.draw,
            ...(last ? { combinedScore: rec.review.score! } : {}),
            at: rec.createdAt,
          },
        });
      });
    } else {
      events.push({
        type: "judged",
        draw: { key: reviewKey, mp4Hash, score: rec.review.score, verdict: rec.review.verdict, gatesPassed: rec.review.gatesPassed, passed: decided, at: rec.createdAt },
      });
    }
  }
  applyEvents(resolvePackageDir(slug), rec.format, events);
}

// Moves the acceptance record to match a round record whose checks all passed (accepted) or no longer do (revoked).
function settleRoundAcceptance(slug: string, rec: FormatRoundRecord, target: number): void {
  const mp4Hash = hashFileOrNull(rec.videoPath);
  if (mp4Hash === null) return;
  const pkg = resolvePackageDir(slug);
  // A run begun before the machine existed has no evidence yet: seed it once from the saved round, never from an older round over a newer one.
  if (readRecord(pkg, rec.format).state === "unreviewed") recordRoundAcceptance(slug, rec, target);
  const current = readRecord(pkg, rec.format);
  if (current.mp4Hash !== mp4Hash) return;
  if (rec.passed && current.state === "judged") applyEvents(pkg, rec.format, [{ type: "approved", mp4Hash, at: rec.createdAt }]);
  else if (!rec.passed && current.state === "accepted") applyEvents(pkg, rec.format, [{ type: "revoked", mp4Hash, at: new Date().toISOString() }]);
}

// Reads the saved config of a run, or explains that all-check was not started for this video.
export function readConfig(slug: string): AllCheckConfig {
  const file = path.join(allCheckDir(slug), "config.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as AllCheckConfig;
  } catch {
    throw new AllCheckError(`no all-check run is set up for "${slug}" (missing ${file}). Start one with: aideos all-check ${slug}`);
  }
}

// The highest round number that has a folder, or 0.
export function latestRound(slug: string): number {
  const dir = allCheckDir(slug);
  if (!fs.existsSync(dir)) return 0;
  return fs
    .readdirSync(dir)
    .map((name) => /^round-(\d+)$/.exec(name)?.[1])
    .filter((n): n is string => Boolean(n))
    .reduce((max, n) => Math.max(max, Number(n)), 0);
}

// Reads every saved record of a run, ordered by round then format.
export function readRecords(slug: string): FormatRoundRecord[] {
  const out: FormatRoundRecord[] = [];
  for (let round = 1; round <= latestRound(slug); round++) {
    for (const format of ["long", "reel"] as const) {
      const file = recordPath(slug, round, format);
      if (fs.existsSync(file)) out.push(JSON.parse(fs.readFileSync(file, "utf8")) as FormatRoundRecord);
    }
  }
  return out;
}

// Decides whether a record passes and lists, in actionable words, everything that still fails.
export function evaluateRecord(
  rec: Omit<FormatRoundRecord, "passed" | "failing">,
  target: number,
): { passed: boolean; failing: string[] } {
  const failing: string[] = [];
  if (rec.review.error) {
    failing.push(`the Gemini review could not run: ${rec.review.error}`);
  } else {
    if (rec.review.score === null || rec.review.score < target) {
      // A score settled by two draws is cut to two decimals so it never reads as the bar it missed.
      const shown = rec.review.score === null ? "n/a" : (rec.review.draws?.length ?? 0) > 1 ? formatScore(rec.review.score) : rec.review.score.toFixed(1);
      failing.push(`reviewer score ${shown} is under the ${target.toFixed(1)} target`);
    }
    if (rec.review.gatesPassed === false) {
      failing.push(`a hard gate failed in the reviewer's rubric: ${(rec.review.failedGates ?? rec.review.failedCriteria).join("; ") || "see feedback"}`);
    }
  }
  if (rec.measured.error) {
    failing.push(`the measured review could not run: ${rec.measured.error}`);
  } else if (rec.measured.passed !== true) {
    failing.push(`measured gates failed: ${rec.measured.gateFailures.join(", ") || "see the measured report"}`);
  }
  if (rec.pairwise) {
    if (rec.pairwise.error) failing.push(`the cross-review against the reference could not run: ${rec.pairwise.error}`);
    else if (rec.pairwise.passed !== true) {
      failing.push(`lost the cross-review against the reference (${rec.pairwise.candidateScore?.toFixed(2)} vs ${rec.pairwise.referenceScore?.toFixed(2)})`);
    }
  }
  if (rec.frameCheck.status === "pending") {
    failing.push(`frame check not recorded: look at the stills in ${rec.frameCheck.stillsDir}, then run aideos all-check frames`);
  } else if (rec.frameCheck.status === "issues") {
    for (const issue of rec.frameCheck.issues) failing.push(`frame check: ${issue}`);
  }
  return { passed: failing.length === 0, failing };
}

// Renders a record as the markdown the agent and the report read.
export function recordMarkdown(rec: FormatRoundRecord): string {
  const lines = [
    `# Round ${rec.round} - ${rec.format} - ${rec.passed ? "PASSED" : "NOT PASSED"}`,
    ``,
    `- Reviewer: ${rec.review.error ? `error: ${rec.review.error}` : `${rec.review.score === null ? "n/a" : formatScore(rec.review.score)} / 10, ${rec.review.verdict}${rec.review.drawNote ? ` (${rec.review.drawNote})` : ""}`}`,
    `- Measured checks: ${rec.measured.error ? `error: ${rec.measured.error}` : rec.measured.passed ? "pass" : `FAIL (${rec.measured.gateFailures.join(", ")})`}${rec.measured.softFailures.length ? `; soft failures: ${rec.measured.softFailures.join(", ")}` : ""}`,
  ];
  if (rec.pairwise) lines.push(`- Cross-review against ${path.basename(rec.pairwise.reference)}: ${rec.pairwise.error ? `error: ${rec.pairwise.error}` : `${rec.pairwise.winner} (${rec.pairwise.candidateScore?.toFixed(2)} vs ${rec.pairwise.referenceScore?.toFixed(2)})`}`);
  lines.push(`- Frame check: ${rec.frameCheck.status}${rec.frameCheck.issues.length ? ` (${rec.frameCheck.issues.join("; ")})` : ""}`);
  lines.push(`- Video: ${rec.videoPath}`, `- Stills: ${rec.frameCheck.stillsDir} (${rec.frameCheck.stills.length})`, ``);
  if (rec.failing.length) lines.push(`## Still failing`, ...rec.failing.map((f) => `- ${f}`), ``);
  if (rec.review.feedback.length) {
    lines.push(`## Reviewer feedback`);
    for (const f of rec.review.feedback) lines.push(`- [${f.priority}]${f.timestamp ? ` ${f.timestamp}` : ""} ${f.issue} -> ${f.recommendation}`);
    lines.push(``);
  }
  if (rec.measured.recommendations.length) lines.push(`## Measured recommendations`, ...rec.measured.recommendations.map((r) => `- ${r}`), ``);
  return lines.join("\n");
}

// Saves a record's JSON and markdown side by side.
function writeRecord(slug: string, rec: FormatRoundRecord): void {
  fs.mkdirSync(roundDir(slug, rec.round), { recursive: true });
  fs.writeFileSync(recordPath(slug, rec.round, rec.format), JSON.stringify(rec, null, 2) + "\n");
  fs.writeFileSync(recordPath(slug, rec.round, rec.format).replace(/\.json$/, ".md"), recordMarkdown(rec));
}

// Extracts stills every few seconds for the agent's frame check.
function extractStills(video: string, framesDir: string, everySec: number, deps: RoundDeps): string[] {
  const duration = deps.durationOf(video);
  const names: string[] = [];
  for (let t = everySec / 2; t < duration; t += everySec) {
    const name = `frame-${String(Math.round(t)).padStart(4, "0")}s.jpg`;
    if (deps.still(video, Math.min(t, Math.max(0, duration - 0.1)), path.join(framesDir, name))) names.push(name);
  }
  return names;
}

/** Options of one measured round. */
export interface RoundRequest {
  slug: string;
  format: CheckFormat;
  /** Round number; a new round when omitted. */
  round?: number;
  /** Seconds between frame-check stills. */
  stillEverySec?: number;
  /** Measure the video already rendered instead of rendering again. */
  skipRender?: boolean;
}

// Measures one format in one round and saves the record.
export async function runFormatRound(req: RoundRequest, round: number, config: AllCheckConfig, deps: RoundDeps): Promise<FormatRoundRecord> {
  const { slug, format } = req;
  if (format === "reel" && req.skipRender) reelForRender(slug);
  const pkg = resolvePackageDir(slug);
  const inputs = formatInputs(slug, format);
  const filmFile = inputs.film;
  const dir = roundDir(slug, round);
  fs.mkdirSync(dir, { recursive: true });

  const backup = path.join(allCheckDir(slug), "backups", `film.round-${round}.json`);
  if (!fs.existsSync(backup)) {
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(path.join(pkg, "film.json"), backup);
    const reelDir = path.join(pkg, "reel");
    if (fs.existsSync(reelDir)) fs.cpSync(reelDir, path.join(path.dirname(backup), `reel.round-${round}`), { recursive: true });
  }

  deps.onProgress(`[round ${round} ${format}] rendering ${slug}`);
  let rendered: string;
  if (req.skipRender) {
    const candidates = [
      path.join(pkg, "renders", `${format}.mp4`),
      path.join(pkg, "renders", `${slug}-${format}.mp4`),
      path.join(pkg, `${format}.mp4`),
      path.join(pkg, `${slug}-${format}.mp4`),
      path.resolve(__dirname, "../../out", `${slug}-${format}.mp4`),
      path.resolve(__dirname, "../../out", `${format}.mp4`),
    ];
    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) {
      throw new AllCheckError(`no rendered video for "${slug}": looked in ${path.join(pkg, "renders")} and fallback out/`);
    }
    rendered = found;
  } else {
    rendered = await deps.render(slug, format);
  }
  if (!fs.existsSync(rendered)) throw new AllCheckError(`no rendered video at ${rendered}`);
  const videoPath = path.join(dir, `${format}.mp4`);
  fs.copyFileSync(rendered, videoPath);
  const filmHash = hashFile(filmFile);

  const wordsFile = inputs.words;
  const measuredDir = path.join(dir, `${format}-measured`);
  const measured: FormatRoundRecord["measured"] = { passed: null, gateFailures: [], softFailures: [], recommendations: [], reportPath: null };
  deps.onProgress(`[round ${round} ${format}] measured review`);
  try {
    const report = await deps.measure({ target: videoPath, film: filmFile, words: fs.existsSync(wordsFile) ? wordsFile : undefined, outDir: measuredDir });
    measured.passed = report.passed;
    measured.gateFailures = report.gateFailures;
    measured.softFailures = report.softFailures;
    measured.recommendations = report.recommendations;
    measured.reportPath = path.join(measuredDir, report.format === "reel" ? "review.reel.json" : "review.json");
  } catch (err) {
    measured.error = err instanceof Error ? err.message : String(err);
  }

  const review: FormatRoundRecord["review"] = {
    score: null, verdict: null, gatesPassed: null, summary: "", failedCriteria: [], feedback: [], reportPath: null,
  };
  deps.onProgress(`[round ${round} ${format}] Gemini review`);
  try {
    const report = await deps.gemini(videoPath, {
      filmPath: filmFile,
      reviewContextPath: measured.reportPath && fs.existsSync(measured.reportPath) ? measured.reportPath : undefined,
    });
    // The verdict score is the mean of the criteria scores (combined over both draws), never the reviewer's own overall number.
    review.score = decisionScore(report);
    review.verdict = report.verdict;
    review.draws = report.draws?.map((d) => ({ draw: d.draw, score: d.score, overallScore: d.overallScore, gatesPassed: d.gatesPassed, verdict: d.verdict }));
    review.drawNote = report.drawNote;
    review.gatesPassed = report.draws ? report.draws.every((d) => d.gatesPassed) : !report.criteria.some((c) => c.isGate && (!c.passed || c.score < 6));
    review.summary = report.summary;
    const describe = (c: (typeof report.criteria)[number]) => `${c.title} ${c.score.toFixed(1)}/10${c.isGate ? " [gate]" : ""}: ${c.reason}`;
    review.failedCriteria = report.criteria.filter((c) => !c.passed || c.score < 9).map(describe);
    review.failedGates = report.criteria.filter((c) => c.isGate && (!c.passed || c.score < 6)).map(describe);
    review.feedback = report.feedback.slice(0, 12);
    review.reportPath = path.join(dir, `${format}-gemini.json`);
    fs.writeFileSync(review.reportPath, JSON.stringify(report, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, `${format}-gemini.txt`), formatReviewSummary(report) + "\n");
  } catch (err) {
    review.error = err instanceof Error ? err.message : String(err);
  }

  let pairwise: FormatRoundRecord["pairwise"];
  if (config.reference && format === "long") {
    deps.onProgress(`[round ${round} ${format}] cross-review against ${path.basename(config.reference)}`);
    pairwise = { reference: config.reference, winner: null, candidateScore: null, referenceScore: null, passed: null, reportPath: null };
    try {
      const report = await deps.pairwise(videoPath, config.reference);
      pairwise.winner = report.winner;
      pairwise.candidateScore = report.videoA.finalRating;
      pairwise.referenceScore = report.videoB.finalRating;
      pairwise.passed = report.winner === "Video A" || report.winner === "Tie";
      pairwise.reportPath = path.join(dir, `${format}-pairwise.json`);
      fs.writeFileSync(pairwise.reportPath, JSON.stringify(report, null, 2) + "\n");
    } catch (err) {
      pairwise.error = err instanceof Error ? err.message : String(err);
    }
  }

  const framesDir = path.join(dir, `${format}-frames`);
  fs.rmSync(framesDir, { recursive: true, force: true });
  const stills = extractStills(videoPath, framesDir, Math.max(2, req.stillEverySec ?? 4), deps);

  const base: Omit<FormatRoundRecord, "passed" | "failing"> = {
    schema: "aideos.all-check.round/1",
    round,
    format,
    videoPath,
    filmHash,
    createdAt: new Date().toISOString(),
    review,
    measured,
    pairwise,
    frameCheck: { status: "pending", issues: [], stillsDir: framesDir, stills },
  };
  const record: FormatRoundRecord = { ...base, ...evaluateRecord(base, config.target) };
  writeRecord(slug, record);
  recordRoundAcceptance(slug, record, config.target);
  return record;
}

// Runs a measured round for one format or both, enforcing the round budget.
export async function runRound(
  req: { slug: string; format: CheckFormat | "both"; round?: number; stillEverySec?: number; skipRender?: boolean },
  deps: RoundDeps,
): Promise<FormatRoundRecord[]> {
  const config = readConfig(req.slug);
  const round = req.round ?? latestRound(req.slug) + 1;
  if (!Number.isInteger(round) || round < 1) throw new AllCheckError(`--round must be a positive whole number (got ${req.round})`);
  if (round > config.rounds) {
    throw new AllCheckError(`the round budget is spent (${config.rounds} rounds). Stop measuring and run: aideos all-check finish ${req.slug}`);
  }
  if (round === latestRound(req.slug) + 1 && round > 1) {
    const unchecked = readRecords(req.slug).filter((r) => r.round === round - 1 && r.frameCheck.status === "pending");
    if (unchecked.length) {
      throw new AllCheckError(
        `round ${round - 1} has no frame check yet. Open the stills (${unchecked.map((r) => r.frameCheck.stillsDir).join(", ")}) and record what you saw first: ` +
          `aideos all-check frames ${req.slug} --round ${round - 1} --format ${unchecked[0].format} --clean | --issue "<time>: <problem>"`,
      );
    }
  }
  const formats: CheckFormat[] = req.format === "both" ? ["long", "reel"] : [req.format];
  const records: FormatRoundRecord[] = [];
  for (const format of formats) {
    records.push(await runFormatRound({ ...req, format }, round, config, deps));
  }
  return records;
}

// Records the agent's frame check of one format in one round and re-evaluates the record.
export function recordFrameCheck(req: { slug: string; round: number; format: CheckFormat; issues: string[] }): FormatRoundRecord {
  const config = readConfig(req.slug);
  const file = recordPath(req.slug, req.round, req.format);
  if (!fs.existsSync(file)) throw new AllCheckError(`no ${req.format} record for round ${req.round}: run aideos all-check round first`);
  const rec = JSON.parse(fs.readFileSync(file, "utf8")) as FormatRoundRecord;
  const issues = req.issues.map((i) => i.trim()).filter(Boolean);
  rec.frameCheck = { ...rec.frameCheck, status: issues.length ? "issues" : "clean", issues, recordedAt: new Date().toISOString() };
  const evaluated = evaluateRecord(rec, config.target);
  const updated: FormatRoundRecord = { ...rec, ...evaluated };
  writeRecord(req.slug, updated);
  settleRoundAcceptance(req.slug, updated, config.target);
  return updated;
}
