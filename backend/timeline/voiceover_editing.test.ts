/**
 * File Description: Comprehensive Test Suite for Phase L-4 Voiceover Editing & Close-Gap Shifts.
 * Asserts L4-1..L4-7 and named negative cases:
 * - Audio splitting preserving combined source range.
 * - Gap cutting (U-8).
 * - Close-gap with multi-track dependency shifting (U-9).
 * - Real-time sync drift monitoring.
 * - Real PCM waveform peak extraction.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  splitAudioClip,
  deleteAudioSection,
  closeAudioGapWithDependencies,
  calculateSyncDrift,
  extractAudioPeaks,
} from "./voiceover_engine";
import { TimelineTransactionManager } from "./updates";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import type { LayeredFilm } from "../../src/dl/layeredSchema";
import path from "path";

function createMockAudioFilm(): LayeredFilm {
  return {
    id: "test-audio-film",
    title: "Test Audio Film",
    fps: 30,
    accent: "#FF6B00",
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 190, h: 62 },
        { id: "n2", label: "Node 2", x: 200, y: 0, w: 190, h: 62 },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
    chapters: ["Ch 1"],
    layers: [
      { id: "layer-audio", number: 0, label: "Audio", locked: false, hidden: false, muted: false, height: 48 },
      { id: "layer-anim", number: 10, label: "Animation", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-subs", number: 20, label: "Subtitles", locked: false, hidden: false, muted: false, height: 40 },
    ],
    clips: [
      {
        id: "clip-vo-main",
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
        id: "clip-anim-1",
        layerId: "layer-anim",
        position: 0,
        start: 0,
        end: 6.0,
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
      {
        id: "clip-anim-2",
        layerId: "layer-anim",
        position: 6.0,
        start: 0,
        end: 9.0,
        kind: "animation",
        payload: {
          shotId: "shot-2",
          stage: "frame",
          look: "n2",
          move: "pan",
          drift: false,
          zoom: 1,
          blocks: [{ c: "StatCounter", to: 99, label: "Efficiency", format: "plain" }],
        },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-sub-1",
        layerId: "layer-subs",
        position: 1.0,
        start: 0,
        end: 2.0,
        kind: "subtitle",
        payload: { text: "Welcome to Aideos", startFrame: 30, endFrame: 90 },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-sub-2",
        layerId: "layer-subs",
        position: 7.0,
        start: 0,
        end: 3.0,
        kind: "subtitle",
        payload: { text: "Autonomous video director", startFrame: 210, endFrame: 300 },
        volume: 1,
        opacity: 1,
      },
    ],
  };
}

// L4-1: Splitting voiceover at playhead produces two clips with preserved combined source range
test("L4-1: Splitting voiceover at playhead produces two clips whose combined range equals original", () => {
  const film = createMockAudioFilm();
  const origVo = film.clips.find((c) => c.id === "clip-vo-main")!;
  const origDur = origVo.end - origVo.start;

  const { film: splitFilm } = splitAudioClip(film, "clip-vo-main", 6.0);
  const part1 = splitFilm.clips.find((c) => c.id === "clip-vo-main-part1")!;
  const part2 = splitFilm.clips.find((c) => c.id === "clip-vo-main-part2")!;

  assert.ok(part1 && part2);
  assert.equal(part1.position, 0);
  assert.equal(part1.start, 0);
  assert.equal(part1.end, 6.0);

  assert.equal(part2.position, 6.0);
  assert.equal(part2.start, 6.0);
  assert.equal(part2.end, 15.0);

  // Combined duration matches original exact
  const combinedDur = (part1.end - part1.start) + (part2.end - part2.start);
  assert.equal(combinedDur, origDur);
  assert.doesNotThrow(() => validateLayeredFilm(splitFilm));
});

// L4-2: Deleting middle section leaves a silent gap (U-8)
test("L4-2: Deleting middle section leaves a gap; following clip positions remain untouched", () => {
  const film = createMockAudioFilm();
  // Split into 3 sections: 0..4s, 4..8s, 8..15s
  const { film: split1 } = splitAudioClip(film, "clip-vo-main", 4.0);
  const { film: split2 } = splitAudioClip(split1, "clip-vo-main-part2", 8.0);

  // Delete middle section (4.0s .. 8.0s)
  const { film: deletedFilm } = deleteAudioSection(split2, "clip-vo-main-part2-part1");
  assert.equal(deletedFilm.clips.some((c) => c.id === "clip-vo-main-part2-part1"), false);

  // Part 3 starts at 8.0s (leaves silent gap between 4.0s and 8.0s)
  const part3 = deletedFilm.clips.find((c) => c.id === "clip-vo-main-part2-part2")!;
  assert.equal(part3.position, 8.0);
  assert.doesNotThrow(() => validateLayeredFilm(deletedFilm));
});

// L4-3 & L4-4: Close-gap shifts audio AND dependent animation/subtitles left by exact gap length (U-9)
test("L4-3 & L4-4: Close-gap shifts following audio AND dependent animation/subtitles left by exact gap", () => {
  const film = createMockAudioFilm();
  // Split and delete 4s..7s section (3.0s gap)
  const { film: split1 } = splitAudioClip(film, "clip-vo-main", 4.0);
  const { film: split2 } = splitAudioClip(split1, "clip-vo-main-part2", 7.0);
  const { film: withGap } = deleteAudioSection(split2, "clip-vo-main-part2-part1");

  // Close the 3.0s gap at 4.0s
  const { film: closedFilm } = closeAudioGapWithDependencies(withGap, 4.0, 3.0);

  // 1. Audio part 2 shifted from 7.0s to 4.0s (-3.0s)
  const audioPart2 = closedFilm.clips.find((c) => c.id === "clip-vo-main-part2-part2")!;
  assert.equal(audioPart2.position, 4.0);

  // 2. Dependent animation clip 2 shifted from 6.0s (inside gap) to 4.0s (following anim1 which was trimmed to 0..4.0s)
  const anim2 = closedFilm.clips.find((c) => c.id === "clip-anim-2")!;
  assert.equal(anim2.position, 4.0);

  // 3. Dependent subtitle clip 2 shifted from 7.0s to 4.0s (-3.0s)
  const sub2 = closedFilm.clips.find((c) => c.id === "clip-sub-2")!;
  assert.equal(sub2.position, 4.0);

  // 4. Earlier clip 1s before gap remain untouched
  const anim1 = closedFilm.clips.find((c) => c.id === "clip-anim-1")!;
  const sub1 = closedFilm.clips.find((c) => c.id === "clip-sub-1")!;
  assert.equal(anim1.position, 0);
  assert.equal(sub1.position, 1.0);

  assert.doesNotThrow(() => validateLayeredFilm(closedFilm));
});

// L4-5: Sync indicator reports drift accurately
test("L4-5: Sync indicator reports drift accurately after duration alteration", () => {
  const film = createMockAudioFilm();
  // Initial state: visual duration = 15.0s, audio duration = 15.0s -> drift = 0
  const report1 = calculateSyncDrift(film);
  assert.equal(report1.isSynchronized, true);
  assert.equal(report1.driftSec, 0);

  // Extend animation clip 2 by +3.0s (total visual = 18.0s, audio = 15.0s)
  film.clips[2].end = 12.0; // was 9.0
  const report2 = calculateSyncDrift(film);
  assert.equal(report2.isSynchronized, false);
  assert.equal(report2.driftSec, 3.0);
  assert.ok(report2.statusLabel.includes("+3.0s"));
});

// L4-6: Real PCM waveform peak extraction
test("L4-6: Waveform extraction produces normalized amplitude peaks", () => {
  const sampleAudio = path.resolve(__dirname, "../../public/voiceover.wav");
  const waveData = extractAudioPeaks(sampleAudio, 50);
  assert.equal(waveData.peaks.length, 50);
  for (const p of waveData.peaks) {
    assert.ok(p >= 0 && p <= 1.0, `Peak ${p} must be normalized in [0, 1]`);
  }
});

// L4-7: Undo reverses close-gap and restores all dependent tracks
test("L4-7: Undo reverses close-gap transaction and restores all dependent tracks", () => {
  const txManager = new TimelineTransactionManager<LayeredFilm>(50);
  const film = createMockAudioFilm();

  const { film: split1 } = splitAudioClip(film, "clip-vo-main", 4.0);
  const { film: split2 } = splitAudioClip(split1, "clip-vo-main-part2", 7.0);
  const { film: withGap } = deleteAudioSection(split2, "clip-vo-main-part2-part1");

  const { film: closedFilm, actions, transactionId } = closeAudioGapWithDependencies(withGap, 4.0, 3.0);
  txManager.commit(withGap, closedFilm, actions, "Close 3s gap", transactionId);

  // Undo transaction
  const undone = txManager.undo(closedFilm);
  assert.ok(undone);
  assert.deepEqual(undone.film, withGap);

  // Verified dependent animation 2 is back at 6.0s and subtitle 2 at 7.0s
  const restoredAnim2 = undone.film.clips.find((c) => c.id === "clip-anim-2")!;
  const restoredSub2 = undone.film.clips.find((c) => c.id === "clip-sub-2")!;
  assert.equal(restoredAnim2.position, 6.0);
  assert.equal(restoredSub2.position, 7.0);
});

// Negative Case: Attempting to split non-audio clip as audio throws error
test("L4 Negative Case: Attempting to split non-audio clip with splitAudioClip throws error", () => {
  const film = createMockAudioFilm();
  assert.throws(
    () => splitAudioClip(film, "clip-anim-1", 2.0),
    /is of kind "animation", not audio/
  );
});
