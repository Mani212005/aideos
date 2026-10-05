/**
 * File Description: Unit tests for the EditProgram semantic validator (Phase 2).
 * Tests closed Zod schema enforcement, parameter ranges, entity reference verification,
 * and dry-run simulation against LayeredFilm invariants.
 * Inputs and outputs: sample edit programs -> validation error assertions.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateEditProgram } from "./validator";
import { buildEditContext } from "../editContext/buildEditContext";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

/**
 * Creates a standard LayeredFilm fixture for validator testing.
 */
function createTestLayeredFilm(): LayeredFilm {
  return {
    id: "test-val-film",
    title: "Validation Test Film",
    fps: 30,
    accent: "#635BFF",
    canvas: { nodes: [{ id: "n1", label: "Scene", x: 0, y: 0, w: 190, h: 62 }], edges: [] },
    chapters: [],
    layers: [
      { id: "layer-video", number: 15, label: "Video", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-audio-spine", number: 0, label: "Audio", locked: false, hidden: false, muted: false, height: 48 },
    ],
    clips: [
      {
        id: "clip-video-1",
        layerId: "layer-video",
        position: 0,
        start: 0,
        end: 10,
        kind: "video",
        payload: { src: "media/video.mp4" },
        opacity: 1,
        volume: 1,
      },
      {
        id: "clip-audio-1",
        layerId: "layer-audio-spine",
        position: 0,
        start: 0,
        end: 10,
        kind: "audio",
        payload: { src: "media/audio.wav" },
        opacity: 1,
        volume: 1,
      },
    ],
  };
}

test("validator: accepts a valid edit program and returns parsed operations", () => {
  const film = createTestLayeredFilm();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const ops = [
    {
      op: "add_text_overlay",
      text: "Introduction",
      startSec: 0,
      endSec: 3,
      size: "headline",
      position: "bottom",
    },
    {
      op: "set_accent",
      hex: "#FF6B00",
    },
  ];

  const result = validateEditProgram(ops, context);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.program?.length, 2);
});

test("validator: rejects unknown operation kinds (closed union)", () => {
  const film = createTestLayeredFilm();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const ops = [
    {
      op: "apply_vintage_filter",
      intensity: 0.8,
    },
  ];

  const result = validateEditProgram(ops, context);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Schema violation") || e.includes("Invalid discriminator")));
});

test("validator: rejects inverted time ranges (startSec >= endSec)", () => {
  const film = createTestLayeredFilm();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const ops = [
    {
      op: "add_text_overlay",
      text: "Bad Timing",
      startSec: 5,
      endSec: 2,
    },
  ];

  const result = validateEditProgram(ops, context);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("must be strictly less than endSec")));
});

test("validator: rejects negative start timestamps", () => {
  const film = createTestLayeredFilm();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const ops = [
    {
      op: "trim_range",
      fromSec: -2,
      toSec: 3,
    },
  ];

  const result = validateEditProgram(ops, context);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("cannot be negative") || e.includes("Schema violation")));
});

test("validator: rejects referenced clipId that does not exist in context", () => {
  const film = createTestLayeredFilm();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const ops = [
    {
      op: "move_clip",
      clipId: "clip-nonexistent-999",
      toSec: 2.5,
    },
  ];

  const result = validateEditProgram(ops, context);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("does not exist in timeline context")));
});

test("validator: rejects invalid accent hex formats", () => {
  const film = createTestLayeredFilm();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const ops = [
    {
      op: "set_accent",
      hex: "blue",
    },
  ];

  const result = validateEditProgram(ops, context);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("hex code") || e.includes("Schema violation")));
});

test("validator: rejects invalid add_lower_third timing or empty title", () => {
  const film = createTestLayeredFilm();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const invertedTiming = validateEditProgram(
    [{ op: "add_lower_third", title: "Speaker", startSec: 4, endSec: 2 }],
    context,
  );
  assert.equal(invertedTiming.valid, false);
  assert.ok(invertedTiming.errors.some((e) => e.includes("must be strictly less than endSec")));

  const emptyTitle = validateEditProgram(
    [{ op: "add_lower_third", title: "   ", startSec: 1, endSec: 4 }],
    context,
  );
  assert.equal(emptyTitle.valid, false);
  assert.ok(emptyTitle.errors.some((e) => e.includes("title content cannot be empty")));
});

test("validator: accepts valid add_lower_third and set_theme operations", () => {
  const film = createTestLayeredFilm();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const result = validateEditProgram(
    [
      { op: "add_lower_third", title: "Jane Smith", subtitle: "Lead Architect", startSec: 1, endSec: 4 },
      { op: "set_theme", partialTheme: { mode: "dark" } },
    ],
    context,
  );
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.program?.length, 2);
});

test("validator: rejects empty edit program", () => {
  const film = createTestLayeredFilm();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const result = validateEditProgram([], context);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("empty")));
});
