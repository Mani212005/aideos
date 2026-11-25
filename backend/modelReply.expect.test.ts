/**
 * File Description: Captured input/output corpus for the unified model-reply parser. Sanitized reply samples exercise
 * plain JSON, fenced JSON with surrounding prose, and nested JSON; parser output is stored as reviewed expectations.
 * Inputs and outputs: sanitized raw model reply samples -> clean JSON text and parsed value expectations.
 * Used by: npm test (found by glob), the CI unit job.
 */

import test from "node:test";
import { expectFile, formatForReview } from "./testSupport/expectFile";
import { cleanModelJsonResponse, parseModelJson } from "./modelReply";

const replies = [
  {
    id: "plain-json",
    raw: '{"status":"ok","count":3}',
  },
  {
    id: "fenced-review-json",
    raw: 'Review result:\n```json\n{"verdict":"ACCEPT","criteria":[{"name":"readability","score":9.2}]}\n```\nDone.',
  },
  {
    id: "nested-json",
    raw: '```python\n{"payload":{"items":[{"name":"alpha","enabled":true},{"name":"beta","enabled":false}]}}\n```',
  },
];

// Captures each parser result in stable JSON for diff review.
test("model reply parser matches the sanitized captured reply corpus", () => {
  const outputs = replies.map(({ id, raw }) => ({
    id,
    cleaned: cleanModelJsonResponse(raw),
    parsed: parseModelJson(raw),
  }));
  expectFile(formatForReview(outputs), "model-reply/parser.json");
});
