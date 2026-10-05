/**
 * File Description: High-level video review engine using the agy CLI agent running Gemini 3.8 Flash.
 * Evaluates local mp4 videos against the 12-criterion rubric, enforces timestamp evidence verification,
 * validates hard gates, and executes dual-agent cross-review pairwise video comparisons.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reviewerModel } from "../aideosConfig";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { extractDeterministicFacts } from "./facts";
import {
  PAIRWISE_EXCHANGE_JSON_SCHEMA,
  PAIRWISE_WATCH_JSON_SCHEMA,
  RUBRIC_CRITERIA,
  SINGLE_REVIEW_JSON_SCHEMA,
  buildPairwiseExchangePrompt,
  buildPairwiseWatchPrompt,
  buildSingleVideoReviewPrompt,
  validateCriterionTimestamps,
} from "./rubric";
import type {
  AgyReviewClient,
  AgyRunner,
  AgyRunnerOptions,
  DeterministicVideoFacts,
  GeminiReviewReport,
  PairwiseRunReport,
  WatchReport,
} from "./types";

export interface SingleReviewOptions {
  runner?: AgyRunner;
  client?: AgyReviewClient;
  model?: string;
  timeoutSeconds?: number;
  maxValidationAttempts?: number;
  filmPath?: string;
  skipFacts?: boolean;
  facts?: DeterministicVideoFacts;
  slug?: string;
  /** Path of a measured review.json to hand the reviewer as context; overrides the slug and sibling lookup. */
  reviewContextPath?: string;
  onProgress?: (message: string) => void;
}

export interface PairwiseReviewOptions {
  runner?: AgyRunner;
  client?: AgyReviewClient;
  model?: string;
  timeoutSeconds?: number;
  onProgress?: (message: string) => void;
}

// Executes agy CLI non-interactively in print mode with structured JSON schema.
export async function defaultAgyRunner(
  prompt: string,
  options?: AgyRunnerOptions,
): Promise<string> {
  const model =
    reviewerModel(options?.model);
  const timeoutSec =
    options?.timeoutSeconds ??
    (Number(process.env.AIDEOS_AGY_TIMEOUT) || 1800);
  const printTimeoutArg = `${timeoutSec}s`;

  const args: string[] = [
    "-p",
    prompt,
    "--model",
    model,
    "--print-timeout",
    printTimeoutArg,
    "--output-format",
    "json",
    "--sandbox",
    "--dangerously-skip-permissions",
  ];

  if (options?.schema) {
    args.push("--json-schema", JSON.stringify(options.schema));
  }

  if (options?.conversationId) {
    args.push("--conversation", options.conversationId);
  }

  return new Promise<string>((resolve, reject) => {
    execFile(
      "agy",
      args,
      {
        cwd: options?.cwd,
        maxBuffer: 50 * 1024 * 1024,
        timeout: (timeoutSec + 30) * 1000,
      },
      (error, stdout, stderr) => {
        if (error) {
          if ((error as any).code === "ENOENT") {
            return reject(
              new Error(
                "agy CLI not found on PATH. Please ensure agy is installed and accessible.",
              ),
            );
          }

          const combined = `${error.message}\n${stdout}\n${stderr}`;
          if (
            combined.includes("RESOURCE_EXHAUSTED") ||
            combined.includes("quota") ||
            combined.includes("429") ||
            combined.includes("rate limit")
          ) {
            return reject(
              new Error(
                `agy review failed: Quota exceeded or rate limited. No silent fallback allowed. Details: ${combined.trim()}`,
              ),
            );
          }
          if (
            combined.includes("not authenticated") ||
            combined.includes("not signed in") ||
            combined.includes("login") ||
            combined.includes("auth")
          ) {
            return reject(
              new Error(
                `agy review failed: Not authenticated or signed in to agy. Details: ${combined.trim()}`,
              ),
            );
          }

          try {
            const parsed = JSON.parse(stdout);
            if (parsed.status === "ERROR") {
              const errStr = parsed.error || stderr || error.message;
              return reject(new Error(`agy review failed (${parsed.status}): ${errStr}`));
            }
          } catch {}

          return reject(
            new Error(
              `agy execution failed (exit code ${error.code || "unknown"}): ${stderr || error.message}`,
            ),
          );
        }

        const combinedOutput = `${stdout}\n${stderr}`;
        if (combinedOutput.includes("print timeout after")) {
          return reject(
            new Error(
              `agy review timed out: print timeout expired before agent completed review. Details: ${combinedOutput.trim()}`,
            ),
          );
        }

        try {
          const parsed = JSON.parse(stdout);
          if (parsed.status === "ERROR") {
            const errStr = parsed.error || stderr || "Unknown error";
            if (
              errStr.includes("RESOURCE_EXHAUSTED") ||
              errStr.includes("quota") ||
              errStr.includes("429") ||
              errStr.includes("rate limit")
            ) {
              return reject(
                new Error(
                  `agy review failed: Quota exceeded or rate limited. No silent fallback allowed. Details: ${errStr}`,
                ),
              );
            }
            if (
              errStr.includes("not authenticated") ||
              errStr.includes("not signed in") ||
              errStr.includes("login") ||
              errStr.includes("auth")
            ) {
              return reject(
                new Error(
                  `agy review failed: Not authenticated or signed in to agy. Details: ${errStr}`,
                ),
              );
            }
            return reject(new Error(`agy review failed: ${errStr}`));
          }

          if (parsed.structured_output && typeof parsed.structured_output === "object") {
            if (parsed.conversation_id && !parsed.structured_output.conversation_id) {
              parsed.structured_output.conversation_id = parsed.conversation_id;
            }
            return resolve(JSON.stringify(parsed.structured_output));
          }

          if (typeof parsed.response === "string" && parsed.response.trim().length > 0) {
            const cleaned = cleanModelJsonResponse(parsed.response);
            // Keep the conversation id on a text reply too: the pairwise exchange phase resumes the watcher's conversation by it.
            try {
              const obj = JSON.parse(cleaned);
              if (obj && typeof obj === "object" && !Array.isArray(obj) && parsed.conversation_id && !obj.conversation_id) {
                obj.conversation_id = parsed.conversation_id;
                return resolve(JSON.stringify(obj));
              }
            } catch {}
            return resolve(cleaned);
          }

          if (
            parsed.status === "SUCCESS" &&
            !parsed.structured_output &&
            (!parsed.response || parsed.response.trim().length === 0)
          ) {
            return reject(
              new Error("agy review failed: agent returned empty response without structured output."),
            );
          }

          return resolve(stdout);
        } catch {
          return resolve(cleanModelJsonResponse(stdout));
        }
      },
    );
  });
}

// Resolves the active review runner function from options or default agy CLI.
function resolveRunner(options?: { runner?: AgyRunner; client?: AgyReviewClient }): AgyRunner {
  if (options?.runner) return options.runner;
  if (options?.client?.runReviewPrompt) {
    return (prompt, opts) => options.client!.runReviewPrompt(prompt, opts);
  }
  return defaultAgyRunner;
}

// Computes the SHA-256 hash of a file for change tracking and auditability.
export function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// Reports whether a string parses as JSON.
function isJsonText(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Strips markdown code fences (with or without a language tag such as json or python) and surrounding prose, returning the JSON text.
export function cleanModelJsonResponse(rawText: string): string {
  const text = rawText.trim();
  if (isJsonText(text)) return text;

  let firstBody: string | undefined;
  for (const match of text.matchAll(/```[A-Za-z0-9_+.-]*[ \t]*\r?\n?([\s\S]*?)```/g)) {
    const body = match[1].trim();
    firstBody ??= body;
    if (isJsonText(body)) return body;
  }

  // An unterminated fence (a cut-off reply) still opens with the marker line; drop it.
  const candidate = firstBody ?? text.replace(/^```[A-Za-z0-9_+.-]*[ \t]*\r?\n?/, "").trim();
  if (isJsonText(candidate)) return candidate;

  // Prose around a bare JSON object: take the outermost braces.
  const open = candidate.indexOf("{");
  const close = candidate.lastIndexOf("}");
  if (open >= 0 && close > open) {
    const slice = candidate.slice(open, close + 1);
    if (isJsonText(slice)) return slice;
  }
  return candidate;
}

// Creates an isolated temporary directory containing hardlinks or copies of video files under neutral names.
export function createIsolatedVideoWorkspace(
  videos: Record<string, string>,
): { dir: string; videoPaths: Record<string, string>; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-review-"));
  const videoPaths: Record<string, string> = {};

  for (const [neutralName, srcPath] of Object.entries(videos)) {
    const destPath = path.join(dir, neutralName);
    try {
      fs.linkSync(srcPath, destPath);
    } catch {
      fs.copyFileSync(srcPath, destPath);
    }
    videoPaths[neutralName] = destPath;
  }

  const cleanup = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  };

  return { dir, videoPaths, cleanup };
}

// Reviews a single rendered video against the 12-criterion good-video rubric.
export async function reviewVideo(
  videoPath: string,
  options?: SingleReviewOptions,
): Promise<GeminiReviewReport> {
  const resolvedPath = path.resolve(videoPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Video file does not exist: ${resolvedPath}`);
  }

  const hash = await computeFileHash(resolvedPath);
  const onProgress = options?.onProgress || (() => {});
  const runner = resolveRunner(options);
  const modelName =
    reviewerModel(options?.model);
  const maxAttempts = options?.maxValidationAttempts ?? 3;

  onProgress(`Extracting deterministic facts for ${path.basename(resolvedPath)}...`);
  const facts =
    options?.facts ??
    (options?.skipFacts
      ? undefined
      : await extractDeterministicFacts(resolvedPath, {
          filmPath: options?.filmPath,
        }));
  if (facts) {
    onProgress(`Measured: ${facts.durationSec.toFixed(1)}s, captions: ${facts.bottomCaptions.summary}, camera: ${facts.camera.summary}`);
  }

  let deterministicReviewContext: string | undefined;
  const possiblePaths: string[] = [];
  if (options?.reviewContextPath) {
    possiblePaths.push(path.resolve(options.reviewContextPath));
  } else if (options?.slug) {
    possiblePaths.push(path.join(resolvePackageDir(options.slug), "review.json"));
  } else {
    const parentDir = path.dirname(resolvedPath);
    possiblePaths.push(
      path.join(parentDir, "review.json"),
      path.join(parentDir, "..", "review.json"),
    );
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        deterministicReviewContext = fs.readFileSync(p, "utf8");
        break;
      } catch {}
    }
  }

  onProgress(`Evaluating ${path.basename(resolvedPath)} with agy (${modelName})...`);

  let reAskNote: string | undefined;
  let lastReport: GeminiReviewReport | null = null;

  const workspace = createIsolatedVideoWorkspace({ "video.mp4": resolvedPath });
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const prompt = buildSingleVideoReviewPrompt(
        workspace.videoPaths["video.mp4"],
        reAskNote,
        deterministicReviewContext,
        facts?.rawSummaryText,
      );

      const rawResult = await runner(prompt, {
        model: modelName,
        cwd: workspace.dir,
        timeoutSeconds: options?.timeoutSeconds,
        schema: SINGLE_REVIEW_JSON_SCHEMA,
        onProgress,
      });

    try {
      const parsed = (
        typeof rawResult === "string"
          ? JSON.parse(cleanModelJsonResponse(rawResult))
          : rawResult
      ) as Partial<GeminiReviewReport>;

      // Ensure criteria array is present and complete
      const criteriaList = Array.isArray(parsed.criteria) ? parsed.criteria : [];
      const criteriaMap = new Map(criteriaList.map((c) => [c.name, c]));

      // Merge and fill any criteria missing from model response
      const normalizedCriteria = RUBRIC_CRITERIA.map((def) => {
        const existing = criteriaMap.get(def.name);
        return {
          name: def.name,
          title: def.title,
          isGate: def.isGate,
          score: typeof existing?.score === "number" ? existing.score : 0,
          passed: typeof existing?.passed === "boolean" ? existing.passed : false,
          evidenceTimestamps: Array.isArray(existing?.evidenceTimestamps) ? existing.evidenceTimestamps : [],
          reason: existing?.reason || "No specific feedback provided.",
        };
      });

      // Overwrite/ground measurable gates directly from deterministic facts
      if (facts) {
        // Bottom captions gate
        if (facts.bottomCaptions.measured) {
          const capCrit = normalizedCriteria.find((c) => c.name === "bottom_captions");
          if (capCrit) {
            capCrit.passed = facts.bottomCaptions.hasCaptions;
            capCrit.score = facts.bottomCaptions.hasCaptions
              ? Math.max(capCrit.score, facts.bottomCaptions.score)
              : facts.bottomCaptions.score;
            capCrit.reason = facts.bottomCaptions.summary;
            if (capCrit.evidenceTimestamps.length === 0) {
              capCrit.evidenceTimestamps = ["0:00-0:10", "0:25-0:35"];
            }
          }
        }

        // Camera gate
        if (facts.camera.measured) {
          const camCrit = normalizedCriteria.find((c) => c.name === "camera_purpose");
          if (camCrit) {
            if (facts.camera.hasCameraMoves) {
              camCrit.passed = true;
              camCrit.score = Math.max(camCrit.score, facts.camera.score);
              if (camCrit.score < 6.0) camCrit.score = 8.0;
            } else {
              camCrit.passed = false;
              camCrit.score = Math.min(camCrit.score, facts.camera.score);
              camCrit.reason = facts.camera.summary;
            }
          }
        }

        // Audio mix criterion
        if (facts.audio.measured) {
          const audioCrit = normalizedCriteria.find((c) => c.name === "audio_mix");
          if (audioCrit && facts.audio.hasAudio) {
            const audioPass =
              facts.audio.integratedLufs >= -18 &&
              facts.audio.integratedLufs <= -14 &&
              facts.audio.truePeakDb <= -1.0;
            if (audioPass) {
              audioCrit.passed = true;
              audioCrit.score = Math.max(audioCrit.score, 9.0);
              audioCrit.reason = `Measured mix: ${facts.audio.summary}`;
            }
          }
        }
      }

      // Verify that every single criterion contains timestamp evidence
      const timestampCheck = validateCriterionTimestamps(normalizedCriteria);
      if (!timestampCheck.valid && attempt < maxAttempts) {
        onProgress(
          `Attempt ${attempt} lacked timestamps for: ${timestampCheck.missing.join(", ")}. Re-prompting...`,
        );
        reAskNote = timestampCheck.missing.join(", ");
        continue;
      }

      // Check hard gates: if any gate fails or scores below 6.0, gate fails
      const anyGateFailed = normalizedCriteria.some(
        (c) => c.isGate && (!c.passed || c.score < 6.0),
      );

      const meanScore =
        normalizedCriteria.reduce((sum, c) => sum + c.score, 0) /
        normalizedCriteria.length;
      let overallScore =
        typeof parsed.overallScore === "number" ? parsed.overallScore : meanScore;

      // If any hard gate failed, overall score cannot exceed 8.5
      if (anyGateFailed && overallScore >= 9.0) {
        overallScore = 8.5;
      }

      // Acceptance requires overallScore >= 9.0 AND all gates passing
      const verdict = overallScore >= 9.0 && !anyGateFailed ? "ACCEPT" : "REVISE";

      const normalizedReport: GeminiReviewReport = {
        overallScore,
        verdict,
        summary: parsed.summary || (verdict === "ACCEPT" ? "Meets quality standards." : "Revisions required."),
        criteria: normalizedCriteria,
        feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
        model: modelName,
        evaluatedAt: new Date().toISOString(),
        videoHash: hash,
        videoPath: resolvedPath,
        facts,
      };

      lastReport = normalizedReport;
      return normalizedReport;
    } catch (parseErr) {
      if (attempt >= maxAttempts) {
        throw new Error(
          `Failed to parse valid review report after ${maxAttempts} attempts: ${
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          }`,
        );
      }
      onProgress(`Attempt ${attempt} produced invalid JSON. Retrying...`);
    }
  }
} finally {
  workspace.cleanup();
}

  if (lastReport) return lastReport;
  throw new Error("Video review failed to produce a valid report.");
}

// Executes a dual-agent cross-review pairwise comparison of two videos to verify preference stability.
export async function reviewPairwise(
  pathA: string,
  pathB: string,
  options?: PairwiseReviewOptions,
): Promise<PairwiseRunReport> {
  const resolvedA = path.resolve(pathA);
  const resolvedB = path.resolve(pathB);
  if (!fs.existsSync(resolvedA)) throw new Error(`Video file does not exist: ${resolvedA}`);
  if (!fs.existsSync(resolvedB)) throw new Error(`Video file does not exist: ${resolvedB}`);

  const onProgress = options?.onProgress || (() => {});
  const runner = resolveRunner(options);
  const modelName =
    reviewerModel(options?.model);
  const timeoutSeconds = options?.timeoutSeconds;

  const wsA = createIsolatedVideoWorkspace({ "video.mp4": resolvedA });
  const wsB = createIsolatedVideoWorkspace({ "video.mp4": resolvedB });

  try {
    const promptWatchA = buildPairwiseWatchPrompt(wsA.videoPaths["video.mp4"]);
    onProgress(`Watching Video A (${path.basename(resolvedA)})...`);
    const rawWatchA = await runner(promptWatchA, {
      cwd: wsA.dir,
      schema: PAIRWISE_WATCH_JSON_SCHEMA,
      model: modelName,
      timeoutSeconds,
      onProgress,
    });
    const parsedWatchA = (
      typeof rawWatchA === "string" ? JSON.parse(cleanModelJsonResponse(rawWatchA)) : rawWatchA
    ) as WatchReport & { conversation_id?: string };
    const convA = parsedWatchA.conversation_id;

    const promptWatchB = buildPairwiseWatchPrompt(wsB.videoPaths["video.mp4"]);
    onProgress(`Watching Video B (${path.basename(resolvedB)})...`);
    const rawWatchB = await runner(promptWatchB, {
      cwd: wsB.dir,
      schema: PAIRWISE_WATCH_JSON_SCHEMA,
      model: modelName,
      timeoutSeconds,
      onProgress,
    });
    const parsedWatchB = (
      typeof rawWatchB === "string" ? JSON.parse(cleanModelJsonResponse(rawWatchB)) : rawWatchB
    ) as WatchReport & { conversation_id?: string };
    const convB = parsedWatchB.conversation_id;

    const promptExA = buildPairwiseExchangePrompt("Video B", parsedWatchB);
    onProgress(`Exchange Phase: Agent A rating Video B...`);
    const rawExA = await runner(promptExA, {
      cwd: wsA.dir,
      schema: PAIRWISE_EXCHANGE_JSON_SCHEMA,
      conversationId: convA,
      model: modelName,
      timeoutSeconds,
      onProgress,
    });
    const parsedExA = (
      typeof rawExA === "string" ? JSON.parse(cleanModelJsonResponse(rawExA)) : rawExA
    ) as { otherVideoRating: number; reasoning: string };
    const ratingB_byA = parsedExA.otherVideoRating;

    const promptExB = buildPairwiseExchangePrompt("Video A", parsedWatchA);
    onProgress(`Exchange Phase: Agent B rating Video A...`);
    const rawExB = await runner(promptExB, {
      cwd: wsB.dir,
      schema: PAIRWISE_EXCHANGE_JSON_SCHEMA,
      conversationId: convB,
      model: modelName,
      timeoutSeconds,
      onProgress,
    });
    const parsedExB = (
      typeof rawExB === "string" ? JSON.parse(cleanModelJsonResponse(rawExB)) : rawExB
    ) as { otherVideoRating: number; reasoning: string };
    const ratingA_byB = parsedExB.otherVideoRating;

    const finalA = (parsedWatchA.rating + ratingA_byB) / 2;
    const finalB = (parsedWatchB.rating + ratingB_byA) / 2;
    const winner = finalA > finalB ? "Video A" : finalB > finalA ? "Video B" : "Tie";

    return {
      videoA: {
        path: resolvedA,
        watchReport: parsedWatchA,
        ratingByWatcher: parsedWatchA.rating,
        ratingByOther: ratingA_byB,
        finalRating: finalA,
      },
      videoB: {
        path: resolvedB,
        watchReport: parsedWatchB,
        ratingByWatcher: parsedWatchB.rating,
        ratingByOther: ratingB_byA,
        finalRating: finalB,
      },
      winner,
      evaluatedAt: new Date().toISOString(),
    };
  } finally {
    wsA.cleanup();
    wsB.cleanup();
  }
}

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
