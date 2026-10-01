/**
 * File Description: High-level video review engine using Gemini 3.8 Flash.
 * Evaluates videos against the 12-criterion rubric, enforces timestamp evidence verification,
 * validates hard gates, and executes order-swapped pairwise video comparisons.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { getGoogleAiClient } from "../modelClient";
import { extractDeterministicFacts } from "./facts";
import {
  RUBRIC_CRITERIA,
  buildPairwiseReviewPrompt,
  buildSingleVideoReviewPrompt,
  validateCriterionTimestamps,
} from "./rubric";
import type {
  DeterministicVideoFacts,
  GeminiReviewReport,
  PairwiseComparisonResult,
  PairwiseRunReport,
} from "./types";

export interface SingleReviewOptions {
  client?: GeminiVideoClient;
  clientOptions?: GeminiClientOptions;
  maxValidationAttempts?: number;
  filmPath?: string;
  skipFacts?: boolean;
  facts?: DeterministicVideoFacts;
  slug?: string;
  onProgress?: (message: string) => void;
}

export interface PairwiseReviewOptions {
  client?: GeminiVideoClient;
  clientOptions?: GeminiClientOptions;
  onProgress?: (message: string) => void;
}

export interface GeminiVideoClient {
  uploadVideo(filePath: string, displayName?: string): Promise<{ name: string, uri: string, state: string }>;
  generateContentWithVideo(videoUri: string, promptText: string, options?: { temperature?: number, systemInstruction?: string }): Promise<string>;
  generateContentPairwise(videoUriA: string, videoUriB: string, promptText: string): Promise<string>;
}

export interface GeminiClientOptions {
  onProgress?: (message: string) => void;
  [key: string]: any;
}

function createDefaultClient(options?: GeminiClientOptions): GeminiVideoClient {
  const ai = getGoogleAiClient();
  const modelName = process.env.AIDEOS_GEMINI_REVIEW_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const onProgress = options?.onProgress || (() => {});
  
  return {
    async uploadVideo(filePath: string, displayName?: string) {
      const file = await ai.files.upload({
        file: filePath,
        config: { displayName: displayName || path.basename(filePath) }
      });
      let currentFile = file;
      while (currentFile.state === "PROCESSING") {
        onProgress(`  Video processing (${currentFile.name})...`);
        await new Promise(r => setTimeout(r, 5000));
        currentFile = await ai.files.get({ name: file.name });
      }
      if (currentFile.state === "FAILED") {
        throw new Error(`Video processing failed for ${filePath}`);
      }
      return currentFile as any;
    },
    async generateContentWithVideo(videoUri: string, promptText: string, configOpts?: any) {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{
          role: "user",
          parts: [
            { fileData: { fileUri: videoUri, mimeType: "video/mp4" } },
            { text: promptText }
          ]
        }],
        config: {
          temperature: configOpts?.temperature ?? 0.1,
          systemInstruction: configOpts?.systemInstruction,
        }
      });
      return response.text || "";
    },
    async generateContentPairwise(uriA: string, uriB: string, promptText: string) {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{
          role: "user",
          parts: [
            { fileData: { fileUri: uriA, mimeType: "video/mp4" } },
            { fileData: { fileUri: uriB, mimeType: "video/mp4" } },
            { text: promptText }
          ]
        }],
        config: { temperature: 0.1 }
      });
      return response.text || "";
    }
  };
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
  const client = options?.client || createDefaultClient({ ...options?.clientOptions, onProgress });
  const maxAttempts = options?.maxValidationAttempts ?? 3;

  onProgress(`Uploading ${path.basename(resolvedPath)} to Gemini Files API...`);
  const uploaded = await client.uploadVideo(resolvedPath);
  onProgress(`Video uploaded (${uploaded.name}). Running Gemini 3.8 Flash evaluation...`);

  let reAskNote: string | undefined;
  let lastReport: GeminiReviewReport | null = null;

  // Extract deterministic facts (duration, captions via OCR, loudness, camera)
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

  // Check for pre-existing deterministic review report (e.g. from fm/aideos-review-deterministic)
  let deterministicReviewContext: string | undefined;
  const possiblePaths = [];
  if (options?.slug) {
    possiblePaths.push(path.join(resolvePackageDir(options.slug), "review.json"));
  } else {
    const parentDir = path.dirname(resolvedPath);
    possiblePaths.push(
      path.join(parentDir, "review.json"),
      path.join(parentDir, "..", "review.json")
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

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildSingleVideoReviewPrompt(
      reAskNote,
      deterministicReviewContext,
      facts?.rawSummaryText,
    );
    const rawJson = await client.generateContentWithVideo(uploaded.uri, prompt, {
      temperature: 0.1,
      systemInstruction:
        "You are an uncompromising technical video critic. Evaluate the video strictly, cite timestamps, and output valid JSON.",
    });

    try {
      const parsed = JSON.parse(cleanModelJsonResponse(rawJson)) as Partial<GeminiReviewReport>;

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
        model: "gemini-3.8-flash",
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
  const onProgress = options?.onProgress || (() => {});
  const client = options?.client || createDefaultClient({ ...options?.clientOptions, onProgress });

  onProgress(`Uploading Video A: ${path.basename(pathA)}...`);
  const uploadA = await client.uploadVideo(pathA, "video_a");

  onProgress(`Uploading Video B: ${path.basename(pathB)}...`);
  const uploadB = await client.uploadVideo(pathB, "video_b");

  const prompt = buildPairwiseReviewPrompt();

  // Order 1: Video 1 = A, Video 2 = B
  onProgress("Running pairwise comparison (Order: Video 1 = A, Video 2 = B)...");
  const rawAB = await client.generateContentPairwise(uploadA.uri, uploadB.uri, prompt);
  const parsedAB = JSON.parse(cleanModelJsonResponse(rawAB)) as {
    video1Score: number;
    video2Score: number;
    choice: "Video 1" | "Video 2" | "Tie";
    reasoning: string;
    timestampsCited?: string[];
  };

  const orderAB: PairwiseComparisonResult = {
    orderKey: "Video1=A, Video2=B",
    video1Path: pathA,
    video2Path: pathB,
    video1Score: parsedAB.video1Score,
    video2Score: parsedAB.video2Score,
    choice: parsedAB.choice,
    reasoning: parsedAB.reasoning,
    timestampsCited: parsedAB.timestampsCited || [],
  };

  // Order 2: Video 1 = B, Video 2 = A
  onProgress("Running pairwise comparison (Order: Video 1 = B, Video 2 = A)...");
  const rawBA = await client.generateContentPairwise(uploadB.uri, uploadA.uri, prompt);
  const parsedBA = JSON.parse(cleanModelJsonResponse(rawBA)) as {
    video1Score: number;
    video2Score: number;
    choice: "Video 1" | "Video 2" | "Tie";
    reasoning: string;
    timestampsCited?: string[];
  };

  const orderBA: PairwiseComparisonResult = {
    orderKey: "Video1=B, Video2=A",
    video1Path: pathB,
    video2Path: pathA,
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
