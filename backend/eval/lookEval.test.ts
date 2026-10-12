/**
 * File Description: Tests labelled look-treatment cases and offline plan scoring.
 * Inputs and outputs: Checked-in evaluation labels and look plan fixtures -> schema and score assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadLookEvalCases, scoreLookEvalCase } from "./lookEval";
import { parseLookPlan, type LookPlan, type LookTreatment } from "../lookPlan/schema";

/** Builds the smallest valid look plan for exercising one labelled shot. */
function planFor(id: string, treatment: LookTreatment): LookPlan {
  return {
    schema: "aideos.look/1",
    decidedBy: { agent: "eval-test", model: "fixture", at: "2026-10-12T00:00:00Z" },
    film: {
      mode: "scene",
      stage: "A single service rack where requests move between servers.",
      cast: [{ id: "server", what: "a server", enters: "start", changes: [] }],
      camera: [{ at: "start", pose: "wide establishing view", why: "show the whole stage" }],
      palette: { bg: "#0A0A0B", accent: "#635BFF", extra: {} },
      captions: { position: "bottom", kineticColumn: false },
      headlines: "none",
    },
    shots: [{ id, treatment, carries: ["server"], cue: "server", criterion: "test", why: "fixture plan", ...(treatment === "device" ? { device: "StatCounter" } : {}) }],
  };
}

test("LookEval: labelled cases load and their plan fixtures validate against look.json schema", () => {
  const cases = loadLookEvalCases();
  assert.equal(cases.length, 8);
  assert.ok(cases.some((evalCase) => evalCase.id === "lb-04-routing-counter"));
  for (const evalCase of cases) {
    const fixture = planFor(evalCase.id, evalCase.right[0]);
    assert.doesNotThrow(() => parseLookPlan(fixture), evalCase.id);
    assert.ok(evalCase.source.length > 0, evalCase.id);
    assert.ok(evalCase.beat.narration.length > 0, evalCase.id);
    for (const label of evalCase.wrong) assert.ok(label.reason.length > 0, evalCase.id);
  }
});

test("LookEval: a right plan, wrong plan and missing plan score correctly", () => {
  const evalCase = loadLookEvalCases().find((candidate) => candidate.id === "lb-04-routing-counter");
  assert.ok(evalCase);
  const right = scoreLookEvalCase(evalCase, planFor(evalCase.id, "scene"));
  const wrong = scoreLookEvalCase(evalCase, planFor(evalCase.id, "device"));
  const missing = scoreLookEvalCase(evalCase, undefined);
  assert.deepEqual(right, { id: evalCase.id, chosen: "scene", hit: true, result: "right" });
  assert.deepEqual(wrong, { id: evalCase.id, chosen: "device", hit: false, result: "wrong" });
  assert.deepEqual(missing, { id: evalCase.id, chosen: null, hit: false, result: "missing" });
});
