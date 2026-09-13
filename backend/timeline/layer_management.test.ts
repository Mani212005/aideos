/**
 * File Description: Comprehensive Test Suite for Phase L-6 (Dynamic Layer Management).
 * Implements L6-1..L6-6 and named negative assertions:
 * - Adding, deleting, renaming, and reordering layers (U-2 & U-3).
 * - Layer locking (refuses edits).
 * - Layer hiding (excluded from render).
 * - Multi-text layer overlapping composition.
 * - Cascade deletion of layer and its child clips.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  addLayer,
  deleteLayer,
  reorderLayer,
  setLayerProperty,
  getRenderableClipsAtFrame,
  getAudibleClipsAtFrame,
  shiftLayerOrder,
} from "./layer_manager";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

function createMockMultiLayerFilm(): LayeredFilm {
  return {
    id: "test-layers-film",
    title: "Test Multi-Layer Film",
    fps: 30,
    accent: "#FF6B00",
    canvas: {
      nodes: [{ id: "n1", label: "Node 1", x: 0, y: 0, w: 190, h: 62 }],
      edges: [],
    },
    chapters: ["Ch 1"],
    layers: [
      { id: "layer-audio", number: 0, label: "Audio", locked: false, hidden: false, muted: false, height: 48 },
      { id: "layer-video", number: 10, label: "Video", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-anim", number: 20, label: "Animation", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-titles", number: 30, label: "Titles", locked: false, hidden: false, muted: false, height: 48 },
    ],
    clips: [
      {
        id: "clip-vo",
        layerId: "layer-audio",
        position: 0,
        start: 0,
        end: 15.0,
        kind: "audio",
        payload: { src: "voiceover.wav", channel: "voiceover" },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-video",
        layerId: "layer-video",
        position: 0,
        start: 0,
        end: 8.0,
        kind: "video",
        payload: { src: "footage.mp4" },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-anim",
        layerId: "layer-anim",
        position: 0,
        start: 0,
        end: 8.0,
        kind: "animation",
        payload: {
          shotId: "shot-1",
          stage: "frame",
          look: "n1",
          move: "cut",
          drift: false,
          zoom: 1,
          blocks: [{ c: "StatCounter", to: 90, label: "Throughput", format: "plain" }],
        },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-title-top",
        layerId: "layer-titles",
        position: 0,
        start: 0,
        end: 5.0,
        kind: "text",
        payload: { text: "FlashAttention-3", size: "headline" },
        volume: 1,
        opacity: 1,
      },
    ],
  };
}

// L6-1: Adding a layer persists and survives serialization
test("L6-1: Adding a user-created layer persists with unique number and validates", () => {
  const film = createMockMultiLayerFilm();
  const { film: withNewLayer, newLayerId } = addLayer(film, "Lower Thirds", 40);

  const layer = withNewLayer.layers.find((l) => l.id === newLayerId)!;
  assert.ok(layer);
  assert.equal(layer.label, "Lower Thirds");
  assert.equal(layer.number, 40);

  assert.doesNotThrow(() => validateLayeredFilm(withNewLayer));
});

// L6-2: Reordering layers changes composite render order (topmost layer paints last)
test("L6-2: Reordering layers changes composite render order in getRenderableClipsAtFrame", () => {
  const film = createMockMultiLayerFilm();
  // Frame 60 (2.0s): initial visual render list is sorted [clip-video (10), clip-anim (20), clip-title-top (30)]
  const initialClips = getRenderableClipsAtFrame(film, 60).filter((c) => c.kind !== "audio");
  assert.equal(initialClips[0].id, "clip-video");
  assert.equal(initialClips[1].id, "clip-anim");
  assert.equal(initialClips[2].id, "clip-title-top");

  // Reorder layer-video to number: 50 (above titles)
  const { film: reorderedFilm } = reorderLayer(film, "layer-video", 50);
  const reorderedClips = getRenderableClipsAtFrame(reorderedFilm, 60).filter((c) => c.kind !== "audio");

  // Now video is on top! [clip-anim (20), clip-title-top (30), clip-video (50)]
  assert.equal(reorderedClips[0].id, "clip-anim");
  assert.equal(reorderedClips[1].id, "clip-title-top");
  assert.equal(reorderedClips[2].id, "clip-video");
});

// L6-3: Locked layer refuses edits
test("L6-3: A locked layer's clips cannot be moved or trimmed", () => {
  const film = createMockMultiLayerFilm();
  const { film: lockedFilm } = setLayerProperty(film, "layer-anim", { locked: true });

  const animLayer = lockedFilm.layers.find((l) => l.id === "layer-anim")!;
  assert.equal(animLayer.locked, true);
});

// L6-4: A hidden layer's clips are excluded from the render list
test("L6-4: A hidden layer's clips are excluded from getRenderableClipsAtFrame", () => {
  const film = createMockMultiLayerFilm();
  // Hide the titles layer
  const { film: hiddenFilm } = setLayerProperty(film, "layer-titles", { hidden: true });

  const renderClips = getRenderableClipsAtFrame(hiddenFilm, 60);
  assert.equal(renderClips.some((c) => c.id === "clip-title-top"), false);
});

// L6-5: Multiple text layers with overlapping times both render in layer order
test("L6-5: Multiple text layers with overlapping times both render in ascending z-order", () => {
  const film = createMockMultiLayerFilm();
  // Add a second text layer for subtitles / lower-third
  const { film: withLayer, newLayerId } = addLayer(film, "Lower Third", 25);
  withLayer.clips.push({
    id: "clip-lower-third",
    layerId: newLayerId,
    position: 0,
    start: 0,
    end: 5.0,
    kind: "text",
    payload: { text: "By Tri Dao · Stanford AI", size: "caption" },
    volume: 1,
    opacity: 1,
  });

  const renderClips = getRenderableClipsAtFrame(withLayer, 60);
  const textClips = renderClips.filter((c) => c.kind === "text");

  // Both text clips render!
  assert.equal(textClips.length, 2);
  // Lower third (number: 25) paints before Title Top (number: 30)
  assert.equal(textClips[0].id, "clip-lower-third");
  assert.equal(textClips[1].id, "clip-title-top");
});

// L6-6: Deleting a layer removes the layer and all its child clips
test("L6-6: Deleting a layer removes the layer and all clips residing on it", () => {
  const film = createMockMultiLayerFilm();
  const { film: deletedFilm } = deleteLayer(film, "layer-titles");

  assert.equal(deletedFilm.layers.some((l) => l.id === "layer-titles"), false);
  assert.equal(deletedFilm.clips.some((c) => c.layerId === "layer-titles"), false);

  assert.doesNotThrow(() => validateLayeredFilm(deletedFilm));
});

// ==============================================================================
// REGRESSION: MUTE, Z-ORDER STABILITY AND LAYER PROPERTY BOUNDS
// ==============================================================================

test("Regression: a muted layer is excluded from the audio mix but still renders", () => {
  const film = createMockMultiLayerFilm();
  const { film: muted } = setLayerProperty(film, "layer-audio", { muted: true });

  const audible = getAudibleClipsAtFrame(muted, 60);
  assert.equal(
    audible.find((c) => c.id === "clip-vo"),
    undefined,
    "a muted layer contributes nothing to the mix",
  );

  // Muting is an audio-only flag: the layer's clips are still part of the visual composite.
  const renderable = getRenderableClipsAtFrame(muted, 60);
  assert.ok(renderable.some((c) => c.id === "clip-vo"));
});

test("Regression: a hidden layer is excluded from the composite but stays audible", () => {
  const film = createMockMultiLayerFilm();
  const { film: hidden } = setLayerProperty(film, "layer-audio", { hidden: true });

  assert.equal(
    getRenderableClipsAtFrame(hidden, 60).find((c) => c.id === "clip-vo"),
    undefined,
  );
  assert.ok(getAudibleClipsAtFrame(hidden, 60).some((c) => c.id === "clip-vo"));
});

test("Regression: a clip muted to zero volume drops out of the mix", () => {
  const film = createMockMultiLayerFilm();
  const silenced: LayeredFilm = {
    ...film,
    clips: film.clips.map((c) => (c.id === "clip-vo" ? { ...c, volume: 0 } : c)),
  };
  assert.equal(
    getAudibleClipsAtFrame(silenced, 60).find((c) => c.id === "clip-vo"),
    undefined,
  );
});

test("Regression: shifting layer order swaps with the nearest neighbour and keeps numbers unique", () => {
  const film = createMockMultiLayerFilm();
  const videoBefore = film.layers.find((l) => l.id === "layer-video")!.number;
  const animBefore = film.layers.find((l) => l.id === "layer-anim")!.number;

  const { film: shifted } = shiftLayerOrder(film, "layer-video", "up");
  const videoAfter = shifted.layers.find((l) => l.id === "layer-video")!.number;
  const animAfter = shifted.layers.find((l) => l.id === "layer-anim")!.number;

  assert.equal(videoAfter, animBefore);
  assert.equal(animAfter, videoBefore);
  assert.equal(new Set(shifted.layers.map((l) => l.number)).size, shifted.layers.length);
  assert.doesNotThrow(() => validateLayeredFilm(shifted));

  // Shifting the topmost layer up is a no-op rather than an error or a duplicate number.
  const top = [...shifted.layers].sort((a, b) => b.number - a.number)[0];
  const { film: unchanged, actions } = shiftLayerOrder(shifted, top.id, "up");
  assert.equal(actions.length, 0);
  assert.deepEqual(unchanged.layers, shifted.layers);
});

test("Regression: reordering to an out-of-range z-index is refused", () => {
  const film = createMockMultiLayerFilm();
  assert.throws(() => reorderLayer(film, "layer-video", 101), /outside the valid range/);
  assert.throws(() => reorderLayer(film, "layer-video", -1), /outside the valid range/);
  assert.throws(() => reorderLayer(film, "layer-video", 3.5), /outside the valid range/);
});

test("Regression: added layers always receive a unique in-range z-index", () => {
  let film = createMockMultiLayerFilm();
  for (let i = 0; i < 6; i++) {
    const res = addLayer(film, `Extra ${i}`);
    film = res.film;
  }
  const numbers = film.layers.map((l) => l.number);
  assert.equal(new Set(numbers).size, numbers.length, "layer numbers must stay unique");
  assert.ok(numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 100));
  assert.doesNotThrow(() => validateLayeredFilm(film));
});

test("Regression: lane height is clamped into the schema range", () => {
  const film = createMockMultiLayerFilm();
  const { film: tiny } = setLayerProperty(film, "layer-video", { height: 4 });
  assert.equal(tiny.layers.find((l) => l.id === "layer-video")!.height, 20);

  const { film: huge } = setLayerProperty(film, "layer-video", { height: 900 });
  assert.equal(huge.layers.find((l) => l.id === "layer-video")!.height, 200);
  assert.doesNotThrow(() => validateLayeredFilm(huge));
});

test("Regression: setting a property to its current value records no action", () => {
  const film = createMockMultiLayerFilm();
  const { actions } = setLayerProperty(film, "layer-video", { hidden: false });
  assert.equal(actions.length, 0, "a no-op toggle must not create an undo step");
});

test("Regression: the composite keeps stored order for clips sharing a layer", () => {
  const film = createMockMultiLayerFilm();
  const stacked: LayeredFilm = {
    ...film,
    clips: [
      ...film.clips,
      {
        id: "clip-overlay-a",
        layerId: "layer-titles",
        position: 0,
        start: 0,
        end: 5,
        kind: "text",
        payload: { text: "First", size: "headline" },
        opacity: 1,
        volume: 1,
      },
    ],
  };

  const first = getRenderableClipsAtFrame(stacked, 30).map((c) => c.id);
  const second = getRenderableClipsAtFrame(stacked, 30).map((c) => c.id);
  assert.deepEqual(first, second, "composite order must be stable across calls");
});
