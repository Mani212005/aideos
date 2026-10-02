/**
 * File Description: Iterative video review loop that orchestrates video rendering,
 * Gemini 3.8 Flash evaluation, round persistence, and 9.0+ acceptance gating.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { reviewVideo, reviewPairwise } from "./geminiReview";
import type {
  GeminiReviewReport,
  PairwiseRunReport,
  ReviewFeedbackItem,
  ReviewLoopOptions,
  ReviewLoopResult,
  ReviewLoopRound,
} from "./types";

const REPO_ROOT = path.resolve(__dirname, "../..");

// Formats a human-readable summary of review findings.
export function formatReviewSummary(report: GeminiReviewReport): string {
  const lines: string[] = [
    `=== Gemini 3.8 Flash Video Review ===`,
    `Overall Score: ${report.overallScore.toFixed(1)} / 10.0`,
    `Verdict: ${report.verdict}`,
    `Summary: ${report.summary}`,
    ``,
    `Criteria Breakdown:`,
  ];

  for (const crit of report.criteria) {
    const gateLabel = crit.isGate ? "[GATE]" : "      ";
    const status = crit.passed ? "PASS" : "FAIL";
    const ts = crit.evidenceTimestamps.length > 0 ? ` (${crit.evidenceTimestamps.join(", ")})` : "";
    lines.push(`  ${gateLabel} ${status} - ${crit.title}: ${crit.score.toFixed(1)}/10${ts}`);
    lines.push(`         Reason: ${crit.reason}`);
  }

  if (report.feedback.length > 0) {
    lines.push(``, `Actionable Feedback (${report.feedback.length} items):`);
    for (const item of report.feedback) {
      const ts = item.timestamp ? ` at ${item.timestamp}` : "";
      lines.push(`  [${item.priority.toUpperCase()}]${ts} ${item.issue}`);
      lines.push(`    Recommendation: ${item.recommendation}`);
    }
  }

  return lines.join("\n");
}

// Finds or resolves the rendered mp4 file path for a given film slug.
export function resolveVideoOutputPath(slug: string, format: "long" | "reel" = "long"): string {
  const candidates = [
    path.join(REPO_ROOT, "out", `${slug}-${format}.mp4`),
    path.join(REPO_ROOT, "out", `${slug}.mp4`),
    path.join(resolvePackageDir(slug), `${format}.mp4`),
    path.join(resolvePackageDir(slug), "out.mp4"),
    path.join(REPO_ROOT, "out", `${format}.mp4`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

// Renders the video for a given slug using Remotion CLI.
export async function renderVideoForSlug(slug: string, format: "long" | "reel" = "long"): Promise<string> {
  const outPath = path.join(REPO_ROOT, "out", `${slug}-${format}.mp4`);
  await fsp.mkdir(path.dirname(outPath), { recursive: true });

  const compId = format === "reel" ? "Reel" : "Long";
  const args = [
    "remotion", "render", "src/index.ts", compId, outPath, `--props={"filmId":"${slug}"}`, "--gl=angle"
  ];

  execFileSync("npx", args, { cwd: REPO_ROOT, stdio: "inherit" });
  if (!fs.existsSync(outPath)) {
    throw new Error(`Render failed to create output file at ${outPath}`);
  }
  return outPath;
}



// Orchestrates the multi-round render-review-refine loop until score >= 9.0 or maxRounds reached.
export async function runReviewLoop(
  slug: string,
  options?: ReviewLoopOptions,
): Promise<ReviewLoopResult> {
  const maxRounds = options?.maxRounds ?? 6;
  const targetScore = options?.targetScore ?? 9.0;
  const format = options?.format ?? "long";
  const onProgress = options?.onProgress || (() => {});

  const videoDir = resolvePackageDir(slug);
  const reviewDir = path.join(videoDir, "gemini-review");
  await fsp.mkdir(reviewDir, { recursive: true });

  const rounds: ReviewLoopRound[] = [];
  let videoPath = resolveVideoOutputPath(slug, format);

  for (let round = 1; round <= maxRounds; round++) {
    onProgress(`\n--- Review Loop Round ${round} of ${maxRounds} [${slug}] ---`);

    // Ensure video exists or render it
    if (!fs.existsSync(videoPath) || round > 1) {
      onProgress(`Rendering video for ${slug} (${format})...`);
      if (options?.mockRenderer) {
        videoPath = await options.mockRenderer(slug, format);
      } else {
        videoPath = await renderVideoForSlug(slug, format);
      }
    }

    onProgress(`Evaluating video with Gemini 3.8 Flash: ${videoPath}...`);
    let report: GeminiReviewReport;
    if (options?.mockReviewer) {
      report = await options.mockReviewer(videoPath, round);
    } else {
      const filmPath = path.join(resolvePackageDir(slug), "film.json");
      report = await reviewVideo(videoPath, { onProgress, slug, filmPath });
    }

    // Optional pairwise comparison against reference video
    let pairwiseReport: PairwiseRunReport | undefined;
    let candidateWonOrTied = true;

    if (options?.referenceVideo) {
      const refPath = path.resolve(options.referenceVideo);
      onProgress(`Running pairwise comparison against reference video: ${path.basename(refPath)}...`);
      if (options.mockPairwise) {
        pairwiseReport = await options.mockPairwise(videoPath, refPath);
      } else {
        pairwiseReport = await reviewPairwise(videoPath, refPath, { onProgress });
      }

      // Order 1 (AB): Video 1 = candidate, Video 2 = reference
      // Order 2 (BA): Video 1 = reference, Video 2 = candidate
      const winOrder1 = pairwiseReport.orderAB.choice === "Video 1" || pairwiseReport.orderAB.choice === "Tie";
      const winOrder2 = pairwiseReport.orderBA.choice === "Video 2" || pairwiseReport.orderBA.choice === "Tie";
      candidateWonOrTied = winOrder1 && winOrder2;

      if (!candidateWonOrTied) {
        onProgress(`  Pairwise check failed: candidate video did not beat or tie reference video (${pairwiseReport.consistentWinner === "Video B" ? "Reference Video won" : "Inconsistent preference"}).`);
        report.verdict = "REVISE";
        report.feedback.unshift({
          priority: "high",
          issue: `Candidate video did not beat or tie reference video (${path.basename(refPath)}) in pairwise evaluation.`,
          recommendation: `Elevate visual pacing, persistent stage continuity, and bottom subtitles to match or exceed reference video standards.`,
        });
      } else {
        onProgress(`  Pairwise check passed: candidate video won or tied against reference video.`);
      }
    }

    const roundRecord: ReviewLoopRound = {
      round,
      score: report.overallScore,
      verdict: report.verdict,
      feedback: report.feedback,
      videoHash: report.videoHash || "",
      videoPath,
      timestamp: new Date().toISOString(),
      report,
      pairwiseReport,
    };
    rounds.push(roundRecord);

    // Persist round state to gitignored review directory
    const roundPath = path.join(reviewDir, `round-${round}.json`);
    const latestPath = path.join(reviewDir, "latest.json");
    await fsp.writeFile(roundPath, JSON.stringify(roundRecord, null, 2), "utf8");
    await fsp.writeFile(latestPath, JSON.stringify(roundRecord, null, 2), "utf8");
    onProgress(`Saved round ${round} results to ${roundPath}`);

    // Print summary
    onProgress(formatReviewSummary(report));

    const singlePassed = report.verdict === "ACCEPT" && report.overallScore >= targetScore;
    const pairwisePassed = !options?.referenceVideo || candidateWonOrTied;

    if (singlePassed && pairwisePassed) {
      onProgress(`\n SUCCESS: Video achieved score of ${report.overallScore.toFixed(1)} >= ${targetScore.toFixed(1)} and passed pairwise reference check on round ${round}!`);
      const result: ReviewLoopResult = {
        slug,
        finalScore: report.overallScore,
        finalVerdict: "ACCEPT",
        passed: true,
        rounds,
        outputPath: videoPath,
        referenceVideo: options?.referenceVideo,
        pairwisePassed: true,
      };
      await fsp.writeFile(path.join(videoDir, "review-loop.json"), JSON.stringify(result, null, 2), "utf8");
      return result;
    }

    if (round >= maxRounds) {
      onProgress(`\n STOPPED: Reached maximum rounds (${maxRounds}) without reaching target score of ${targetScore}. Final score: ${report.overallScore.toFixed(1)}.`);
      break;
    }


  }

  const lastRound = rounds[rounds.length - 1];
  const lastPairwisePassed = !options?.referenceVideo || (
    lastRound?.pairwiseReport
      ? (lastRound.pairwiseReport.orderAB.choice === "Video 1" || lastRound.pairwiseReport.orderAB.choice === "Tie") &&
        (lastRound.pairwiseReport.orderBA.choice === "Video 2" || lastRound.pairwiseReport.orderBA.choice === "Tie")
      : true
  );
  const finalPassed = (lastRound?.verdict === "ACCEPT") && ((lastRound?.score ?? 0) >= targetScore) && lastPairwisePassed;
  const finalResult: ReviewLoopResult = {
    slug,
    finalScore: lastRound?.score ?? 0,
    finalVerdict: finalPassed ? "ACCEPT" : "REVISE",
    passed: finalPassed,
    rounds,
    outputPath: videoPath,
    referenceVideo: options?.referenceVideo,
    pairwisePassed: lastPairwisePassed,
  };
  await fsp.writeFile(path.join(videoDir, "review-loop.json"), JSON.stringify(finalResult, null, 2), "utf8");
  return finalResult;
}
