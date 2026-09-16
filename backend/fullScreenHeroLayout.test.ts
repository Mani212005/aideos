/**
 * File Description: Regression coverage for full-screen B-roll framing and for the reel hero caption
 * never colliding with the burned-in subtitle card.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SUBTITLE_BAND_TOP_RATIO,
  getFullScreenHeroLayout,
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
