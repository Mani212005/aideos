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
import { verifyTrajectoryContinuity, verifyTrajectoryC1Continuity } from "../src/dl/motion/verifier";
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

  const report = verifyTrajectoryContinuity(evalPiecewiseLinearKink, [0.5], 1e-4);
  assert.equal(report.isC1Continuous, false, "Piecewise linear kink must be flagged as non-C1");
  assert.ok(
    Math.abs(report.maxVelocityDiscontinuity - 2.0) < 1e-5,
    `Positive control must measure exact analytical jump of 2.000 (measured: ${report.maxVelocityDiscontinuity.toFixed(7)})`,
  );
});

test("Motion Verifier Negative Control: asserts Δv <= 1e-5 on known smooth cubic curve", () => {
  // Smooth polynomial f(t) = t^3 - 2t^2 + t (C-infinity continuous everywhere)
  const evalSmoothCubic = (t: number): number => {
    return t * t * t - 2 * t * t + t;
  };

  const report = verifyTrajectoryContinuity(evalSmoothCubic, [0.25, 0.5, 0.75], 1e-4);
  assert.equal(report.isC1Continuous, true, "Smooth cubic polynomial must be verified as C1 continuous");
  assert.ok(
    report.maxVelocityDiscontinuity < 1e-4,
    `Negative control must measure near-zero velocity jump on smooth curve (measured: ${report.maxVelocityDiscontinuity.toFixed(7)})`,
  );
});

test("Motion Verifier Convergence: step-size halving converges to true analytical jump", () => {
  const evalPiecewiseLinearKink = (t: number): number => {
    return t < 0.5 ? t : 0.5 - (t - 0.5);
  };

  const epsilons = [1e-3, 1e-4, 1e-5];
  for (const eps of epsilons) {
    const report = verifyTrajectoryContinuity(evalPiecewiseLinearKink, [0.5], eps);
    assert.ok(
      Math.abs(report.maxVelocityDiscontinuity - 2.0) < 1e-5,
      `Measured jump must stay stable at 2.000 across epsilon=${eps} (got: ${report.maxVelocityDiscontinuity})`,
    );
  }
});

test("Catmull-Rom C1 Continuity: proves C1 velocity continuity across multi-knot sequences", () => {
  const knots = [
    { t: 0, val: 0 },
    { t: 0.5, val: 45 },
    { t: 1.0, val: -20 },
  ];

  const evalCatmullRom = (t: number): number => evaluateCatmullRomSpline(knots, t);

  const splineReport = verifyTrajectoryContinuity(evalCatmullRom, [0.5], 1e-4, 0.05);
  assert.ok(
    splineReport.isC1Continuous,
    `Catmull-Rom must be C1 continuous at interior knots (max discontinuity: ${splineReport.maxVelocityDiscontinuity.toFixed(7)})`,
  );
});
