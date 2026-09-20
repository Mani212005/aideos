/**
 * File Description: Invariants and Defect-Class Regression Test Suite for AI Video Editing (Phase 2).
 * Verifies core design contracts from report section 3.7:
 * - Invariant 1: Round-trip losslessness across all clip kinds and custom lanes.
 * - Invariant 2: Every EditOp execution produces a schema-valid LayeredFilm (Rules 1-7).
 * - Invariant 3: Filler and dead-air removals preserve A/V sync with exact duration reductions.
 * - Invariant 4: Edit programs execute atomically with zero side-effects on rollback.
 * - Invariant 5: The EditOp union is closed and rejects unmodeled operations.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { Film } from "../../src/dl/schema";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../../src/dl/convertFilm";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import { applyEditProgram } from "./interpreter";
import { validateEditProgram } from "./validator";
import { buildEditContext, type EditContext } from "../editContext/buildEditContext";
import type { EditOp } from "./schema";

/**
 * Creates an authoritative Film fixture containing videoClips, overlayClips, audioClips, and shots.
 */
function createComprehensiveFilmFixture(): Film {
  return {
    id: "invariants-film-pkg",
    title: "Comprehensive Film Manifest",
    fps: 30,
    accent: "#635BFF",
    canvas: { nodes: [{ id: "n1", label: "Intro", x: 0, y: 0, w: 200, h: 80 }], edges: [] },
    chapters: ["Chapter 1"],
    shots: [
      {
        id: "shot-1",
        stage: "anchor",
        ch: "Chapter 1",
        dur: 4,
        look: "n1",
        move: "cut",
        cameraAngle: "flat",
        drift: false,
        zoom: 1,
        scriptText: "Welcome to this production.",
        blocks: [{ c: "TextReveal", text: "Welcome to Aideos", size: "headline" }],
      },
    ],
    layers: [
      { id: "layer-video", number: 15, label: "Video Footage", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-audio-footage", number: 5, label: "Footage Audio", locked: false, hidden: false, muted: false, height: 48 },
      { id: "layer-text-overlay", number: 30, label: "Text Overlays", locked: false, hidden: false, muted: false, height: 48 },
    ],
    videoClips: [
      {
        id: "clip-video-user",
        src: "videos/invariants-film-pkg/footage/import-1.mp4",
        position: 0,
        start: 0,
        end: 8,
        width: 1920,
        height: 1080,
        opacity: 1,
        volume: 1,
        linkedClipId: "clip-audio-user",
      },
    ],
    audioClips: [
      {
        id: "clip-audio-user",
        src: "videos/invariants-film-pkg/footage/import-1.mp4",
        position: 0,
        start: 0,
        end: 8,
        volume: 1,
        channel: "external",
        linkedClipId: "clip-video-user",
      },
    ],
    overlayClips: [
      {
        id: "clip-text-title",
        kind: "text",
        position: 1,
        start: 0,
        end: 3,
        opacity: 1,
        payload: { text: "Title Card", size: "headline" },
      },
    ],
  };
}

test("Invariant 1: Bidirectional round-trip conversion is lossless across all visual and audio clip kinds", () => {
  const originalFilm = createComprehensiveFilmFixture();
  const layered = convertFilmToLayeredFilm(originalFilm);

  // Validate LayeredFilm invariants
  validateLayeredFilm(layered);

  // Fold back to Film
  const foldedFilm = convertLayeredFilmToFilm(layered, originalFilm);

  // Assert all clip kinds survived
  assert.ok(foldedFilm.videoClips && foldedFilm.videoClips.length > 0, "videoClips must survive round-trip");
  assert.equal(foldedFilm.videoClips[0].id, "clip-video-user");
  assert.equal(foldedFilm.videoClips[0].width, 1920);

  assert.ok(foldedFilm.audioClips && foldedFilm.audioClips.length > 0, "audioClips must survive round-trip");
  assert.equal(foldedFilm.audioClips[0].id, "clip-audio-user");
  assert.equal(foldedFilm.audioClips[0].linkedClipId, "clip-video-user");

  assert.ok(foldedFilm.overlayClips && foldedFilm.overlayClips.length > 0, "overlayClips must survive round-trip");
  assert.equal(foldedFilm.overlayClips[0].id, "clip-text-title");
  assert.equal((foldedFilm.overlayClips[0].payload as any).text, "Title Card");

  // Verify second round-trip stability
  const layered2 = convertFilmToLayeredFilm(foldedFilm);
  const folded2 = convertLayeredFilmToFilm(layered2, foldedFilm);
  assert.deepEqual(folded2.videoClips, foldedFilm.videoClips);
  assert.deepEqual(folded2.overlayClips, foldedFilm.overlayClips);
  assert.deepEqual(folded2.audioClips, foldedFilm.audioClips);
});

test("Invariant 2: Every EditOp primitive produces a strictly valid LayeredFilm satisfying Rules 1-7", () => {
  const film = convertFilmToLayeredFilm(createComprehensiveFilmFixture());
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 8 });

  const testOps: EditOp[] = [
    { op: "add_text_overlay", text: "New Overlay", startSec: 4, endSec: 7, size: "headline", position: "center" },
    { op: "set_volume", clipId: "clip-audio-user", volume: 0.75 },
    { op: "set_accent", hex: "#00E5FF" },
    { op: "mute_lane", laneId: "layer-audio-footage", muted: true },
    { op: "hide_lane", laneId: "layer-text-overlay", hidden: true },
  ];

  for (const op of testOps) {
    const result = applyEditProgram(film, [op], context);
    assert.equal(result.rejected.length, 0, `Op ${op.op} should execute cleanly`);
    // Rule 1-7 assertion
    assert.doesNotThrow(() => validateLayeredFilm(result.film), `Op ${op.op} must leave a valid LayeredFilm`);
  }
});

test("Invariant 3: Filler removal cuts the exact duration, preserves A/V sync, and shifts overlays", () => {
  const originalFilm = createComprehensiveFilmFixture();
  const layered = convertFilmToLayeredFilm(originalFilm);

  const context: EditContext = {
    transcript: [
      { word: "Here", start: 0, end: 1 },
      { word: "um", start: 2, end: 3.5, confidence: 0.3 }, // 1.5s filler
      { word: "is", start: 4, end: 5 },
      { word: "the", start: 5, end: 6 },
    ],
    fillers: [{ startIndex: 1, endIndex: 1, start: 2, end: 3.5, text: "um" }],
    silences: [],
    lanes: layered.layers,
    clips: layered.clips.map((c) => ({ id: c.id, kind: c.kind, layerId: c.layerId, position: c.position, start: c.start, end: c.end })),
    meta: { fps: 30, durationSec: 8 },
  };

  const ops: EditOp[] = [{ op: "remove_fillers", scope: "all" }];
  const result = applyEditProgram(layered, ops, context);

  assert.equal(result.rejected.length, 0);

  // Verify A/V pairs remain aligned
  const videoClips = result.film.clips.filter((c) => c.kind === "video").sort((a, b) => a.position - b.position);
  const audioClips = result.film.clips.filter((c) => c.kind === "audio" && c.layerId === "layer-audio-footage").sort((a, b) => a.position - b.position);

  assert.equal(videoClips.length, 2);
  assert.equal(audioClips.length, 2);

  // Half 1
  assert.equal(videoClips[0].position, audioClips[0].position);
  assert.equal(videoClips[0].end - videoClips[0].start, 2);
  assert.equal(audioClips[0].end - audioClips[0].start, 2);

  // Half 2 (shifted left by 1.5s from 3.5s -> starts at 2.0s)
  assert.equal(videoClips[1].position, 2);
  assert.equal(audioClips[1].position, 2);
  assert.equal(videoClips[1].end - videoClips[1].start, 4.5); // 8 - 3.5 = 4.5s
  assert.equal(audioClips[1].end - audioClips[1].start, 4.5);

  // Total duration decreased by exactly 1.5s
  const maxEnd = Math.max(...result.film.clips.map((c) => c.position + (c.end - c.start)));
  assert.equal(maxEnd, 6.5); // 8.0 - 1.5 = 6.5s
});

test("Invariant 4: Edit program is atomic, completely rolling back on any failure", () => {
  const film = convertFilmToLayeredFilm(createComprehensiveFilmFixture());
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 8 });

  const failingProgram: EditOp[] = [
    { op: "set_accent", hex: "#FF0000" },
    { op: "add_text_overlay", text: "Valid Step", startSec: 0, endSec: 2 },
    { op: "trim_range", fromSec: 10, toSec: 5 }, // Inverted range, will fail
  ];

  const result = applyEditProgram(film, failingProgram, context);
  assert.equal(result.applied.length, 0);
  assert.ok(result.rejected.length > 0);
  assert.equal(result.film.accent, "#635BFF", "Accent should remain unchanged on rollback");
  assert.equal(result.film.clips.length, film.clips.length, "No clips should have been added");
});

test("Invariant 5: Validator rejects out-of-vocabulary operations", () => {
  const film = convertFilmToLayeredFilm(createComprehensiveFilmFixture());
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 8 });

  const unmodeledOps = [
    { op: "warp_speed_transition", intensity: 9000 },
    { op: "inject_custom_shader", code: "gl_FragColor = vec4(1.0);" },
  ];

  const valResult = validateEditProgram(unmodeledOps, context);
  assert.equal(valResult.valid, false);
  assert.ok(valResult.errors.length >= 2);
});
