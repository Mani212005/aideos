/**
 * File Description: Retargeting tests: the receive on every character, limit policies, named failures and property runs over random proportions.
 * Inputs and outputs: committed and randomly proportioned character rigs -> retargeted receives checked by the independent numerical critique.
 * Used by: npm test.
 */
import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import { createReceiveAction } from "../../src/dl/performance/receive";
import { shiftReceive } from "../../src/dl/performance/span";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import { critiquePerformance } from "../../src/dl/performance/critique";
import { retargetReceive, ReceiveRetargetError } from "../../src/dl/performance/retarget";
import { limbRange } from "../../src/dl/performance/limits";
import { distance, point } from "../../src/dl/performance/math";
import { rigFromCharacter } from "../../src/dl/characters/rig";
import { validateCharacterSemantics } from "../../src/dl/characters/validate";
import type { CharacterRig, PerformanceState, ReceiveAction } from "../../src/dl/performance/types";
import { bindReceive, bindReceiveSpan, fitReceiveSpan } from "../performance/bindReceive";
import { RECEIVE_TIMING } from "../performance/fixture";
import { loadSpec, randomProportions, type FixtureCharacter } from "../testSupport/characters";

const IONA = rigFromCharacter(loadSpec("iona"));
const rigOf = (name: FixtureCharacter) => rigFromCharacter(loadSpec(name));

// Runs the independent critique and returns the failing obligations.
function failures(rig: CharacterRig, action: ReceiveAction, cue = action.contact.frame): string[] {
  const report = critiquePerformance(rig, action, createPerformanceEvaluator(rig, action), cue);
  return report.checks.filter((c) => !c.passed).map((c) => `${c.id} ${c.measured} > ${c.limit}`);
}
// Samples every integer frame of an action.
const frames = (action: ReceiveAction): PerformanceState[] => {
  const evaluate = createPerformanceEvaluator(rigFromCharacterId(action), action);
  return Array.from({ length: Math.ceil(action.toFrame - action.fromFrame) + 1 }, (_, i) => evaluate(action.fromFrame + i));
};
const rigs = new Map<string, CharacterRig>();
const rigFromCharacterId = (action: ReceiveAction) => rigs.get(action.rigId)!;
// Largest frame-to-frame joint jump, each joint measured against the length of its own chain (arm, leg or spine): a pop shows up here.
function maxStep(states: PerformanceState[], rig: CharacterRig): number {
  const chain = (limb: string) => limbRange(rig, limb).reachMax / rig.limits.reach;
  const spine = ["spine", "chest", "neck", "head"].reduce((sum, id) => sum + Math.hypot(...rig.joints.find((j) => j.id === id)!.offset), 0);
  const scaleOf = (id: string) => /^(shoulder|elbow|wrist|fingers|thumb)/.test(id) ? chain(id.endsWith("L") ? "armL" : "armR") : /^(hip|knee|ankle)[LR]$/.test(id) ? chain(id.endsWith("L") ? "legL" : "legR") : spine;
  let worst = 0;
  for (let i = 1; i < states.length; i++) for (const id of Object.keys(states[i].joints)) worst = Math.max(worst, distance(states[i].joints[id].position, states[i - 1].joints[id].position) / scaleOf(id));
  return worst;
}

test("retargeting onto Iona is the identity, and the bound span equals the merged P0 binding", () => {
  const reference = createReceiveAction(69);
  const { action, warnings } = retargetReceive(reference, IONA, IONA);
  assert.deepEqual(action, reference);
  assert.deepEqual(warnings, []);
  assert.deepEqual(bindReceiveSpan(109, 40, 400), shiftReceive(createReceiveAction(69), 40));
  assert.deepEqual(failures(IONA, action), []);
  // An authored grip offset moves the hand exactly as the P0 binding did; only the elbow poles are re-aimed to the new axis.
  const legacy = shiftReceive(createReceiveAction(69, 30, [0.1, -0.05, 0.2]), 40), offset = bindReceiveSpan(109, 40, 400, 30, [0.1, -0.05, 0.2]);
  assert.deepEqual(offset.constraints.map((c) => c.target), legacy.constraints.map((c) => c.target));
  assert.deepEqual({ ...offset, constraints: [] }, { ...legacy, constraints: [] });
  assert.deepEqual(failures(IONA, offset, 109), []);
});

test("the same receive runs on all three characters with every numerical obligation, including reach and joint limits", () => {
  for (const name of ["iona", "pip", "marlo"] as const) {
    const rig = rigOf(name);
    rigs.set(rig.id, rig);
    const { action, warnings } = fitReceiveSpan(69, 0, 160, 30, [0, 0, 0], { rig, policy: "clamp" });
    assert.equal(action.rigId, `${name}-v1`);
    assert.deepEqual(failures(rig, action), [], name);
    const report = critiquePerformance(rig, action, createPerformanceEvaluator(rig, action), 69);
    assert.ok(report.checks.some((c) => c.id === "reach-limit") && report.checks.some((c) => c.id === "joint-limits"), "character rigs prove their limits");
    // Soles stay on the ground and contact lands on the cue frame.
    const states = frames(action);
    for (const s of states) for (const side of ["L", "R"] as const) assert.ok(Math.abs(point(s.joints[`ankle${side}`], rig.sockets[`sole${side}`].offset)[1]) < 1e-6, `${name} sole${side} frame ${s.frame}`);
    assert.equal(createPerformanceEvaluator(rig, action)(68.999).contact.mode, "airborne");
    assert.equal(createPerformanceEvaluator(rig, action)(69).contact.mode, "attached");
    if (name === "pip") assert.match(warnings.map((w) => `${w.field}: ${w.message}`).join("\n"), /limits\.rotation\.spine: spine rotation clamped by up to 0\.070 rad/);
    else assert.deepEqual(warnings, [], name);
  }
});

test("a stiff character fails the receive under the fail policy with the field, joint and frame named", () => {
  assert.throws(() => fitReceiveSpan(69, 0, 160, 30, [0, 0, 0], { rig: rigOf("pip"), policy: "fail" }), (err: unknown) => {
    assert.ok(err instanceof ReceiveRetargetError);
    assert.equal(err.field, "limits.rotation.spine");
    assert.match(err.message, /turns spine to -0\.420 rad about y at frame 45\.0, outside the allowed \[-0\.35, 0\.35\]/);
    return true;
  });
});

test("an unreachable hand target fails with a named error, or clamps smoothly with a warning, and never yields NaN or a pop", () => {
  const rig = rigOf("marlo");
  rigs.set(rig.id, rig);
  const far: [number, number, number] = [-2.5, 2.5, 1.5];
  assert.throws(() => fitReceiveSpan(69, 0, 160, 30, far, { rig, policy: "fail" }), (err: unknown) => err instanceof ReceiveRetargetError && err.field === "limits.reach" && /armR needs \d+\.\d+ rig units from shoulderR to its target at frame \d+\.\d, outside the allowed/.test(err.message));
  const clamped = fitReceiveSpan(69, 0, 160, 30, far, { rig, policy: "clamp" });
  assert.match(clamped.warnings.map((w) => w.message).join("\n"), /armR target clamped by up to \d/);
  assert.deepEqual(failures(rig, clamped.action), []);
  const states = frames(clamped.action);
  assert.ok(states.every((s) => Object.values(s.joints).every((t) => [...t.position, ...t.rotation].every(Number.isFinite))));
  const clean = frames(fitReceiveSpan(69, 0, 160, 30, [0, 0, 0], { rig, policy: "fail" }).action);
  assert.ok(maxStep(states, rig) <= maxStep(clean, rig) * 2, `clamped motion pops: ${maxStep(states, rig)} vs ${maxStep(clean, rig)}`);
});

test("a planted foot that cannot stay planted is refused even under clamp, naming the limit", () => {
  const spec = structuredClone(loadSpec("iona"));
  spec.id = "short-leg"; spec.limits.reach = 0.92;
  const rig = rigFromCharacter(spec);
  assert.throws(() => retargetReceive(createReceiveAction(69), IONA, rig, { policy: "clamp" }), (err: unknown) => err instanceof ReceiveRetargetError && err.field === "limits.reach" && /leg[LR] needs .* a planted foot cannot move/.test(err.message));
});

test("changed narration moves contact to the new cue on every character (J2)", () => {
  const later = structuredClone(RECEIVE_TIMING);
  later.totalDurationSec = 7;
  later.segments[0].durationSec = 7;
  later.segments[0].words[1] = { word: "catches", startSec: 3.1, endSec: 3.3 };
  for (const name of ["iona", "pip", "marlo"] as const) {
    const rig = rigOf(name);
    const action = fitReceiveSpan(93, 0, 210, 30, [0, 0, 0], { rig, policy: "clamp" }).action;
    assert.equal(action.contact.frame, 93);
    assert.deepEqual(failures(rig, action, 93), [], name);
  }
  assert.equal(bindReceive(later, { shotId: "catch", phrase: "catches" }).contact.frame, 93);
});

test("regression: the approved receive's elbows roll smoothly; the original poles that snapped the left elbow fail pole clearance", () => {
  const repaired = createReceiveAction(69);
  rigs.set(IONA.id, IONA);
  const elbowSteps = (action: ReceiveAction) => { const states = frames(action); return Math.max(...states.slice(1).map((s, i) => distance(s.joints.elbowL.position, states[i].joints.elbowL.position))); };
  assert.ok(elbowSteps(repaired) < 0.25, `left elbow moves ${elbowSteps(repaired)} rig units in one frame`);
  assert.deepEqual(failures(IONA, repaired), []);
  // The merged P0 poles: the left arm's pole ran within 2 degrees of its axis at frame 61.
  const original = structuredClone(repaired) as ReceiveAction & { constraints: Array<{ limb: string; pole: Array<{ frame: number; value: [number, number, number] }> }> };
  const at = (s: number) => Number(((s / 2.3) * 69).toFixed(9)), after = (s: number) => Number((69 + (s - 2.3) * 30).toFixed(9));
  original.constraints.find((c) => c.limb === "armL")!.pole = [{ frame: 0, value: [0.6, -0.3, -0.7] }, { frame: at(1.5), value: [1, -0.2, -0.6] }, { frame: 69, value: [1, -0.5, -0.5] }, { frame: after(3.1), value: [1, -0.7, -0.2] }];
  assert.ok(elbowSteps(original) > 0.75, "the original snap is reproduced");
  assert.match(failures(IONA, original).join("\n"), /^pole-clearance /m);
});

test("retargeting never mutates its inputs", () => {
  const reference = createReceiveAction(69), before = structuredClone(reference);
  const rig = rigOf("marlo"), rigBefore = structuredClone(rig);
  retargetReceive(reference, IONA, rig, { policy: "clamp", targetOffset: [0.3, 0.1, 0] });
  assert.deepEqual(reference, before);
  assert.deepEqual(rig, rigBefore);
});

test("property: over 120 random proportions the receive keeps bone lengths, planted soles, limits, cue contact and smooth seams", () => {
  rigs.set(IONA.id, IONA);
  const base = loadSpec("iona"), baseStep = maxStep(frames(retargetReceive(createReceiveAction(69), IONA, IONA).action), IONA);
  const refused: string[] = [];
  let passed = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const { spec, draw } = randomProportions(base, seed);
    assert.deepEqual(validateCharacterSemantics(spec).errors, [], `seed ${seed} spec`);
    const rig = rigFromCharacter(spec);
    rigs.set(rig.id, rig);
    let result: ReturnType<typeof retargetReceive>;
    try {
      result = retargetReceive(createReceiveAction(69), IONA, rig, { policy: "clamp" });
    } catch (err) {
      // A refusal is allowed only as a named, field-addressed retarget error.
      assert.ok(err instanceof ReceiveRetargetError, `seed ${seed} threw ${String(err)}`);
      assert.match(err.field, /^limits\./);
      refused.push(`${seed}:${err.field}`);
      continue;
    }
    const failed = failures(rig, result.action, 69);
    assert.deepEqual(failed, [], `seed ${seed} ${JSON.stringify(draw)}`);
    const states = frames(result.action);
    for (const s of states) for (const side of ["L", "R"] as const) assert.ok(Math.abs(point(s.joints[`ankle${side}`], rig.sockets[`sole${side}`].offset)[1]) < 1e-6, `seed ${seed} sole`);
    assert.ok(maxStep(states, rig) <= baseStep * 2, `seed ${seed} pops: ${maxStep(states, rig)} vs Iona ${baseStep}`);
    passed++;
  }
  assert.ok(passed >= 110, `only ${passed} of 120 random characters could perform; refused ${refused.join(", ")}`);
});

test("property: under the fail policy every random character either passes every obligation or is refused with a named field", () => {
  const base = loadSpec("marlo");
  const marlo = rigFromCharacter(base);
  for (let seed = 500; seed < 560; seed++) {
    const rig = rigFromCharacter(randomProportions(base, seed).spec);
    try {
      const { action, warnings } = retargetReceive(createReceiveAction(69), IONA, rig, { policy: "fail" });
      assert.deepEqual(warnings, []);
      assert.deepEqual(failures(rig, action), [], `seed ${seed}`);
    } catch (err) {
      assert.ok(err instanceof ReceiveRetargetError, `seed ${seed} threw ${String(err)}`);
      assert.ok(/^limits\.(reach|bend\.(arm|leg)|rotation\.\w+)$/.test(err.field), err.field);
    }
  }
  assert.equal(marlo.id, "marlo-v1");
});
