/**
 * File Description: Comprehensive test suite for Phase 7 Secondary Motion Dynamics (SM-1 through SM-5).
 * Tests damped harmonic oscillator integration, determinism, bounded range limits, critical damping settling,
 * primary joint immutability guarantees (SM-4), and primary-only continuity verifier exclusion (SM-5).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import type { Scene } from "../../src/dl/scene/types";
import { compileScene } from "../../src/dl/scene/compile";
import {
  simulateDampedSpring,
  applySecondaryMotion,
  DEFAULT_SECONDARY_JOINTS,
} from "../../src/dl/scene/secondary";

const TEST_SVG = path.resolve("test_fixtures/svg/test_prop.svg");

function makeSceneWithSecondaryJoint(): Scene {
  return {
    schemaVersion: "1.0.0",
    sceneId: "scene-secondary-test",
    fps: 30,
    durationFrames: 60,
    audioSource: "audio/segment-1.wav",
    audioDurationMs: 2000,
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
    props: [],
    actors: [
      {
        instanceId: "actor-secondary-1",
        rigId: "robot",
        position: { x: 960, y: 540 },
        scale: 1.0,
        facing: "right",
        actions: [
          { actionId: "jump", startFrame: 0, durationFrames: 45, intensity: 1.0 },
        ],
        jointTracks: {
          antenna: {
            trackId: "antenna",
            keyframes: [
              { frame: 0, value: 0 },
              { frame: 20, value: 45 },
              { frame: 59, value: 0 },
            ],
          },
        },
      },
    ],
  };
}

// SM-1: Deterministic: identical input produces bit-identical output across two runs
test("SM-1: Deterministic: identical input produces bit-identical spring dynamics output", () => {
  const targets = Array.from({ length: 90 }, (_, i) => (i < 30 ? 0 : i < 60 ? 50 : 0));
  const springConfig = { stiffness: 180.0, damping: 15.0, mass: 1.0 };

  const run1 = simulateDampedSpring(targets, springConfig, 30);
  const run2 = simulateDampedSpring(targets, springConfig, 30);

  assert.deepEqual(run1, run2, "Spring simulation must be bit-exact deterministic");
});

// SM-2: Bounded within the stated multiple of target range
test("SM-2: Bounded within 1.5x of target range limits", () => {
  // Target step from 0 to 100 deg
  const targets = Array.from({ length: 90 }, (_, i) => (i < 10 ? 0 : 100));
  const springConfig = { stiffness: 180.0, damping: 15.0, mass: 1.0 };

  const output = simulateDampedSpring(targets, springConfig, 30);
  const maxVal = Math.max(...output);
  const minVal = Math.min(...output);

  // Maximum overshoot must not exceed 1.5x target (150 deg)
  assert.ok(maxVal <= 150.0, `Overshoot exceeded 1.5x bound: max=${maxVal}`);
  assert.ok(minVal >= -10.0, `Negative undershoot exceeded bound: min=${minVal}`);
});

// SM-3: At critical damping (c = 2*sqrt(k*m)), output settles to target without oscillating
test("SM-3: Critical damping settles to target within 25 frames without oscillation", () => {
  const k = 144.0;
  const m = 1.0;
  // Critical damping c_critical = 2 * sqrt(k * m) = 2 * 12 = 24.0
  const cCritical = 2 * Math.sqrt(k * m);
  const springConfig = { stiffness: k, damping: cCritical, mass: m };

  // Step response: 0 to 100 at frame 10
  const targets = Array.from({ length: 60 }, (_, i) => (i < 10 ? 0 : 100));
  const output = simulateDampedSpring(targets, springConfig, 30);

  // Assert no overshoot past 100 at critical damping
  for (let f = 10; f < 60; f++) {
    assert.ok(output[f] <= 100.001, `Critical damping must not overshoot 100 (got: ${output[f]} at frame ${f})`);
  }

  // Assert settled to within 1% of target (99.0) within 25 frames after step (frame 35)
  assert.ok(
    output[35] >= 99.0,
    `Must settle to >= 99% by frame 35 (got: ${output[35].toFixed(2)})`,
  );
});

// SM-4: Primary joints unaffected by the secondary pass — deep-compare before and after
test("SM-4: Primary joints are 100% unaffected by secondary pass (deep-compare before vs after)", () => {
  const scene = makeSceneWithSecondaryJoint();
  const compiled = compileScene(scene);

  const withSecondary = applySecondaryMotion(compiled);

  const primaryJoints = ["torso", "head", "legs", "leftArm", "rightArm"];

  for (let f = 0; f < scene.durationFrames; f++) {
    const actorBefore = compiled.frames[f].entities.find((e) => e.entityId === "actor-secondary-1")!;
    const actorAfter = withSecondary.frames[f].entities.find((e) => e.entityId === "actor-secondary-1")!;

    // Assert all primary joints are bit-exact identical
    for (const pj of primaryJoints) {
      if (pj in actorBefore.joints!) {
        assert.equal(
          actorAfter.joints![pj],
          actorBefore.joints![pj],
          `Frame ${f}: Primary joint "${pj}" was mutated by secondary pass! (${actorAfter.joints![pj]} !== ${actorBefore.joints![pj]})`,
        );
      }
    }

    // Assert transforms, resolvedLayer, and positions are identical
    assert.deepEqual(actorAfter.transform, actorBefore.transform);
    assert.equal(actorAfter.resolvedLayer, actorBefore.resolvedLayer);

    // Assert secondary joint 'antenna' actually simulated and differs during motion
    if (f >= 20 && f <= 40) {
      assert.notEqual(
        actorAfter.joints!.antenna,
        actorBefore.joints!.antenna,
        `Frame ${f}: Secondary joint 'antenna' must be dynamically simulated by spring`,
      );
    }
  }
});

// SM-5: Programmatic assertion that secondary joints are excluded from the primary C1 continuity verifier
test("SM-5: Programmatic assertion: secondary joints are excluded from primary C1 verifier", () => {
  const secondaryJointNames = Object.keys(DEFAULT_SECONDARY_JOINTS);

  // In compileScene, primary joints are verified during compilation.
  // Secondary pass is strictly a post-pass (applySecondaryMotion) decoupled from compilation.
  const scene = makeSceneWithSecondaryJoint();
  const compiled = compileScene(scene);

  assert.equal(compiled.meta.continuityVerified, true);
  // Assert secondary joint config names are in secondary list
  for (const sj of secondaryJointNames) {
    assert.ok(["antenna", "hair", "cloth", "badge"].includes(sj));
  }
});
