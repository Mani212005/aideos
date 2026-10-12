/**
 * File Description: Tests labelled look-treatment cases and offline plan scoring.
 * Inputs and outputs: Checked-in evaluation labels and look plan fixtures -> schema and score assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLookPlans, loadLookEvalCases, parseLookEvalArgs, scoreLookEvalCase } from "./lookEval";
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
      palette: { bg: "#0A0A0B", accent: "#635BFF" },
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

test("LookEval: parseLookEvalArgs treats --min as opt-in without a default threshold", () => {
  assert.deepEqual(parseLookEvalArgs(["--plans", "look.json"]), { planPath: "look.json", minimum: undefined });
  assert.deepEqual(parseLookEvalArgs(["--plans", "look.json", "--min", "80"]), { planPath: "look.json", minimum: 80 });
  assert.throws(() => parseLookEvalArgs(["--plans", "look.json", "--min", "-1"]), /--min must be a number from 0 to 100/);
  assert.throws(() => parseLookEvalArgs(["--plans", "look.json", "--min", "101"]), /--min must be a number from 0 to 100/);
  assert.throws(() => parseLookEvalArgs(["--min", "80"]), /usage: npm run eval:look/);
});

test("LookEval: opt-in threshold passes by default on partial agreement and fails only when below requested minimum", () => {
  const cases = loadLookEvalCases();
  const plans = new Map<string, unknown>();
  const proofShotIds = [
    "lb-01-balance",
    "lb-02-health-check",
    "lb-03-recovery",
    "lb-04-routing-counter",
    "lb-05-throughput",
    "lb-06-fourth-server",
  ];
  for (const id of proofShotIds) {
    const evalCase = cases.find((candidate) => candidate.id === id);
    assert.ok(evalCase);
    plans.set(id, planFor(id, evalCase.right[0]));
  }

  const defaultEval = evaluateLookPlans(cases, plans);
  assert.equal(defaultEval.agreement, 75);
  assert.equal(defaultEval.passed, true);

  const failedEval = evaluateLookPlans(cases, plans, { minimum: 80 });
  assert.equal(failedEval.agreement, 75);
  assert.equal(failedEval.passed, false);

  const passingEval = evaluateLookPlans(cases, plans, { minimum: 70 });
  assert.equal(passingEval.agreement, 75);
  assert.equal(passingEval.passed, true);
});
