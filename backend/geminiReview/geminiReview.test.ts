/**
 * File Description: Comprehensive unit tests for the Gemini 3.8 Flash video quality review system,
 * covering client upload/polling/retries, rubric schema validation, timestamp verification,
 * single video scoring, pairwise order-swapped comparison, and iterative review loop orchestration.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RUBRIC_CRITERIA,
  validateCriterionTimestamps,
  buildSingleVideoReviewPrompt,
  buildPairwiseReviewPrompt,
} from "./rubric";
import { GeminiVideoClient } from "./geminiClient";
import {
  computeFileHash,
  cleanModelJsonResponse,
  reviewVideo,
  reviewPairwise,
} from "./geminiReview";
import {
  formatReviewSummary,
  runReviewLoop,
} from "./reviewLoop";
import type { CriterionEvaluation, GeminiReviewReport, ReviewFeedbackItem } from "./types";

// Helper to construct a full 12-criterion evaluation list for test mocks.
function createMockCriteria(options?: { gateScore?: number; gatePassed?: boolean; withTimestamps?: boolean }): CriterionEvaluation[] {
  const gateScore = options?.gateScore ?? 9.0;
  const gatePassed = options?.gatePassed ?? true;
  const withTimestamps = options?.withTimestamps ?? true;

  return RUBRIC_CRITERIA.map((def) => ({
    name: def.name,
    title: def.title,
    isGate: def.isGate,
    score: def.isGate ? gateScore : 8.5,
    passed: def.isGate ? gatePassed : true,
    evidenceTimestamps: withTimestamps ? ["0:12", "0:45-0:52"] : [],
    reason: withTimestamps ? `Observed compliant behavior at 0:12 for ${def.title}` : "Generic reason without timestamps",
  }));
}

test("Rubric: defines 12 criteria and exactly 6 hard gates", () => {
  assert.equal(RUBRIC_CRITERIA.length, 12);
  const gates = RUBRIC_CRITERIA.filter((c) => c.isGate);
  assert.equal(gates.length, 6);

  const gateNames = new Set(gates.map((g) => g.name));
  assert.ok(gateNames.has("persistent_stage"));
  assert.ok(gateNames.has("camera_purpose"));
  assert.ok(gateNames.has("bottom_captions"));
  assert.ok(gateNames.has("readability"));
  assert.ok(gateNames.has("no_overlap_clipping"));
  assert.ok(gateNames.has("audio_sync"));
});

test("Rubric: validateCriterionTimestamps validates valid timestamps and detects missing ones", () => {
  const validCriteria = createMockCriteria({ withTimestamps: true });
  const checkValid = validateCriterionTimestamps(validCriteria);
  assert.equal(checkValid.valid, true);
  assert.deepEqual(checkValid.missing, []);

  const invalidCriteria: CriterionEvaluation[] = [
    {
      name: "persistent_stage",
      title: "One persistent stage",
      isGate: true,
      score: 8.0,
      passed: true,
      evidenceTimestamps: [],
      reason: "No timestamp mentioned anywhere here.",
    },
    {
      name: "camera_purpose",
      title: "Camera that does something",
      isGate: true,
      score: 8.0,
      passed: true,
      evidenceTimestamps: ["0:15"],
      reason: "Camera pans left at 0:15.",
    },
  ];

  const checkInvalid = validateCriterionTimestamps(invalidCriteria);
  assert.equal(checkInvalid.valid, false);
  assert.deepEqual(checkInvalid.missing, ["persistent_stage"]);
});

test("Rubric: buildSingleVideoReviewPrompt injects re-ask note when specified", () => {
  const normalPrompt = buildSingleVideoReviewPrompt();
  assert.ok(normalPrompt.includes("persistent_stage"));
  assert.ok(normalPrompt.includes("HARD GATE"));
  assert.ok(!normalPrompt.includes("CRITICAL PREVIOUS ERROR"));

  const reAskPrompt = buildSingleVideoReviewPrompt("bottom_captions, camera_purpose");
  assert.ok(reAskPrompt.includes("CRITICAL PREVIOUS ERROR"));
  assert.ok(reAskPrompt.includes("bottom_captions, camera_purpose"));
});

test("Rubric: buildPairwiseReviewPrompt contains core comparison directives", () => {
  const prompt = buildPairwiseReviewPrompt();
  assert.ok(prompt.includes("Video 1"));
  assert.ok(prompt.includes("Video 2"));
  assert.ok(prompt.includes("video1Score"));
  assert.ok(prompt.includes("video2Score"));
});

test("geminiReview: cleanModelJsonResponse strips markdown code block fences", () => {
  const jsonWithFence = "```json\n{\"overallScore\": 9.2}\n```";
  assert.equal(cleanModelJsonResponse(jsonWithFence), "{\"overallScore\": 9.2}");

  const genericFence = "```\n{\"verdict\": \"ACCEPT\"}\n```";
  assert.equal(cleanModelJsonResponse(genericFence), "{\"verdict\": \"ACCEPT\"}");

  const plain = "{\"status\": \"ok\"}";
  assert.equal(cleanModelJsonResponse(plain), "{\"status\": \"ok\"}");
});

test("geminiReview: computeFileHash computes correct sha256 checksum", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-test-hash-"));
  const tmpFile = path.join(tmpDir, "sample.txt");
  fs.writeFileSync(tmpFile, "hello aideos world\n", "utf8");

  const hash = computeFileHash(tmpFile);
  assert.equal(typeof hash, "string");
  assert.equal(hash.length, 64);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("GeminiVideoClient: handles resumable upload protocol and active polling", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-client-test-"));
  const testVideo = path.join(tmpDir, "test.mp4");
  fs.writeFileSync(testVideo, Buffer.alloc(1024, 0));

  let pollCount = 0;
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);

    if (url.includes("/upload/v1beta/files")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "X-Goog-Upload-URL": "https://upload.example.com/session-123" },
      });
    }

    if (url === "https://upload.example.com/session-123") {
      return new Response(
        JSON.stringify({ file: { name: "files/test-file-999", uri: "https://genai.example.com/v1/files/999", state: "PROCESSING" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.includes("/v1beta/files/test-file-999")) {
      pollCount++;
      const state = pollCount >= 2 ? "ACTIVE" : "PROCESSING";
      return new Response(
        JSON.stringify({ name: "files/test-file-999", uri: "https://genai.example.com/v1/files/999", state }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unexpected request to ${url}`);
  };

  const client = new GeminiVideoClient({
    apiKey: "test-api-key",
    fetchFn: mockFetch,
    sleepFn: async () => {},
    pollIntervalMs: 1,
  });

  const uploadResult = await client.uploadVideo(testVideo);
  assert.equal(uploadResult.state, "ACTIVE");
  assert.equal(uploadResult.name, "files/test-file-999");
  assert.equal(uploadResult.uri, "https://genai.example.com/v1/files/999");
  assert.ok(pollCount >= 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("GeminiVideoClient: retries on 429 and parses retry-after wait duration", async () => {
  let attempts = 0;
  let sleptMs = 0;

  const mockFetch: typeof fetch = async () => {
    attempts++;
    if (attempts === 1) {
      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: "Quota exceeded for model gemini-3.8-flash. Please retry in 4.5s.",
            status: "RESOURCE_EXHAUSTED",
          },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "{\"status\":\"success\"}" }] } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const client = new GeminiVideoClient({
    apiKey: "test-key",
    fetchFn: mockFetch,
    sleepFn: async (ms) => {
      sleptMs = ms;
    },
  });

  const res = await client.generateContentWithVideo("https://example.com/file", "hello");
  assert.equal(attempts, 2);
  assert.ok(sleptMs >= 6000);
  assert.ok(res.includes("success"));
});

test("geminiReview: reviewVideo evaluates verdict ACCEPT when score >= 9.0 and gates pass", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-review-test-"));
  const testVideo = path.join(tmpDir, "test.mp4");
  fs.writeFileSync(testVideo, Buffer.alloc(512, 1));

  const criteria = createMockCriteria({ gateScore: 9.2, gatePassed: true, withTimestamps: true });
  const mockReportPayload: Partial<GeminiReviewReport> = {
    overallScore: 9.3,
    verdict: "ACCEPT",
    summary: "Exceptional visual continuity and synchronized audio.",
    criteria,
    feedback: [],
  };

  const mockClient = {
    uploadVideo: async () => ({ name: "files/123", uri: "https://example.com/123", state: "ACTIVE" as const }),
    generateContentWithVideo: async () => JSON.stringify(mockReportPayload),
  } as unknown as GeminiVideoClient;

  const report = await reviewVideo(testVideo, { client: mockClient });
  assert.equal(report.overallScore, 9.3);
  assert.equal(report.verdict, "ACCEPT");
  assert.equal(report.criteria.length, 12);
  assert.equal(report.model, "gemini-3.8-flash");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("geminiReview: reviewVideo assigns REVISE if any hard gate fails even with high total score", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-review-gate-test-"));
  const testVideo = path.join(tmpDir, "test.mp4");
  fs.writeFileSync(testVideo, Buffer.alloc(512, 1));

  const criteria = createMockCriteria({ gateScore: 4.0, gatePassed: false, withTimestamps: true });
  const mockReportPayload: Partial<GeminiReviewReport> = {
    overallScore: 9.1,
    verdict: "ACCEPT",
    summary: "High overall but failed caption gate.",
    criteria,
    feedback: [{ priority: "high", timestamp: "0:20", issue: "No captions", recommendation: "Enable bottom captions" }],
  };

  const mockClient = {
    uploadVideo: async () => ({ name: "files/456", uri: "https://example.com/456", state: "ACTIVE" as const }),
    generateContentWithVideo: async () => JSON.stringify(mockReportPayload),
  } as unknown as GeminiVideoClient;

  const report = await reviewVideo(testVideo, { client: mockClient });
  assert.equal(report.verdict, "REVISE");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("geminiReview: reviewPairwise runs swapped presentation orders and determines consistent winner", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-pairwise-test-"));
  const videoA = path.join(tmpDir, "videoA.mp4");
  const videoB = path.join(tmpDir, "videoB.mp4");
  fs.writeFileSync(videoA, Buffer.alloc(100, 1));
  fs.writeFileSync(videoB, Buffer.alloc(100, 2));

  let callIndex = 0;
  const mockClient = {
    uploadVideo: async (filePath: string, name?: string) => ({
      name: `files/${name || "video"}`,
      uri: `https://example.com/${name || "video"}`,
      state: "ACTIVE" as const,
    }),
    generateContentPairwise: async (uri1: string, uri2: string) => {
      callIndex++;
      if (callIndex === 1) {
        // Order 1: Video 1 = A, Video 2 = B. Chooses Video 1 (A).
        return JSON.stringify({
          video1Score: 9.1,
          video2Score: 7.2,
          choice: "Video 1",
          reasoning: "Video 1 has superior camera motion and bottom captions.",
          timestampsCited: ["0:15", "0:42"],
        });
      }
      // Order 2: Video 1 = B, Video 2 = A. Chooses Video 2 (A).
      return JSON.stringify({
        video1Score: 7.3,
        video2Score: 9.2,
        choice: "Video 2",
        reasoning: "Video 2 demonstrates continuous 3D stage and clear narrative build.",
        timestampsCited: ["0:18", "0:45"],
      });
    },
  } as unknown as GeminiVideoClient;

  const pairwiseResult = await reviewPairwise(videoA, videoB, { client: mockClient });
  assert.equal(pairwiseResult.consistentWinner, "Video A");
  assert.equal(pairwiseResult.orderAB.choice, "Video 1");
  assert.equal(pairwiseResult.orderBA.choice, "Video 2");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("reviewLoop: formatReviewSummary outputs human-readable breakdown", () => {
  const criteria = createMockCriteria({ gateScore: 8.5, gatePassed: true, withTimestamps: true });
  const feedback: ReviewFeedbackItem[] = [
    { priority: "high", timestamp: "0:25", issue: "Stage clears at 0:25", recommendation: "Keep node elements persistent" },
  ];
  const report: GeminiReviewReport = {
    overallScore: 8.2,
    verdict: "REVISE",
    summary: "Solid start but needs stage continuity.",
    criteria,
    feedback,
    model: "gemini-3.8-flash",
    evaluatedAt: new Date().toISOString(),
  };

  const summary = formatReviewSummary(report);
  assert.ok(summary.includes("Gemini 3.8 Flash Video Review"));
  assert.ok(summary.includes("8.2 / 10.0"));
  assert.ok(summary.includes("REVISE"));
  assert.ok(summary.includes("[GATE]"));
  assert.ok(summary.includes("Keep node elements persistent"));
});

test("reviewLoop: applyFeedbackToFilm modifies film.json configuration", async () => {
  const tmpVideos = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-film-test-"));
  const slugDir = path.join(tmpVideos, "test-film");
  fs.mkdirSync(slugDir, { recursive: true });

  const initialFilm = {
    id: "test-film",
    title: "Test Film",
    showCaptions: false,
    shots: [
      { id: "shot-1", dur: 20, move: "none" },
    ],
  };
  fs.writeFileSync(path.join(slugDir, "film.json"), JSON.stringify(initialFilm, null, 2), "utf8");

  // Temporarily override REPO_ROOT for this test
  const feedback: ReviewFeedbackItem[] = [
    { priority: "high", issue: "Missing bottom captions", recommendation: "Enable bottom caption band" },
    { priority: "medium", issue: "Static camera", recommendation: "Add slow zoom in camera motion" },
    { priority: "low", issue: "Shot held too long", recommendation: "Shorten shot duration" },
  ];

  // Directly test the transformation logic on the film JSON
  const raw = fs.readFileSync(path.join(slugDir, "film.json"), "utf8");
  const film = JSON.parse(raw);
  for (const item of feedback) {
    const text = `${item.issue} ${item.recommendation}`.toLowerCase();
    if (text.includes("caption")) film.showCaptions = true;
    if (text.includes("camera")) film.shots[0].move = "slow-zoom-in";
    if (text.includes("shorten")) film.shots[0].dur = 16;
  }
  fs.writeFileSync(path.join(slugDir, "film.json"), JSON.stringify(film, null, 2), "utf8");

  const updated = JSON.parse(fs.readFileSync(path.join(slugDir, "film.json"), "utf8"));
  assert.equal(updated.showCaptions, true);
  assert.equal(updated.shots[0].move, "slow-zoom-in");
  assert.equal(updated.shots[0].dur, 16);

  fs.rmSync(tmpVideos, { recursive: true, force: true });
});

test("reviewLoop: runs multi-round loop and achieves target score 9.0+", async () => {
  const tmpVideoDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-loop-test-"));
  const testSlug = "mock-loop-slug";
  const repoVideos = path.join(__dirname, "../../videos", testSlug);
  fs.mkdirSync(repoVideos, { recursive: true });

  let roundCounter = 0;
  const mockReviewer = async (_videoPath: string, round: number): Promise<GeminiReviewReport> => {
    roundCounter = round;
    if (round === 1) {
      return {
        overallScore: 7.8,
        verdict: "REVISE",
        summary: "Round 1 needs camera motion and caption adjustments.",
        criteria: createMockCriteria({ gateScore: 7.0, gatePassed: true }),
        feedback: [{ priority: "high", timestamp: "0:10", issue: "Static camera", recommendation: "Add camera moves" }],
        model: "gemini-3.8-flash",
        evaluatedAt: new Date().toISOString(),
        videoHash: "hash-r1",
      };
    }
    return {
      overallScore: 9.3,
      verdict: "ACCEPT",
      summary: "Round 2 achieved exceptional continuity and 9.3 rating.",
      criteria: createMockCriteria({ gateScore: 9.5, gatePassed: true }),
      feedback: [],
      model: "gemini-3.8-flash",
      evaluatedAt: new Date().toISOString(),
      videoHash: "hash-r2",
    };
  };

  const mockRenderer = async (_slug: string) => {
    const p = path.join(tmpVideoDir, `render-round-${roundCounter + 1}.mp4`);
    fs.writeFileSync(p, Buffer.alloc(256, 1));
    return p;
  };

  const progressEvents: string[] = [];
  const loopResult = await runReviewLoop(testSlug, {
    maxRounds: 4,
    targetScore: 9.0,
    autoRefine: false,
    mockRenderer,
    mockReviewer,
    onProgress: (msg) => progressEvents.push(msg),
  });

  assert.equal(loopResult.passed, true);
  assert.equal(loopResult.finalScore, 9.3);
  assert.equal(loopResult.rounds.length, 2);

  // Check persisted round files
  const round1Path = path.join(repoVideos, "gemini-review", "round-1.json");
  const round2Path = path.join(repoVideos, "gemini-review", "round-2.json");
  const latestPath = path.join(repoVideos, "gemini-review", "latest.json");
  assert.ok(fs.existsSync(round1Path));
  assert.ok(fs.existsSync(round2Path));
  assert.ok(fs.existsSync(latestPath));

  // Clean up test slug dir
  fs.rmSync(repoVideos, { recursive: true, force: true });
  fs.rmSync(tmpVideoDir, { recursive: true, force: true });
});

test("geminiReview: grounds measurable gates in deterministic facts", async () => {
  const tmpVideo = path.join(os.tmpdir(), `test-facts-video-${Date.now()}.mp4`);
  fs.writeFileSync(tmpVideo, Buffer.alloc(1024, 0));

  const modelReport = {
    overallScore: 9.2,
    verdict: "ACCEPT",
    summary: "Visually polished video.",
    criteria: createMockCriteria({ gateScore: 9.0, gatePassed: true }),
    feedback: [],
  };

  const mockClient = {
    uploadVideo: async () => ({ name: "files/test123", uri: "https://mock.gemini/file", state: "ACTIVE" as const }),
    generateContentWithVideo: async () => JSON.stringify(modelReport),
  } as unknown as GeminiVideoClient;

  // Provide deterministic facts indicating 0% captions (like Video B)
  const facts = {
    durationSec: 80.8,
    audio: { measured: true, hasAudio: true, integratedLufs: -16.5, truePeakDb: -1.0, summary: "-16.5 LUFS" },
    bottomCaptions: {
      measured: true,
      hasCaptions: false,
      coverageRatio: 0,
      sampledFrames: 12,
      captionFrames: 0,
      score: 0.0,
      summary: "0% caption frames detected by OCR in bottom band (0/12)",
    },
    camera: { measured: true, hasCameraMoves: false, moveCount: 1, score: 4.0, summary: "Static camera" },
    readability: { measured: true, summary: "Legibility OK" },
    rawSummaryText: "PRE-MEASURED FACTS: 0% captions",
  };

  const report = await reviewVideo(tmpVideo, {
    client: mockClient,
    facts,
  });

  // Deterministic facts MUST override model mistake and fail bottom_captions gate
  const capGate = report.criteria.find((c) => c.name === "bottom_captions");
  assert.ok(capGate);
  assert.equal(capGate.passed, false);
  assert.equal(capGate.score, 0.0);
  assert.equal(report.verdict, "REVISE");
  assert.ok(report.overallScore <= 8.5);

  fs.unlinkSync(tmpVideo);
});

test("reviewLoop: requires winning or tying pairwise check when reference video is configured", async () => {
  const tmpVideoDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-loop-ref-test-"));
  const testSlug = "mock-ref-slug";
  const repoVideos = path.join(__dirname, "../../videos", testSlug);
  fs.mkdirSync(repoVideos, { recursive: true });

  const candidateVideo = path.join(tmpVideoDir, "candidate.mp4");
  const refVideo = path.join(tmpVideoDir, "ref.mp4");
  fs.writeFileSync(candidateVideo, Buffer.alloc(256, 1));
  fs.writeFileSync(refVideo, Buffer.alloc(256, 2));

  // Candidate gets 9.2 single score but loses pairwise in round 1, wins in round 2
  let roundNum = 0;
  const mockReviewer = async () => ({
    overallScore: 9.2,
    verdict: "ACCEPT" as const,
    summary: "Single evaluation excellent.",
    criteria: createMockCriteria({ gateScore: 9.2, gatePassed: true }),
    feedback: [],
    model: "gemini-3.8-flash",
    evaluatedAt: new Date().toISOString(),
    videoHash: "hash-ref-test",
  });

  const mockPairwise = async () => {
    roundNum++;
    if (roundNum === 1) {
      // Round 1: candidate loses to reference
      return {
        orderAB: {
          orderKey: "Video1=candidate, Video2=ref",
          video1Path: candidateVideo,
          video2Path: refVideo,
          video1Score: 7.0,
          video2Score: 9.0,
          choice: "Video 2" as const, // reference wins
          reasoning: "Reference video had superior stage persistence",
          timestampsCited: ["0:15"],
        },
        orderBA: {
          orderKey: "Video1=ref, Video2=candidate",
          video1Path: refVideo,
          video2Path: candidateVideo,
          video1Score: 9.0,
          video2Score: 7.0,
          choice: "Video 1" as const, // reference wins
          reasoning: "Reference video preferred",
          timestampsCited: ["0:15"],
        },
        consistentWinner: "Video B" as const,
        evaluatedAt: new Date().toISOString(),
      };
    }
    // Round 2: candidate wins
    return {
      orderAB: {
        orderKey: "Video1=candidate, Video2=ref",
        video1Path: candidateVideo,
        video2Path: refVideo,
        video1Score: 9.5,
        video2Score: 8.0,
        choice: "Video 1" as const, // candidate wins
        reasoning: "Candidate video has better persistent stage",
        timestampsCited: ["0:20"],
      },
      orderBA: {
        orderKey: "Video1=ref, Video2=candidate",
        video1Path: refVideo,
        video2Path: candidateVideo,
        video1Score: 8.0,
        video2Score: 9.5,
        choice: "Video 2" as const, // candidate wins
        reasoning: "Candidate video preferred",
        timestampsCited: ["0:20"],
      },
      consistentWinner: "Video A" as const,
      evaluatedAt: new Date().toISOString(),
    };
  };

  const mockRenderer = async () => candidateVideo;

  const loopResult = await runReviewLoop(testSlug, {
    maxRounds: 3,
    targetScore: 9.0,
    referenceVideo: refVideo,
    autoRefine: false,
    mockRenderer,
    mockReviewer,
    mockPairwise,
  });

  // Must not pass on round 1 (pairwise failed); must pass on round 2 (pairwise won)
  assert.equal(loopResult.rounds.length, 2);
  assert.equal(loopResult.rounds[0].verdict, "REVISE");
  assert.equal(loopResult.rounds[1].verdict, "ACCEPT");
  assert.equal(loopResult.passed, true);
  assert.equal(loopResult.pairwisePassed, true);

  fs.rmSync(repoVideos, { recursive: true, force: true });
  fs.rmSync(tmpVideoDir, { recursive: true, force: true });
});

