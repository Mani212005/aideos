/**
 * File Description: Tests for Jev shot-visual choice, SVG-route choice, and vision-judge verdicts.
 * Verifies request building, response parsing, heuristic fallbacks, confidence gating, and mock
 * injection for the pipeline compile path, with zero live API calls.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SHOT_VISUALS,
  SVG_ROUTES,
  DEFAULT_JEV_MODEL,
  applyShotVisualGating,
  applySvgRouteGating,
  applyVisionGating,
  buildShotVisualRequest,
  buildSvgRouteRequest,
  buildVisionJudgeRequest,
  clearMockShotVisualHandler,
  clearMockSvgRouteHandler,
  clearMockVisionHandler,
  heuristicShotVisualSelection,
  heuristicSvgRouteSelection,
  heuristicVisionJudgement,
  parseShotVisualResponse,
  parseSvgRouteResponse,
  parseVisionJudgeResponse,
  selectShotVisual,
  selectSvgRoute,
  setMockShotVisualHandler,
  setMockSvgRouteHandler,
  setMockVisionHandler,
  judgeVisionStill,
  type ShotVisualAnswer,
  type SvgRouteAnswer,
  type VisionJudgeResult,
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

test("SvgRoute: buildSvgRouteRequest constructs conforming payload with both routes", () => {
  const payload = buildSvgRouteRequest(
    { visual: "A rat in a maze", narration: "The rat explores.", onscreen: ["Rat"] },
    DEFAULT_JEV_MODEL,
  ) as Record<string, unknown>;
  const questions = payload.questions as Record<string, unknown>;
  const q = questions.svgRoute as Record<string, unknown>;
  assert.equal(q.type, "choice");
  const criteria = q.criteria as Record<string, string>;
  for (const r of SVG_ROUTES) {
    assert.ok(criteria[r], `Criteria must define ${r}`);
  }
});

test("VisionJudge: buildVisionJudgeRequest carries PNG base64 plus intent and ids", () => {
  const payload = buildVisionJudgeRequest(
    { pngBase64: "aGVsbG8=", intent: "A rat in a maze", shotId: "beat-01", clipIds: ["clip-a"], assetIds: ["rat-scene"] },
    DEFAULT_JEV_MODEL,
  ) as Record<string, unknown>;
  const state = payload.state as Record<string, unknown>;
  assert.equal(state.intent, "A rat in a maze");
  assert.equal(state.shotId, "beat-01");
  assert.deepEqual(state.clipIds, ["clip-a"]);
  assert.deepEqual(state.assetIds, ["rat-scene"]);
  const attachments = payload.attachments as Array<Record<string, unknown>>;
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].dataBase64, "aGVsbG8=");
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

test("SvgRoute: parseSvgRouteResponse parses both routes and rejects unknown", () => {
  const svg = parseSvgRouteResponse({ answers: { svgRoute: { choice: "svg-asset", confidence: 0.91 } } });
  assert.equal(svg.choice, "svg-asset");
  const std = parseSvgRouteResponse({ decisions: { svgRoute: "standard-blocks" } });
  assert.equal(std.choice, "standard-blocks");
  assert.throws(() => parseSvgRouteResponse({ answers: { svgRoute: { choice: "hologram", confidence: 0.9 } } }), /unknown svgRoute choice/);
});

test("VisionJudge: parseVisionJudgeResponse parses pass with score and reasons", () => {
  const pass = parseVisionJudgeResponse({
    answers: { verdict: { choice: "pass", confidence: 0.92, reasons: [] } },
  });
  assert.equal(pass.pass, true);
  assert.equal(pass.score, 0.92);
  assert.equal(pass.source, "jev");
  const fail = parseVisionJudgeResponse({
    answers: { verdict: { verdict: "fail", score: 0.2, reasons: ["Wrong animal: shows a cat, intent asks for a rat"] } },
  });
  assert.equal(fail.pass, false);
  assert.equal(fail.score, 0.2);
  assert.ok(fail.reasons[0].includes("rat"));
  assert.throws(() => parseVisionJudgeResponse({ answers: { verdict: { choice: "maybe", confidence: 0.5 } } }), /unknown verdict/);
});

test("ShotVisual: heuristic maps device cues and falls back to Text", () => {
  assert.equal(
    heuristicShotVisualSelection({ narration: "Throughput jumped by 4.5x.", onscreen: ["4.5x"] }),
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

test("ShotVisual: heuristic avoids repeating the last visual when alternatives exist", () => {
  const choice = heuristicShotVisualSelection({
    narration: "Throughput scales and loss curves grow together.",
    onscreen: ["Scaling"],
    activeVisuals: ["Plot"],
  });
  assert.notEqual(choice, "Plot");
});

test("SvgRoute: heuristic routes concrete scenes to SVG and footage to standard", () => {
  assert.equal(
    heuristicSvgRouteSelection({ visual: "A rat exploring a spatial maze diagram", narration: "The rat runs." }),
    "svg-asset",
  );
  assert.equal(heuristicSvgRouteSelection({ visual: "B-roll: water drop in darkness", wantsFootage: true }), "standard-blocks");
  assert.equal(heuristicSvgRouteSelection({ visual: "B-roll: sparks in a workshop" }), "standard-blocks");
  assert.equal(heuristicSvgRouteSelection({ visual: "Clean title card" }), "standard-blocks");
  assert.equal(heuristicSvgRouteSelection({}), "standard-blocks");
});

test("ShotVisual: gating falls back to Text on low confidence for device visuals", () => {
  const answer: ShotVisualAnswer = { choice: "Plot", confidence: 0.5, probabilities: { Plot: 0.5 } };
  const result = applyShotVisualGating(answer, { narration: "Scaling talk.", onscreen: ["Scaling"] });
  assert.equal(result.visual, "Text");
  assert.equal(result.source, "confidence-fallback");
  const confident: ShotVisualAnswer = { choice: "Plot", confidence: 0.9, probabilities: { Plot: 0.9 } };
  const kept = applyShotVisualGating(confident, { narration: "Scaling talk.", onscreen: ["Scaling"] });
  assert.equal(kept.visual, "Plot");
  assert.equal(kept.source, "jev");
});

test("SvgRoute: gating falls back to standard-blocks on low confidence for svg-asset", () => {
  const answer: SvgRouteAnswer = { choice: "svg-asset", confidence: 0.4, probabilities: { "svg-asset": 0.4 } };
  const result = applySvgRouteGating(answer, { visual: "A rat in a maze" });
  assert.equal(result.route, "standard-blocks");
  assert.equal(result.source, "confidence-fallback");
  const kept = applySvgRouteGating(
    { choice: "svg-asset", confidence: 0.9, probabilities: { "svg-asset": 0.9 } },
    { visual: "A rat in a maze" },
  );
  assert.equal(kept.route, "svg-asset");
  assert.equal(kept.source, "jev");
});

test("VisionJudge: gating passes through when confidence is below minimum", () => {
  const low: VisionJudgeResult = { score: 0.2, pass: false, reasons: ["Unclear"], source: "jev", confidence: 0.2 };
  const gated = applyVisionGating(low, { pngBase64: "eA==", intent: "A rat" }, { minThreshold: 0.4 });
  assert.equal(gated.source, "heuristic-fallback");
  assert.equal(gated.pass, true);
  const high: VisionJudgeResult = { score: 0.9, pass: true, reasons: [], source: "jev", confidence: 0.9 };
  const kept = applyVisionGating(high, { pngBase64: "eA==", intent: "A rat" });
  assert.equal(kept.pass, true);
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
    { narration: "A 95% reduction was recorded.", onscreen: ["95%"] },
    { apiKey: "" },
  );
  assert.equal(res.visual, "StatCounter");
  assert.equal(res.source, "heuristic-fallback");
});

test("SvgRoute: selectSvgRoute uses mock and falls back with no key", async () => {
  setMockSvgRouteHandler(async () => ({ choice: "svg-asset", confidence: 0.9, probabilities: { "svg-asset": 0.9 } }));
  try {
    const res = await selectSvgRoute({ visual: "A rat in a maze" });
    assert.equal(res.route, "svg-asset");
    assert.equal(res.source, "jev");
  } finally {
    clearMockSvgRouteHandler();
  }
  const fallback = await selectSvgRoute({ visual: "A rat in a maze diagram with spatial arrangement" }, { apiKey: "" });
  assert.equal(fallback.route, "svg-asset");
  assert.equal(fallback.source, "heuristic-fallback");
});

test("VisionJudge: judgeVisionStill uses mock and passes through with no key", async () => {
  setMockVisionHandler(async () => ({ score: 0.85, pass: true, reasons: [], source: "jev", confidence: 0.85 }));
  try {
    const res = await judgeVisionStill({ pngBase64: "ZmFrZS1wbmctZGF0YQ==", intent: "A rat in a maze" });
    assert.equal(res.pass, true);
    assert.equal(res.score, 0.85);
  } finally {
    clearMockVisionHandler();
  }
  const heuristic = await judgeVisionStill({ pngBase64: "ZmFrZS1wbmctZGF0YQ==", intent: "A rat" }, { apiKey: "" });
  assert.equal(heuristic.source, "heuristic-fallback");
  assert.equal(heuristic.pass, true);
  assert.deepEqual(heuristicVisionJudgement({ pngBase64: "eA==", intent: "rat" }).reasons, []);
});
