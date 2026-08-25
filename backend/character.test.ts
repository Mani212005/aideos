/**
 * File Description: Unit tests for the pure TypeScript SVG character system.
 * Validates rig schemas, pose keyframe interpolation, validator constraints,
 * and pacing rules for CharacterBeat devices.
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
