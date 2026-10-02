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
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import {
  RUBRIC_CRITERIA,
  validateCriterionTimestamps,
  buildSingleVideoReviewPrompt,
  buildPairwiseReviewPrompt,
  SINGLE_REVIEW_JSON_SCHEMA,
  PAIRWISE_REVIEW_JSON_SCHEMA,
} from "./rubric";
import {
  computeFileHash,
  cleanModelJsonResponse,
  reviewVideo,
  reviewPairwise,
  defaultAgyRunner,
  createIsolatedVideoWorkspace,
} from "./geminiReview";
import type {
  AgyRunner,
  AgyReviewClient,
} from "./types";
import {
  formatReviewSummary,
  runReviewLoop,
} from "./reviewLoop";
import {
  inspectCamera,
  measureBottomCaptions,
} from "./facts";
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
  assert.ok(!prompt.includes("HNSW"));
  assert.ok(!prompt.includes("express train"));

  const promptWithTopic = buildPairwiseReviewPrompt("Distributed consensus algorithms");
  assert.ok(promptWithTopic.includes("Distributed consensus algorithms"));
});

test("facts: inspectCamera handles missing film.json without hardcoded path heuristics", () => {
  const result = inspectCamera(undefined, 60);
  assert.equal(result.measured, false);
  assert.equal(result.moveCount, 0);

  const nonExistent = inspectCamera("/path/to/nonexistent/film.json", 60);
  assert.equal(nonExistent.measured, false);
  assert.equal(nonExistent.moveCount, 0);
});

test("facts: measureBottomCaptions handles short duration safely", async () => {
  const shortResult = await measureBottomCaptions("dummy.mp4", 1.5);
  assert.equal(shortResult.measured, false);
  assert.equal(shortResult.hasCaptions, false);
});

test("geminiReview: cleanModelJsonResponse strips markdown code block fences", () => {
  const jsonWithFence = "```json\n{\"overallScore\": 9.2}\n```";
  assert.equal(cleanModelJsonResponse(jsonWithFence), "{\"overallScore\": 9.2}");

  const genericFence = "```\n{\"verdict\": \"ACCEPT\"}\n```";
  assert.equal(cleanModelJsonResponse(genericFence), "{\"verdict\": \"ACCEPT\"}");

  const plain = "{\"status\": \"ok\"}";
  assert.equal(cleanModelJsonResponse(plain), "{\"status\": \"ok\"}");
});

test("geminiReview: computeFileHash computes correct sha256 checksum", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-test-hash-"));
  const tmpFile = path.join(tmpDir, "sample.txt");
  fs.writeFileSync(tmpFile, "hello aideos world\n", "utf8");

  const hash = await computeFileHash(tmpFile);
  assert.equal(typeof hash, "string");
  assert.equal(hash.length, 64);
  fs.rmSync(tmpDir, { recursive: true, force: true });
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

  const mockRunner: AgyRunner = async () => JSON.stringify(mockReportPayload);

  const report = await reviewVideo(testVideo, { runner: mockRunner, model: "gemini-3.8-flash-high" });
  assert.equal(report.overallScore, 9.3);
  assert.equal(report.verdict, "ACCEPT");
  assert.equal(report.criteria.length, 12);
  assert.equal(report.model, "gemini-3.8-flash-high");

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

  const mockRunner: AgyRunner = async () => JSON.stringify(mockReportPayload);

  const report = await reviewVideo(testVideo, { runner: mockRunner });
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
  const mockRunner: AgyRunner = async (prompt: string) => {
    callIndex++;
    if (callIndex === 1) {
      assert.ok(prompt.includes("Video 1 is located at:"));
      assert.ok(prompt.includes("video_1.mp4"));
      assert.ok(prompt.includes("video_2.mp4"));
      // Order 1: Video 1 = A, Video 2 = B. Chooses Video 1 (A).
      return JSON.stringify({
        video1Score: 9.1,
        video2Score: 7.2,
        choice: "Video 1",
        reasoning: "Video 1 has superior camera motion and bottom captions.",
        timestampsCited: ["0:15", "0:42"],
      });
    }
    assert.ok(prompt.includes("Video 1 is located at:"));
    assert.ok(prompt.includes("video_1.mp4"));
    assert.ok(prompt.includes("video_2.mp4"));
    // Order 2: Video 1 = B, Video 2 = A. Chooses Video 2 (A).
    return JSON.stringify({
      video1Score: 7.3,
      video2Score: 9.2,
      choice: "Video 2",
      reasoning: "Video 2 demonstrates continuous 3D stage and clear narrative build.",
      timestampsCited: ["0:18", "0:45"],
    });
  };

  const pairwiseResult = await reviewPairwise(videoA, videoB, { runner: mockRunner });
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

test("reviewLoop: runs multi-round loop and achieves target score 9.0+", async () => {
  const tmpVideoDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-loop-test-"));
  const testSlug = "mock-loop-slug";
  const repoVideos = resolvePackageDir(testSlug);
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

  const mockRunner: AgyRunner = async () => JSON.stringify(modelReport);

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
    runner: mockRunner,
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
  const repoVideos = resolvePackageDir(testSlug);
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

test("geminiReview: prompt includes video file path and local inspection directive", () => {
  const singlePrompt = buildSingleVideoReviewPrompt("/Users/test/render.mp4");
  assert.ok(singlePrompt.includes("Watch and inspect the complete local video file at: /Users/test/render.mp4 with audio."));
  assert.ok(singlePrompt.includes("DO NOT write or run scripts. DO NOT extract frames. ONLY watch the video and return the required JSON."));

  const singlePromptNoPath = buildSingleVideoReviewPrompt();
  assert.ok(singlePromptNoPath.includes("DO NOT run any tools. DO NOT write or run scripts. ONLY watch the video and return the required JSON."));

  const pairwisePrompt = buildPairwiseReviewPrompt("/Users/test/videoA.mp4", "/Users/test/videoB.mp4");
  assert.ok(pairwisePrompt.includes("Video 1 is located at: /Users/test/videoA.mp4"));
  assert.ok(pairwisePrompt.includes("Video 2 is located at: /Users/test/videoB.mp4"));
  assert.ok(pairwisePrompt.includes("Watch and inspect both complete local video files carefully with audio."));
  assert.ok(pairwisePrompt.includes("DO NOT write or run scripts. DO NOT extract frames. ONLY watch the videos and return the required JSON."));

  const pairwisePromptNoPath = buildPairwiseReviewPrompt();
  assert.ok(pairwisePromptNoPath.includes("DO NOT run any tools. DO NOT write or run scripts. ONLY watch the videos and return the required JSON."));
});

test("geminiReview: supports client injection via AgyReviewClient", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-client-inject-test-"));
  const testVideo = path.join(tmpDir, "test.mp4");
  fs.writeFileSync(testVideo, Buffer.alloc(128, 1));

  const criteria = createMockCriteria({ gateScore: 9.0, gatePassed: true, withTimestamps: true });
  const mockReportPayload: Partial<GeminiReviewReport> = {
    overallScore: 9.1,
    verdict: "ACCEPT",
    summary: "Client injection works cleanly.",
    criteria,
    feedback: [],
  };

  const mockClient: AgyReviewClient = {
    runReviewPrompt: async () => JSON.stringify(mockReportPayload),
  };

  const report = await reviewVideo(testVideo, { client: mockClient });
  assert.equal(report.overallScore, 9.1);
  assert.equal(report.verdict, "ACCEPT");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("geminiReview: throws descriptive error when agy CLI is missing", async () => {
  assert.equal(typeof defaultAgyRunner, "function");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-missing-agy-test-"));
  const testVideo = path.join(tmpDir, "test.mp4");
  fs.writeFileSync(testVideo, Buffer.alloc(128, 1));

  const failingRunner: AgyRunner = async () => {
    const err = new Error("spawn agy ENOENT");
    (err as any).code = "ENOENT";
    throw new Error("agy CLI not found on PATH. Please ensure agy is installed and accessible.");
  };

  await assert.rejects(
    () => reviewVideo(testVideo, { runner: failingRunner }),
    /agy CLI not found on PATH/,
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("geminiReview: throws descriptive error on agy auth failure without fallback", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-auth-fail-test-"));
  const testVideo = path.join(tmpDir, "test.mp4");
  fs.writeFileSync(testVideo, Buffer.alloc(128, 1));

  const authFailingRunner: AgyRunner = async () => {
    throw new Error("agy review failed: Not authenticated or signed in to agy. Details: please login");
  };

  await assert.rejects(
    () => reviewVideo(testVideo, { runner: authFailingRunner }),
    /Not authenticated or signed in to agy/,
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("geminiReview: throws descriptive error on quota exceeded without silent fallback", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-quota-fail-test-"));
  const testVideo = path.join(tmpDir, "test.mp4");
  fs.writeFileSync(testVideo, Buffer.alloc(128, 1));

  const quotaFailingRunner: AgyRunner = async () => {
    throw new Error("agy review failed: Quota exceeded or rate limited. No silent fallback allowed. Details: 429 RESOURCE_EXHAUSTED");
  };

  await assert.rejects(
    () => reviewVideo(testVideo, { runner: quotaFailingRunner }),
    /Quota exceeded or rate limited\. No silent fallback allowed/,
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("geminiReview: schemas enforce expected required properties", () => {
  assert.deepEqual(SINGLE_REVIEW_JSON_SCHEMA.required, [
    "overallScore",
    "verdict",
    "summary",
    "criteria",
    "feedback",
  ]);

  assert.deepEqual(PAIRWISE_REVIEW_JSON_SCHEMA.required, [
    "video1Score",
    "video2Score",
    "choice",
    "reasoning",
  ]);
});

test("geminiReview: createIsolatedVideoWorkspace creates temp dir with neutral videos and cleans up", () => {
  const tmpSrcDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-src-test-"));
  const srcA = path.join(tmpSrcDir, "origA.mp4");
  const srcB = path.join(tmpSrcDir, "origB.mp4");
  fs.writeFileSync(srcA, "content A");
  fs.writeFileSync(srcB, "content B");

  const workspace = createIsolatedVideoWorkspace({
    "video_1.mp4": srcA,
    "video_2.mp4": srcB,
  });

  assert.ok(fs.existsSync(workspace.dir));
  assert.ok(fs.existsSync(workspace.videoPaths["video_1.mp4"]));
  assert.ok(fs.existsSync(workspace.videoPaths["video_2.mp4"]));
  assert.equal(fs.readFileSync(workspace.videoPaths["video_1.mp4"], "utf8"), "content A");
  assert.equal(fs.readFileSync(workspace.videoPaths["video_2.mp4"], "utf8"), "content B");

  workspace.cleanup();
  assert.equal(fs.existsSync(workspace.dir), false);
  fs.rmSync(tmpSrcDir, { recursive: true, force: true });
});

test("geminiReview: reviewVideo executes in isolated workspace with neutral video.mp4 and cleans up", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-review-iso-test-"));
  const testVideo = path.join(tmpDir, "source_explainer.mp4");
  fs.writeFileSync(testVideo, Buffer.alloc(128, 1));

  let capturedCwd: string | undefined;
  const mockReportPayload: Partial<GeminiReviewReport> = {
    overallScore: 9.2,
    verdict: "ACCEPT",
    summary: "Isolated workspace test passed.",
    criteria: createMockCriteria({ gateScore: 9.0, gatePassed: true, withTimestamps: true }),
    feedback: [],
  };

  const runner: AgyRunner = async (prompt, opts) => {
    capturedCwd = opts?.cwd;
    assert.ok(capturedCwd, "runner options must receive cwd");
    assert.ok(fs.existsSync(capturedCwd), "isolated cwd directory must exist during review");
    assert.ok(fs.existsSync(path.join(capturedCwd, "video.mp4")), "isolated video.mp4 must exist in cwd");
    assert.ok(prompt.includes("video.mp4"), "prompt must reference isolated video.mp4");
    assert.ok(prompt.includes("do not look for, open, or read any other files or source code"));
    return JSON.stringify(mockReportPayload);
  };

  const report = await reviewVideo(testVideo, { runner });
  assert.equal(report.overallScore, 9.2);
  assert.equal(report.verdict, "ACCEPT");
  assert.equal(report.videoPath, path.resolve(testVideo));
  assert.ok(capturedCwd);
  assert.equal(fs.existsSync(capturedCwd), false, "isolated workspace cwd must be cleaned up after review");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("geminiReview: reviewPairwise executes each order in isolated workspace with neutral video_1.mp4 and video_2.mp4", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-pairwise-iso-test-"));
  const videoA = path.join(tmpDir, "a.mp4");
  const videoB = path.join(tmpDir, "b.mp4");
  fs.writeFileSync(videoA, Buffer.alloc(128, 1));
  fs.writeFileSync(videoB, Buffer.alloc(128, 2));

  const capturedCwds: string[] = [];
  const runner: AgyRunner = async (prompt, opts) => {
    assert.ok(opts?.cwd, "pairwise runner must receive isolated cwd");
    assert.ok(fs.existsSync(opts.cwd), "pairwise cwd must exist during run");
    assert.ok(fs.existsSync(path.join(opts.cwd, "video_1.mp4")), "video_1.mp4 must exist in cwd");
    assert.ok(fs.existsSync(path.join(opts.cwd, "video_2.mp4")), "video_2.mp4 must exist in cwd");
    capturedCwds.push(opts.cwd);

    if (prompt.includes("Order: Video 1 = A, Video 2 = B") || capturedCwds.length === 1) {
      return JSON.stringify({
        video1Score: 9.0,
        video2Score: 7.0,
        choice: "Video 1",
        reasoning: "Video 1 is superior.",
        timestampsCited: ["0:10"],
      });
    }
    return JSON.stringify({
      video1Score: 7.0,
      video2Score: 9.0,
      choice: "Video 2",
      reasoning: "Video 2 is superior.",
      timestampsCited: ["0:10"],
    });
  };

  const report = await reviewPairwise(videoA, videoB, { runner });
  assert.equal(report.consistentWinner, "Video A");
  assert.equal(capturedCwds.length, 2);
  for (const cwd of capturedCwds) {
    assert.equal(fs.existsSync(cwd), false, "pairwise isolated workspace must be cleaned up");
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

