/**
 * File Description: Regression coverage for full-screen B-roll framing and for the reel hero caption
 * never colliding with the burned-in subtitle card.
 * Inputs and outputs: hero layout fixtures and screen geometries -> layout test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CAPTION_SAFE_SQUARE, FORMAT_WINDOWS } from "./sceneKit";
import {
  SUBTITLE_BAND_TOP_RATIO,
  getFullScreenHeroLayout,
  subtitleCardBottom,
  heroScrimGradient,
} from "../src/dl/fullScreenHeroLayout";

const REEL = {
  format: "reel" as const,
  width: 1080,
  height: 1920,
  margin: { top: 120, right: 64, bottom: 240, left: 64 },
  labelHeight: 17,
};

const LONG = {
  format: "long" as const,
  width: 1920,
  height: 1080,
  margin: { top: 96, right: 96, bottom: 96, left: 96 },
  labelHeight: 24,
};

// Verifies that a vertical hero covers the canvas instead of being letterboxed into a band.
test("a reel hero fills the vertical frame", () => {
  const layout = getFullScreenHeroLayout(REEL);

  assert.equal(layout.media.objectFit, "cover");
  assert.equal(layout.media.width, "100%");
  assert.equal(layout.media.height, "100%");

  // `contain` on a 16:9 source in a 9:16 frame resolves to roughly 32% of the frame height.
  // `cover` is what makes the block live up to its name, so the old behaviour must not return.
  assert.notEqual(layout.media.objectFit as string, "contain");
});

// Verifies that landscape heroes cover the canvas too, so one rule governs both cuts.
test("a landscape hero fills the horizontal frame", () => {
  const layout = getFullScreenHeroLayout(LONG);

  assert.equal(layout.media.objectFit, "cover");
  assert.equal(layout.media.height, "100%");
});

// Verifies that the reel hero caption never overlaps the burned-in subtitle card.
test("a reel hero caption clears the burned-in subtitle band", () => {
  const layout = getFullScreenHeroLayout(REEL);

  assert.equal(layout.caption.top, REEL.margin.top);
  assert.equal(layout.caption.bottom, undefined);
  assert.equal(layout.subtitleBandTop, REEL.height * SUBTITLE_BAND_TOP_RATIO);
  assert.ok(
    layout.captionBand.bottom < layout.subtitleBandTop,
    `caption band ends at ${layout.captionBand.bottom} but the subtitle card starts at ${layout.subtitleBandTop}`,
  );

  // The old placement anchored the caption to the bottom margin, which lands inside the
  // subtitle band on a 1080x1920 frame. That is the collision this test exists to prevent.
  const oldCaptionBottom = REEL.height - REEL.margin.bottom;
  assert.ok(
    oldCaptionBottom > layout.subtitleBandTop,
    "the old bottom-margin placement should be inside the subtitle band",
  );
});

// Verifies that both canvases keep the hero caption clear of all bottom chrome.
// The bottom of either frame carries the chapter rail, and a reel also carries the
// burned-in subtitle card, so the caption has to sit in the top half of the frame.
for (const input of [REEL, LONG]) {
  test(`a ${input.format} hero caption clears every piece of bottom chrome`, () => {
    const layout = getFullScreenHeroLayout(input);

    assert.equal(layout.caption.top, input.margin.top);
    assert.equal(layout.caption.bottom, undefined);
    assert.ok(
      layout.captionBand.bottom < layout.frameHeight * 0.5,
      `caption band ends at ${layout.captionBand.bottom}, below the halfway line of ${layout.frameHeight}`,
    );
    assert.ok(layout.captionBand.top >= input.margin.top);
  });
}

// Verifies that both cuts place the hero caption identically, so they stay one film.
test("both formats place the hero caption in the same corner", () => {
  const reel = getFullScreenHeroLayout(REEL);
  const long = getFullScreenHeroLayout(LONG);

  assert.equal(Object.keys(reel.caption).join(), Object.keys(long.caption).join());
  assert.equal(reel.caption.left, REEL.margin.left);
  assert.equal(long.caption.left, LONG.margin.left);
});

// Verifies that the scrim darkens only the two edges that carry text.
test("the hero scrim leaves the middle of the shot unshaded", () => {
  const layout = getFullScreenHeroLayout(REEL);
  const middle = layout.scrimStops.filter((stop) => stop.offset > 0 && stop.offset < 1);

  assert.ok(middle.length > 0, "the scrim needs interior stops or it flattens the whole frame");
  for (const stop of middle) {
    assert.ok(stop.alpha <= 0.12, `interior scrim stop at ${stop.offset} is too dark (${stop.alpha})`);
  }
  assert.ok(layout.scrimStops[0].alpha >= 0.4, "the top edge must stay readable");
  assert.ok(layout.scrimStops[layout.scrimStops.length - 1].alpha >= 0.6, "the bottom edge must stay readable");
});

// Verifies that the scrim is built from the canvas colour rather than an arbitrary black.
test("the hero scrim gradient is built from the supplied canvas colour", () => {
  const layout = getFullScreenHeroLayout(REEL);
  const gradient = heroScrimGradient(layout.scrimStops, (alpha) => `rgba(10, 10, 11, ${alpha})`);

  assert.match(gradient, /^linear-gradient\(to bottom, /);
  assert.match(gradient, /rgba\(10, 10, 11, 0\.52\) 0%/);
  assert.match(gradient, /rgba\(10, 10, 11, 0\.72\) 100%/);
});

// Verifies the caption band sits a bit higher than the old 0.82 yet still in the bottom quarter the review measures.
test("the subtitle band was raised but is still a bottom caption", () => {
  assert.ok(SUBTITLE_BAND_TOP_RATIO < 0.82, `band top ${SUBTITLE_BAND_TOP_RATIO} was not raised from 0.82`);
  assert.ok(SUBTITLE_BAND_TOP_RATIO >= 0.75, "the band left the bottom quarter, so review no longer reads it as bottom captions");
});

// Verifies the tallest caption card keeps clear of the bottom edge in both formats.
for (const [name, w, h] of [["long", 1920, 1080], ["reel", 1080, 1920]] as const) {
  test(`a two-line ${name} caption card keeps at least 6% of the frame below it`, () => {
    const clearance = (h - subtitleCardBottom(w, h)) / h;
    assert.ok(clearance >= 0.06, `only ${(clearance * 100).toFixed(1)}% of the frame is left under the caption card`);
  });
}

// Verifies the scene engine's caption-safe line sits at the band top in both format windows.
test("the scene caption-safe square ends where the subtitle band starts", () => {
  const wide = FORMAT_WINDOWS.wide;
  const reel = FORMAT_WINDOWS.reel;
  const wideBandTop = wide.y0 + (wide.y1 - wide.y0) * SUBTITLE_BAND_TOP_RATIO;
  const reelBandTop = reel.y0 + (reel.y1 - reel.y0) * SUBTITLE_BAND_TOP_RATIO;
  assert.ok(Math.abs(wideBandTop - CAPTION_SAFE_SQUARE.y1) <= 4, `wide band starts at scene y=${wideBandTop}`);
  assert.ok(reelBandTop >= CAPTION_SAFE_SQUARE.y1, `reel band starts at scene y=${reelBandTop}, above the safe line`);
});
