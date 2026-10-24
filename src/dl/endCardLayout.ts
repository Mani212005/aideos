/**
 * File Description: Pure geometry for the fixed end card: where the card sits in each format (centred
 * in the stage safe area, clear of the caption card and the reel's action-button strip), the sizes of
 * every part of it, and which ink reads on the accent fill. A plain module like
 * fullScreenHeroLayout.ts, with no Remotion imports, so it is unit testable.
 * Inputs and outputs: format, frame size, rectangles to avoid and the card copy -> EndCardLayout (card rect, slot and part sizes).
 * Used by: src/dl/EndCard.tsx, backend/endCardLayout.test.ts.
 */

import type { Format } from "./tokens";
import { getFrameMargins, getStageSafeRegion, subtitleCardBottom, SUBTITLE_BAND_TOP_RATIO } from "./fullScreenHeroLayout";

/** A rectangle in render pixels. */
export type CardRect = { x: number; y: number; w: number; h: number };

/**
 * The Shorts action-button strip (like, comment, share): the right of a vertical frame from x 0.88
 * of its width, in its lower half. Mirrors REEL_ACTION_ZONE in the movable-captions work; once that
 * lands this module should import it from src/dl/captionPlacement.ts instead of keeping a copy.
 */
export const END_CARD_REEL_ACTION_ZONE = { x: 0.88, y: 0.5 } as const;

/** Authored sizes at each format's reference width (1920 long, 1080 reel), in pixels. */
const PARTS: Record<Format, {
  maxWidth: number; padX: number; padY: number; gap: number; label: number; headline: number;
  chip: number; chipHeight: number; chipPadX: number; chipGap: number; icon: number; handle: number; radius: number; gutter: number;
}> = {
  long: { maxWidth: 1000, padX: 72, padY: 60, gap: 28, label: 26, headline: 90, chip: 30, chipHeight: 84, chipPadX: 30, chipGap: 24, icon: 34, handle: 28, radius: 12, gutter: 32 },
  reel: { maxWidth: 820, padX: 56, padY: 52, gap: 26, label: 26, headline: 72, chip: 30, chipHeight: 84, chipPadX: 28, chipGap: 20, icon: 34, handle: 28, radius: 12, gutter: 24 },
};

/** Line heights of the card's type, as multiples of font size. */
const LINE = { label: 1.4, headline: 1.06, handle: 1.4 } as const;

/** Widest a Geist headline glyph runs on average, in ems; a safe over-estimate for fitting. */
const HEADLINE_EM = 0.55;

/** The smallest the card may shrink to fit a slot the owner's captions squeezed. */
const MIN_SCALE = 0.6;

/** Everything the card needs to draw itself, in render pixels. */
export interface EndCardLayout {
  card: CardRect;
  /** Where the card ended up: centred in the stage, or moved above or below the captions. */
  slot: "centre" | "upper" | "lower";
  /** How much the card shrank to fit its slot (1 when it did not). */
  scale: number;
  padX: number;
  padY: number;
  gap: number;
  radius: number;
  type: { label: number; headline: number; chip: number; handle: number };
  chip: { height: number; padX: number; gap: number; icon: number };
}

export interface EndCardLayoutInput {
  format: Format;
  width: number;
  height: number;
  /** Rectangles the card must not touch. Defaults to the bottom caption card the last shot shows. */
  avoid?: CardRect[];
  /** Whether a handle line is drawn under the chips. */
  hasHandle: boolean;
  /** The headline copy, so a longer headline is set smaller rather than overflowing. */
  headline: string;
}

// The caption card a shot shows by default: the bottom band, as wide as the subtitles may run.
export function defaultCaptionRect(width: number, height: number): CardRect {
  const top = height * SUBTITLE_BAND_TOP_RATIO;
  return { x: width * 0.07, y: top, w: width * 0.86, h: subtitleCardBottom(width, height) - top };
}

// The reel's action-button strip as a rectangle in render pixels.
export function reelActionZoneRect(width: number, height: number): CardRect {
  const x = width * END_CARD_REEL_ACTION_ZONE.x;
  const y = height * END_CARD_REEL_ACTION_ZONE.y;
  return { x, y, w: width - x, h: height - y };
}

// Whether two rectangles share any area.
export function rectsIntersect(a: CardRect, b: CardRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// The card's natural height at a given scale, from the stacked parts.
function cardHeight(p: typeof PARTS[Format], k: number, hasHandle: boolean, headline: number): number {
  const handle = hasHandle ? p.gap + p.handle * LINE.handle : 0;
  return k * (p.padY * 2 + p.label * LINE.label + p.gap + p.gap * 0.4 + p.chipHeight + handle) + headline * LINE.headline;
}

/**
 * Places the end card. It is centred in the format's stage safe area; when that position would touch
 * a rectangle to avoid (the owner moved the captions up into the middle), it moves into the band
 * above that rectangle, or below it when the band above is too small, shrinking to fit the band. In
 * the reel the card is also kept narrow enough to stay left of the action-button strip.
 */
export function getEndCardLayout(input: EndCardLayoutInput): EndCardLayout {
  const { format, width, height } = input;
  const p = PARTS[format];
  const k = width / (format === "long" ? 1920 : 1080);
  const margin = getFrameMargins(format, width);
  const region = getStageSafeRegion(format, width, height, false);
  const avoid = input.avoid ?? [defaultCaptionRect(width, height)];
  const gutter = p.gutter * k;
  const cx = (region.x0 + region.x1) / 2;

  // Half the width the card may take either side of its centre.
  let half = Math.min(cx - Math.max(region.x0, margin.left), Math.min(region.x1, width - margin.right) - cx);
  if (format === "reel") half = Math.min(half, width * END_CARD_REEL_ACTION_ZONE.x - gutter - cx);
  const fullWidth = Math.min(p.maxWidth * k, half * 2);

  // A headline longer than the default is set smaller so it never overflows the card.
  const headlineFit = (w: number, scale: number) =>
    Math.min(p.headline * k * scale, (w - p.padX * k * scale * 2) / Math.max(1, input.headline.length * HEADLINE_EM));

  const build = (scale: number, top: number, slot: EndCardLayout["slot"]): EndCardLayout => {
    const w = fullWidth * scale;
    const headline = headlineFit(w, scale);
    const h = cardHeight(p, k * scale, input.hasHandle, headline);
    return {
      card: { x: cx - w / 2, y: top, w, h },
      slot,
      scale,
      padX: p.padX * k * scale,
      padY: p.padY * k * scale,
      gap: p.gap * k * scale,
      radius: p.radius * k,
      type: { label: p.label * k * scale, headline, chip: p.chip * k * scale, handle: p.handle * k * scale },
      chip: { height: p.chipHeight * k * scale, padX: p.chipPadX * k * scale, gap: p.chipGap * k * scale, icon: p.icon * k * scale },
    };
  };

  const natural = build(1, 0, "centre");
  const centred = build(1, (region.y0 + region.y1) / 2 - natural.card.h / 2, "centre");
  const blockers = avoid.filter((r) => rectsIntersect(centred.card, { x: r.x - gutter, y: r.y - gutter, w: r.w + gutter * 2, h: r.h + gutter * 2 }));
  if (blockers.length === 0) return centred;

  // Fit the card into the band above the highest blocker, else the band below the lowest one.
  const blockTop = Math.min(...blockers.map((r) => r.y)) - gutter;
  const blockBottom = Math.max(...blockers.map((r) => r.y + r.h)) + gutter;
  const above = { y0: region.y0, y1: Math.min(region.y1, blockTop) };
  const below = { y0: Math.max(region.y0, blockBottom), y1: region.y1 };
  const aboveRoom = above.y1 - above.y0;
  const belowRoom = below.y1 - below.y0;
  const useAbove = aboveRoom >= natural.card.h * MIN_SCALE || aboveRoom >= belowRoom;
  const band = useAbove ? above : below;
  const room = Math.max(0, band.y1 - band.y0);
  const scale = Math.max(MIN_SCALE, Math.min(1, room / natural.card.h));
  const sized = build(scale, 0, useAbove ? "upper" : "lower");
  return build(scale, band.y0 + Math.max(0, (room - sized.card.h) / 2), useAbove ? "upper" : "lower");
}

// Relative luminance of a #RRGGBB colour (WCAG 2), or null when it is not one.
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

// WCAG contrast ratio between two #RRGGBB colours (1 when either cannot be read).
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 1;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The candidate ink that reads best on a fill, so a light accent gets dark type and a dark one light type.
export function readableInkOn(fill: string, candidates: string[]): string {
  return candidates.reduce((best, c) => (contrastRatio(fill, c) > contrastRatio(fill, best) ? c : best), candidates[0]);
}
