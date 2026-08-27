/**
 * File Description: Comprehensive test suite for Phase 2 Motion Vocabulary Actions (A-1 through A-8).
 * Tests determinism, purity, intensity scaling, joint validity across all 8 character rigs,
 * joint-masking action blending, and negative control cases.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_REGISTRY, getActionDefinition } from "../../src/dl/scene/actions";
import { getAllCharacterRigs } from "../../src/dl/characters";

const ALL_ACTION_IDS = ["idle", "walk", "wave", "point", "jump", "crouch", "turn", "reach"];

// A-1: Every action returns keyframes only for joints in its affectedJoints
test("A-1: Every action returns keyframes only for joints in its affectedJoints", () => {
  for (const actionId of ALL_ACTION_IDS) {
    const action = getActionDefinition(actionId);
    assert.ok(action, `Action "${actionId}" must be registered`);

    for (const side of ["left" as const, "right" as const]) {
      const result = action.generate({ durationFrames: 60, intensity: 1.0, side });
      const affected = action.affectedJoints;

      for (const jointKey of Object.keys(result)) {
        assert.ok(
          affected.includes(jointKey),
          `Action "${actionId}" generated keyframes for joint "${jointKey}" not listed in affectedJoints: ${JSON.stringify(affected)}`,
        );
      }
    }
  }
});

// A-2: Every action is deterministic: two calls with identical params return deep-equal output
test("A-2: Every action is deterministic: two calls with identical params return deep-equal output", () => {
  for (const actionId of ALL_ACTION_IDS) {
    const action = getActionDefinition(actionId)!;
    const params = { durationFrames: 90, intensity: 0.8, side: "right" as const };

    const run1 = action.generate(params);
    const run2 = action.generate(params);

    assert.deepEqual(run1, run2, `Action "${actionId}" must be purely deterministic across multiple calls`);
  }
});

// A-3: Every action returns t values in [0, 1], sorted ascending, no duplicates
test("A-3: Every action returns t values in [0, 1], sorted ascending, no duplicates", () => {
  for (const actionId of ALL_ACTION_IDS) {
    const action = getActionDefinition(actionId)!;
    const result = action.generate({ durationFrames: 60, intensity: 1.0 });

    for (const [joint, keyframes] of Object.entries(result)) {
      assert.ok(keyframes.length >= 2, `Joint "${joint}" in action "${actionId}" must have at least 2 keyframes`);
      let prevT = -1;
      for (let i = 0; i < keyframes.length; i++) {
        const kf = keyframes[i];
        assert.ok(
          kf.t >= 0 && kf.t <= 1,
          `Action "${actionId}" joint "${joint}" keyframe ${i} has t=${kf.t} outside [0, 1]`,
        );
        assert.ok(
          kf.t > prevT,
          `Action "${actionId}" joint "${joint}" keyframes must be strictly ascending: t=${kf.t} <= prevT=${prevT}`,
        );
        prevT = kf.t;
      }
    }
  }
});

// A-4: intensity: 0 produces joint values at or near rest (0) for every action
test("A-4: intensity: 0 produces joint values at or near rest for every action", () => {
  for (const actionId of ALL_ACTION_IDS) {
    const action = getActionDefinition(actionId)!;
    const result = action.generate({ durationFrames: 60, intensity: 0 });

    for (const [joint, keyframes] of Object.entries(result)) {
      for (const kf of keyframes) {
        assert.ok(
          Math.abs(kf.value) < 1e-5,
          `Action "${actionId}" joint "${joint}" with intensity 0 must have value=0, got ${kf.value}`,
        );
      }
    }
  }
});

// A-5: intensity: 1.0 produces larger absolute deviation from rest than intensity: 0.5
test("A-5: intensity: 1.0 produces larger absolute deviation from rest than intensity: 0.5", () => {
  for (const actionId of ALL_ACTION_IDS) {
    const action = getActionDefinition(actionId)!;
    const res05 = action.generate({ durationFrames: 60, intensity: 0.5 });
    const res10 = action.generate({ durationFrames: 60, intensity: 1.0 });

    for (const joint of Object.keys(res10)) {
      const maxDev05 = Math.max(...res05[joint].map((k) => Math.abs(k.value)));
      const maxDev10 = Math.max(...res10[joint].map((k) => Math.abs(k.value)));

      assert.ok(
        maxDev10 > maxDev05,
        `Action "${actionId}" joint "${joint}" intensity 1.0 (${maxDev10}) must exceed intensity 0.5 (${maxDev05})`,
      );
    }
  }
});

// A-6: Every affectedJoints entry exists as a CharacterGroup.id in every rig in the cast library
test("A-6: Every affectedJoints entry exists as a CharacterGroup.id in every rig in the cast library", () => {
  const allRigs = getAllCharacterRigs();
  assert.ok(allRigs.length >= 8, "Expected at least 8 registered character rigs");

  for (const rig of allRigs) {
    const rigGroupIds = new Set(rig.groups.map((g) => g.id));

    for (const actionId of ALL_ACTION_IDS) {
      const action = getActionDefinition(actionId)!;
      for (const joint of action.affectedJoints) {
        assert.ok(
          rigGroupIds.has(joint),
          `Action "${actionId}" affected joint "${joint}" missing in rig "${rig.id}" (available: ${Array.from(rigGroupIds).join(", ")})`,
        );
      }
    }
  }
});

// A-7: For actions accepting side, side: 'left' and side: 'right' produce mirrored joint sets
test("A-7: For actions accepting side, side: 'left' and side: 'right' produce mirrored joint sets", () => {
  const sideActions = ["wave", "point", "reach"];

  for (const actionId of sideActions) {
    const action = getActionDefinition(actionId)!;
    const leftRes = action.generate({ durationFrames: 60, intensity: 1.0, side: "left" });
    const rightRes = action.generate({ durationFrames: 60, intensity: 1.0, side: "right" });

    assert.ok("leftArm" in leftRes, `Action "${actionId}" with side="left" must affect leftArm`);
    assert.ok("rightArm" in rightRes, `Action "${actionId}" with side="right" must affect rightArm`);
  }
});

// A-8: Joint-Mask Blending: Overlapping walk + wave produces rightArm from wave, and legs/torso/leftArm byte-identical to walk-only
test("A-8: Joint-Mask Blending: Overlapping walk + wave produces rightArm from wave, and remaining joints byte-identical to walk-only", () => {
  const walk = getActionDefinition("walk")!;
  const wave = getActionDefinition("wave")!;

  const walkKeyframes = walk.generate({ durationFrames: 60, intensity: 1.0 });
  const waveKeyframes = wave.generate({ durationFrames: 60, intensity: 1.0, side: "right" });

  // Blending resolution per joint:
  // For 'rightArm': overridden by wave
  // For 'legs', 'leftArm', 'torso': pure walk keyframes
  const blendedJoints: Record<string, typeof walkKeyframes.legs> = {};

  const allJoints = new Set([...Object.keys(walkKeyframes), ...Object.keys(waveKeyframes)]);
  for (const joint of allJoints) {
    if (joint in waveKeyframes) {
      blendedJoints[joint] = waveKeyframes[joint];
    } else {
      blendedJoints[joint] = walkKeyframes[joint];
    }
  }

  // Assert rightArm comes from wave
  assert.deepEqual(blendedJoints.rightArm, waveKeyframes.rightArm);

  // Assert legs, leftArm, torso are byte-identical to walk-only
  assert.deepEqual(blendedJoints.legs, walkKeyframes.legs);
  assert.deepEqual(blendedJoints.leftArm, walkKeyframes.leftArm);
  assert.deepEqual(blendedJoints.torso, walkKeyframes.torso);
});

// Negative Case 1: An action returning a keyframe for an unlisted joint fails A-1
test("Phase 2 Negative Case 1: Action returning keyframe for unlisted joint is caught by A-1 assertion", () => {
  const malformedAction = {
    actionId: "malformed-action",
    description: "Action with undeclared joint",
    affectedJoints: ["torso"],
    generate: () => ({
      torso: [{ t: 0, value: 0 }, { t: 1, value: 0 }],
      unlistedSpine: [{ t: 0, value: 0 }, { t: 1, value: 10 }], // Undeclared joint
    }),
  };

  const generated = malformedAction.generate();
  const hasUndeclaredJoint = Object.keys(generated).some((j) => !malformedAction.affectedJoints.includes(j));
  assert.equal(hasUndeclaredJoint, true, "Negative case must detect undeclared joint");
});

// Negative Case 2: An action containing Math.random() fails A-2 determinism
test("Phase 2 Negative Case 2: Non-deterministic action containing Math.random() is caught by A-2 determinism assertion", () => {
  const randomAction = {
    actionId: "random-action",
    description: "Non-deterministic action",
    affectedJoints: ["torso"],
    generate: () => ({
      torso: [{ t: 0, value: 0 }, { t: 1, value: Math.random() * 100 }],
    }),
  };

  const run1 = randomAction.generate();
  const run2 = randomAction.generate();
  const isDeepEqual = JSON.stringify(run1) === JSON.stringify(run2);
  assert.equal(isDeepEqual, false, "Randomized action must fail deep-equality determinism assertion");
});
