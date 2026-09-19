/**
 * File Description: Tests for the pure edit-context modules: detectFillers, detectSilences and
 * buildEditContext. All three operate on plain data with no network or filesystem access.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { detectFillers } from "./detectFillers";
import { detectSilences } from "./detectSilences";
import { buildEditContext } from "./buildEditContext";
import type { TranscribedWord } from "../transcribe";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

/** Helper for constructing a TranscribedWord with concise positional arguments in tests. */
function word(w: string, start: number, end: number, confidence?: number): TranscribedWord {
  return { word: w, start, end, confidence };
}

test("detectFillers: flags strong fillers regardless of confidence", () => {
  const words = [word("so", 0, 0.2, 0.99), word("um", 0.2, 0.4, 0.95), word("today", 0.4, 0.8, 0.99)];
  const spans = detectFillers(words);
  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0], { startIndex: 1, endIndex: 1, start: 0.2, end: 0.4, text: "um" });
});

test("detectFillers: only flags a weak filler like 'like' when confidence is below threshold", () => {
  const confidentLike = [word("I", 0, 0.1, 0.99), word("like", 0.1, 0.3, 0.97), word("cats", 0.3, 0.6, 0.99)];
  assert.equal(detectFillers(confidentLike).length, 0, "a clearly-spoken 'like' is a real word, not a filler");

  const mumbledLike = [word("I", 0, 0.1, 0.99), word("like", 0.1, 0.3, 0.3), word("cats", 0.3, 0.6, 0.99)];
  const spans = detectFillers(mumbledLike);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].text, "like");
});

test("detectFillers: flags the 'you know' bigram only when both words are low confidence", () => {
  const lowConfidence = [
    word("it", 0, 0.1, 0.99),
    word("you", 0.1, 0.25, 0.3),
    word("know", 0.25, 0.45, 0.35),
    word("works", 0.45, 0.7, 0.99),
  ];
  const spans = detectFillers(lowConfidence);
  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0], { startIndex: 1, endIndex: 2, start: 0.1, end: 0.45, text: "you know" });
});

test("detectFillers: an empty transcript produces no spans", () => {
  assert.deepEqual(detectFillers([]), []);
});

test("detectSilences: reports a gap past the minimum, inset by the keep margin", () => {
  const words = [word("hello", 0, 0.5), word("world", 1.5, 2.0)];
  const windows = detectSilences(words, { minSilenceSec: 0.6, keepMarginSec: 0.1 });
  assert.deepEqual(windows, [{ start: 0.6, end: 1.4 }]);
});

test("detectSilences: a gap under the minimum is not reported", () => {
  const words = [word("hello", 0, 0.5), word("world", 0.7, 1.0)];
  assert.deepEqual(detectSilences(words, { minSilenceSec: 0.6 }), []);
});

test("detectSilences: never returns an inverted window when the margin would overrun the gap", () => {
  const words = [word("hello", 0, 0.5), word("world", 1.1, 1.5)];
  const windows = detectSilences(words, { minSilenceSec: 0.6, keepMarginSec: 0.3 });
  assert.deepEqual(windows, [], "a 0.6s gap inset by 0.3s on each side leaves nothing, so it must be dropped");
});

/** Builds a minimal LayeredFilm fixture with one video layer and clip for edit context tests. */
function createLayeredFilmFixture(): LayeredFilm {
  return {
    id: "ctx-fixture",
    title: "Context Fixture",
    fps: 30,
    accent: "#FF6B00",
    canvas: { nodes: [{ id: "n1", label: "Node 1", x: 0, y: 0, w: 190, h: 62 }], edges: [] },
    chapters: ["Ch 1"],
    layers: [{ id: "layer-video", number: 15, label: "Video Footage", locked: false, hidden: false, muted: true, height: 72 }],
    clips: [
      {
        id: "clip-video-1",
        layerId: "layer-video",
        position: 0,
        start: 0,
        end: 8,
        kind: "video",
        payload: { src: "media/talk.mp4" },
        opacity: 1,
        volume: 1,
      },
    ],
  };
}

test("buildEditContext: assembles lanes, clips, transcript, fillers and silences into one object", () => {
  const layered = createLayeredFilmFixture();
  const transcript = [word("hello", 0, 0.5), word("um", 0.5, 0.7), word("world", 2.0, 2.4)];
  const fillers = detectFillers(transcript);
  const silences = detectSilences(transcript, { minSilenceSec: 0.5 });

  const ctx = buildEditContext(layered, transcript, fillers, silences, { fps: 30, format: "long", durationSec: 8 });

  assert.equal(ctx.transcript, transcript);
  assert.equal(ctx.fillers, fillers);
  assert.equal(ctx.silences, silences);
  assert.deepEqual(ctx.lanes, [
    { id: "layer-video", label: "Video Footage", number: 15, hidden: false, muted: true, locked: false },
  ]);
  assert.deepEqual(ctx.clips, [{ id: "clip-video-1", kind: "video", layerId: "layer-video", position: 0, start: 0, end: 8 }]);
  assert.deepEqual(ctx.meta, { fps: 30, format: "long", durationSec: 8 });
});
