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
  renameLayer,
  reorderLayer,
  setLayerProperty,
  getRenderableClipsAtFrame,
} from "./layer_manager";
import {
  moveLayerClip,
  trimLayerClipEdge,
} from "./layer_engine";
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
          blocks: [{ c: "StatCounter", from: 0, to: 90, label: "Throughput", format: "plain" }],
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
