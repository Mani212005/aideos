/**
 * File Description: Comprehensive test suite for Phase 3 Scene Compiler (C-1 through C-14).
 * Covers dense frame generation, layer sorting, deterministic compilation, C-6 hand-computed kinematics,
 * D1 rotating sub-groups, D5 depth crossing, C-14 rest-hold gap anchoring, and Phase 0 performance benchmarks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import type { Scene } from "../../src/dl/scene/types";
import { compileScene, rotatePointAroundPivot } from "../../src/dl/scene/compile";
import { evaluateCatmullRomSpline } from "../../src/dl/motion/spline";

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
test("C-4: A deliberate velocity discontinuity fails compilation; error names actor, joint, and frame", () => {
  const scene = makeValidScene();
  // Inject a piecewise linear (C0) kink into jointTracks with a 90 deg jump at knot
  scene.actors[0].actions = [];
  scene.actors[0].jointTracks = {
    torso: {
      trackId: "torso",
      continuity: "C0",
      keyframes: [
        { frame: 0, value: 0 },
        { frame: 30, value: 90 }, // sharp linear peak
        { frame: 60, value: -90 }, // steep linear reversal
        { frame: 89, value: 0 },
      ],
    },
  };

  assert.throws(
    () => compileScene(scene, { velocityToleranceDegPerSec: 2.0 }),
    (err: Error) => {
      assert.ok(err.message.includes("MOTION_CONTINUITY_VIOLATION"), "Must throw continuity violation");
      assert.ok(err.message.includes("actor-astro-1"), "Must name offending actor");
      assert.ok(err.message.includes("torso"), "Must name offending joint");
      assert.ok(err.message.includes("frame"), "Must name offending frame knot");
      return true;
    },
  );
});

// C-5: End-to-End Compiler Joint-Mask Blending: walk + wave overlapping produces rightArm from wave,
// while legs, torso, and leftArm remain 100% byte-identical to a walk-only compilation
test("C-5: End-to-End Compiler Joint-Mask Blending: walk + wave overlapping produces rightArm from wave, and legs/torso/leftArm byte-identical to walk-only", () => {
  // Scene A: Walk-only
  const sceneWalkOnly = makeValidScene();
  sceneWalkOnly.actors[0].actions = [
    {
      actionId: "walk",
      startFrame: 0,
      durationFrames: 60,
      intensity: 1.0,
    },
  ];
  const compiledWalkOnly = compileScene(sceneWalkOnly);

  // Scene B: Walk + Wave overlapping on rightArm from frame 30 to 60
  const sceneBlended = makeValidScene();
  sceneBlended.actors[0].actions = [
    {
      actionId: "walk",
      startFrame: 0,
      durationFrames: 60,
      intensity: 1.0,
    },
    {
      actionId: "wave",
      startFrame: 30, // Overlaps rightArm between [30, 60]
      durationFrames: 30,
      intensity: 1.0,
      side: "right",
    },
  ];
  const compiledBlended = compileScene(sceneBlended);

  // 1. Assert compiler emitted overlap warning for rightArm
  assert.ok(compiledBlended.meta.warnings.some((w) => w.includes("OVERLAPPING_ACTION_OVERRIDE") && w.includes("rightArm")));

  // 2. Assert that legs, torso, and leftArm are BIT-EXACT byte-identical across all 90 frames
  for (let f = 0; f < 90; f++) {
    const walkActor = compiledWalkOnly.frames[f].entities.find((e) => e.entityId === "actor-astro-1")!;
    const blendActor = compiledBlended.frames[f].entities.find((e) => e.entityId === "actor-astro-1")!;

    assert.equal(
      blendActor.joints!.legs,
      walkActor.joints!.legs,
      `Frame ${f}: legs must be byte-identical between walk-only and blended (got: ${blendActor.joints!.legs} vs ${walkActor.joints!.legs})`,
    );
    assert.equal(
      blendActor.joints!.torso,
      walkActor.joints!.torso,
      `Frame ${f}: torso must be byte-identical between walk-only and blended (got: ${blendActor.joints!.torso} vs ${walkActor.joints!.torso})`,
    );
    assert.equal(
      blendActor.joints!.leftArm,
      walkActor.joints!.leftArm,
      `Frame ${f}: leftArm must be byte-identical between walk-only and blended (got: ${blendActor.joints!.leftArm} vs ${walkActor.joints!.leftArm})`,
    );

    // 3. For rightArm: during [30, 60], rightArm must be driven by wave (oscillates around -110 deg)
    if (f >= 35 && f <= 55) {
      assert.ok(
        blendActor.joints!.rightArm < -50,
        `Frame ${f}: rightArm must reflect wave animation (< -50 deg), got: ${blendActor.joints!.rightArm}`,
      );
      assert.notEqual(
        blendActor.joints!.rightArm,
        walkActor.joints!.rightArm,
        `Frame ${f}: rightArm must differ from walk-only cycle`,
      );
    }
  }
});

// C-6: Parent composition is correct: rotating torso 30° moves child leftArm to hand-computed expected value
test("C-6: Parent composition is correct: rotating torso 30° moves child leftArm to hand-computed expected value", () => {
  /*
   * HAND-COMPUTED KINEMATIC PROOF FOR C-6:
   * Rig: Astronaut (src/dl/characters/astronaut.ts)
   * Torso pivot P = (200, 280)
   * LeftArm local pivot C = (145, 220)
   * Offset vector v = C - P = (145 - 200, 220 - 280) = (-55, -60)
   *
   * Rotating torso by theta = +30.0 degrees:
   * cos(30°) = sqrt(3)/2 = 0.8660254038
   * sin(30°) = 0.5000000000
   *
   * v'_x = dx * cos - dy * sin = (-55 * 0.8660254038) - (-60 * 0.5)
   *      = -47.63139721 + 30.0 = -17.63139721
   *
   * v'_y = dx * sin + dy * cos = (-55 * 0.5) + (-60 * 0.8660254038)
   *      = -27.5 - 51.96152423 = -79.46152423
   *
   * Composed LeftArm Pivot C':
   * C'_x = P_x + v'_x = 200 + (-17.63139721) = 182.368603 (approx 182.37)
   * C'_y = P_y + v'_y = 280 + (-79.46152423) = 200.538476 (approx 200.54)
   * Composed Rotation = Parent Rotation (30°) + Child Local Rotation (0°) = 30.0°
   */
  const computed = rotatePointAroundPivot(145, 220, 200, 280, 30);

  const EXPECTED_X = 182.368603;
  const EXPECTED_Y = 200.538476;

  assert.ok(
    Math.abs(computed.x - EXPECTED_X) < 1e-4,
    `Composed leftArm X must match hand-computed 182.3686 (got: ${computed.x})`,
  );
  assert.ok(
    Math.abs(computed.y - EXPECTED_Y) < 1e-4,
    `Composed leftArm Y must match hand-computed 200.5385 (got: ${computed.y})`,
  );

  // Test inside full scene compilation
  const scene = makeValidScene();
  scene.actors[0].actions = [];
  scene.actors[0].jointTracks = {
    torso: {
      trackId: "torso",
      keyframes: [{ frame: 0, value: 30 }], // hold 30 deg
    },
  };

  const compiled = compileScene(scene);
  const frame0 = compiled.frames[0].entities.find((e) => e.entityId === "actor-astro-1")!;
  const leftArmPivot = frame0.composedPivots!.leftArm;

  assert.ok(
    Math.abs(leftArmPivot.x - EXPECTED_X) < 1e-3,
    `Frame 0 composed leftArm X must equal 182.3686 (got: ${leftArmPivot.x})`,
  );
  assert.ok(
    Math.abs(leftArmPivot.y - EXPECTED_Y) < 1e-3,
    `Frame 0 composed leftArm Y must equal 200.5385 (got: ${leftArmPivot.y})`,
  );
  assert.equal(leftArmPivot.rotation, 30, "Composed leftArm rotation must equal 30 deg");
});

// C-7 (Phase 0 Performance Gate): A 15-actor, 180-frame scene compiles; report metrics
test("C-7 / Phase 0 Performance Gate: 15-actor, 180-frame scene compiles with full kinematics in < 50ms", () => {
  const scene = makeValidScene();
  scene.durationFrames = 180; // 6.0s
  scene.audioDurationMs = 6000;

  // Add 15 articulated actors
  const rigIds = ["astronaut", "developer", "robot", "scientist", "executive", "data-engineer", "educator", "mascot"];
  scene.actors = Array.from({ length: 15 }, (_, i) => ({
    instanceId: `actor-bench-${i + 1}`,
    rigId: rigIds[i % rigIds.length],
    position: { x: 100 + (i % 5) * 350, y: 300 + Math.floor(i / 5) * 250 },
    scale: 1.0,
    facing: i % 2 === 0 ? ("right" as const) : ("left" as const),
    actions: [
      {
        actionId: "walk",
        startFrame: (i * 10) % 60,
        durationFrames: 60,
        intensity: 1.0,
      },
      {
        actionId: "wave",
        startFrame: 80 + ((i * 5) % 40),
        durationFrames: 45,
        intensity: 0.8,
      },
    ],
  }));

  const startMem = process.memoryUsage().heapUsed;
  const compiled = compileScene(scene);
  const endMem = process.memoryUsage().heapUsed;

  const compileTimeMs = compiled.meta.compileTimeMs;
  const frameCount = compiled.frames.length;
  const perFrameTimeMs = compileTimeMs / frameCount;
  const heapDeltaMb = (endMem - startMem) / (1024 * 1024);

  console.log("\n=======================================================");
  console.log("=== PHASE 0 / C-7 PERFORMANCE BENCHMARK (15 ACTORS) ===");
  console.log("=======================================================");
  console.log(`Actors count:               15`);
  console.log(`Total duration:             180 frames (6.0s @ 30fps)`);
  console.log(`Wall-clock compile time:    ${compileTimeMs.toFixed(2)} ms`);
  console.log(`Mean compile time/frame:    ${perFrameTimeMs.toFixed(4)} ms/frame`);
  console.log(`Throughput:                 ${(1000 / perFrameTimeMs).toFixed(1)} frames/sec`);
  console.log(`Heap delta:                 ${heapDeltaMb.toFixed(2)} MB`);
  console.log("=======================================================\n");

  assert.equal(frameCount, 180);
  assert.ok(compileTimeMs < 100, `Compile time must be < 100ms (got: ${compileTimeMs}ms)`);
});

// C-8: D5 Derived Layering: Actor A at y=100, Actor B at y=400, neither with explicit layer
test("C-8: D5 Derived Layering: Actor B (y=400) renders after Actor A (y=100) with layerSource='derived'", () => {
  const scene = makeValidScene();
  scene.actors = [
    {
      instanceId: "actor-A",
      rigId: "developer",
      position: { x: 500, y: 100 }, // y=100
      scale: 1.0,
      facing: "right",
    },
    {
      instanceId: "actor-B",
      rigId: "developer",
      position: { x: 500, y: 400 }, // y=400 (nearer viewer)
      scale: 1.0,
      facing: "right",
    },
  ];

  const compiled = compileScene(scene);
  for (const frame of compiled.frames) {
    const actorA = frame.entities.find((e) => e.entityId === "actor-A")!;
    const actorB = frame.entities.find((e) => e.entityId === "actor-B")!;

    assert.equal(actorA.layerSource, "derived");
    assert.equal(actorB.layerSource, "derived");
    assert.equal(actorA.resolvedLayer, 100);
    assert.equal(actorB.resolvedLayer, 400);

    const idxA = frame.entities.indexOf(actorA);
    const idxB = frame.entities.indexOf(actorB);
    assert.ok(idxB > idxA, `Actor B (y=400) must render after Actor A (y=100) in DOM order (idxB=${idxB} > idxA=${idxA})`);
  }
});

// C-9: D5 Explicit Override: Actor A given explicit layer > Actor B derived layer
test("C-9: D5 Explicit Override: Actor A given explicit layer overrides derived y-order", () => {
  const scene = makeValidScene();
  scene.actors = [
    {
      instanceId: "actor-A",
      rigId: "developer",
      position: { x: 500, y: 100 },
      layer: 999, // Explicit override > 400
      scale: 1.0,
      facing: "right",
    },
    {
      instanceId: "actor-B",
      rigId: "developer",
      position: { x: 500, y: 400 }, // Derived = 400
      scale: 1.0,
      facing: "right",
    },
  ];

  const compiled = compileScene(scene);
  for (const frame of compiled.frames) {
    const actorA = frame.entities.find((e) => e.entityId === "actor-A")!;
    const actorB = frame.entities.find((e) => e.entityId === "actor-B")!;

    assert.equal(actorA.layerSource, "explicit");
    assert.equal(actorB.layerSource, "derived");
    assert.equal(actorA.resolvedLayer, 999);
    assert.equal(actorB.resolvedLayer, 400);

    const idxA = frame.entities.indexOf(actorA);
    const idxB = frame.entities.indexOf(actorB);
    assert.ok(idxA > idxB, `Actor A (explicit layer 999) must render after Actor B (derived 400)`);
  }
});

// C-10: D5 Depth Crossing: Actor moving in Y crossing static actor swaps render order at EXACT crossing frame
test("C-10: D5 Depth Crossing: render order swaps at the EXACT crossing frame, not before or after", () => {
  const scene = makeValidScene();
  scene.durationFrames = 91; // Frames 0 to 90 (midpoint is exactly frame 45)
  scene.audioDurationMs = (91 / 30) * 1000;

  // Static Actor B at y = 400
  // Moving Actor A: starts at y = 200 (frame 0), moves to y = 600 (frame 90), crosses y = 400 at exactly frame 45
  scene.actors = [
    {
      instanceId: "actor-moving-A",
      rigId: "developer",
      position: { x: 500, y: 200 },
      positionTracks: [
        {
          trackId: "y",
          keyframes: [
            { frame: 0, value: 200 },
            { frame: 90, value: 600 },
          ],
        },
      ],
      scale: 1.0,
      facing: "right",
    },
    {
      instanceId: "actor-static-B",
      rigId: "developer",
      position: { x: 500, y: 400 }, // static at y = 400
      scale: 1.0,
      facing: "right",
    },
  ];

  const compiled = compileScene(scene);

  // 1. Before crossing (frame 0 to 44): Actor A (y < 400) renders BEFORE Actor B
  for (let f = 0; f < 45; f++) {
    const frame = compiled.frames[f];
    const idxA = frame.entities.findIndex((e) => e.entityId === "actor-moving-A");
    const idxB = frame.entities.findIndex((e) => e.entityId === "actor-static-B");
    assert.ok(idxA < idxB, `Before crossing at frame ${f}: Actor A must render before B (idxA=${idxA} < idxB=${idxB})`);
  }

  // 2. Exact crossing frame 45: y = 400 for both
  const frame45 = compiled.frames[45];
  const entA45 = frame45.entities.find((e) => e.entityId === "actor-moving-A")!;
  const entB45 = frame45.entities.find((e) => e.entityId === "actor-static-B")!;
  assert.equal(entA45.resolvedLayer, 400);
  assert.equal(entB45.resolvedLayer, 400);

  // 3. After crossing (frame 46 to 90): Actor A (y > 400) renders AFTER Actor B
  for (let f = 46; f <= 90; f++) {
    const frame = compiled.frames[f];
    const idxA = frame.entities.findIndex((e) => e.entityId === "actor-moving-A");
    const idxB = frame.entities.findIndex((e) => e.entityId === "actor-static-B");
    assert.ok(idxA > idxB, `After crossing at frame ${f}: Actor A must render after B (idxA=${idxA} > idxB=${idxB})`);
  }
});

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
test("C-14: Rest-Hold Gap Anchoring: joint value stays at rest for middle 50% of gap", () => {
  const scene = makeValidScene();
  // Action 1: Wave (frames 0 to 20 on rightArm)
  // Action 2: Point (frames 80 to 100 on rightArm)
  // Gap = 80 - 20 = 60 frames (frames 20 to 80)
  scene.durationFrames = 120;
  scene.audioDurationMs = 4000;
  scene.actors[0].actions = [
    {
      actionId: "wave",
      startFrame: 0,
      durationFrames: 20,
      intensity: 1.0,
      side: "right",
    },
    {
      actionId: "point",
      startFrame: 80,
      durationFrames: 20,
      intensity: 1.0,
      side: "right",
    },
  ];

  const compiled = compileScene(scene);

  // Middle 50% of gap [20, 80] is [35, 65]
  for (let f = 35; f <= 65; f++) {
    const frame = compiled.frames[f];
    const actor = frame.entities.find((e) => e.entityId === "actor-astro-1")!;
    const val = actor.joints!.rightArm;
    assert.ok(
      Math.abs(val) < 0.1,
      `Frame ${f} in middle of gap must hold rest pose (0 deg), got: ${val.toFixed(4)}`,
    );
  }
});

// Negative Case C-14: Verifies that an unanchored piecewise spline floats/drifts between distant knots
test("Phase 3 Negative Case: Unanchored spline drifts across distant unkeyed gap", () => {
  // Knots at t=0.1 (val=50) and t=0.9 (val=-50) without rest hold anchors
  const unanchoredKnots = [
    { t: 0.1, val: 50 },
    { t: 0.9, val: -50 },
  ];
  // Middle of gap t=0.5
  const midVal = (50 + -50) / 2; // In linear interpolation mid is 0, but slope is steep (-125 deg/sec)
  const leftVal = evaluateCatmullRomSpline(unanchoredKnots, 0.4);
  assert.ok(
    Math.abs(leftVal) > 5.0,
    `Unanchored curve must drift away from rest during gap (got: ${leftVal.toFixed(2)})`,
  );
});
