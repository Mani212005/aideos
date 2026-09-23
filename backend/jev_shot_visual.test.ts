/**
 * File Description: Tests for Jev shot-visual choice.
 * Verifies request building, response parsing, heuristic fallbacks, confidence gating, and mock
 * injection for the pipeline compile path, with zero live API calls.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SHOT_VISUALS,
  DEFAULT_JEV_MODEL,
  applyShotVisualGating,
  buildShotVisualRequest,
  clearMockShotVisualHandler,
  heuristicShotVisualSelection,
  parseShotVisualResponse,
  selectShotVisual,
  setMockShotVisualHandler,
  type ShotVisualAnswer,
} from "./jev";

test("ShotVisual: buildShotVisualRequest constructs conforming payload with criteria", () => {
  const payload = buildShotVisualRequest(
    {
      visual: "Growth curve of throughput",
      narration: "Throughput scales linearly with draft length.",
      onscreen: ["Throughput"],
      activeVisuals: ["Text"],
      sceneTitle: "Scaling",
      durationSec: 6,
      wantsFootage: false,
    },
    DEFAULT_JEV_MODEL,
  ) as Record<string, unknown>;
  assert.equal(payload.model, DEFAULT_JEV_MODEL);
  const state = payload.state as Record<string, unknown>;
  assert.equal(state.visual, "Growth curve of throughput");
  assert.equal(state.narration, "Throughput scales linearly with draft length.");
  assert.deepEqual(state.activeVisuals, ["Text"]);
  const questions = payload.questions as Record<string, unknown>;
  const q = questions.shotVisual as Record<string, unknown>;
  assert.equal(q.type, "choice");
  const criteria = q.criteria as Record<string, string>;
  for (const v of SHOT_VISUALS) {
    assert.ok(criteria[v], `Criteria must define ${v}`);
  }
});

test("ShotVisual: parseShotVisualResponse parses standard shape and normalizes casing", () => {
  const parsed = parseShotVisualResponse({
    answers: { shotVisual: { choice: "Plot", confidence: 0.88, probabilities: { Plot: 0.88 } } },
  });
  assert.equal(parsed.choice, "Plot");
  assert.equal(parsed.confidence, 0.88);
  const lower = parseShotVisualResponse({ answers: { shotVisual: { choice: "matrixgrid", confidence: 0.8 } } });
  assert.equal(lower.choice, "MatrixGrid");
});

test("ShotVisual: parseShotVisualResponse rejects unknown choice and surfaces API errors", () => {
  assert.throws(() => parseShotVisualResponse({ answers: { shotVisual: { choice: "Orb", confidence: 0.9 } } }), /unknown shotVisual choice/);
  assert.throws(() => parseShotVisualResponse({ error: { message: "rate limited" } }), /rate limited/);
  assert.throws(() => parseShotVisualResponse({ answers: {} }), /missing 'shotVisual'/);
});

test("ShotVisual: heuristic maps device cues and falls back to Text", () => {
  assert.equal(
    heuristicShotVisualSelection({ narration: "Throughput jumped by four times.", onscreen: ["4x"] }),
    "StatCounter",
  );
  assert.equal(
    heuristicShotVisualSelection({ narration: "Tokens stream in parallel at once.", onscreen: ["Stream"] }),
    "TokenStrip",
  );
  assert.equal(
    heuristicShotVisualSelection({ narration: "Loss curves scale with throughput.", onscreen: ["Curve"] }),
    "Plot",
  );
  assert.equal(
    heuristicShotVisualSelection({ narration: "The attention map grid fills.", onscreen: ["Grid"] }),
    "MatrixGrid",
  );
  assert.equal(
    heuristicShotVisualSelection({ narration: "The core principle is fault tolerance.", onscreen: ["Consensus"] }),
    "Text",
  );
  assert.equal(heuristicShotVisualSelection({ narration: "Plain talk.", onscreen: [] }), "Text");
});

test("ShotVisual: heuristic picks StatCounter only for a number the design stage can read", () => {
  for (const narration of ["It cuts latency by 40%.", "Recall improved 4x.", "Replies land in 200 ms.", "It needs 8 GB."]) {
    assert.equal(heuristicShotVisualSelection({ narration, onscreen: ["Metric"] }), "StatCounter", narration);
  }
  for (const narration of ["Launched in 1977, it never came back.", "Box 3 is where it ends."]) {
    assert.notEqual(heuristicShotVisualSelection({ narration, onscreen: ["Metric"] }), "StatCounter", narration);
  }
});

test("ShotVisual: heuristic avoids repeating the last visual when alternatives exist", () => {
  const choice = heuristicShotVisualSelection({
    narration: "Throughput scales and loss curves grow together.",
    onscreen: ["Scaling"],
    activeVisuals: ["Plot"],
  });
  assert.notEqual(choice, "Plot");
});

test("ShotVisual: gating falls back to Text on low confidence for device visuals", () => {
  const answer: ShotVisualAnswer = { choice: "Plot", confidence: 0.42, probabilities: { Plot: 0.42 } };
  const result = applyShotVisualGating(answer, { narration: "Scaling talk.", onscreen: ["Scaling"] });
  assert.equal(result.visual, "Text");
  assert.equal(result.source, "confidence-fallback");
  const confident: ShotVisualAnswer = { choice: "Plot", confidence: 0.9, probabilities: { Plot: 0.9 } };
  const kept = applyShotVisualGating(confident, { narration: "Scaling talk.", onscreen: ["Scaling"] });
  assert.equal(kept.visual, "Plot");
  assert.equal(kept.source, "jev");
});

test("ShotVisual: selectShotVisual uses mock handler without network", async () => {
  setMockShotVisualHandler(async () => ({ choice: "Plot", confidence: 0.9, probabilities: { Plot: 0.9 } }));
  try {
    const res = await selectShotVisual({ narration: "Scaling curves.", onscreen: ["Curve"] });
    assert.equal(res.visual, "Plot");
    assert.equal(res.source, "jev");
  } finally {
    clearMockShotVisualHandler();
  }
});

test("ShotVisual: selectShotVisual falls back deterministically with no API key", async () => {
  clearMockShotVisualHandler();
  const res = await selectShotVisual(
    { narration: "A 95 percent reduction was recorded.", onscreen: ["95%"] },
    { apiKey: "" },
  );
  assert.equal(res.visual, "StatCounter");
  assert.equal(res.source, "heuristic-fallback");
});
