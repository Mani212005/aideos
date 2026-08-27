/**
 * File Description: Unit tests for the pure TypeScript SVG character system,
 * analytical bounding box overlap validator, and calibrated finite-difference motion verifier.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  characterRigSchema,
  getAllCharacterRigs,
  POSE_PRESETS,
} from "../src/dl/characters";
import { parseFilm } from "../src/dl/schema";
import { validateFilmAudioAndAssets } from "../src/dl/validateFilm";
import { verifyTrajectoryContinuity } from "../src/dl/motion/verifier";
import { evaluateCatmullRomSpline } from "../src/dl/motion/spline";

test("character rigs conform to characterRigSchema", () => {
  const rigs = getAllCharacterRigs();
  assert.ok(rigs.length >= 2, "must have at least 2 pre-rigged characters");

  for (const rig of rigs) {
    const parsed = characterRigSchema.safeParse(rig);
    assert.ok(parsed.success, `rig "${rig.id}" must pass characterRigSchema`);
    assert.ok(rig.groups.length >= 3, `rig "${rig.id}" must have at least 3 joint groups`);
  }
});

test("8 pose presets exist and define standard joint groups", () => {
  const presetKeys = Object.keys(POSE_PRESETS);
  assert.equal(presetKeys.length, 8, "must define exactly 8 pose presets");

  const requiredPresets = [
    "neutral",
    "present-right",
    "present-left",
    "think",
    "shrug",
    "wave",
    "crossed-arms",
    "celebrate",
  ];

  for (const p of requiredPresets) {
    assert.ok(POSE_PRESETS[p], `preset "${p}" must exist`);
    assert.ok(POSE_PRESETS[p].groups.torso, `preset "${p}" must specify torso transform`);
  }
});

test("validator accepts valid CharacterBeat block", () => {
  const film = {
    id: "test-char",
    title: "Test Character Film",
    fps: 30 as const,
    chapters: ["Ch1"],
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 200, h: 60 },
        { id: "n2", label: "Node 2", x: 300, y: 0, w: 200, h: 60 },
      ],
      edges: [{ from: "n1", to: "n2", dashed: false }],
    },
    shots: [
      {
        id: "s1",
        dur: 8,
        look: "n1",
        move: "cut" as const,
        stage: "anchor" as const,
        drift: true,
        zoom: 1,
        blocks: [
          {
            c: "CharacterBeat" as const,
            characterId: "astronaut",
            poses: [
              { t: 0, groups: { torso: { rotate: 0 } } },
              { t: 0.5, groups: { torso: { rotate: 5 } } },
            ],
          },
        ],
      },
      {
        id: "s2",
        dur: 6,
        look: "all",
        move: "pan" as const,
        stage: "none" as const,
        drift: false,
        zoom: 1,
        blocks: [],
      },
    ],
  };

  const validated = validateFilmAudioAndAssets(film);
  assert.equal(validated.shots[0].blocks[0].c, "CharacterBeat");
});

test("validator rejects unknown characterId", () => {
  const film = {
    id: "test-char-invalid",
    title: "Test Film",
    fps: 30,
    chapters: ["Ch1"],
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 200, h: 60 },
        { id: "n2", label: "Node 2", x: 300, y: 0, w: 200, h: 60 },
      ],
      edges: [{ from: "n1", to: "n2", dashed: false }],
    },
    shots: [
      {
        id: "s1",
        dur: 8,
        look: "n1",
        move: "cut",
        stage: "anchor",
        blocks: [
          {
            c: "CharacterBeat",
            characterId: "non-existent-robot",
            poses: [],
          },
        ],
      },
      {
        id: "s2",
        dur: 6,
        look: "all",
        move: "pan",
        stage: "none",
        blocks: [],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(film),
    /references unknown characterId "non-existent-robot"/,
  );
});

test("validator rejects non-monotonic pose keyframe timestamps", () => {
  const film = {
    id: "test-char-non-mono",
    title: "Test Film",
    fps: 30,
    chapters: ["Ch1"],
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 200, h: 60 },
        { id: "n2", label: "Node 2", x: 300, y: 0, w: 200, h: 60 },
      ],
      edges: [{ from: "n1", to: "n2", dashed: false }],
    },
    shots: [
      {
        id: "s1",
        dur: 8,
        look: "n1",
        move: "cut",
        stage: "anchor",
        blocks: [
          {
            c: "CharacterBeat",
            characterId: "astronaut",
            poses: [
              { t: 0.8, groups: { torso: { rotate: 0 } } },
              { t: 0.2, groups: { torso: { rotate: 5 } } },
            ],
          },
        ],
      },
      {
        id: "s2",
        dur: 6,
        look: "all",
        move: "pan",
        stage: "none",
        blocks: [],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(film),
    /pose keyframes must be non-decreasing in t/,
  );
});

test("validator rejects unknown joint group in pose keyframe", () => {
  const film = {
    id: "test-char-bad-group",
    title: "Test Film",
    fps: 30,
    chapters: ["Ch1"],
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 200, h: 60 },
        { id: "n2", label: "Node 2", x: 300, y: 0, w: 200, h: 60 },
      ],
      edges: [{ from: "n1", to: "n2", dashed: false }],
    },
    shots: [
      {
        id: "s1",
        dur: 8,
        look: "n1",
        move: "cut",
        stage: "anchor",
        blocks: [
          {
            c: "CharacterBeat",
            characterId: "astronaut",
            poses: [{ t: 0, groups: { imaginaryWings: { rotate: 45 } } }],
          },
        ],
      },
      {
        id: "s2",
        dur: 6,
        look: "all",
        move: "pan",
        stage: "none",
        blocks: [],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(film),
    /references unknown group "imaginaryWings"/,
  );
});

test("pacing gate rejects CharacterBeat held past 25s", () => {
  const film = {
    id: "test-char-pacing",
    title: "Test Film",
    fps: 30,
    chapters: ["Ch1"],
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 200, h: 60 },
        { id: "n2", label: "Node 2", x: 300, y: 0, w: 200, h: 60 },
      ],
      edges: [{ from: "n1", to: "n2", dashed: false }],
    },
    shots: [
      {
        id: "s1",
        dur: 28,
        look: "n1",
        move: "cut",
        stage: "frame",
        blocks: [
          {
            c: "CharacterBeat",
            characterId: "astronaut",
            poses: [],
          },
        ],
      },
    ],
  };

  assert.throws(
    () => parseFilm(film),
    /CharacterBeat holds for 28s; no device may hold past 25s/,
  );
});

test("validator rejects unsupported schemaVersion", () => {
  const film = {
    schemaVersion: "2.0.0",
    id: "test-char-version",
    title: "Test Film",
    fps: 30 as const,
    chapters: ["Ch1"],
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 200, h: 60 },
        { id: "n2", label: "Node 2", x: 300, y: 0, w: 200, h: 60 },
      ],
      edges: [{ from: "n1", to: "n2", dashed: false }],
    },
    shots: [
      {
        id: "s1",
        dur: 12,
        look: "n1",
        move: "cut" as const,
        stage: "anchor" as const,
        blocks: [{ c: "Body" as const, text: "Valid content" }],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(film),
    /Unsupported film schemaVersion "2.0.0"/,
  );
});

test("Theme-Token Conformance: all character rigs bind 100% semantic color tokens", () => {
  const rigs = getAllCharacterRigs();
  const validTokens = new Set(["surface", "ink", "muted", "hairline", "accent", "canvas", "none", undefined]);

  for (const rig of rigs) {
    for (const group of rig.groups) {
      for (const path of group.paths) {
        assert.ok(
          validTokens.has(path.fill),
          `rig "${rig.id}" group "${group.id}" path fill "${path.fill}" must be a semantic token`,
        );
        assert.ok(
          validTokens.has(path.stroke),
          `rig "${rig.id}" group "${group.id}" path stroke "${path.stroke}" must be a semantic token`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------
// MOTION VERIFIER KNOWN-ANSWER CALIBRATION & CONTINUITY TESTS
// ---------------------------------------------------------------------

test("Motion Verifier Positive Control: asserts exact Δv = 2.000000 on known piecewise linear kink", () => {
  // Analytical function: f(t) = +1*t for t < 0.5, f(t) = -1*(t - 0.5) + 0.5 for t >= 0.5
  // True left velocity v^-(0.5) = +1.0, true right velocity v^+(0.5) = -1.0
  // True analytical jump Δv = |-1.0 - (+1.0)| = 2.000000
  const evalPiecewiseLinearKink = (t: number): number => {
    return t < 0.5 ? t : 0.5 - (t - 0.5);
  };

  // When durationSec = 1.0s, physical jump = 2.000 deg/s
  const report1s = verifyTrajectoryContinuity(evalPiecewiseLinearKink, [0.5], 1.0, 1e-4, 0.05);
  assert.equal(report1s.isC1Continuous, false, "Piecewise linear kink must be flagged as non-C1");
  assert.ok(
    Math.abs(report1s.maxPhysicalVelocityDiscontinuity - 2.0) < 1e-5,
    `Positive control at 1s must measure exact analytical jump of 2.000 deg/s (measured: ${report1s.maxPhysicalVelocityDiscontinuity.toFixed(7)})`,
  );

  // When durationSec = 4.0s, physical jump = 2.0 / 4.0 = 0.500 deg/s (verifying exact physical scaling)
  const report4s = verifyTrajectoryContinuity(evalPiecewiseLinearKink, [0.5], 4.0, 1e-4);
  assert.ok(
    Math.abs(report4s.maxPhysicalVelocityDiscontinuity - 0.5) < 1e-5,
    `Positive control at 4s must measure exact physical jump of 0.500 deg/s (measured: ${report4s.maxPhysicalVelocityDiscontinuity.toFixed(7)})`,
  );
  assert.equal(
    report1s.maxRawNormalizedDiscontinuity,
    report4s.maxRawNormalizedDiscontinuity,
    "Raw normalized discontinuity must be invariant to durationSec",
  );
});

test("Motion Verifier Negative Control: asserts Δv <= 1e-5 on known smooth cubic curve", () => {
  // Smooth polynomial f(t) = t^3 - 2t^2 + t (C-infinity continuous everywhere)
  const evalSmoothCubic = (t: number): number => {
    return t * t * t - 2 * t * t + t;
  };

  const report = verifyTrajectoryContinuity(evalSmoothCubic, [0.25, 0.5, 0.75], 2.0, 1e-4);
  assert.equal(report.isC1Continuous, true, "Smooth cubic polynomial must be verified as C1 continuous");
  assert.ok(
    report.maxPhysicalVelocityDiscontinuity < 1e-4,
    `Negative control must measure near-zero velocity jump on smooth curve (measured: ${report.maxPhysicalVelocityDiscontinuity.toFixed(7)})`,
  );
});

test("Motion Verifier Convergence: step-size halving converges to true analytical jump", () => {
  const evalPiecewiseLinearKink = (t: number): number => {
    return t < 0.5 ? t : 0.5 - (t - 0.5);
  };

  const epsilons = [1e-3, 1e-4, 1e-5];
  for (const eps of epsilons) {
    const report = verifyTrajectoryContinuity(evalPiecewiseLinearKink, [0.5], 1.0, eps);
    assert.ok(
      Math.abs(report.maxPhysicalVelocityDiscontinuity - 2.0) < 1e-5,
      `Measured jump must stay stable at 2.000 across epsilon=${eps} (got: ${report.maxPhysicalVelocityDiscontinuity})`,
    );
  }
});

test("P-1 Threshold Units: identical physical motion produces identical pass/fail invariant across 3s and 12s shots", () => {
  // Physical motion: kink with analytical physical jump of exactly 4.0 deg/s (exceeds 2.0 deg/s threshold)
  const makeTrajectory = (duration: number) => (t: number) => {
    const tPhys = t * duration;
    return tPhys < 0.5 * duration ? 2.0 * tPhys : 2.0 * (0.5 * duration) - 2.0 * (tPhys - 0.5 * duration);
  };

  const report3s = verifyTrajectoryContinuity(makeTrajectory(3.0), [0.5], 3.0, 1e-4, 2.0);
  const report12s = verifyTrajectoryContinuity(makeTrajectory(12.0), [0.5], 12.0, 1e-4, 2.0);

  assert.equal(report3s.isC1Continuous, false, "3s shot with 4 deg/s jump must fail");
  assert.equal(report12s.isC1Continuous, false, "12s shot with identical 4 deg/s jump must fail");
  assert.ok(
    Math.abs(report3s.maxPhysicalVelocityDiscontinuity - 4.0) < 1e-5,
    "3s shot converted physical jump must be 4.0 deg/s",
  );
  assert.ok(
    Math.abs(report12s.maxPhysicalVelocityDiscontinuity - 4.0) < 1e-5,
    "12s shot converted physical jump must be 4.0 deg/s",
  );
  assert.ok(
    Math.abs(report3s.maxRawNormalizedDiscontinuity / report3s.maxPhysicalVelocityDiscontinuity - 3.0) < 1e-5,
    "Ratio raw / converted must equal shot.dur (3.0)",
  );
  assert.ok(
    Math.abs(report12s.maxRawNormalizedDiscontinuity / report12s.maxPhysicalVelocityDiscontinuity - 12.0) < 1e-5,
    "Ratio raw / converted must equal shot.dur (12.0)",
  );

  // Negative case: smooth physical motion of 1.0 deg/s jump (within 2.0 deg/s threshold) passes on both
  const makeSubThresholdTrajectory = (duration: number) => (t: number) => {
    const tPhys = t * duration;
    return tPhys < 0.5 * duration ? 0.5 * tPhys : 0.5 * (0.5 * duration) - 0.5 * (tPhys - 0.5 * duration);
  };
  const sub3s = verifyTrajectoryContinuity(makeSubThresholdTrajectory(3.0), [0.5], 3.0, 1e-4, 2.0);
  const sub12s = verifyTrajectoryContinuity(makeSubThresholdTrajectory(12.0), [0.5], 12.0, 1e-4, 2.0);
  assert.equal(sub3s.isC1Continuous, true, "Sub-threshold jump must pass on 3s shot");
  assert.equal(sub12s.isC1Continuous, true, "Sub-threshold jump must pass on 12s shot");
});
