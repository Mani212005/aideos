/**
 * File Description: Behavioral tests of cue-bound sparse performances and their numerical failure fixtures.
 * Inputs and outputs: Iona rig, good and degraded actions -> deterministic geometry and critique assertions.
 * Used by: npm test.
 */
import "../testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Quat } from "../../src/dl/performance/types";
import { createCues } from "../sceneKit/timing";
import { bindReceive } from "./bindReceive";
import { RECEIVE_CUE, RECEIVE_TIMING } from "./fixture";
import { critiquePerformance } from "../../src/dl/performance/critique";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import { IONA_RIG } from "../../src/dl/performance/iona";
import { createReceiveAction } from "../../src/dl/performance/receive";
import {
  add,
  distance,
  length,
  point,
  sample,
  solveTwoBone,
} from "../../src/dl/performance/math";
import { degrade, type Defect } from "../../test_fixtures/performance/degraded";

const action = bindReceive(RECEIVE_TIMING, RECEIVE_CUE);
const evaluate = createPerformanceEvaluator(IONA_RIG, action);
const cue = createCues(RECEIVE_TIMING).word(
  RECEIVE_CUE.shotId,
  RECEIVE_CUE.phrase,
);

// Reports the named check from an independent critique of an evaluator.
function checkFor(defect: Defect, id: string) {
  const report = critiquePerformance(
    IONA_RIG,
    action,
    degrade(evaluate, defect),
    cue,
  );
  assert.equal(report.passed, false);
  return report.checks.find((c) => c.id === id)!;
}

test("approved receive meets all numerical obligations without claiming visual acceptance", () => {
  const report = critiquePerformance(IONA_RIG, action, evaluate, cue);
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.equal(report.samples, 151);
  assert.equal(report.visualQuality, "unmeasured");
  assert.equal(evaluate(0).expression.a, "neutral");
  assert.equal(evaluate(45).expression.b, "determined");
  assert.equal(evaluate(111).expression.a, "relieved");
});

test("absolute-frame seeks match sequential, reverse, repeated and fractional seeks", () => {
  const frames = Array.from({ length: 151 }, (_, i) => i);
  const expected = new Map(frames.map((f) => [f, evaluate(f)]));
  for (const f of frames.reverse().concat([69, 0, 111, 69, 149]))
    assert.deepEqual(evaluate(f), expected.get(f));
  const fractional = evaluate(68.75);
  evaluate(140);
  evaluate(4);
  assert.deepEqual(evaluate(68.75), fractional);
});

test("fixed-length limbs and planted foot points hold through every interpolated frame", () => {
  for (let f = 0; f <= 150; f += 0.25) {
    const s = evaluate(f);
    for (const limb of Object.values(IONA_RIG.limbs)) {
      const upper = IONA_RIG.joints.find((j) => j.id === limb.middle)!.offset;
      const lower = IONA_RIG.joints.find((j) => j.id === limb.tip)!.offset;
      assert.ok(
        Math.abs(
          distance(
            s.joints[limb.base].position,
            s.joints[limb.middle].position,
          ) - length(upper),
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          distance(
            s.joints[limb.middle].position,
            s.joints[limb.tip].position,
          ) - length(lower),
        ) < 1e-10,
      );
    }
    for (const foot of ["ankleL", "ankleR"])
      assert.ok(
        distance(s.joints[foot].position, evaluate(0).joints[foot].position) <
          1e-10,
      );
  }
});

test("grip follows its authored path between sparse keys and prop remains attached after contact", () => {
  for (let f = 0; f <= 150; f += 0.5) {
    const s = evaluate(f),
      path = action.constraints.find((c) => c.limb === "armR")!.target;
    assert.ok(
      distance(
        s.joints.wristR.position,
        point(s.root, sample(path, Math.min(f, action.holdFromFrame))),
      ) < 1e-10,
    );
    if (f >= cue)
      assert.ok(distance(s.contact.point, s.contact.propPoint) < 1e-10);
  }
  assert.equal(evaluate(cue - 0.0001).contact.mode, "airborne");
  assert.equal(evaluate(cue).contact.mode, "attached");
});

test("a new cue and reachable target retime contact through the existing word resolver", () => {
  const timing = structuredClone(RECEIVE_TIMING);
  timing.segments[0].words[1].startSec = 2.6;
  timing.segments[0].durationSec = timing.totalDurationSec = 5.3;
  const retimed = bindReceive(timing, RECEIVE_CUE, 30, [0.08, -0.06, 0.02]);
  const resolved = createCues(timing).word("catch", "catches");
  assert.equal(resolved, 78);
  assert.equal(retimed.anchors[3].frame, resolved);
  assert.equal(retimed.contact.frame, resolved);
  const run = createPerformanceEvaluator(IONA_RIG, retimed);
  assert.equal(
    critiquePerformance(IONA_RIG, retimed, run, resolved).passed,
    true,
  );
  assert.equal(run(77.999).contact.mode, "airborne");
  assert.equal(run(78).contact.mode, "attached");
  assert.notDeepEqual(
    run(78).joints.wristR.position,
    evaluate(69).joints.wristR.position,
  );
  assert.throws(
    () => bindReceive(timing, { shotId: "catch", phrase: "drops" }),
    /not spoken/,
  );
  assert.throws(
    () => bindReceive(RECEIVE_TIMING, { ...RECEIVE_CUE, edge: "end" }),
    /ends before/,
  );
});

test("fps changes use the same cue authority and preserve action duration in seconds", () => {
  const at60 = bindReceive(RECEIVE_TIMING, RECEIVE_CUE, 60);
  assert.equal(at60.contact.frame, 138);
  const run = createPerformanceEvaluator(IONA_RIG, at60);
  for (const f of [0, 21, 45, 69, 80, 111, 149])
    assert.deepEqual(run(f * 2).joints, evaluate(f).joints);
});

test("moving root keeps feet planted in world space", () => {
  const moving = structuredClone(action);
  moving.root.position = [
    { frame: 0, value: [1.9, 0, 0] },
    { frame: 150, value: [2, 0, 0] },
  ];
  const run = createPerformanceEvaluator(IONA_RIG, moving);
  for (let f = 0; f <= 150; f++)
    for (const foot of ["ankleL", "ankleR"])
      assert.ok(
        distance(run(f).joints[foot].position, run(0).joints[foot].position) <
          1e-10,
      );
});

test("unreachable target keeps bone lengths but fails the grip obligation", () => {
  const far = createReceiveAction(69, 30, [20, 0, 0]);
  const report = critiquePerformance(
    IONA_RIG,
    far,
    createPerformanceEvaluator(IONA_RIG, far),
    cue,
  );
  assert.equal(report.checks.find((c) => c.id === "bone-length")!.passed, true);
  assert.equal(report.checks.find((c) => c.id === "grip-path")!.passed, false);
});

for (const [defect, id] of [
  ["stretch", "bone-length"],
  ["slide", "planted-feet"],
  ["miss-grip", "grip-path"],
  ["late-contact", "contact-cue"],
  ["pose-snap", "pose-seams"],
  ["velocity-snap", "velocity-seams"],
  ["history", "seek-order"],
  ["frozen", "frozen-pose"],
  ["attachment", "attachment"],
  ["nonfinite", "finite-pose"],
] as const)
  test(`degraded ${defect} fails ${id}`, () =>
    assert.equal(checkFor(defect, id).passed, false));

test("declared final hold is identical while a frozen active catch is rejected", () => {
  assert.deepEqual(evaluate(111).joints, evaluate(149).joints);
  assert.deepEqual(evaluate(111).prop, evaluate(149).prop);
  assert.equal(checkFor("frozen", "frozen-pose").passed, false);
});

test("evaluation owns its inputs and outputs, clamps endpoints and rejects invalid frames", () => {
  const owned = structuredClone(action),
    rig = structuredClone(IONA_RIG);
  const run = createPerformanceEvaluator(rig, owned),
    before = run(69);
  owned.contact.frame = 80;
  rig.joints[0].offset = [99, 0, 0];
  before.joints.wristR.position = [99, 0, 0];
  assert.deepEqual(run(69), evaluate(69));
  assert.deepEqual(run(-10), run(0));
  assert.deepEqual(run(200), run(150));
  assert.throws(() => run(NaN), /finite/);
  assert.throws(() => run(Infinity), /finite/);
});

test("invalid rigs, path ordering, contact phases and planted targets fail before evaluation", () => {
  assert.throws(
    () => createPerformanceEvaluator({ ...IONA_RIG, id: "other" }, action),
    /requires rig/,
  );
  const empty = structuredClone(action);
  empty.root.position = [];
  assert.throws(() => createPerformanceEvaluator(IONA_RIG, empty), /empty/);
  const unordered = structuredClone(action);
  unordered.root.position = [
    { frame: 1, value: [0, 0, 0] },
    { frame: 0, value: [0, 0, 0] },
  ];
  assert.throws(
    () => createPerformanceEvaluator(IONA_RIG, unordered),
    /increasing/,
  );
  const bad = structuredClone(action);
  bad.contact.frame++;
  assert.throws(() => createPerformanceEvaluator(IONA_RIG, bad), /cue-bound/);
  const slide = structuredClone(action);
  slide.constraints = slide.constraints.map((c) =>
    c.planted
      ? {
          ...c,
          target: [
            ...c.target,
            { frame: 20, value: add(c.target[0].value, [0.1, 0, 0]) },
          ],
        }
      : c,
  );
  assert.throws(
    () => createPerformanceEvaluator(IONA_RIG, slide),
    /fixed target/,
  );
  assert.throws(() => createReceiveAction(0), /positive/);
  assert.throws(() => createReceiveAction(69, 0), /positive/);
});

test("IK handles folded, unreachable and pole-parallel configurations without stretching", () => {
  for (const target of [
    [0, 0, 0],
    [100, 0, 0],
    [1, 0, 0],
  ] as const) {
    const solved = solveTwoBone([0, 0, 0], target, [1, 0, 0], 1, 0.9);
    assert.ok(Math.abs(length(solved.middle) - 1) < 1e-8);
    assert.ok(Math.abs(distance(solved.middle, solved.tip) - 0.9) < 1e-8);
  }
  assert.throws(
    () => solveTwoBone([0, 0, 0], [1, 0, 0], [0, 1, 0], 0, 1),
    /positive/,
  );
});

test("equivalent quaternion signs do not create a false rotation or velocity seam", () => {
  const equivalent = (frame: number) => {
    const state = evaluate(frame);
    if (frame >= 45) {
      for (const t of [state.root, ...Object.values(state.joints), state.prop])
        t.rotation = t.rotation.map((v) => -v) as unknown as Quat;
    }
    return state;
  };
  assert.equal(
    critiquePerformance(IONA_RIG, action, equivalent, cue).passed,
    true,
  );
});
