/**
 * File Description: Comprehensive test suite for Phase 1 Scene Graph Data Model.
 * Verifies the valid scene, pure JSON round-trip serialization, and the negative cases for the validation rules covered here (rules 1, 11, 14, 15, 16 and 21).
 * Inputs and outputs: scene data models and validation rules -> test assertions.
 * Used by: npm test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import type { Scene } from "../../src/dl/scene/types";
import { validateSceneWithNodeAssets as validateScene } from "./validateSceneNode";

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
    actors: [],
  };
}

// S-1: A valid scene produces zero errors
test("S-1: A valid scene produces zero errors", () => {
  const scene = makeValidScene();
  const res = validateScene(scene);
  assert.equal(res.isValid, true);
  assert.equal(res.errors.length, 0, `Expected 0 errors, got: ${JSON.stringify(res.errors)}`);
});

test("Scene actors fail explicitly because character rigs are not rendered", () => {
  const scene = makeValidScene();
  scene.props[0].svgSource = "";
  scene.actors = [{ instanceId: "courier", rigId: "anime-courier", position: { x: 960, y: 540 }, scale: 1, facing: "right" }];
  const result = validateScene(scene);
  assert.equal(result.isValid, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].entityId, "courier");
  assert.match(result.errors[0].message, /Actor "courier" cannot be rendered/);
  assert.match(result.errors[0].message, /character rigs are not supported/);
  assert.match(result.errors[0].message, /SVG backgrounds and props only/);
});

// S-2: Negative cases for the validation rules that this suite covers
test("S-2 Negative Case 1: Rule 1 rejects unsupported schemaVersion", () => {
  const scene = makeValidScene();
  scene.schemaVersion = "2.0.0";
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 1));
});

test("Scene with more than 15 actors still fails on unsupported character rigs", () => {
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
  assert.equal(res.errors.length, 16);
  assert.ok(res.errors.every((e) => e.rule === 21));
});

test("S-2 Negative Case 3: Unsupported actor validation names the actor", () => {
  const scene = makeValidScene();
  scene.actors.push({
    instanceId: "actor-astro-1",
    rigId: "developer",
    position: { x: 500, y: 500 },
    scale: 1.0,
    facing: "right",
  });
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  const err = res.errors.find((e) => e.rule === 21);
  assert.ok(err);
  assert.equal(err.entityId, "actor-astro-1");
});

test("S-2 Negative Case 11: Rule 11 rejects non-existent svgSource file", () => {
  const scene = makeValidScene();
  scene.background.svgSource = "non/existent/path/bg.svg";
  const res = validateScene(scene);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((e) => e.rule === 11));
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

// S-5: Round-trip pure JSON serialization deep-equality
test("S-5: Round-trip JSON.parse(JSON.stringify(scene)) deep-equals original (pure data)", () => {
  const scene = makeValidScene();
  const serialized = JSON.stringify(scene);
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed, scene);
});

test("Single solo actor scene fails with exactly one unsupported character rig error", () => {
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
  assert.equal(res.isValid, false);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0].message, /character rigs are not supported/);
});

test("Rule 5 Confirmation: Absent layer is valid and permits D5 derived layer resolution", () => {
  const scene = makeValidScene();
  delete scene.props[0].layer;
  const res = validateScene(scene);
  assert.equal(res.isValid, true);
  assert.equal(res.errors.length, 0);
});
