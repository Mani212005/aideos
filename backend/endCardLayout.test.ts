/**
 * File Description: Covers the end card's pure geometry (src/dl/endCardLayout.ts) and its press timing
 * (src/dl/EndCard.tsx): centred in each format's stage safe area by default, moved to the upper slot
 * when the captions sit in the middle, never into the reel's action-button strip, always inside the
 * frame margins and clear of the caption card, with an accent ink that reads.
 * Inputs and outputs: format frame sizes and caption rectangles -> end card layout assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getFrameMargins, getStageSafeRegion } from "../src/dl/fullScreenHeroLayout";
import {
  contrastRatio,
  defaultCaptionRect,
  getEndCardLayout,
  readableInkOn,
  rectsIntersect,
  reelActionZoneRect,
  type CardRect,
} from "../src/dl/endCardLayout";
import { pressDepth, subscribePressFrame } from "../src/dl/EndCard";

const FORMATS = [
  { format: "long" as const, width: 1920, height: 1080 },
  { format: "reel" as const, width: 1080, height: 1920 },
];
const COPY = { hasHandle: true, headline: "Like and subscribe" };

// Asserts a rectangle lies inside the frame's margins.
function assertInsideMargins(card: CardRect, format: "long" | "reel", width: number, height: number): void {
  const m = getFrameMargins(format, width);
  assert.ok(card.x >= m.left - 0.5 && card.x + card.w <= width - m.right + 0.5, `${format}: card x ${card.x}..${card.x + card.w} inside margins`);
  assert.ok(card.y >= m.top - 0.5 && card.y + card.h <= height - m.bottom + 0.5, `${format}: card y ${card.y}..${card.y + card.h} inside margins`);
}

test("end card layout: centred in the stage safe area, clear of the caption card, inside the margins", () => {
  for (const { format, width, height } of FORMATS) {
    const layout = getEndCardLayout({ format, width, height, ...COPY });
    const region = getStageSafeRegion(format, width, height, false);
    assert.equal(layout.slot, "centre");
    assert.equal(layout.scale, 1);
    assert.ok(Math.abs(layout.card.x + layout.card.w / 2 - (region.x0 + region.x1) / 2) < 0.5, `${format}: centred horizontally`);
    assert.ok(Math.abs(layout.card.y + layout.card.h / 2 - (region.y0 + region.y1) / 2) < 0.5, `${format}: centred vertically`);
    assert.equal(rectsIntersect(layout.card, defaultCaptionRect(width, height)), false, `${format}: clear of the bottom caption card`);
    assertInsideMargins(layout.card, format, width, height);
    // Every part is set at a readable size at 1080p (labels 20 px or more).
    const k = Math.min(width, height) / 1080;
    for (const [part, size] of Object.entries(layout.type)) assert.ok(size / k >= 24, `${format}: ${part} is ${size}px`);
  }
});

test("end card layout: captions moved into the middle send the card to the upper slot", () => {
  for (const { format, width, height } of FORMATS) {
    const middle: CardRect = { x: width * 0.07, y: height * 0.45, w: width * 0.86, h: height * 0.1 };
    const layout = getEndCardLayout({ format, width, height, avoid: [middle], ...COPY });
    assert.equal(layout.slot, "upper");
    assert.ok(layout.card.y + layout.card.h <= middle.y, `${format}: the card sits above the captions`);
    assert.equal(rectsIntersect(layout.card, middle), false);
    assertInsideMargins(layout.card, format, width, height);
  }
  // Captions high in the frame leave the card the band below them.
  const high: CardRect = { x: 134, y: 130, w: 1652, h: 200 };
  const low = getEndCardLayout({ format: "long", width: 1920, height: 1080, avoid: [high], ...COPY });
  assert.equal(low.slot, "lower");
  assert.ok(low.card.y >= high.y + high.h);
});

test("end card layout: the reel card never reaches the action-button strip", () => {
  for (const width of [1080, 720]) {
    const height = (width * 16) / 9;
    const layout = getEndCardLayout({ format: "reel", width, height, ...COPY });
    assert.equal(rectsIntersect(layout.card, reelActionZoneRect(width, height)), false);
    assert.ok(layout.card.x + layout.card.w <= width * 0.88);
    const moved = getEndCardLayout({ format: "reel", width, height, avoid: [{ x: 0.07 * width, y: 0.5 * height, w: 0.86 * width, h: 0.1 * height }], ...COPY });
    assert.equal(rectsIntersect(moved.card, reelActionZoneRect(width, height)), false);
  }
});

test("end card layout: a longer headline is set smaller instead of overflowing the card", () => {
  const short = getEndCardLayout({ format: "reel", width: 1080, height: 1920, ...COPY });
  const long = getEndCardLayout({ format: "reel", width: 1080, height: 1920, hasHandle: false, headline: "Like, subscribe and share this video" });
  assert.ok(long.type.headline < short.type.headline);
  assert.ok(long.type.headline * 0.55 * 36 <= long.card.w - long.padX * 2 + 0.5);
  assert.ok(long.card.h < short.card.h, "no handle line, a shorter card");
});

test("end card ink: the SUBSCRIBE pill takes whichever ink reads on the accent", () => {
  assert.equal(readableInkOn("#635BFF", ["#0A0A0B", "#FFFFFF"]), "#FFFFFF");
  assert.equal(readableInkOn("#F5D547", ["#0A0A0B", "#FFFFFF"]), "#0A0A0B");
  assert.ok(contrastRatio("#000000", "#FFFFFF") > 20);
  assert.equal(contrastRatio("rgba(0,0,0,1)", "#FFFFFF"), 1, "only #RRGGBB is measured");
});

test("end card motion: SUBSCRIBE presses on its spoken word, or on a fixed beat when the card is silent", () => {
  const card = { from: 600, to: 780, durationInFrames: 180, lineFrom: 609 };
  const words = [{ text: "like", startFrame: 640, endFrame: 650 }, { text: "subscribe.", startFrame: 656, endFrame: 675 }];
  assert.equal(subscribePressFrame(card, words, "SUBSCRIBE", 30), 656);
  assert.equal(subscribePressFrame({ ...card, lineFrom: null }, [], "SUBSCRIBE", 30), 642);
  assert.equal(pressDepth(655, 656, 30), 0);
  assert.ok(pressDepth(658, 656, 30) > 0.9, "down fast");
  assert.equal(pressDepth(656 + 11, 656, 30), 0, "back up by the end of the press");
});
