/**
 * File Description: Input/output corpus for the Gemini review prompt and its model-reply JSON cleanup. The prompt comes
 * from the production rubric builder. The captured case is the reply of a real Gemini 3.8 Flash review (PR #124, run of
 * 2026-10-15) read from the committed docs/evidence/dots/gemini-review.json: only the fields the model wrote, without the
 * model, evaluatedAt, videoHash, videoPath and facts fields that the review code adds afterwards. The fenced cases are
 * AUTHORED, not captured: no raw fenced reply survives on disk, so a fence is wrapped around the captured body or a
 * one-criterion sample.
 * Inputs and outputs: the generated review prompt, the captured reply and authored fenced replies -> prompt and parsed reply expectations.
 * Used by: npm test (found by glob), the CI unit job.
 */

import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { cleanModelJsonResponse } from "../modelReply";
import { expectFile, formatForReview } from "../testSupport/expectFile";
import { buildSingleVideoReviewPrompt } from "./rubric";

const CAPTURE_PATH = path.resolve(__dirname, "../../docs/evidence/dots/gemini-review.json");
const REPLY_FIELDS = ["overallScore", "verdict", "summary", "criteria", "feedback"] as const;

interface CapturedCriterion {
  name: string;
  score: number;
  passed: boolean;
}

// Loads the real Gemini review report and keeps only the fields the model itself wrote, as the raw reply text.
function loadCapturedReply(): string {
  const report = JSON.parse(fs.readFileSync(CAPTURE_PATH, "utf8")) as Record<string, unknown>;
  const reply: Record<string, unknown> = {};
  for (const field of REPLY_FIELDS) {
    if (!(field in report)) throw new Error(`captured review is missing the reply field ${field}`);
    reply[field] = report[field];
  }
  return JSON.stringify(reply);
}

const capturedReply = loadCapturedReply();

// AUTHORED sample (not captured): a one-criterion reply inside the Python fence the reviewer has been seen to emit.
const authoredPythonFenceReply =
  '```python\n{"overallScore":9.2,"verdict":"ACCEPT","criteria":[{"name":"persistent_stage","score":9.4,"passed":true,"evidenceTimestamps":["0:04-0:12"],"reason":"The stage remains visible."}],"feedback":[]}\n```';

// AUTHORED wrapper (the body is captured): the captured reply inside a json fence with prose around it.
const authoredFenceAroundCapture = `Review result:\n\`\`\`json\n${capturedReply}\n\`\`\`\nDone.`;

// Summarizes a parsed review reply into the fields a reviewer diffs: verdict, score, each criterion and the feedback count.
function digest(parsed: {
  overallScore: number;
  verdict: string;
  criteria: CapturedCriterion[];
  feedback: unknown[];
}): unknown {
  return {
    overallScore: parsed.overallScore,
    verdict: parsed.verdict,
    criteria: parsed.criteria.map(({ name, score, passed }) => ({ name, score, passed })),
    feedbackCount: parsed.feedback.length,
  };
}

// Records the production review prompt and the parsed content of one captured and two authored replies.
test("Gemini review prompt and reply parser match the captured and authored reply corpus", () => {
  const prompt = buildSingleVideoReviewPrompt("video.mp4");
  const replies = [
    { id: "captured-plain-json", source: "captured", raw: capturedReply },
    { id: "authored-json-fence-around-captured-body", source: "authored", raw: authoredFenceAroundCapture },
    { id: "authored-python-fence", source: "authored", raw: authoredPythonFenceReply },
  ];
  const outputs = replies.map(({ id, source, raw }) => {
    const cleaned = cleanModelJsonResponse(raw);
    return { id, source, cleanedIsJson: cleaned.startsWith("{"), parsed: digest(JSON.parse(cleaned)) };
  });
  expectFile(formatForReview({ prompt, outputs }), "gemini-review/prompt-reply.json");
});
