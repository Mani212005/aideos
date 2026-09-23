/**
 * File Description: Tests for the scene-film kit.
 * Covers the timeline builder's continuity, single-origin and overrun rules, audio-first cues
 * (including the failure when a cued word is no longer spoken), and the stage geometry helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Timeline, createCues, shotFrames, rectInside, SAFE_SQUARE, FORMAT_WINDOWS, type NarrationTiming } from "./index";

const TIMING: NarrationTiming = {
  totalDurationSec: 4,
  segments: [
    { shotId: "one", text: "The craft leaves home.", startSec: 0, durationSec: 2, words: [
      { word: "The", startSec: 0.1, endSec: 0.3 }, { word: "craft", startSec: 0.3, endSec: 0.7 },
      { word: "leaves", startSec: 0.7, endSec: 1.1 }, { word: "home.", startSec: 1.1, endSec: 1.6 },
    ] },
    { shotId: "two", text: "It keeps going.", startSec: 2, durationSec: 2, words: [
      { word: "It", startSec: 2.1, endSec: 2.3 }, { word: "keeps", startSec: 2.3, endSec: 2.7 }, { word: "going.", startSec: 2.7, endSec: 3.2 },
    ] },
  ],
};

test("sceneKit: a clip that does not start where the last one ended is refused as a snap", () => {
  const t = new Timeline("t", 100).add({ id: "a", targets: ["x"], property: "opacity", from: 1, to: 0, start: 0, end: 10 });
  assert.throws(() => t.add({ id: "b", targets: ["x"], property: "opacity", from: 1, to: 0.5, start: 10, end: 20 }), /visible snap/);
  assert.doesNotThrow(() => t.add({ id: "c", targets: ["x"], property: "opacity", from: 0, to: 1, start: 10, end: 20 }));
  assert.doesNotThrow(() => t.add({ id: "d", targets: ["x"], property: "opacity", from: 0.2, to: 1, start: 20, end: 30, allowJump: true }));
});

test("sceneKit: one element may only ever have one transform origin", () => {
  const t = new Timeline("t", 100).add({ id: "a", targets: ["x"], property: "scale", from: 1, to: 2, start: 0, end: 10, origin: { x: 0, y: 0 } });
  assert.throws(() => t.add({ id: "b", targets: ["x"], property: "rotate", from: 0, to: 90, start: 10, end: 20, origin: { x: 5, y: 5 } }), /One element, one origin/);
});

test("sceneKit: clips may not run past the film or have no duration", () => {
  const t = new Timeline("t", 30);
  assert.throws(() => t.add({ id: "a", targets: ["x"], property: "opacity", from: 1, to: 0, start: 20, end: 40 }), /past the film/);
  assert.throws(() => t.add({ id: "b", targets: ["x"], property: "opacity", from: 1, to: 0, start: 10, end: 10 }), /not after start/);
  assert.equal(t.build().clips.length, 0);
});

test("sceneKit: shot spans and cues come from the measured narration", () => {
  const { spans, durationFrames } = shotFrames(TIMING);
  assert.deepEqual(spans.get("one"), { from: 0, to: 60 });
  assert.deepEqual(spans.get("two"), { from: 60, to: 120 });
  assert.equal(durationFrames, 120);
  const cues = createCues(TIMING);
  assert.equal(cues.from("two"), 60);
  assert.equal(cues.at("one", 0.5), 30);
  assert.equal(cues.word("one", "leaves home"), 21);
  assert.equal(cues.word("one", "leaves home", "end"), 48);
  assert.throws(() => cues.word("two", "leaves"), /is not spoken in shot "two"/);
  assert.throws(() => cues.from("three"), /No shot "three"/);
});

test("sceneKit: the safe square is inside both format windows", () => {
  assert.ok(rectInside(SAFE_SQUARE, FORMAT_WINDOWS.wide));
  assert.ok(rectInside(SAFE_SQUARE, FORMAT_WINDOWS.reel));
  assert.ok(!rectInside({ x0: 0, y0: 0, x1: 100, y1: 100 }, SAFE_SQUARE));
});
