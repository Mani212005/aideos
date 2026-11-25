/**
 * File Description: Captured input/output corpus for Jev decision parsing and request construction. It snapshots the
 * prompt payload built from sanitized state alongside the normalized result from a sanitized model reply.
 * Inputs and outputs: a sanitized Jev decision state and reply -> request payload and parsed Jev answer expectations.
 * Used by: npm test (found by glob), the CI unit job.
 */

import test from "node:test";
import { expectFile, formatForReview } from "./testSupport/expectFile";
import { buildDecisionRequest, parseDecisionResponse, DEFAULT_JEV_MODEL } from "./jev";

const state = {
  visual: "A command appears in a terminal window",
  narration: "Run npm install to add the dependency to your project.",
  onscreen: ["npm install @typesafe-ai/sdk"],
  activeComponents: ["TextReveal"],
  sceneTitle: "Installation",
};

const reply = {
  model: "typesafe/jev-1.13",
  answers: {
    primitive: {
      type: "choice",
      choice: "CodeBlock",
      confidence: 0.88,
      probabilities: { CodeBlock: 0.88, TextReveal: 0.12 },
    },
    servesPhrase: { type: "choice", choice: "phrase1" },
  },
  usage: { input_tokens: 120, output_tokens: 15 },
};

// Captures Jev's generated request and the real parser's normalized answer.
test("Jev decision parser matches the sanitized prompt and reply corpus", () => {
  const request = buildDecisionRequest(state, DEFAULT_JEV_MODEL);
  const parsed = parseDecisionResponse(reply, ["Run npm install to add the dependency to your project"]);
  expectFile(formatForReview({ request, reply, parsed }), "jev/decision.json");
});
