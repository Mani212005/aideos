/**
 * File Description: Computes the format-safe media, scrim and caption geometry for full-screen B-roll heroes,
 * and owns the single definition of where a reel's burned-in subtitle band starts so the two never collide.
 */

import type { Format } from "./tokens";

/**
 * Top edge of the burned-in subtitle card, as a fraction of frame height.
 * `KineticSubtitles` positions its "bottom" card here and this module keeps hero
 * captions out of the same band, so the two layouts are derived from one number
 * rather than independently guessed (see src/dl/README.md on the reel safe area).
 */
export const SUBTITLE_BAND_TOP_RATIO = 0.82;

export type FullScreenHeroLayoutInput = {
  format: Format;
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  /** Rendered height of one caption line, in render pixels. */
  labelHeight: number;
};

export type FullScreenHeroLayout = {
  media: {
    width: "100%";
    height: "100%";
    objectFit: "cover";
    objectPosition: string;
  };
  /** Top-and-bottom scrim keeping the caption and the chapter HUD readable over live footage. */
  scrimStops: { offset: number; alpha: number }[];
  caption: { left: number; top?: number; bottom?: number };
  /** Vertical band the caption occupies, in render pixels, for collision checks. */
  captionBand: { top: number; bottom: number };
  /** Top of the burned-in subtitle card, in render pixels. */
  subtitleBandTop: number;
  /** Frame height, so callers and tests can express clearance as a fraction of it. */
  frameHeight: number;
};

/**
 * A `fullScreenHero` block owns the frame, so the media covers it in both formats rather than
 * being letterboxed. The focal bias sits slightly above centre because framed B-roll subjects
 * sit above the midline more often than below it.
 */
const MEDIA: FullScreenHeroLayout["media"] = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "50% 45%",
};

/** Darkens only the two edges that carry text, leaving the middle of the shot at full exposure. */
const SCRIM_STOPS = [
  { offset: 0, alpha: 0.52 },
  { offset: 0.32, alpha: 0.08 },
  { offset: 0.6, alpha: 0.1 },
  { offset: 1, alpha: 0.72 },
];

/**
 * Returns edge-to-edge media plus a caption placement that clears every piece of bottom chrome.
 *
 * The bottom of either frame is already spoken for: a reel burns in its subtitle card over the
 * bottom fifth, and both cuts draw the chapter rail just above the bottom margin. So the hero
 * label lives in the top margin on both canvases. That also keeps the two deliverables the same
 * film rather than two per-format designs (see `Format` in src/dl/tokens.ts).
 */
export const getFullScreenHeroLayout = ({
  height,
  margin,
  labelHeight,
}: FullScreenHeroLayoutInput): FullScreenHeroLayout => {
  return {
    media: MEDIA,
    scrimStops: SCRIM_STOPS,
    caption: { left: margin.left, top: margin.top },
    captionBand: { top: margin.top, bottom: margin.top + labelHeight },
    subtitleBandTop: height * SUBTITLE_BAND_TOP_RATIO,
    frameHeight: height,
  };
};

// Builds the hero scrim as a CSS gradient from the canvas colour and the shared stop table.
export const heroScrimGradient = (
  stops: { offset: number; alpha: number }[],
  toRgba: (alpha: number) => string,
): string =>
  `linear-gradient(to bottom, ${stops
    .map((stop) => `${toRgba(stop.alpha)} ${Math.round(stop.offset * 100)}%`)
    .join(", ")})`;
