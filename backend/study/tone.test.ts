/**
 * File Description: Expected-value tests of the per-frame tone statistics of `aideos study` method B (luma mean and percentiles, chroma magnitude) on hand-built yuv444p frames.
 * Inputs and outputs: hand-built yuv444p frames -> asserted tone statistics on the 0..1 limited-range scales.
 * Used by: npm test (found by glob).
 */

import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import { frameTone, normLuma } from "./tone";

/** A yuv444p frame of `pixels` pixels whose three planes are filled by the given functions of the pixel index. */
function frame(pixels: number, y: (i: number) => number, u: (i: number) => number, v: (i: number) => number): Uint8Array {
  const out = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    out[i] = y(i);
    out[pixels + i] = u(i);
    out[2 * pixels + i] = v(i);
  }
  return out;
}

test("tone: a neutral mid-grey frame has the grey luma at every percentile and no chroma", () => {
  const stats = frameTone(frame(100, () => 126, () => 128, () => 128), 100);
  assert.equal(stats.meanLuma, normLuma(126));
  assert.equal(stats.blackPoint, normLuma(126));
  assert.equal(stats.highlight, normLuma(126));
  assert.equal(stats.saturation, 0);
});

test("tone: chroma is the mean distance of (U, V) from the neutral point (128, 128) over 112, whichever plane the offset is in", () => {
  // Every pixel is 60 above neutral in U and 80 below it in V: a 3-4-5 triangle, so the magnitude is exactly 100.
  const stats = frameTone(frame(64, () => 16, () => 188, () => 48), 64);
  assert.equal(stats.saturation, 100 / 112);
  // Half the pixels carry that chroma and half none: the mean halves.
  const half = frameTone(frame(64, () => 16, (i) => (i < 32 ? 188 : 128), (i) => (i < 32 ? 48 : 128)), 64);
  assert.equal(half.saturation, 50 / 112);
});

test("tone: black point and highlight are the 10th and 90th percentile luma, and the mean is the plain average", () => {
  // Luma 16 for the darkest tenth, 235 for the brightest tenth, 126 for the rest. The 10th percentile is the first level holding a tenth of the pixels (16);
  // the 90th is the first level holding nine tenths (126, since the ninety darkest pixels are at or below it); the mean is the plain average.
  const stats = frameTone(frame(100, (i) => (i < 10 ? 16 : i >= 90 ? 235 : 126), () => 128, () => 128), 100);
  assert.equal(stats.blackPoint, normLuma(16));
  assert.equal(stats.highlight, normLuma(126));
  assert.equal(stats.meanLuma, normLuma((10 * 16 + 80 * 126 + 10 * 235) / 100));
});
