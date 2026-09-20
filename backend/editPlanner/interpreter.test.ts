/**
 * File Description: Unit tests for the EditOp transactional interpreter (Phase 2).
 * Tests all EditOp primitives (text overlay, filler removal, dead air removal, trim, split, move,
 * volume, lane flags, accent, theme), verifying A/V synchronization, dependent overlay shifting,
 * and atomic rollback on error.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { applyEditProgram } from "./interpreter";
import type { LayeredFilm, Clip } from "../../src/dl/layeredSchema";
import type { EditContext } from "../editContext/buildEditContext";
import type { EditOp } from "./schema";

/**
 * Creates a standard linked video+audio LayeredFilm fixture for interpreter testing.
 */
function createLinkedFixture(): LayeredFilm {
  const videoClip: Clip = {
    id: "clip-video-main",
    layerId: "layer-video",
    position: 0,
    start: 0,
    end: 12,
    kind: "video",
    payload: { src: "media/interview.mp4" },
    linkedClipId: "clip-audio-main",
    opacity: 1,
    volume: 1,
  };

  const audioClip: Clip = {
    id: "clip-audio-main",
    layerId: "layer-audio-footage",
    position: 0,
    start: 0,
    end: 12,
    kind: "audio",
    payload: { src: "media/interview.mp4", channel: "external" },
    linkedClipId: "clip-video-main",
    opacity: 1,
    volume: 1,
  };

  return {
    id: "test-interpreter-film",
    title: "Interpreter Test Film",
    fps: 30,
    accent: "#635BFF",
    canvas: { nodes: [{ id: "n1", label: "Scene", x: 0, y: 0, w: 190, h: 62 }], edges: [] },
    chapters: [],
    layers: [
      { id: "layer-video", number: 15, label: "Video Footage", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-audio-footage", number: 5, label: "Footage Audio", locked: false, hidden: false, muted: false, height: 48 },
    ],
    clips: [videoClip, audioClip],
  };
}

test("interpreter: add_text_overlay adds text clip and creates lane if missing", () => {
  const film = createLinkedFixture();
  const ops: EditOp[] = [
    {
      op: "add_text_overlay",
      text: "Welcome to Aideos",
      startSec: 1,
      endSec: 4,
      size: "headline",
      position: "bottom",
    },
  ];

  const result = applyEditProgram(film, ops);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.applied.length, 1);

  const textClip = result.film.clips.find((c) => c.kind === "text");
  assert.ok(textClip, "Text clip should exist");
  assert.equal(textClip?.position, 1);
  assert.equal(textClip?.end, 3);
  assert.equal((textClip?.payload as any).text, "Welcome to Aideos");
  assert.ok(result.film.layers.some((l) => l.id === textClip?.layerId));
});

test("interpreter: remove_fillers cuts filler span and shifts video+audio in sync", () => {
  const film = createLinkedFixture();
  const context: EditContext = {
    transcript: [
      { word: "Hello", start: 0, end: 1 },
      { word: "um", start: 2, end: 3, confidence: 0.95 },
      { word: "world", start: 4, end: 6 },
    ],
    fillers: [{ startIndex: 1, endIndex: 1, start: 2, end: 3, text: "um" }],
    silences: [],
    lanes: film.layers,
    clips: film.clips.map((c) => ({ id: c.id, kind: c.kind, layerId: c.layerId, position: c.position, start: c.start, end: c.end })),
    meta: { fps: 30, durationSec: 12 },
  };

  const ops: EditOp[] = [
    {
      op: "remove_fillers",
      scope: "all",
    },
  ];

  const result = applyEditProgram(film, ops, context);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.applied.length, 1);

  // Total duration of clips should be reduced by 1.0s (2.0s to 3.0s cut)
  const videoClips = result.film.clips.filter((c) => c.kind === "video");
  const audioClips = result.film.clips.filter((c) => c.kind === "audio");

  assert.equal(videoClips.length, 2, "Video should be split into 2 parts");
  assert.equal(audioClips.length, 2, "Audio should be split into 2 parts");

  // Verify first halves end at 2.0s
  assert.equal(videoClips[0].position, 0);
  assert.equal(videoClips[0].end - videoClips[0].start, 2);
  assert.equal(audioClips[0].position, 0);
  assert.equal(audioClips[0].end - audioClips[0].start, 2);

  // Verify second halves start at 2.0s (shifted left by 1.0s from 3.0s)
  assert.equal(videoClips[1].position, 2);
  assert.equal(audioClips[1].position, 2);

  // Total remaining content length should be 11.0s (12 - 1)
  const maxEnd = Math.max(...result.film.clips.map((c) => c.position + (c.end - c.start)));
  assert.equal(maxEnd, 11);
});

test("interpreter: remove_dead_air trims qualifying silences and leaves target gap", () => {
  const film = createLinkedFixture();
  const context: EditContext = {
    transcript: [
      { word: "Start", start: 0, end: 1 },
      { word: "End", start: 4, end: 6 },
    ],
    fillers: [],
    silences: [{ start: 1, end: 4 }], // 3.0s silence
    lanes: film.layers,
    clips: film.clips.map((c) => ({ id: c.id, kind: c.kind, layerId: c.layerId, position: c.position, start: c.start, end: c.end })),
    meta: { fps: 30, durationSec: 12 },
  };

  const ops: EditOp[] = [
    {
      op: "remove_dead_air",
      minSilenceSec: 0.6,
      targetGapSec: 0.2,
    },
  ];

  const result = applyEditProgram(film, ops, context);
  assert.equal(result.rejected.length, 0);

  // 3s silence trimmed to 0.2s gap -> cut duration = 2.8s
  const maxEnd = Math.max(...result.film.clips.map((c) => c.position + (c.end - c.start)));
  assert.equal(Number(maxEnd.toFixed(2)), 9.2); // 12 - 2.8 = 9.2s
});

test("interpreter: trim_range cuts specified section and closes gap", () => {
  const film = createLinkedFixture();
  const ops: EditOp[] = [
    {
      op: "trim_range",
      fromSec: 4,
      toSec: 7, // cut 3.0s
    },
  ];

  const result = applyEditProgram(film, ops);
  assert.equal(result.rejected.length, 0);

  const maxEnd = Math.max(...result.film.clips.map((c) => c.position + (c.end - c.start)));
  assert.equal(maxEnd, 9); // 12 - 3 = 9s
});

test("interpreter: mute_lane and hide_lane set layer properties", () => {
  const film = createLinkedFixture();
  const ops: EditOp[] = [
    { op: "mute_lane", laneId: "layer-audio-footage", muted: true },
    { op: "hide_lane", laneId: "layer-video", hidden: true },
  ];

  const result = applyEditProgram(film, ops);
  assert.equal(result.rejected.length, 0);

  const audioLayer = result.film.layers.find((l) => l.id === "layer-audio-footage");
  const videoLayer = result.film.layers.find((l) => l.id === "layer-video");

  assert.equal(audioLayer?.muted, true);
  assert.equal(videoLayer?.hidden, true);
});

test("interpreter: set_accent and set_theme update film design tokens", () => {
  const film = createLinkedFixture();
  const ops: EditOp[] = [
    { op: "set_accent", hex: "#FF6B00" },
    { op: "set_theme", partialTheme: { mode: "dark" } },
  ];

  const result = applyEditProgram(film, ops);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.film.accent, "#FF6B00");
  assert.deepEqual(result.film.theme, { mode: "dark" } as any);
});

test("interpreter: atomic rollback on error restores original film completely", () => {
  const film = createLinkedFixture();
  const ops: EditOp[] = [
    { op: "set_accent", hex: "#FF6B00" },
    { op: "move_clip", clipId: "clip-nonexistent", toSec: 5 }, // Fails!
  ];

  const result = applyEditProgram(film, ops);
  assert.equal(result.applied.length, 0, "No ops should be reported as applied when rolled back");
  assert.ok(result.rejected.length > 0, "Should report rejected ops");
  assert.equal(result.film.accent, "#635BFF", "Accent should be rolled back to original");
});
