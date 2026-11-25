/**
 * File Description: Captured input/output corpus for the Gemini review prompt and its model-reply JSON cleanup. The
 * prompt comes from the production rubric builder; the sanitized reply retains the Python fence seen in a review.
 * Inputs and outputs: the generated review prompt and fenced reply -> prompt and normalized parsed reply expectations.
 * Used by: npm test (found by glob), the CI unit job.
 */

import test from "node:test";
import { cleanModelJsonResponse } from "../modelReply";
import { expectFile, formatForReview } from "../testSupport/expectFile";
import { buildSingleVideoReviewPrompt } from "./rubric";

const reply = '```python\n{"overallScore":9.2,"verdict":"ACCEPT","criteria":[{"name":"persistent_stage","score":9.4,"passed":true,"evidenceTimestamps":["0:04-0:12"],"reason":"The stage remains visible."}],"feedback":[]}\n```';

// Captures the production review prompt and parsed content of a sanitized fenced model reply.
test("Gemini review prompt and reply parser match the sanitized capture corpus", () => {
  const prompt = buildSingleVideoReviewPrompt("video.mp4");
  const cleaned = cleanModelJsonResponse(reply);
  expectFile(formatForReview({ prompt, cleaned, parsed: JSON.parse(cleaned) }), "gemini-review/prompt-reply.json");
});
