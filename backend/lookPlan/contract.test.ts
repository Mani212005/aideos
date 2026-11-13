/**
 * File Description: Behavioral tests for the renderer-independent look contract's legal transitions.
 * Inputs and outputs: plan items, camera evidence and judge rulings -> state and acceptance assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { contractErrors, designAcceptance, judgeBuiltDesign, matchCameraPose, plannedItem, realizeLookContract, transitionPlanItem } from "./contract";

test("look contract: planned items bind before realization and terminal items reject impossible transitions", () => {
  const planned = plannedItem("camera:0", "camera", "beat-01");
  assert.equal(planned.state, "planned");
  assert.throws(() => transitionPlanItem(planned, { type: "realize", reason: "no binding" }), /cannot realize from planned/);
  const bound = transitionPlanItem(planned, { type: "bind", binding: "keyframe:0", reason: "cue matches" });
  assert.equal(bound.state, "bound");
  assert.equal(planned.state, "planned", "transitions are pure");
  const realized = realizeLookContract([bound]);
  assert.equal(realized[0].state, "realized");
  assert.deepEqual(contractErrors(realized), []);
  assert.throws(() => transitionPlanItem(realized[0], { type: "drop", reason: "too late" }), /cannot drop from realized/);
  const dropped = realizeLookContract([bound], new Map([[bound.id, "compiled camera missed its cue"]]));
  assert.equal(dropped[0].state, "dropped");
  assert.deepEqual(contractErrors(dropped), ["camera:0: compiled camera missed its cue"]);
  assert.throws(() => transitionPlanItem(dropped[0], { type: "bind", binding: "other", reason: "retry" }), /cannot bind from dropped/);
  assert.throws(() => transitionPlanItem(planned, { type: "bind", binding: "", reason: "missing" }), /binding is empty/);
});

test("look contract: camera binding includes the tolerance boundary and excludes a distant nearest pose", () => {
  const pose = { frame: 45, focus: "carrier" };
  assert.equal(matchCameraPose({ frame: 0 }, [pose], 45), pose);
  assert.equal(matchCameraPose({ frame: 91 }, [pose], 45), undefined);
  assert.equal(matchCameraPose({ frame: 0 }, [], 45), undefined);
});

test("look contract: judged designs distinguish acceptance, rejection and unavailable evidence", () => {
  for (const passed of [true, false, null] as const) {
    const judged = judgeBuiltDesign({ state: "built" }, { passed });
    assert.equal(judged.state, "judged");
    assert.equal(judged.judge, passed === null ? "skipped" : passed ? "passed" : "failed");
    assert.equal(designAcceptance(judged.judge), passed === null ? "unjudged" : passed ? "accepted" : "needs_design");
    assert.throws(() => judgeBuiltDesign(judged, { passed: true }), /requires a newly built design/);
  }
  assert.throws(() => judgeBuiltDesign({ state: "built" }, { passed: true, skipped: "no evidence" }), /skipped judgment cannot pass/);
});
