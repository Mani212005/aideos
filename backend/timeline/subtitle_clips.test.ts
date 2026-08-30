/**
 * File Description: Comprehensive Test Suite for Phase L-5 (Subtitles as Interactive Clips).
 * Implements L5-1..L5-5 and named negative assertions:
 * - Continuous speech coverage across voiceover (eliminates O-2 sparse gap defect).
 * - Independent cue retiming.
 * - Symmetrical cue splitting and adjacent cue merging.
 * - In-place text editing with atomic undo.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  retimeSubtitleClip,
  splitSubtitleClip,
  mergeSubtitleClips,
  editSubtitleText,
  validateSubtitleContinuousCoverage,
} from "./subtitle_engine";
import { TimelineTransactionManager } from "./updates";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

function createMockSubtitleFilm(): LayeredFilm {
  return {
    id: "test-subtitle-film",
    title: "Test Subtitle Film",
    fps: 30,
    accent: "#FF6B00",
    canvas: {
      nodes: [{ id: "n1", label: "Node 1", x: 0, y: 0, w: 190, h: 62 }],
      edges: [],
    },
    chapters: ["Ch 1"],
    layers: [
      { id: "layer-audio", number: 0, label: "Audio", locked: false, hidden: false, muted: false, height: 48 },
      { id: "layer-anim", number: 10, label: "Animation", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-subs", number: 20, label: "Subtitles", locked: false, hidden: false, muted: false, height: 40 },
    ],
    clips: [
      {
        id: "clip-vo",
        layerId: "layer-audio",
        position: 0,
        start: 0,
        end: 12.0,
        kind: "audio",
        payload: { src: "voiceover.wav", channel: "voiceover" },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-sub-1",
        layerId: "layer-subs",
        position: 0,
        start: 0,
        end: 4.0,
        kind: "subtitle",
        payload: { text: "FlashAttention speeds up attention", startFrame: 0, endFrame: 120 },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-sub-2",
        layerId: "layer-subs",
        position: 4.0,
        start: 0,
        end: 4.0,
        kind: "subtitle",
        payload: { text: "by overlapping memory transfers", startFrame: 120, endFrame: 240 },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-sub-3",
        layerId: "layer-subs",
        position: 8.0,
        start: 0,
        end: 4.0,
        kind: "subtitle",
        payload: { text: "and asynchronous tensor cores", startFrame: 240, endFrame: 360 },
        volume: 1,
        opacity: 1,
      },
    ],
  };
}

// L5-1: Continuous speech coverage across voiceover (no O-2 sparse gaps)
test("L5-1: Every second of voiceover containing speech has a corresponding caption cue", () => {
  const film = createMockSubtitleFilm();
  const speechIntervals = [
    { startSec: 0, endSec: 4.0 },
    { startSec: 4.0, endSec: 8.0 },
    { startSec: 8.0, endSec: 12.0 },
  ];

  assert.doesNotThrow(() => validateSubtitleContinuousCoverage(film, speechIntervals));
});

// L5-2: Dragging a cue changes only that cue's timing
test("L5-2: Dragging a cue changes only that cue's timing without shifting neighboring cues", () => {
  const film = createMockSubtitleFilm();
  const { film: retimed } = retimeSubtitleClip(film, "clip-sub-2", 4.5);

  const sub1 = retimed.clips.find((c) => c.id === "clip-sub-1")!;
  const sub2 = retimed.clips.find((c) => c.id === "clip-sub-2")!;
  const sub3 = retimed.clips.find((c) => c.id === "clip-sub-3")!;

  assert.equal(sub1.position, 0); // Untouched!
  assert.equal(sub2.position, 4.5); // Retimed!
  assert.equal(sub3.position, 8.0); // Untouched!
});

// L5-3: Splitting a cue produces two cues covering the original range exactly
test("L5-3: Splitting a cue produces two cues whose combined duration equals the original", () => {
  const film = createMockSubtitleFilm();
  const { film: splitFilm } = splitSubtitleClip(film, "clip-sub-1", 2.0);

  const part1 = splitFilm.clips.find((c) => c.id === "clip-sub-1-a")!;
  const part2 = splitFilm.clips.find((c) => c.id === "clip-sub-1-b")!;

  assert.ok(part1 && part2);
  assert.equal(part1.position, 0);
  assert.equal(part1.end - part1.start, 2.0);

  assert.equal(part2.position, 2.0);
  assert.equal(part2.end - part2.start, 2.0);

  // Total range covered is exactly 4.0s (0s..4.0s)
  assert.equal((part1.end - part1.start) + (part2.end - part2.start), 4.0);
  assert.doesNotThrow(() => validateLayeredFilm(splitFilm));
});

// L5-3 Merge: Merging two adjacent cues
test("L5-3 Merge: Merging two adjacent cues creates a continuous single cue", () => {
  const film = createMockSubtitleFilm();
  const { film: mergedFilm } = mergeSubtitleClips(film, "clip-sub-1", "clip-sub-2");

  const merged = mergedFilm.clips.find((c) => c.id === "clip-sub-1-merged")!;
  assert.ok(merged);
  assert.equal(merged.position, 0);
  assert.equal(merged.end - merged.start, 8.0); // 4.0s + 4.0s
  assert.equal(
    (merged.payload as any).text,
    "FlashAttention speeds up attention by overlapping memory transfers"
  );
  assert.doesNotThrow(() => validateLayeredFilm(mergedFilm));
});

// L5-4: In-place text editing persists with atomic undo
test("L5-4: In-place text editing persists with atomic undo", () => {
  const txManager = new TimelineTransactionManager(50);
  const film = createMockSubtitleFilm();

  const { film: editedFilm, actions, transactionId } = editSubtitleText(
    film,
    "clip-sub-1",
    "FlashAttention-3 GPU kernel"
  );
  const edited = editedFilm.clips.find((c) => c.id === "clip-sub-1")!;
  assert.equal((edited.payload as any).text, "FlashAttention-3 GPU kernel");

  txManager.commit(film, editedFilm, actions, "Edit text", transactionId);

  // Undo restores original text
  const undone = txManager.undo(editedFilm);
  assert.ok(undone);
  const restored = undone.film.clips.find((c) => c.id === "clip-sub-1")!;
  assert.equal((restored.payload as any).text, "FlashAttention speeds up attention");
});

// L5-5: Subtitle cue positioning matches frame accurately
test("L5-5: Subtitle cue timestamps match video frame rate exactly", () => {
  const film = createMockSubtitleFilm();
  const { film: retimed } = retimeSubtitleClip(film, "clip-sub-1", 1.5);
  const sub = retimed.clips.find((c) => c.id === "clip-sub-1")!;

  assert.equal(sub.position, 1.5);
  // Frame 45 @ 30fps
  assert.equal(Math.round(sub.position * 30), 45);
});

// Negative Case: Missing caption cue in the middle fails L5-1 coverage assertion (The O-2 defect as a test)
test("Phase L-5 Negative Case: Missing cue in the middle of active speech fails coverage gate (O-2 defect caught)", () => {
  const film = createMockSubtitleFilm();
  // Delete middle cue (4.0s .. 8.0s), creating an intentional gap
  film.clips = film.clips.filter((c) => c.id !== "clip-sub-2");

  const speechIntervals = [
    { startSec: 0, endSec: 4.0 },
    { startSec: 4.0, endSec: 8.0 }, // GAP!
    { startSec: 8.0, endSec: 12.0 },
  ];

  assert.throws(
    () => validateSubtitleContinuousCoverage(film, speechIntervals),
    /L5-1 Coverage violation: speech interval \[4\.00s\.\.8\.00s\] has no corresponding subtitle cue/
  );
});
