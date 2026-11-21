/**
 * File Description: Computes the format-safe media, scrim and caption geometry for full-screen B-roll heroes,
 * owns the single definition of where the burned-in subtitle band starts so the two never collide,
 * and owns the fixed inset region a device beat occupies over a scene stage in each format.
 * Inputs and outputs: format, frame size and caption presence -> shared margins, stage safe region, hero and inset rectangles.
 * Used by: Film, devices, KineticSubtitles, tokens, stage design checks and layout tests.
 */

import type { CaptionRect } from "./captionPlacement";
import type { Format } from "./tokens";
import { projectStagePoint, SAFE_SQUARE, SCENE_SIZE, stageViewport, type SceneRect, type StageCameraPose } from "./scene/projection";

/**
 * Platform safe zone for burned-in 9:16 vertical reel captions, as fractions of the frame.
 * Sized from YouTube Shorts phone captures (also clears Instagram Reels and TikTok overlays):
 * - top header sits in y 0..8%
 * - right action-button column sits in x 87..100%, y 40..80%
 * - bottom channel/title/chips/progress block sits in y 62..100%
 * Keeping captions inside y 40..60% (bottom edge <= 60%) and x 6..84% keeps every word clear of
 * every platform overlay while staying visually prominent on a phone screen.
 */
export const REEL_CAPTION_SAFE_ZONE = {
  left: 0.06,
  right: 0.84,
  top: 0.4,
  bottom: 0.6,
  centerX: 0.45,
  width: 0.78,
  defaultY: 0.5,
} as const;

/**
 * Vertical centre of the stage in a 9:16 reel, as a fraction of frame height.
 * Shifting the stage up from 50% to 29% keeps scene artwork, characters and diagrams above the
 * 40..60% reel caption safe zone and below the 8% Shorts top header.
 */
export const REEL_STAGE_CENTER_Y_RATIO = 0.29;

// Returns the shared format chrome margins, scaled from each format's reference width.
export function getFrameMargins(format: Format, width: number) {
  const scale = width / (format === "long" ? 1920 : 1080);
  return format === "long"
    ? { top: 96 * scale, right: 96 * scale, bottom: 96 * scale, left: 96 * scale }
    : { top: 120 * scale, right: 64 * scale, bottom: 240 * scale, left: 64 * scale };
}

// Returns the default vertical centre of the stage in render pixels for a viewport.
export function stageCenterY(width: number, height: number): number {
  return width < height ? height * REEL_STAGE_CENTER_Y_RATIO : height / 2;
}

// Shifts a scene camera pose upward in 9:16 reels so stage art sits cleanly above the reel caption safe zone.
export function adjustStageCameraForFormat(
  pose: StageCameraPose,
  width: number,
  height: number,
  size: { w: number; h: number } = SCENE_SIZE,
): StageCameraPose {
  if (width >= height) return pose;
  const { fit } = stageViewport(width, height, size);
  const scale = fit * pose.zoom;
  if (!(scale > 0)) return pose;
  const shiftScene = ((0.5 - REEL_STAGE_CENTER_Y_RATIO) * height) / scale;
  const rad = (pose.rotation * Math.PI) / 180;
  return {
    ...pose,
    center: {
      x: pose.center.x + shiftScene * Math.sin(rad),
      y: pose.center.y + shiftScene * Math.cos(rad),
    },
  };
}

// Returns the default burned-in subtitle top ratio for a format.
export function subtitleBandTopRatio(format: Format): number {
  return format === "reel" ? REEL_CAPTION_SAFE_ZONE.defaultY : SUBTITLE_BAND_TOP_RATIO;
}

// Intersects the common stage square with output margins and the actual caption band.
export function getStageSafeRegion(format: Format, width: number, height: number, captions: boolean): SceneRect {
  const pose = adjustStageCameraForFormat({ center: { x: 960, y: 960 }, zoom: 1, rotation: 0 }, width, height);
  const start = projectStagePoint({ x: SAFE_SQUARE.x0, y: SAFE_SQUARE.y0 }, pose, width, height);
  const end = projectStagePoint({ x: SAFE_SQUARE.x1, y: SAFE_SQUARE.y1 }, pose, width, height);
  const margin = getFrameMargins(format, width);
  return {
    x0: Math.max(start.x, margin.left),
    y0: Math.max(start.y, margin.top),
    x1: Math.min(end.x, width - margin.right),
    y1: Math.min(end.y, height - margin.bottom, captions ? height * subtitleBandTopRatio(format) : height),
  };
}

// Returns the bounding rectangle for stage-level text cards so reel cards sit above the reel caption safe zone.
export function getStageCardRect(
  format: Format,
  width: number,
  height: number,
  margin: { top: number; right: number; bottom: number; left: number },
  captions = true,
): InsetRect {
  const bottom =
    format === "reel" && captions
      ? Math.min(height - margin.bottom, height * REEL_CAPTION_SAFE_ZONE.defaultY - 24 * (width / 1080))
      : height - margin.bottom;
  return {
    x: margin.left,
    y: margin.top,
    w: width - margin.left - margin.right,
    h: Math.max(0, bottom - margin.top),
  };
}

/**
 * Top edge of the burned-in subtitle card in widescreen 16:9, as a fraction of frame height.
 * For 9:16 reels use `REEL_CAPTION_SAFE_ZONE.defaultY` (via `subtitleBandTopRatio("reel")`).
 * `KineticSubtitles` and `fullScreenHero` derive their bands from these constants rather than
 * independently guessed numbers (see src/dl/README.md).
 */
export const SUBTITLE_BAND_TOP_RATIO = 0.78;

/** Caption font size as a fraction of the frame's short side, shared by `Film` and the card-height maths. */
export const SUBTITLE_FONT_RATIO = 0.042;
/** Line height (a multiple of font size) and vertical padding (px, each side) of the burned-in subtitle card. */
export const SUBTITLE_LINE_HEIGHT = 1.35;
export const SUBTITLE_CARD_PADDING_Y = 12;
/** Caption phrases never wrap past two lines; narrowed cards are split by measured width to preserve this bound. */
export const SUBTITLE_MAX_LINES = 2;

// Returns the rendered caption card height for the planned number of lines.
export const subtitleCardHeight = (
  width: number,
  height: number,
  lines = SUBTITLE_MAX_LINES,
): number => {
  const fontSize = Math.round(Math.min(width, height) * SUBTITLE_FONT_RATIO);
  return SUBTITLE_CARD_PADDING_Y * 2 + 2 + (fontSize * SUBTITLE_LINE_HEIGHT + 8) * lines;
};

/** Bottom edge (render px) of the tallest subtitle card a frame of this size can draw, to check it clears the frame edge. */
export const subtitleCardBottom = (
  width: number,
  height: number,
  format: Format = width < height ? "reel" : "long",
): number => {
  return height * subtitleBandTopRatio(format) + subtitleCardHeight(width, height);
};

export type FullScreenHeroLayoutInput = {
  format: Format;
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  /** Rendered height of one caption line, in render pixels. */
  labelHeight: number;
  captionRect?: CaptionRect;
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
 * The bottom of either frame is already spoken for: both formats burn in the subtitle card over the
 * bottom fifth, and both cuts draw the chapter rail just above the bottom margin. So the hero
 * label lives in the top margin on both canvases. That also keeps the two deliverables the same
 * film rather than two per-format designs (see `Format` in src/dl/tokens.ts).
 */
export const getFullScreenHeroLayout = ({
  format,
  height,
  margin,
  labelHeight,
  captionRect,
}: FullScreenHeroLayoutInput): FullScreenHeroLayout => {
  const labelTop = captionRect && captionRect.y < height / 2 ? height - margin.bottom - labelHeight : margin.top;
  return {
    media: MEDIA,
    scrimStops: SCRIM_STOPS,
    caption: { left: margin.left, top: labelTop },
    captionBand: { top: labelTop, bottom: labelTop + labelHeight },
    subtitleBandTop: height * subtitleBandTopRatio(format),
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

/** A rectangle in render pixels (or, for the scene-space variant, scene units). */
export type InsetRect = { x: number; y: number; w: number; h: number };

/**
 * The fixed region a `stage: "inset"` device occupies, as fractions of the frame. A device beat
 * shares the stage instead of covering it, so the region is a constant per format and the design
 * check keeps scene art out of it while an inset shot plays. Both edges that face captions and
 * chrome derive from the margins in `useLayout` (long: 96 px all round; reel: 120 top, 64 sides)
 * and from each format's caption band (`SUBTITLE_BAND_TOP_RATIO` for long, `REEL_CAPTION_SAFE_ZONE`
 * for reel), so moving the caption band moves the region's floor with it.
 * - long: the right third, between the top margin and the caption band.
 * - reel: the middle-upper band (y 27..47%), between the shifted stage art and the 50% caption band.
 */
const INSET_RATIOS: Record<Format, { left: number; right: number; top: number; bottom: number }> = {
  long: { left: 0.6, right: 1 - 96 / 1920, top: 96 / 1080, bottom: SUBTITLE_BAND_TOP_RATIO - 0.04 },
  reel: { left: 64 / 1080, right: 1 - 64 / 1080, top: 518 / 1920, bottom: 902 / 1920 },
};

// Returns the inset region for a format in the pixels of a frame of the given size.
export const getInsetRegion = (format: Format, width: number, height: number): InsetRect => {
  const r = INSET_RATIOS[format];
  const x = width * r.left;
  const y = height * r.top;
  return { x, y, w: width * r.right - x, h: height * r.bottom - y };
};

/** Reference frame size of each format, which is what the scene square is windowed against. */
export const INSET_FORMAT_FRAMES: Record<Format, { width: number; height: number }> = {
  long: { width: 1920, height: 1080 },
  reel: { width: 1080, height: 1920 },
};
