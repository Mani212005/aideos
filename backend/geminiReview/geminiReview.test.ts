/**
 * File Description: Comprehensive unit tests for the Gemini 3.8 Flash video quality review system,
 * covering client upload/polling/retries, rubric schema validation, timestamp verification,
 * single video scoring, pairwise cross-review comparison, and the plain-text review summary.
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
  buildPairwiseWatchPrompt,
  buildPairwiseExchangePrompt,
  SINGLE_REVIEW_JSON_SCHEMA,
  PAIRWISE_WATCH_JSON_SCHEMA,
  PAIRWISE_EXCHANGE_JSON_SCHEMA,
} from "./rubric";
import {
  computeFileHash,
  cleanModelJsonResponse,
  reviewVideo,
  reviewPairwise,
  defaultAgyRunner,
  createIsolatedVideoWorkspace,
  formatReviewSummary,
} from "./geminiReview";
import type {
  AgyRunner,
  AgyReviewClient,
} from "./types";
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

test("Rubric: buildPairwiseWatchPrompt and buildPairwiseExchangePrompt contain core directives", () => {
  const watchPrompt = buildPairwiseWatchPrompt("/Users/test/video.mp4");
  assert.ok(watchPrompt.includes("Watch and inspect the complete local video file at: /Users/test/video.mp4 with audio."));
  assert.ok(watchPrompt.includes("12-criterion quality rubric"));
  assert.ok(watchPrompt.includes("DO NOT write or run scripts. DO NOT extract frames. ONLY watch the video and return the required JSON."));

  const exchangePrompt = buildPairwiseExchangePrompt("Video B", { rating: 8.5, likes: ["persistent stage"] });
  assert.ok(exchangePrompt.includes("OTHER video (Video B)"));
  assert.ok(exchangePrompt.includes("persistent stage"));
  assert.ok(exchangePrompt.includes("Give the OTHER video a rating (0-10) and brief reasoning."));
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

test("geminiReview: cleanModelJsonResponse strips fences carrying any language tag, prose and unterminated fences", () => {
  // The reported crash: the reviewer wrapped the watch-phase JSON in a fence tagged "python".
  assert.equal(cleanModelJsonResponse("```python\n{\"rating\": 8.5}\n```"), "{\"rating\": 8.5}");
  assert.equal(cleanModelJsonResponse("```JSON {\"rating\": 8.5}```"), "{\"rating\": 8.5}");
  assert.equal(cleanModelJsonResponse("```json{\"rating\": 8.5}```"), "{\"rating\": 8.5}");
  // Prose around the fence, and the first fence that is not JSON.
  assert.equal(
    cleanModelJsonResponse("Here is the report:\n```text\nnotes\n```\n```json\n{\"rating\": 8.5}\n```\nDone."),
    "{\"rating\": 8.5}",
  );
  // A cut-off reply that never closed its fence.
  assert.equal(cleanModelJsonResponse("```json\n{\"rating\": 8.5}"), "{\"rating\": 8.5}");
  // Prose around a bare object.
  assert.equal(cleanModelJsonResponse("Sure! {\"rating\": 8.5} Hope that helps."), "{\"rating\": 8.5}");
  // Nested braces inside a fenced object survive.
  assert.equal(cleanModelJsonResponse("```python\n{\"a\": {\"b\": [1, 2]}}\n```"), "{\"a\": {\"b\": [1, 2]}}");
});

test("geminiReview: reviewPairwise survives watch-phase JSON wrapped in a python code fence", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-pairwise-fence-"));
  const videoA = path.join(tmpDir, "a.mp4");
  const videoB = path.join(tmpDir, "b.mp4");
  fs.writeFileSync(videoA, Buffer.alloc(100, 1));
  fs.writeFileSync(videoB, Buffer.alloc(100, 2));

  const fenced = (obj: unknown) => "```python\n" + JSON.stringify(obj) + "\n```";
  let call = 0;
  const runner: AgyRunner = async () => {
    call++;
    if (call <= 2) return fenced({ rating: 8.0, likes: [], dislikes: [], neutral: [], timestamps: [] });
    return fenced({ otherVideoRating: 8.0, reasoning: "same" });
  };

  const result = await reviewPairwise(videoA, videoB, { runner });
  assert.equal(result.winner, "Tie");
  assert.equal(result.videoA.finalRating, 8.0);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("geminiReview: defaultAgyRunner unwraps a fenced text reply and keeps the conversation id", async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-fake-agy-"));
  const reply = JSON.stringify({
    conversation_id: "conv-123",
    status: "SUCCESS",
    response: "```python\n{\"rating\": 7.5}\n```",
  });
  fs.writeFileSync(path.join(binDir, "agy"), `#!/bin/sh\ncat <<'EOF'\n${reply}\nEOF\n`, { mode: 0o755 });
  const savedPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${savedPath}`;
  try {
    const raw = await defaultAgyRunner("hello", { timeoutSeconds: 30 });
    const parsed = JSON.parse(raw);
    assert.equal(parsed.rating, 7.5);
    assert.equal(parsed.conversation_id, "conv-123");
  } finally {
    process.env.PATH = savedPath;
    fs.rmSync(binDir, { recursive: true, force: true });
  }
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

test("geminiReview: reviewPairwise runs dual-agent cross-review and determines winner", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-pairwise-test-"));
  const videoA = path.join(tmpDir, "videoA.mp4");
  const videoB = path.join(tmpDir, "videoB.mp4");
  fs.writeFileSync(videoA, Buffer.alloc(100, 1));
  fs.writeFileSync(videoB, Buffer.alloc(100, 2));

  let callIndex = 0;
  const mockRunner: AgyRunner = async (prompt: string) => {
    callIndex++;
    if (callIndex === 1) {
      assert.ok(prompt.includes("video.mp4"));
      return JSON.stringify({
        rating: 9.0,
        likes: ["Continuous 3D stage and camera moves"],
        dislikes: [],
        neutral: [],
        timestamps: ["0:15", "0:42"],
      });
    }
    if (callIndex === 2) {
      assert.ok(prompt.includes("video.mp4"));
      return JSON.stringify({
        rating: 7.0,
        likes: ["Color palette"],
        dislikes: ["No bottom captions"],
        neutral: [],
        timestamps: ["0:18", "0:45"],
      });
    }
    if (callIndex === 3) {
      assert.ok(prompt.includes("OTHER video (Video B)"));
      return JSON.stringify({
        otherVideoRating: 7.0,
        reasoning: "Video B lacks synchronized bottom captions.",
      });
    }
    assert.ok(prompt.includes("OTHER video (Video A)"));
    return JSON.stringify({
      otherVideoRating: 9.0,
      reasoning: "Video A demonstrates superior stage continuity.",
    });
  };

  const pairwiseResult = await reviewPairwise(videoA, videoB, { runner: mockRunner });
  assert.equal(pairwiseResult.winner, "Video A");
  assert.equal(pairwiseResult.videoA.finalRating, 9.0);
  assert.equal(pairwiseResult.videoB.finalRating, 7.0);
  assert.equal(pairwiseResult.videoA.ratingByWatcher, 9.0);
  assert.equal(pairwiseResult.videoA.ratingByOther, 9.0);
  assert.equal(pairwiseResult.videoB.ratingByWatcher, 7.0);
  assert.equal(pairwiseResult.videoB.ratingByOther, 7.0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("geminiReview: formatReviewSummary outputs human-readable breakdown", () => {
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

test("geminiReview: prompt includes video file path and local inspection directive", () => {
  const singlePrompt = buildSingleVideoReviewPrompt("/Users/test/render.mp4");
  assert.ok(singlePrompt.includes("Watch and inspect the complete local video file at: /Users/test/render.mp4 with audio."));
  assert.ok(singlePrompt.includes("DO NOT write or run scripts. DO NOT extract frames. ONLY watch the video and return the required JSON."));

  const singlePromptNoPath = buildSingleVideoReviewPrompt();
  assert.ok(singlePromptNoPath.includes("DO NOT run any tools. DO NOT write or run scripts. ONLY watch the video and return the required JSON."));

  const watchPrompt = buildPairwiseWatchPrompt("/Users/test/videoA.mp4");
  assert.ok(watchPrompt.includes("Watch and inspect the complete local video file at: /Users/test/videoA.mp4 with audio."));
  assert.ok(watchPrompt.includes("DO NOT write or run scripts. DO NOT extract frames. ONLY watch the video and return the required JSON."));

  const watchPromptNoPath = buildPairwiseWatchPrompt();
  assert.ok(watchPromptNoPath.includes("12-criterion quality rubric"));
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

  assert.deepEqual(PAIRWISE_WATCH_JSON_SCHEMA.required, [
    "rating",
    "likes",
    "dislikes",
    "neutral",
    "timestamps",
  ]);

  assert.deepEqual(PAIRWISE_EXCHANGE_JSON_SCHEMA.required, [
    "otherVideoRating",
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

test("geminiReview: reviewPairwise executes in isolated workspaces with neutral video.mp4", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-pairwise-iso-test-"));
  const videoA = path.join(tmpDir, "a.mp4");
  const videoB = path.join(tmpDir, "b.mp4");
  fs.writeFileSync(videoA, Buffer.alloc(128, 1));
  fs.writeFileSync(videoB, Buffer.alloc(128, 2));

  const capturedCwds: string[] = [];
  const runner: AgyRunner = async (prompt, opts) => {
    assert.ok(opts?.cwd, "pairwise runner must receive isolated cwd");
    assert.ok(fs.existsSync(opts.cwd), "pairwise cwd must exist during run");
    assert.ok(fs.existsSync(path.join(opts.cwd, "video.mp4")), "video.mp4 must exist in cwd");
    if (!capturedCwds.includes(opts.cwd)) {
      capturedCwds.push(opts.cwd);
    }

    if (capturedCwds.length === 1 && prompt.includes("video.mp4")) {
      return JSON.stringify({
        rating: 9.0,
        likes: ["Persistent stage"],
        dislikes: [],
        neutral: [],
        timestamps: ["0:10"],
      });
    }
    if (capturedCwds.length === 2 && prompt.includes("video.mp4")) {
      return JSON.stringify({
        rating: 7.0,
        likes: ["Clear voiceover"],
        dislikes: ["No bottom captions"],
        neutral: [],
        timestamps: ["0:10"],
      });
    }
    if (prompt.includes("OTHER video (Video B)")) {
      return JSON.stringify({
        otherVideoRating: 7.0,
        reasoning: "Video B missing captions.",
      });
    }
    return JSON.stringify({
      otherVideoRating: 9.0,
      reasoning: "Video A is better.",
    });
  };

  const report = await reviewPairwise(videoA, videoB, { runner });
  assert.equal(report.winner, "Video A");
  assert.equal(report.videoA.path, path.resolve(videoA));
  assert.equal(report.videoB.path, path.resolve(videoB));
  assert.equal(capturedCwds.length, 2);
  for (const cwd of capturedCwds) {
    assert.equal(fs.existsSync(cwd), false, "pairwise isolated workspace must be cleaned up");
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

