/**
 * File Description: Comprehensive test suite for Phase 1 Scene Graph Data Model.
 * Verifies S-1 through S-8, pure JSON round-trip serialization, and 18 exhaustive negative cases for every validation rule.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import type { Scene } from "../../src/dl/scene/types";
import { validateScene } from "../../src/dl/scene/validateScene";

const TEST_SVG = path.resolve("test_fixtures/svg/test_prop.svg");

function makeValidScene(): Scene {
  return {
    schemaVersion: "1.0.0",
    sceneId: "scene-alpha-01",
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
          {
            elementId: "wheel-rear",
            pivot: { x: 300, y: 100 },
            degreesPerSecond: 360,
          },
        ],
      },
    ],
    actors: [
      {
        instanceId: "actor-astro-1",
        rigId: "astronaut",
        position: { x: 960, y: 540 },
        scale: 1.0,
        facing: "right",
        actions: [
          {
            actionId: "walk",
            startFrame: 0,
            durationFrames: 45,
            intensity: 1.0,
          },
          {
            actionId: "wave",
            startFrame: 45,
            durationFrames: 30,
            intensity: 1.0,
            side: "right",
          },
        ],
      },
    ],
  };
}

// S-1: A valid scene produces zero errors
test("S-1: A valid scene produces zero errors", () => {
  const scene = makeValidScene();
  const res = validateScene(scene);
  assert.equal(res.isValid, true);
  assert.equal(res.errors.length, 0, `Expected 0 errors, got: ${JSON.stringify(res.errors)}`);
});

// S-2: 18 Separate Negative Cases for Every Validation Rule
test("S-2 Negative Case 1: Rule 1 rejects unsupported schemaVersion", () => {
  const scene = makeValidScene();
  scene.schemaVersion = "2.0.0";
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 1));
});

test("S-2 Negative Case 2 (S-3): Rule 2 rejects > 15 actors", () => {
  const scene = makeValidScene();
  scene.actors = Array.from({ length: 16 }, (_, i) => ({
    instanceId: `actor-${i + 1}`,
    rigId: "developer",
    position: { x: 100 + i * 50, y: 500 },
    scale: 1.0,
    facing: "right",
  }));
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 2));
});

test("S-2 Negative Case 3 (S-4): Rule 3 rejects duplicate instanceId and names the entity", () => {
  const scene = makeValidScene();
  scene.actors.push({
    instanceId: "actor-astro-1", // duplicate
    rigId: "developer",
    position: { x: 500, y: 500 },
    scale: 1.0,
    facing: "right",
  });
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  const err = res.errors.find((e) => e.rule === 3);
  assert.ok(err);
  assert.equal(err.entityId, "actor-astro-1");
});

test("S-2 Negative Case 4: Rule 4 rejects duplicate assetId", () => {
  const scene = makeValidScene();
  scene.props.push({
    assetId: "bg-main", // duplicate with background
    svgSource: TEST_SVG,
    position: { x: 200, y: 200 },
    scale: 1.0,
    rotation: 0,
    opacity: 1.0,
  });
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 4));
});

test("S-2 Negative Case 5: Rule 5 rejects non-integer layer value", () => {
  const scene = makeValidScene();
  scene.actors[0].layer = 2.5; // non-integer
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 5));
});

test("S-2 Negative Case 6: Rule 6 rejects unknown rigId", () => {
  const scene = makeValidScene();
  scene.actors[0].rigId = "non-existent-cyborg";
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 6));
});

test("S-2 Negative Case 7: Rule 7 rejects unknown joint group in jointTracks", () => {
  const scene = makeValidScene();
  scene.actors[0].jointTracks = {
    unknownTentacle: {
      trackId: "unknownTentacle",
      keyframes: [{ frame: 0, value: 10 }],
    },
  };
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 7));
});

test("S-2 Negative Case 8: Rule 8 rejects keyframe frame outside [0, durationFrames - 1]", () => {
  const scene = makeValidScene();
  scene.actors[0].jointTracks = {
    torso: {
      trackId: "torso",
      keyframes: [{ frame: 120, value: 0 }], // durationFrames is 90
    },
  };
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 8));
});

test("S-2 Negative Case 9: Rule 9 rejects non-ascending keyframe frames", () => {
  const scene = makeValidScene();
  scene.actors[0].jointTracks = {
    torso: {
      trackId: "torso",
      keyframes: [
        { frame: 30, value: 0 },
        { frame: 20, value: 10 }, // non-ascending
      ],
    },
  };
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 9));
});

test("S-2 Negative Case 10: Rule 10 rejects negative scale or opacity > 1", () => {
  const scene = makeValidScene();
  scene.actors[0].scale = -0.5;
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 10));
});

test("S-2 Negative Case 11: Rule 11 rejects non-existent svgSource file", () => {
  const scene = makeValidScene();
  scene.background.svgSource = "non/existent/path/bg.svg";
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 11));
});

test("S-2 Negative Case 12: Rule 12 rejects unknown actionId", () => {
  const scene = makeValidScene();
  scene.actors[0].actions = [
    {
      actionId: "backflip-360",
      startFrame: 0,
      durationFrames: 30,
      intensity: 1.0,
    },
  ];
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 12));
});

test("S-2 Negative Case 13: Rule 13 rejects action exceeding scene durationFrames", () => {
  const scene = makeValidScene();
  scene.actors[0].actions = [
    {
      actionId: "walk",
      startFrame: 60,
      durationFrames: 45, // 60 + 45 = 105 > 90
      intensity: 1.0,
    },
  ];
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 13));
});

test("S-2 Negative Case 14 (S-6): Rule 14 rejects audio mismatch > 50ms (51ms fail, 49ms pass)", () => {
  const scene = makeValidScene();
  // Duration: 90 frames @ 30fps = 3000ms
  // 51ms off -> audioDurationMs = 3051ms -> Rejected
  scene.audioDurationMs = 3051;
  const resFail = validateScene(scene);
  assert.equal(resFail.isValid, false);
  assert.ok(resFail.errors.some((e) => e.rule === 14));

  // 49ms off -> audioDurationMs = 3049ms -> Accepted
  scene.audioDurationMs = 3049;
  const resPass = validateScene(scene);
  assert.equal(resPass.isValid, true);
  assert.equal(resPass.errors.length, 0);
});

test("S-2 Negative Case 15 (S-7): Rule 15 rejects RotatingSubGroup specifying both or neither", () => {
  const scene = makeValidScene();
  // Both degreesPerSecond AND track -> Rejected
  scene.props[0].subGroups = [
    {
      elementId: "wheel-front",
      pivot: { x: 100, y: 100 },
      degreesPerSecond: 360,
      track: { trackId: "rot", keyframes: [{ frame: 0, value: 0 }] },
    },
  ];
  const resBoth = validateScene(scene);
  assert.equal(resBoth.isValid, false);
  assert.ok(resBoth.errors.some((e) => e.rule === 15));

  // Neither -> Rejected
  scene.props[0].subGroups = [
    {
      elementId: "wheel-front",
      pivot: { x: 100, y: 100 },
    },
  ];
  const resNeither = validateScene(scene);
  assert.equal(resNeither.isValid, false);
  assert.ok(resNeither.errors.some((e) => e.rule === 15));
});

test("S-2 Negative Case 16: Rule 16 rejects elementId not found in SVG document", () => {
  const scene = makeValidScene();
  scene.props[0].subGroups = [
    {
      elementId: "non-existent-subgroup-id",
      pivot: { x: 100, y: 100 },
      degreesPerSecond: 180,
    },
  ];
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 16));
});

test("S-2 Negative Case 17: Rule 17 rejects rigId missing ModelSheet", () => {
  // If an actor references a hypothetical rig without a ModelSheet
  const scene = makeValidScene();
  // Temporarily force an unknown rigId
  scene.actors[0].rigId = "unregistered-alien";
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 17));
});

test("S-2 Negative Case 18: Rule 18 rejects simultaneous action collision at same startFrame on shared joint", () => {
  const scene = makeValidScene();
  // Walk (affects legs, torso, leftArm, rightArm) and Wave (affects rightArm) both scheduled at startFrame = 0
  scene.actors[0].actions = [
    {
      actionId: "walk",
      startFrame: 0,
      durationFrames: 30,
      intensity: 1.0,
    },
    {
      actionId: "wave",
      startFrame: 0, // SAME startFrame, colliding on rightArm
      durationFrames: 30,
      intensity: 1.0,
      side: "right",
    },
  ];
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  const err = res.errors.find((e) => e.rule === 18);
  assert.ok(err, "Must trigger Rule 18 SIMULTANEOUS_ACTION_COLLISION");
  assert.ok(err.message.includes("rightArm"));
});

// S-5: Round-trip pure JSON serialization deep-equality
test("S-5: Round-trip JSON.parse(JSON.stringify(scene)) deep-equals original (pure data)", () => {
  const scene = makeValidScene();
  const serialized = JSON.stringify(scene);
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed, scene);
});

// S-8: Scale warning W1 produces warning and ZERO errors
test("S-8: Scale warning W1 produces warning and ZERO errors for outlier scale", () => {
  const scene = makeValidScene();
  // 3 actors: 2 humans at canonical 1.0, 1 human at 1.8x (+80% deviation from median 1.0)
  scene.actors = [
    {
      instanceId: "actor-1",
      rigId: "developer",
      position: { x: 300, y: 500 },
      scale: 1.0,
      facing: "right",
    },
    {
      instanceId: "actor-2",
      rigId: "developer",
      position: { x: 600, y: 500 },
      scale: 1.0,
      facing: "right",
    },
    {
      instanceId: "actor-giant",
      rigId: "developer",
      position: { x: 900, y: 500 },
      scale: 1.8, // 1.8 / 1.0 = 1.8 (+80% deviation from median 1.0)
      facing: "right",
    },
  ];
  const res = validateScene(scene);
  assert.equal(res.isValid, true, "Scene with scale warning must remain valid (zero errors)");
  assert.equal(res.errors.length, 0);
  assert.equal(res.warnings.length, 1);
  assert.equal(res.warnings[0].warningId, "W1_SCALE_DEVIATION");
  assert.equal(res.warnings[0].entityId, "actor-giant");
});

test("W1 Confirmation: Single-actor scene produces exactly ZERO warnings (median equals own scale)", () => {
  const scene = makeValidScene();
  scene.actors = [
    {
      instanceId: "actor-solo",
      rigId: "astronaut",
      position: { x: 960, y: 540 },
      scale: 2.5, // Extreme close-up solo shot
      facing: "right",
    },
  ];
  const res = validateScene(scene);
  assert.equal(res.isValid, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.warnings.length, 0, "Solo actor should produce 0 warnings regardless of absolute scale");
});

test("Rule 5 Confirmation: Absent layer is valid and permits D5 derived layer resolution", () => {
  const scene = makeValidScene();
  delete scene.actors[0].layer;
  delete scene.props[0].layer;
  const res = validateScene(scene);
  assert.equal(res.isValid, true);
  assert.equal(res.errors.length, 0);
});
