/**
 * File Description: Property test of timeline layer and clip identity: after any random sequence of add-layer, import-media, split-clip and delete-layer edits (labels and file names drawn from a small pool so ids are built from the same base again and again), every layer id is unique, every clip id is unique, every clip sits on an existing layer, every linked clip points at an existing clip and every layer number is unique. It reproduced layer ids that collided about one time in 36 when two layers shared a label.
 * Inputs and outputs: seeded random edit sequences on a small layered film -> the id and reference invariants hold after every edit, or a failure that names the seed and the edits.
 * Used by: npm test (found by glob), the CI unit job.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Clip, LayeredFilm } from "../../src/dl/layeredSchema";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import { forAll, pick, randFloat, randInt, type Rand } from "../testSupport/propertyTest";
import { TimelineEditError, deleteLayerClip, importMediaAssetToLayeredFilm, splitLayerClipAtTime } from "./layer_engine";
import { addLayer, deleteLayer } from "./layer_manager";

type Edit =
  | { op: "addLayer"; label: string }
  | { op: "import"; filename: string; type: "video" | "audio" | "image"; duration: number; position: number }
  | { op: "split"; clipPick: number; at: number }
  | { op: "deleteClip"; clipPick: number }
  | { op: "deleteLayer"; layerPick: number };

/** Few labels and file names, so the same id base is made over and over. */
const LABELS = ["Music", "B-roll", "Music", "Titles"] as const;
const FILENAMES = ["clip.mp4", "clip.mp4", "song.wav", "photo.png"] as const;

// Builds the small starting film: a voiceover lane with one narration clip and a titles lane with one text clip.
function startFilm(): LayeredFilm {
  const clip = (id: string, layerId: string, kind: Clip["kind"], payload: Record<string, unknown>): Clip => ({ id, layerId, position: 0, start: 0, end: 10, kind, payload, volume: 1, opacity: 1 }) as Clip;
  return {
    id: "ids-film",
    title: "Layer id property film",
    fps: 30,
    accent: "#FF6B00",
    canvas: { nodes: [{ id: "n1", label: "Node 1", x: 0, y: 0, w: 190, h: 62 }], edges: [] },
    chapters: ["Ch 1"],
    layers: [
      { id: "layer-audio", number: 0, label: "Audio", locked: false, hidden: false, muted: false, height: 48 },
      { id: "layer-titles", number: 30, label: "Titles", locked: false, hidden: false, muted: false, height: 48 },
    ],
    clips: [clip("clip-vo", "layer-audio", "audio", { src: "voiceover.wav", channel: "voiceover" }), clip("clip-title", "layer-titles", "text", { text: "Hello", size: "headline" })],
  } as LayeredFilm;
}

// Draws a random edit sequence of 1 to 30 edits.
function genEdits(rand: Rand): Edit[] {
  return Array.from({ length: randInt(rand, 1, 30) }, (): Edit => {
    const roll = rand();
    if (roll < 0.3) return { op: "addLayer", label: pick(rand, LABELS) };
    if (roll < 0.6) return { op: "import", filename: pick(rand, FILENAMES), type: pick(rand, ["video", "audio", "image"] as const), duration: Number(randFloat(rand, 0.5, 12).toFixed(2)), position: Number(randFloat(rand, 0, 20).toFixed(2)) };
    if (roll < 0.8) return { op: "split", clipPick: rand(), at: rand() };
    if (roll < 0.9) return { op: "deleteClip", clipPick: rand() };
    return { op: "deleteLayer", layerPick: rand() };
  });
}

// Applies one edit; a refusal the model names on purpose (a TimelineEditError or the only-layer and slot-limit errors) leaves the film as it was.
function apply(film: LayeredFilm, edit: Edit): LayeredFilm {
  try {
    switch (edit.op) {
      case "addLayer":
        return addLayer(film, edit.label).film;
      case "import":
        return importMediaAssetToLayeredFilm(film, { filename: edit.filename, src: `media/${edit.filename}`, type: edit.type, duration: edit.duration }, edit.position).film;
      case "split": {
        if (film.clips.length === 0) return film;
        const clip = film.clips[Math.floor(edit.clipPick * film.clips.length)];
        return splitLayerClipAtTime(film, clip.id, clip.position + (clip.end - clip.start) * (0.05 + 0.9 * edit.at)).film;
      }
      case "deleteClip": {
        if (film.clips.length === 0) return film;
        return deleteLayerClip(film, film.clips[Math.floor(edit.clipPick * film.clips.length)].id).film;
      }
      case "deleteLayer":
        return deleteLayer(film, film.layers[Math.floor(edit.layerPick * film.layers.length)].id).film;
    }
  } catch (error) {
    if (error instanceof TimelineEditError || (error instanceof Error && /^Cannot (add another|delete the only)/.test(error.message))) return film;
    throw error;
  }
}

// Returns the values that appear more than once.
const duplicates = (values: string[]) => values.filter((v, i) => values.indexOf(v) !== i);

test("layer and clip ids stay unique and every reference stays valid across random edit sequences", () => {
  forAll("timeline ids", genEdits, (edits) => {
    let film = startFilm();
    edits.forEach((edit, step) => {
      film = apply(film, edit);
      const where = `after edit ${step + 1} (${edit.op})`;
      assert.deepEqual(duplicates(film.layers.map((l) => l.id)), [], `duplicate layer ids ${where}`);
      assert.deepEqual(duplicates(film.clips.map((c) => c.id)), [], `duplicate clip ids ${where}`);
      assert.deepEqual(duplicates(film.layers.map((l) => String(l.number))), [], `duplicate layer numbers ${where}`);
      const layerIds = new Set(film.layers.map((l) => l.id));
      const clipIds = new Set(film.clips.map((c) => c.id));
      for (const clip of film.clips) {
        assert.ok(layerIds.has(clip.layerId), `clip ${clip.id} sits on missing layer ${clip.layerId} ${where}`);
        assert.ok(!clip.linkedClipId || clipIds.has(clip.linkedClipId), `clip ${clip.id} links to missing clip ${clip.linkedClipId} ${where}`);
      }
      assert.doesNotThrow(() => validateLayeredFilm(film), `the film validates ${where}`);
    });
  }, { cases: 300 });
});
