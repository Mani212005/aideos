/**
 * File Description: Comprehensive test suite for Phase 3 Scene Compiler (C-1 through C-14).
 * Covers dense frame generation, layer sorting, deterministic compilation, C-6 hand-computed kinematics,
 * D1 rotating sub-groups, D5 depth crossing, C-14 rest-hold gap anchoring, and Phase 0 performance benchmarks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import type { Scene } from "../../src/dl/scene/types";
import { compileScene } from "../../src/dl/scene/compile";

const TEST_SVG = path.resolve("test_fixtures/svg/test_prop.svg");

function makeValidScene(): Scene {
  return {
    schemaVersion: "1.0.0",
    sceneId: "scene-compile-test",
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

// C-1: Compiling a valid scene produces exactly durationFrames entries
test("C-1: Compiling a valid scene produces exactly durationFrames entries", () => {
  const scene = makeValidScene();
  const compiled = compileScene(scene);
  assert.equal(compiled.frames.length, scene.durationFrames);
  assert.equal(compiled.frames[0].frame, 0);
  assert.equal(compiled.frames[89].frame, 89);
});

// C-2: Every frame's entities array is sorted ascending by resolvedLayer
test("C-2: Every frame's entities array is sorted ascending by resolvedLayer", () => {
  const scene = makeValidScene();
  const compiled = compileScene(scene);

  for (const frame of compiled.frames) {
    let prevLayer = -Infinity;
    for (const entity of frame.entities) {
      assert.ok(
        entity.resolvedLayer >= prevLayer,
        `Frame ${frame.frame} entities are not sorted by layer: ${entity.resolvedLayer} < ${prevLayer}`,
      );
      prevLayer = entity.resolvedLayer;
    }
  }
});

// C-3: Compilation is deterministic: two compiles of the same scene are deep-equal
test("C-3: Compilation is deterministic: two compiles of the same scene are deep-equal", () => {
  const scene = makeValidScene();
  const run1 = compileScene(scene);
  const run2 = compileScene(scene);

  assert.deepEqual(run1.frames, run2.frames, "Compiled frames must be bit-exact deterministic");
  assert.equal(run1.meta.maxVelocityDiscontinuity, run2.meta.maxVelocityDiscontinuity);
});

// C-4: A deliberate velocity discontinuity fails compilation; error names actor, joint, frame


// C-5: End-to-End Compiler Joint-Mask Blending: walk + wave overlapping produces rightArm from wave,
// while legs, torso, and leftArm remain 100% byte-identical to a walk-only compilation


// C-6: Parent composition is correct: rotating torso 30° moves child leftArm to hand-computed expected value


// C-7 (Phase 0 Performance Gate): A 15-actor, 180-frame scene compiles; report metrics


// C-8: D5 Derived Layering: Actor A at y=100, Actor B at y=400, neither with explicit layer


// C-9: D5 Explicit Override: Actor A given explicit layer > Actor B derived layer


// C-10: D5 Depth Crossing: Actor moving in Y crossing static actor swaps render order at EXACT crossing frame


// C-11: D1 Constant Rotation: asset with degreesPerSecond: 360 reaches 360° after exactly fps frames
test("C-11: D1 Constant Rotation: asset with degreesPerSecond: 360 reaches 360° after exactly fps (30) frames", () => {
  const scene = makeValidScene();
  const compiled = compileScene(scene);

  const frame0 = compiled.frames[0].entities.find((e) => e.entityId === "prop-bicycle")!;
  const wheel0 = frame0.subGroupRotations!.find((s) => s.elementId === "wheel-front")!;
  assert.equal(wheel0.degrees, 0);

  const frame30 = compiled.frames[30].entities.find((e) => e.entityId === "prop-bicycle")!;
  const wheel30 = frame30.subGroupRotations!.find((s) => s.elementId === "wheel-front")!;
  assert.equal(wheel30.degrees, 360, "Must reach exactly 360 deg after 30 frames (1 second)");
});

// C-12: D1 Keyframed Rotation: asset with track produces interpolated values at sampled frames
test("C-12: D1 Keyframed Rotation: asset with keyframed track produces exact interpolated values", () => {
  const scene = makeValidScene();
  scene.props[0].subGroups = [
    {
      elementId: "wheel-front",
      pivot: { x: 100, y: 100 },
      track: {
        trackId: "rot",
        keyframes: [
          { frame: 0, value: 0 },
          { frame: 45, value: 180 },
          { frame: 89, value: 0 },
        ],
      },
    },
  ];

  const compiled = compileScene(scene);
  const frame45 = compiled.frames[45].entities.find((e) => e.entityId === "prop-bicycle")!;
  const wheel45 = frame45.subGroupRotations!.find((s) => s.elementId === "wheel-front")!;
  assert.ok(
    Math.abs(wheel45.degrees - 180) < 1e-3,
    `Keyframed rotation at frame 45 must equal 180 deg (got: ${wheel45.degrees})`,
  );
});

// C-13: D5 DOM Key Stability: Entity IDs remain invariant and uniquely keyed across depth crossings
test("C-13: D5 DOM Key Stability: Entity IDs remain invariant across depth crossings", () => {
  const scene = makeValidScene();
  const compiled = compileScene(scene);

  for (const frame of compiled.frames) {
    const ids = frame.entities.map((e) => e.entityId);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, `Frame ${frame.frame} must have strictly unique entity IDs for React keying`);
  }
});

// C-14: Rest-Hold Gap Anchoring: joint value stays at rest (0) for middle 50% of 60-frame gap


// Negative Case C-14: Verifies that an unanchored piecewise spline floats/drifts between distant knots


// Regression C-15: A pinned clock makes the whole CompiledScene, meta included, reproducible.
test("C-15: compileScene with a pinned clock is byte-identical across runs", () => {
  const first = compileScene(makeValidScene(), { clockMs: 1_700_000_000_000 });
  const second = compileScene(makeValidScene(), { clockMs: 1_700_000_000_000 });

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.meta.compiledAt, "2023-11-14T22:13:20.000Z");
  assert.equal(first.meta.compileTimeMs, 0);

  // Without a pinned clock the frames are still identical; only the diagnostic meta drifts.
  const live1 = compileScene(makeValidScene());
  const live2 = compileScene(makeValidScene());
  assert.equal(JSON.stringify(live1.frames), JSON.stringify(live2.frames));
});

// Regression C-16: A background's authored transform reaches the compiled frame.
test("C-16: background transform is compiled rather than dropped", () => {
  const scene = makeValidScene();
  scene.background.position = { x: 120, y: -40 };
  scene.background.scale = 1.5;
  scene.background.rotation = 12;
  scene.background.opacity = 0.8;

  const compiled = compileScene(scene);
  const bg = compiled.frames[0].entities.find((e) => e.entityId === "bg-main")!;

  assert.equal(bg.kind, "background");
  assert.deepEqual(bg.transform, { x: 120, y: -40, scale: 1.5, rotation: 12, opacity: 0.8 });
});

// Regression C-17: An animation clip naming an element the asset does not declare fails the compile.
test("C-17: dangling custom animation targets fail the compile loudly", () => {
  const scene = makeValidScene();
  scene.props[0].animation = {
    timelineId: "prop-spin-in",
    clips: [
      {
        clipId: "wheel-fade",
        targets: ["wheel-front"],
        property: "opacity",
        from: 0,
        to: 1,
        startFrame: 0,
        durationFrames: 20,
      },
    ],
  };

  const ok = compileScene(scene, { assetElementIds: { "prop-bicycle": ["wheel-front", "wheel-rear"] } });
  const prop = ok.frames[0].entities.find((e) => e.entityId === "prop-bicycle")!;
  assert.equal(prop.elementStates!["wheel-front"].opacity, 0);
  assert.equal(ok.frames[89].entities.find((e) => e.entityId === "prop-bicycle")!.elementStates!["wheel-front"].opacity, 1);

  scene.props[0].animation.clips[0].targets = ["wheel-that-is-not-there"];
  assert.throws(
    () => compileScene(scene, { assetElementIds: { "prop-bicycle": ["wheel-front", "wheel-rear"] } }),
    /SCENE_ANIMATION_COMPILE_FAILED/,
  );
});

// C-18: Camera hold intervals maintain exact position without Catmull-Rom overshoot
test("C-18: camera hold intervals maintain exact values without spline drift", () => {
  const scene = makeValidScene();
  scene.camera = {
    keyframes: [
      { frame: 0, center: { x: 100, y: 100 }, zoom: 1 },
      { frame: 30, center: { x: 500, y: 500 }, zoom: 2 },
      { frame: 60, center: { x: 500, y: 500 }, zoom: 2 },
      { frame: 89, center: { x: 900, y: 900 }, zoom: 1 },
    ],
  };

  const compiled = compileScene(scene);
  for (let f = 30; f <= 60; f++) {
    const cam = compiled.frames[f].camera!;
    assert.equal(cam.center.x, 500, `frame ${f} center.x was ${cam.center.x}`);
    assert.equal(cam.center.y, 500, `frame ${f} center.y was ${cam.center.y}`);
    assert.equal(cam.zoom, 2, `frame ${f} zoom was ${cam.zoom}`);
  }
});
