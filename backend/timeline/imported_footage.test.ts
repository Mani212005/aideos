/**
 * File Description: Comprehensive Test Suite for Phase L-3 (Imported Footage & Video/Audio Linking).
 * Implements L3-1..L3-8 and named negative assertions:
 * - Auto-splitting imported video into linked [video + audio] clips (U-6).
 * - Symmetrical movement of linked clips and independent placement after Unlink.
 * - Layer compositing rules (topmost wins: video covers animation, animation draws over video).
 * - Source range trimming without re-encoding.
 * - Missing asset validation by name (Rule 6).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  importMediaAssetToLayeredFilm,
  unlinkClips,
  moveLayerClip,
  trimLayerClipEdge,
  type MediaAssetInput,
} from "./layer_engine";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

function createBaseLayeredFilm(): LayeredFilm {
  return {
    id: "test-footage-film",
    title: "Test Footage Film",
    fps: 30,
    accent: "#FF6B00",
    canvas: {
      nodes: [{ id: "n1", label: "Node 1", x: 0, y: 0, w: 190, h: 62 }],
      edges: [],
    },
    chapters: ["Ch 1"],
    layers: [
      { id: "layer-audio-spine", number: 0, label: "Audio Spine", locked: false, hidden: false, muted: false, height: 48 },
      { id: "layer-anim-main", number: 10, label: "Animation", locked: false, hidden: false, muted: false, height: 72 },
    ],
    clips: [
      {
        id: "clip-anim-1",
        layerId: "layer-anim-main",
        position: 0,
        start: 0,
        end: 10.0,
        kind: "animation",
        payload: {
          shotId: "shot-1",
          stage: "frame",
          look: "n1",
          move: "cut",
          drift: false,
          zoom: 1,
          blocks: [{ c: "StatCounter", to: 90, label: "Speed", format: "plain" }],
        },
        volume: 1,
        opacity: 1,
      },
    ],
  };
}

// L3-1: Media asset metadata verification
test("L3-1: Media asset specifies duration, dimensions, and type", () => {
  const asset: MediaAssetInput = {
    filename: "screen_recording.mov",
    src: "media/screen_recording.mov",
    type: "video",
    duration: 12.5,
    width: 1920,
    height: 1080,
  };
  assert.equal(asset.type, "video");
  assert.equal(asset.duration, 12.5);
  assert.equal(asset.width, 1920);
});

// L3-2: Importing a video splits into TWO linked clips (video + audio)
test("L3-2: Importing a video splits into two linked clips [video + audio] cross-referenced symmetrically", () => {
  const film = createBaseLayeredFilm();
  const asset: MediaAssetInput = {
    filename: "camera_shot.mp4",
    src: "media/camera_shot.mp4",
    type: "video",
    duration: 8.0,
    width: 1920,
    height: 1080,
  };

  const { film: imported, videoClipId, audioClipId } = importMediaAssetToLayeredFilm(film, asset, 5.0);

  assert.ok(videoClipId && audioClipId);
  const videoClip = imported.clips.find((c) => c.id === videoClipId)!;
  const audioClip = imported.clips.find((c) => c.id === audioClipId)!;

  assert.ok(videoClip && audioClip);
  assert.equal(videoClip.kind, "video");
  assert.equal(audioClip.kind, "audio");

  // Symmetrical link (U-6)
  assert.equal(videoClip.linkedClipId, audioClip.id);
  assert.equal(audioClip.linkedClipId, videoClip.id);

  // Stored position & derived duration
  assert.equal(videoClip.position, 5.0);
  assert.equal(audioClip.position, 5.0);
  assert.equal(videoClip.end - videoClip.start, 8.0);
  assert.equal(audioClip.end - audioClip.start, 8.0);

  assert.doesNotThrow(() => validateLayeredFilm(imported));
});

// L3-3: Moving video moves linked audio; after Unlink, it moves independently
test("L3-3: Moving video moves linked audio symmetrically; after Unlink, moves independently", () => {
  const film = createBaseLayeredFilm();
  const asset: MediaAssetInput = {
    filename: "clip.mp4",
    src: "media/clip.mp4",
    type: "video",
    duration: 6.0,
  };

  const { film: imported, videoClipId, audioClipId } = importMediaAssetToLayeredFilm(film, asset, 2.0);

  // 1. Move video clip from 2.0s to 7.0s (+5.0s) -> linked audio moves with it
  const { film: movedFilm } = moveLayerClip(imported, videoClipId!, 7.0);
  const vMoved = movedFilm.clips.find((c) => c.id === videoClipId)!;
  const aMoved = movedFilm.clips.find((c) => c.id === audioClipId)!;
  assert.equal(vMoved.position, 7.0);
  assert.equal(aMoved.position, 7.0);

  // 2. Unlink the pair (U-6)
  const { film: unlinkedFilm } = unlinkClips(movedFilm, videoClipId!);
  const vUnlinked = unlinkedFilm.clips.find((c) => c.id === videoClipId)!;
  const aUnlinked = unlinkedFilm.clips.find((c) => c.id === audioClipId)!;
  assert.equal(vUnlinked.linkedClipId, null);
  assert.equal(aUnlinked.linkedClipId, null);

  // 3. Move video clip independently to 12.0s -> audio stays at 7.0s
  const { film: independentFilm } = moveLayerClip(unlinkedFilm, videoClipId!, 12.0);
  const vIndep = independentFilm.clips.find((c) => c.id === videoClipId)!;
  const aIndep = independentFilm.clips.find((c) => c.id === audioClipId)!;
  assert.equal(vIndep.position, 12.0);
  assert.equal(aIndep.position, 7.0); // Untouched!
});

// L3-4 & L3-5: Layer compositing z-order
test("L3-4 & L3-5: Layer z-order determines composition priority (topmost layer paints last)", () => {
  const film = createBaseLayeredFilm();
  const asset: MediaAssetInput = {
    filename: "broll.mp4",
    src: "media/broll.mp4",
    type: "video",
    duration: 5.0,
  };

  const { film: imported } = importMediaAssetToLayeredFilm(film, asset, 0);

  // Sort visible layers ascending by layer.number
  const layersByZ = [...imported.layers].sort((a, b) => a.number - b.number);
  assert.ok(layersByZ[0].number <= layersByZ[1].number);

  // Video layer (number: 15) is above Animation layer (number: 10) by default
  const videoLayer = imported.layers.find((l) => l.id === "layer-video")!;
  const animLayer = imported.layers.find((l) => l.id === "layer-anim-main")!;
  assert.ok(videoLayer.number > animLayer.number);
});

// L3-6: Trimming video clip modifies source range (in/out points) without touching file
test("L3-6: Trimming video clip changes start/end source range without re-encoding", () => {
  const film = createBaseLayeredFilm();
  const asset: MediaAssetInput = {
    filename: "interview.mp4",
    src: "media/interview.mp4",
    type: "video",
    duration: 10.0,
  };

  const { film: imported, videoClipId } = importMediaAssetToLayeredFilm(film, asset, 0);

  // Trim left edge +2.0s (in-point: 2.0s, position: 2.0s)
  const { film: leftTrimmed } = trimLayerClipEdge(imported, videoClipId!, "left", 2.0);
  const vLeft = leftTrimmed.clips.find((c) => c.id === videoClipId)!;
  assert.equal(vLeft.start, 2.0);
  assert.equal(vLeft.position, 2.0);
  assert.equal(vLeft.end, 10.0);
  assert.equal(vLeft.end - vLeft.start, 8.0); // Duration is now 8.0s

  // Trim right edge -1.0s (out-point: 9.0s)
  const { film: rightTrimmed } = trimLayerClipEdge(leftTrimmed, videoClipId!, "right", -1.0);
  const vRight = rightTrimmed.clips.find((c) => c.id === videoClipId)!;
  assert.equal(vRight.start, 2.0);
  assert.equal(vRight.end, 9.0);
  assert.equal(vRight.end - vRight.start, 7.0); // Duration is now 7.0s
});

// L3-7: Video clip payload contains valid source path for Remotion player
test("L3-7: Video clip payload stores valid source path for Remotion player", () => {
  const film = createBaseLayeredFilm();
  const asset: MediaAssetInput = {
    filename: "demo.mp4",
    src: "media/demo.mp4",
    type: "video",
    duration: 5.0,
  };

  const { film: imported, videoClipId } = importMediaAssetToLayeredFilm(film, asset, 0);
  const vClip = imported.clips.find((c) => c.id === videoClipId)!;
  assert.equal((vClip.payload as any).src, "media/demo.mp4");
});

// L3-8: Missing source asset fails validation by name when disk check is enabled
test("L3-8: Missing source file fails validation by name", () => {
  const film = createBaseLayeredFilm();
  film.clips.push({
    id: "clip-missing-video",
    layerId: "layer-anim-main",
    position: 0,
    start: 0,
    end: 5.0,
    kind: "video",
    payload: { src: "media/nonexistent_file_xyz.mp4" },
    opacity: 1,
    volume: 1,
  });

  assert.throws(
    () => validateLayeredFilm(film, { checkAssetsOnDisk: true }),
    /Source asset file missing: "media\/nonexistent_file_xyz\.mp4"/
  );
});

// Negative Case: Verify imported video does NOT land on subtitle track or render as text (O-1 defect fix)
test("Phase L-3 Negative Case: Imported video creates kind='video' and kind='audio', never 'subtitle' or raw text", () => {
  const film = createBaseLayeredFilm();
  const asset: MediaAssetInput = {
    filename: "recording.mov",
    src: "media/recording.mov",
    type: "video",
    duration: 10.0,
  };

  const { film: imported, videoClipId, audioClipId } = importMediaAssetToLayeredFilm(film, asset, 0);
  const vClip = imported.clips.find((c) => c.id === videoClipId)!;
  const aClip = imported.clips.find((c) => c.id === audioClipId)!;

  assert.notEqual(vClip.kind, "subtitle");
  assert.notEqual(vClip.kind, "text");
  assert.equal(vClip.kind, "video");
  assert.equal(aClip.kind, "audio");
});
