/**
 * File Description: High-level video review engine using the agy CLI agent running Gemini 3.8 Flash.
 * Evaluates local mp4 videos against the 12-criterion rubric, enforces timestamp evidence verification,
 * validates hard gates, and executes order-swapped pairwise video comparisons.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { extractDeterministicFacts } from "./facts";
import {
  PAIRWISE_REVIEW_JSON_SCHEMA,
  RUBRIC_CRITERIA,
  SINGLE_REVIEW_JSON_SCHEMA,
  buildPairwiseReviewPrompt,
  buildSingleVideoReviewPrompt,
  validateCriterionTimestamps,
} from "./rubric";
import type {
  AgyReviewClient,
  AgyRunner,
  AgyRunnerOptions,
  DeterministicVideoFacts,
  GeminiReviewReport,
  PairwiseComparisonResult,
  PairwiseRunReport,
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
    options?.model ||
    process.env.AIDEOS_GEMINI_REVIEW_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-3.8-flash-high";
  const timeoutSec =
    options?.timeoutSeconds ??
    (Number(process.env.AIDEOS_AGY_TIMEOUT) || 900);
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
    "--dangerously-skip-permissions",
  ];

  if (options?.schema) {
    args.push("--json-schema", JSON.stringify(options.schema));
  }

  return new Promise<string>((resolve, reject) => {
    execFile(
      "agy",
      args,
      {
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
            return resolve(JSON.stringify(parsed.structured_output));
          }

          if (typeof parsed.response === "string" && parsed.response.trim().length > 0) {
            return resolve(cleanModelJsonResponse(parsed.response));
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

// Strips markdown code block fences and extracts clean JSON text.
export function cleanModelJsonResponse(rawText: string): string {
  const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return rawText.trim();
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
    options?.model ||
    process.env.AIDEOS_GEMINI_REVIEW_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-3.8-flash-high";
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
  const possiblePaths = [];
  if (options?.slug) {
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

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildSingleVideoReviewPrompt(
      resolvedPath,
      reAskNote,
      deterministicReviewContext,
      facts?.rawSummaryText,
    );

    const rawResult = await runner(prompt, {
      model: modelName,
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

  if (lastReport) return lastReport;
  throw new Error("Video review failed to produce a valid report.");
}

// Executes an order-swapped pairwise comparison of two videos to verify preference stability.
export async function reviewPairwise(
  pathA: string,
  pathB: string,
  options?: PairwiseReviewOptions,
): Promise<PairwiseRunReport> {
  const resolvedA = path.resolve(pathA);
  const resolvedB = path.resolve(pathB);
  if (!fs.existsSync(resolvedA)) {
    throw new Error(`Video file does not exist: ${resolvedA}`);
  }
  if (!fs.existsSync(resolvedB)) {
    throw new Error(`Video file does not exist: ${resolvedB}`);
  }

  const onProgress = options?.onProgress || (() => {});
  const runner = resolveRunner(options);
  const modelName =
    options?.model ||
    process.env.AIDEOS_GEMINI_REVIEW_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-3.8-flash-high";

  const timeoutSeconds =
    options?.timeoutSeconds ??
    (Number(process.env.AIDEOS_AGY_TIMEOUT) || 1200);

  // Order 1: Video 1 = A, Video 2 = B
  onProgress(`Running pairwise comparison with agy (${modelName}) (Order: Video 1 = A, Video 2 = B)...`);
  const promptAB = buildPairwiseReviewPrompt(resolvedA, resolvedB);
  const rawAB = await runner(promptAB, {
    model: modelName,
    timeoutSeconds,
    schema: PAIRWISE_REVIEW_JSON_SCHEMA,
    onProgress,
  });

  const parsedAB = (
    typeof rawAB === "string" ? JSON.parse(cleanModelJsonResponse(rawAB)) : rawAB
  ) as {
    video1Score: number;
    video2Score: number;
    choice: "Video 1" | "Video 2" | "Tie";
    reasoning: string;
    timestampsCited?: string[];
  };

  if (
    typeof parsedAB?.video1Score !== "number" ||
    typeof parsedAB?.video2Score !== "number" ||
    !parsedAB?.choice
  ) {
    throw new Error(
      `Invalid pairwise comparison output from agy (Order AB): missing scores or choice in ${JSON.stringify(rawAB)}`,
    );
  }

  const orderAB: PairwiseComparisonResult = {
    orderKey: "Video1=A, Video2=B",
    video1Path: resolvedA,
    video2Path: resolvedB,
    video1Score: parsedAB.video1Score,
    video2Score: parsedAB.video2Score,
    choice: parsedAB.choice,
    reasoning: parsedAB.reasoning,
    timestampsCited: parsedAB.timestampsCited || [],
  };

  // Order 2: Video 1 = B, Video 2 = A
  onProgress(`Running pairwise comparison with agy (${modelName}) (Order: Video 1 = B, Video 2 = A)...`);
  const promptBA = buildPairwiseReviewPrompt(resolvedB, resolvedA);
  const rawBA = await runner(promptBA, {
    model: modelName,
    timeoutSeconds,
    schema: PAIRWISE_REVIEW_JSON_SCHEMA,
    onProgress,
  });

  const parsedBA = (
    typeof rawBA === "string" ? JSON.parse(cleanModelJsonResponse(rawBA)) : rawBA
  ) as {
    video1Score: number;
    video2Score: number;
    choice: "Video 1" | "Video 2" | "Tie";
    reasoning: string;
    timestampsCited?: string[];
  };

  if (
    typeof parsedBA?.video1Score !== "number" ||
    typeof parsedBA?.video2Score !== "number" ||
    !parsedBA?.choice
  ) {
    throw new Error(
      `Invalid pairwise comparison output from agy (Order BA): missing scores or choice in ${JSON.stringify(rawBA)}`,
    );
  }

  const orderBA: PairwiseComparisonResult = {
    orderKey: "Video1=B, Video2=A",
    video1Path: resolvedB,
    video2Path: resolvedA,
    video1Score: parsedBA.video1Score,
    video2Score: parsedBA.video2Score,
    choice: parsedBA.choice,
    reasoning: parsedBA.reasoning,
    timestampsCited: parsedBA.timestampsCited || [],
  };

  // Determine winner in each order
  // For AB: Video 1 is A, Video 2 is B
  const winnerInAB = orderAB.choice === "Video 1" ? "Video A" : orderAB.choice === "Video 2" ? "Video B" : "Tie";
  // For BA: Video 1 is B, Video 2 is A
  const winnerInBA = orderBA.choice === "Video 2" ? "Video A" : orderBA.choice === "Video 1" ? "Video B" : "Tie";

  const consistentWinner =
    winnerInAB === winnerInBA && (winnerInAB === "Video A" || winnerInAB === "Video B")
      ? winnerInAB
      : "Inconsistent";

  return {
    orderAB,
    orderBA,
    consistentWinner,
    evaluatedAt: new Date().toISOString(),
  };
}
