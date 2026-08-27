/**
 * File Description: Comprehensive test suite for Phase 4 Patch Operations (P-1 through P-10).
 * Exhaustively tests strict locality deep-diffs, immutability purity, individual op error handling,
 * atomic validation rollback, continuity verification rollback, and all 12 discrete patch operations.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import type { Scene } from "../../src/dl/scene/types";
import { applyPatch, type PatchOp } from "../../src/dl/scene/patch";
import { compileScene } from "../../src/dl/scene/compile";

const TEST_SVG = path.resolve("test_fixtures/svg/test_prop.svg");

function makeValidScene(): Scene {
  return {
    schemaVersion: "1.0.0",
    sceneId: "scene-patch-test",
    fps: 30,
    durationFrames: 90, // 3.0s = 3000ms
    audioSource: "audio/segment-1.wav",
    audioDurationMs: 3000,
    sceneSize: { w: 1920, h: 1080 },
    background: {
      assetId: "bg-main",
      svgSource: TEST_SVG,
      layer: 0,
      position: { x: 0, y: 0 },
      scale: 1.0,
      rotation: 0,
      opacity: 1.0,
    },
    props: [
      {
        assetId: "prop-bicycle",
        svgSource: TEST_SVG,
        position: { x: 400, y: 800 },
        scale: 1.0,
        rotation: 0,
        opacity: 1.0,
        subGroups: [
          {
            elementId: "wheel-front",
            pivot: { x: 100, y: 100 },
            degreesPerSecond: 360,
          },
        ],
      },
    ],
    actors: [
      {
        instanceId: "actor-1",
        rigId: "astronaut",
        position: { x: 500, y: 500 },
        scale: 1.0,
        facing: "right",
        actions: [
          {
            actionId: "walk",
            startFrame: 0,
            durationFrames: 45,
            intensity: 1.0,
          },
        ],
        jointTracks: {
          head: {
            trackId: "head",
            keyframes: [
              { frame: 0, value: 0 },
              { frame: 45, value: 15 },
              { frame: 89, value: 0 },
            ],
          },
        },
      },
      {
        instanceId: "actor-2",
        rigId: "developer",
        position: { x: 900, y: 500 },
        scale: 1.0,
        facing: "left",
        actions: [
          {
            actionId: "idle",
            startFrame: 0,
            durationFrames: 90,
            intensity: 1.0,
          },
        ],
      },
    ],
  };
}

/** Exhaustive deep-diff helper comparing every path between two scenes. */
function getSceneDifferences(original: Scene, modified: Scene): string[] {
  const diffs: string[] = [];

  const compareObjects = (pathStr: string, a: any, b: any) => {
    if (a === b) return;
    if (typeof a !== typeof b) {
      diffs.push(`${pathStr}: type changed from ${typeof a} to ${typeof b}`);
      return;
    }
    if (typeof a !== "object" || a === null || b === null) {
      diffs.push(`${pathStr}: value changed from ${JSON.stringify(a)} to ${JSON.stringify(b)}`);
      return;
    }
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of allKeys) {
      compareObjects(pathStr ? `${pathStr}.${key}` : key, a[key], b[key]);
    }
  };

  compareObjects("", original, modified);
  return diffs;
}

// P-1: Locality: apply adjust_joint; exhaustive deep-diff proves exactly one value differs
test("P-1: Locality: apply adjust_joint to one joint; deep-diff proves exactly one value differs, nothing else", () => {
  const scene = makeValidScene();
  const ops: PatchOp[] = [
    {
      op: "adjust_joint",
      instanceId: "actor-1",
      joint: "head",
      frame: 45,
      deltaDegrees: 5, // 15 + 5 = 20
    },
  ];

  const res = applyPatch(scene, ops);
  assert.equal(res.applied.length, 1);
  assert.equal(res.rejected.length, 0);

  const diffs = getSceneDifferences(scene, res.scene);
  // Expected exactly one diff: actors.0.jointTracks.head.keyframes.1.value changed from 15 to 20
  assert.equal(
    diffs.length,
    1,
    `Locality violation: Expected exactly 1 diff, got ${diffs.length}: ${JSON.stringify(diffs)}`,
  );
  assert.ok(diffs[0].includes("actors.0.jointTracks.head.keyframes.1.value"));
  assert.ok(diffs[0].includes("15 to 20"));
});

// P-1 Negative Case: Make an op touch a second joint; observe P-1 deep-diff fails
test("Phase 4 Negative Case: Deliberate mutation of a second joint fails P-1 single-diff locality assertion", () => {
  const scene = makeValidScene();
  const corruptedScene = JSON.parse(JSON.stringify(scene));
  // Mutate primary target joint
  corruptedScene.actors[0].jointTracks.head.keyframes[1].value = 20;
  // Corrupt a second unrelated joint
  corruptedScene.actors[0].jointTracks.torso = { trackId: "torso", keyframes: [{ frame: 0, value: 5 }] };

  const diffs = getSceneDifferences(scene, corruptedScene);
  assert.ok(diffs.length > 1, `Negative case must detect multiple mutations across joints (got ${diffs.length})`);
});

// P-2: Purity: input scene object is byte-identical after applyPatch returns
test("P-2: Purity: input scene object is byte-identical after applyPatch returns", () => {
  const scene = makeValidScene();
  const copyBefore = JSON.parse(JSON.stringify(scene));

  applyPatch(scene, [
    { op: "move_entity", entityId: "actor-1", to: { x: 999, y: 999 } },
    { op: "set_scale", entityId: "prop-bicycle", scale: 2.0 },
    { op: "remove_actor", instanceId: "actor-2" },
  ]);

  assert.deepEqual(scene, copyBefore, "Input scene must remain completely unchanged (purity guarantee)");
});

// P-3: Op naming nonexistent instanceId appears in rejected with reason; other ops apply
test("P-3: Nonexistent instanceId appears in rejected with reason; valid ops in batch still apply", () => {
  const scene = makeValidScene();
  const ops: PatchOp[] = [
    { op: "move_entity", entityId: "actor-1", to: { x: 600, y: 600 } },
    { op: "adjust_joint", instanceId: "non-existent-actor", joint: "head", frame: 0, deltaDegrees: 10 },
  ];

  const res = applyPatch(scene, ops);
  assert.equal(res.applied.length, 1);
  assert.equal(res.rejected.length, 1);
  assert.equal(res.rejected[0].op.op, "adjust_joint");
  assert.ok(res.rejected[0].reason.includes("non-existent-actor"));
  assert.equal(res.scene.actors[0].position.x, 600);
});

// P-4: Patch producing validation errors returns original scene unchanged
test("P-4: Patch producing validation errors rolls back and returns original scene unchanged", () => {
  const scene = makeValidScene();
  // set_scale to negative value (-2.0) violates Rule 10
  const ops: PatchOp[] = [
    { op: "set_scale", entityId: "actor-1", scale: -2.0 },
  ];

  const res = applyPatch(scene, ops);
  assert.equal(res.applied.length, 0);
  assert.ok(res.rejected.length > 0);
  assert.ok(res.rejected.some((r) => r.reason.includes("failed validation") && r.reason.includes("Rule 10")));
  assert.deepEqual(res.scene, scene, "Scene must be rolled back to original");
});

// P-5: Patch producing continuity violation is rejected with verifier error
test("P-5: Patch producing continuity violation is rejected with verifier error", () => {
  const scene = makeValidScene();
  // set_joint with sharp C0 linear reversal
  const ops: PatchOp[] = [
    { op: "set_joint", instanceId: "actor-1", joint: "torso", frame: 0, valueDegrees: 0 },
    { op: "set_joint", instanceId: "actor-1", joint: "torso", frame: 30, valueDegrees: 90 },
    { op: "set_joint", instanceId: "actor-1", joint: "torso", frame: 60, valueDegrees: -90 },
    { op: "set_joint", instanceId: "actor-1", joint: "torso", frame: 89, valueDegrees: 0 },
  ];

  // Force track continuity to C0 to produce real velocity kink
  scene.actors[0].jointTracks!.torso = { trackId: "torso", continuity: "C0", keyframes: [] };

  const res = applyPatch(scene, ops);
  assert.equal(res.applied.length, 0);
  assert.ok(res.rejected.some((r) => r.reason.includes("failed continuity verification")));
  assert.deepEqual(res.scene.actors[0].jointTracks!.torso.keyframes, [], "Keyframes must be rolled back");
});

// P-6: Each of the 12 ops has at least one test proving it performs its stated change
test("P-6: Verification of all 12 patch operations", () => {
  const scene = makeValidScene();

  // 1. adjust_joint
  const r1 = applyPatch(scene, [{ op: "adjust_joint", instanceId: "actor-1", joint: "head", frame: 45, deltaDegrees: 5 }]);
  assert.equal(r1.scene.actors[0].jointTracks!.head.keyframes[1].value, 20);

  // 2. set_joint
  const r2 = applyPatch(scene, [{ op: "set_joint", instanceId: "actor-1", joint: "head", frame: 45, valueDegrees: 35 }]);
  assert.equal(r2.scene.actors[0].jointTracks!.head.keyframes[1].value, 35);

  // 3. retime_action
  const r3 = applyPatch(scene, [{ op: "retime_action", instanceId: "actor-1", actionIndex: 0, shiftFrames: 10 }]);
  assert.equal(r3.scene.actors[0].actions![0].startFrame, 10);

  // 4. set_action
  const r4 = applyPatch(scene, [
    {
      op: "set_action",
      instanceId: "actor-1",
      actionIndex: 0,
      actionId: "wave",
      params: { durationFrames: 30, intensity: 0.9, side: "left" },
    },
  ]);
  assert.equal(r4.scene.actors[0].actions![0].actionId, "wave");
  assert.equal(r4.scene.actors[0].actions![0].durationFrames, 30);

  // 5. move_entity
  const r5 = applyPatch(scene, [{ op: "move_entity", entityId: "actor-1", to: { x: 777, y: 888 } }]);
  assert.deepEqual(r5.scene.actors[0].position, { x: 777, y: 888 });

  // 6. set_layer (D5 explicit override)
  const r6 = applyPatch(scene, [{ op: "set_layer", entityId: "actor-1", layer: 99 }]);
  assert.equal(r6.scene.actors[0].layer, 99);

  // 7. clear_layer (D5 revert to derived)
  const r7 = applyPatch(r6.scene, [{ op: "clear_layer", entityId: "actor-1" }]);
  assert.equal(r7.scene.actors[0].layer, undefined);

  // 8. set_scale
  const r8 = applyPatch(scene, [{ op: "set_scale", entityId: "actor-1", scale: 1.2 }]);
  assert.equal(r8.scene.actors[0].scale, 1.2);

  // 9. set_facing
  const r9 = applyPatch(scene, [{ op: "set_facing", instanceId: "actor-1", facing: "left" }]);
  assert.equal(r9.scene.actors[0].facing, "left");

  // 10. set_sub_rotation (D1)
  const r10 = applyPatch(scene, [{ op: "set_sub_rotation", entityId: "prop-bicycle", degreesPerSecond: 720 }]);
  assert.equal(r10.scene.props[0].subGroups![0].degreesPerSecond, 720);

  // 11. add_actor
  const newActor: ActorInstance = {
    instanceId: "actor-3",
    rigId: "robot",
    position: { x: 200, y: 200 },
    scale: 0.8,
    facing: "right",
  };
  const r11 = applyPatch(scene, [{ op: "add_actor", actor: newActor }]);
  assert.equal(r11.scene.actors.length, 3);
  assert.equal(r11.scene.actors[2].instanceId, "actor-3");

  // 12. remove_actor
  const r12 = applyPatch(scene, [{ op: "remove_actor", instanceId: "actor-2" }]);
  assert.equal(r12.scene.actors.length, 1);
  assert.equal(r12.scene.actors[0].instanceId, "actor-1");
});

// P-7: Round-trip: add_actor then remove_actor returns scene deep-equal to original
test("P-7: Round-trip add_actor then remove_actor returns scene deep-equal to original", () => {
  const scene = makeValidScene();
  const newActor: ActorInstance = {
    instanceId: "actor-temp",
    rigId: "robot",
    position: { x: 300, y: 300 },
    scale: 0.8,
    facing: "right",
  };

  const r1 = applyPatch(scene, [{ op: "add_actor", actor: newActor }]);
  assert.equal(r1.scene.actors.length, 3);

  const r2 = applyPatch(r1.scene, [{ op: "remove_actor", instanceId: "actor-temp" }]);
  assert.deepEqual(r2.scene, scene);
});

// P-8 (D4 Audio Invariant): retime_action pushing action past budget is rejected with budget message
test("P-8 (D4 Audio Invariant): retime_action pushing action past frame budget is rejected with budget message", () => {
  const scene = makeValidScene();
  // Action has durationFrames: 45 on a 90-frame scene. Shift by +50 frames -> [50, 95] > 90
  const ops: PatchOp[] = [
    { op: "retime_action", instanceId: "actor-1", actionIndex: 0, shiftFrames: 50 },
  ];

  const res = applyPatch(scene, ops);
  assert.equal(res.applied.length, 0);
  assert.equal(res.rejected.length, 1);
  assert.ok(res.rejected[0].reason.includes("available scene duration budget"));
  assert.ok(res.rejected[0].reason.includes("90 frames"));
  assert.ok(res.rejected[0].reason.includes("audio-locked (D4)"));
});

// P-9 (D5): set_layer then clear_layer on same entity returns it to derived resolution
test("P-9 (D5 Layer Override & Clear): set_layer then clear_layer returns entity to derived layer", () => {
  const scene = makeValidScene();
  // Initial compiled frame: actor-1 (y=500) has layerSource='derived' and resolvedLayer=500
  const compInit = compileScene(scene);
  const entInit = compInit.frames[0].entities.find((e) => e.entityId === "actor-1")!;
  assert.equal(entInit.layerSource, "derived");
  assert.equal(entInit.resolvedLayer, 500);

  // Apply set_layer = 50
  const rSet = applyPatch(scene, [{ op: "set_layer", entityId: "actor-1", layer: 50 }]);
  const compSet = compileScene(rSet.scene);
  const entSet = compSet.frames[0].entities.find((e) => e.entityId === "actor-1")!;
  assert.equal(entSet.layerSource, "explicit");
  assert.equal(entSet.resolvedLayer, 50);

  // Apply clear_layer
  const rClear = applyPatch(rSet.scene, [{ op: "clear_layer", entityId: "actor-1" }]);
  const compClear = compileScene(rClear.scene);
  const entClear = compClear.frames[0].entities.find((e) => e.entityId === "actor-1")!;
  assert.equal(entClear.layerSource, "derived");
  assert.equal(entClear.resolvedLayer, 500);
});

// P-10: Patch producing only warning W1 (scale deviation) is applied and returns warning
test("P-10: Patch producing only warning W1 is applied, scene updated, and warning returned", () => {
  const scene = makeValidScene();
  // Set scale of actor-1 to 3.0x (with 2 actors [1.0, 3.0], median is 2.0, deviation is |3.0-2.0|/2.0 = 50% > 40%)
  const ops: PatchOp[] = [
    { op: "set_scale", entityId: "actor-1", scale: 3.0 },
  ];

  const res = applyPatch(scene, ops);
  assert.equal(res.applied.length, 1);
  assert.equal(res.rejected.length, 0);
  assert.equal(res.scene.actors[0].scale, 3.0);
  assert.ok(res.warnings.length > 0);
  assert.ok(res.warnings.some((w) => w.includes("exceeds ±40% threshold")));
});
