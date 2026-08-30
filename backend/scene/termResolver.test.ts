/**
 * File Description: Comprehensive test suite for Item B Kinetic Micro-Transitions & Term Resolver.
 * Asserts B-1 through B-5: keyword stem matching, caption alignment, deterministic fallback,
 * frame-budget clamping, and pure data function guarantees.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractLabelStems,
  matchTermToCaptionFrame,
  resolveBlockRevealTiming,
} from "../../src/dl/motion/termResolver";
import type { CaptionWord } from "../../src/dl/KineticSubtitles";
import type { Block, Shot } from "../../src/dl/schema";

const SAMPLE_WORDS: CaptionWord[] = [
  { text: "Because", startFrame: 338, endFrame: 350 },
  { text: "atmospheric", startFrame: 351, endFrame: 375 },
  { text: "pressure", startFrame: 376, endFrame: 400 },
  { text: "sits", startFrame: 401, endFrame: 415 },
  { text: "below", startFrame: 416, endFrame: 430 },
  { text: "the", startFrame: 431, endFrame: 436 },
  { text: "thermodynamic", startFrame: 437, endFrame: 470 },
  { text: "triple", startFrame: 471, endFrame: 495 },
  { text: "point", startFrame: 496, endFrame: 520 },
];

test("B-1: Keyword stem extraction correctly strips punctuation and stop words", () => {
  const stems1 = extractLabelStems("Mars Pressure (610 Pa)");
  assert.deepEqual(stems1, ["mars", "pressure", "610"]);

  const stems2 = extractLabelStems("Earth Triple Point");
  assert.deepEqual(stems2, ["earth", "triple", "point"]);
});

test("B-2: Match term to caption frame correctly identifies spoken keyword frames", () => {
  const frame1 = matchTermToCaptionFrame("Mars Pressure", SAMPLE_WORDS);
  assert.equal(frame1, 376); // matches "pressure"

  const frame2 = matchTermToCaptionFrame("Earth Triple Point", SAMPLE_WORDS);
  assert.equal(frame2, 471); // matches "triple"
});

test("B-3: Terms absent from captions fall back to deterministic even distribution within shot bounds", () => {
  const block: Block = {
    c: "ScaleBar",
    ticks: ["10%", "30%", "60%", "100%"],
    value: 0.75,
  };
  const shot: Shot = {
    id: "shot-scale",
    dur: 5.0,
    stage: "frame",
    look: "node-1",
    move: "pan",
    drift: false,
    zoom: 1,
    blocks: [block],
  };

  const timing = resolveBlockRevealTiming(block, shot, 100, 250, []);
  assert.equal(timing.revealFrames.length, 4);

  // Assert frames are ascending and strictly within [100, 250]
  for (let i = 0; i < timing.revealFrames.length; i++) {
    assert.ok(timing.revealFrames[i] >= 100, `Frame ${timing.revealFrames[i]} must be >= 100`);
    assert.ok(timing.revealFrames[i] <= 250, `Frame ${timing.revealFrames[i]} must be <= 250`);
    if (i > 0) {
      assert.ok(timing.revealFrames[i] >= timing.revealFrames[i - 1], "Frames must be non-decreasing");
    }
  }
});

test("B-4: Multi-layer LayerStack timing aligns bottom and top labels with audio words", () => {
  const block: Block = {
    c: "LayerStack",
    count: 8,
    bottomLabel: "Mars Pressure (610 Pa)",
    topLabel: "Earth Triple Point",
  };
  const shot: Shot = {
    id: "shot-layer",
    dur: 8.0,
    stage: "frame",
    look: "node-2",
    move: "pan",
    drift: false,
    zoom: 1,
    blocks: [block],
  };

  const timing = resolveBlockRevealTiming(block, shot, 330, 570, SAMPLE_WORDS);
  assert.equal(timing.revealFrames.length, 8);
  assert.equal(timing.revealFrames[0], 376); // matches "pressure"
  assert.ok(timing.revealFrames[7] >= 471); // matches "triple"
});

test("B-5: Negative Case: forced extreme bounds clamp strictly within shot frame budget", () => {
  const block: Block = {
    c: "TokenStrip",
    tokens: ["Step A", "Step B", "Step C"],
    lit: [0],
  };
  const shot: Shot = {
    id: "shot-token",
    dur: 3.0,
    stage: "frame",
    look: "node-3",
    move: "cut",
    drift: false,
    zoom: 1,
    blocks: [block],
  };

  const timing = resolveBlockRevealTiming(block, shot, 0, 90, SAMPLE_WORDS);
  for (const f of timing.revealFrames) {
    assert.ok(f >= 0 && f <= 90, `Reveal frame ${f} must stay inside [0, 90]`);
  }
});
