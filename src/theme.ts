import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";
import { Easing, useVideoConfig } from "remotion";

// Fonts are loaded at module scope so Remotion blocks rendering until they are ready.
// Without this, headless Chrome silently falls back to Helvetica mid-render.
export const { fontFamily: SANS } = loadInter("normal", {
  weights: ["400", "500", "600", "700", "800", "900"],
  subsets: ["latin"],
});

export const { fontFamily: SERIF } = loadSerif("italic", {
  weights: ["400"],
  subsets: ["latin"],
});

import { THEMES, type ThemePack } from "./palette";
import { ACTIVE_EPISODE } from "./activeEpisode";
import type { Accent } from "./schema";

export type { Accent } from "./schema";
export type { ThemePack } from "./palette";

/**
 * The active theme pack, chosen by the episode rather than hardcoded here.
 * Components read `COLOR` exactly as before, so swapping `theme: "circuit"` in an
 * episode re-skins the whole video without touching a component.
 */
export const THEME: ThemePack = THEMES[ACTIVE_EPISODE.theme];

/**
 * Neutrals plus the resolved accents. `green`/`purple` are kept as aliases for
 * `primary`/`secondary` so the leaf-specific 3D code and charts stay readable —
 * they are the same two colours, named for what this episode uses them for.
 */
export const COLOR = {
  bgDeep: THEME.bgDeep,
  bgLift: THEME.bgLift,
  inkHigh: THEME.inkHigh,
  inkMid: THEME.inkMid,
  inkLow: THEME.inkLow,
  hairline: THEME.hairline,
  glass: THEME.glass,

  green: THEME.primary.base,
  greenDeep: THEME.primary.deep,
  greenGlow: THEME.primary.glow,

  purple: THEME.secondary.base,
  purpleDeep: THEME.secondary.deep,
  purpleGlow: THEME.secondary.glow,
} as const;

export const accentOf = (accent: Accent) => {
  if (accent === "primary") return THEME.primary;
  if (accent === "secondary") return THEME.secondary;
  return { base: THEME.inkHigh, deep: "#1B2229", glow: "#6E7B84" };
};

/** The accent a scene is *not* using — drives the `~word~` marker. */
export const oppositeAccentOf = (accent: Accent) =>
  accentOf(accent === "primary" ? "secondary" : "primary");

/**
 * Motion curves. A single shared vocabulary is what makes independently animated
 * elements feel like one piece rather than a pile of tweens.
 */
export const EASE = {
  /** Decelerate hard — the workhorse for anything entering frame. */
  out: Easing.bezier(0.16, 1, 0.3, 1),
  /** Symmetric, for camera moves and colour washes. */
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  /** Slight overshoot, for accents that should feel physical. */
  overshoot: Easing.bezier(0.34, 1.56, 0.64, 1),
  /** Fast exit — leaving frame should never be as slow as entering it. */
  in: Easing.bezier(0.7, 0, 0.84, 0),
} as const;

export type LayoutMode = "landscape" | "portrait" | "square";

export type Layout = {
  mode: LayoutMode;
  width: number;
  height: number;
  /** Multiplier applied to every type size and gap. */
  scale: number;
  /** Inset from the frame edge that content never crosses. */
  safe: number;
  /** Width of the text column. */
  columnWidth: number;
  /** Where the text column sits, as a fraction of the frame. */
  textAnchor: { x: number; y: number };
  /** Where the leaf should sit on screen, 0..1 of the frame, y measured downward. */
  subjectOffset: { x: number; y: number };
  /** Extra camera pull-back, since portrait sees less horizontally. */
  cameraDistanceBias: number;
  type: {
    display: number;
    h1: number;
    h2: number;
    body: number;
    kicker: number;
  };
};

/**
 * The old version hardcoded x offsets of +300/-450px tuned for a 1920-wide frame,
 * so the 1080-wide portrait and square comps pushed content off the canvas.
 * Layout is now derived from the aspect ratio instead.
 */
export const useLayout = (): Layout => {
  const { width, height } = useVideoConfig();
  const aspect = width / height;

  if (aspect > 1.2) {
    // Landscape: text in a left column, leaf living in the right two-fifths.
    return {
      mode: "landscape",
      width,
      height,
      scale: width / 1920,
      safe: 104 * (width / 1920),
      columnWidth: width * 0.42,
      textAnchor: { x: 0.06, y: 0.5 },
      subjectOffset: { x: 0.72, y: 0.5 },
      cameraDistanceBias: 0,
      type: { display: 78, h1: 56, h2: 38, body: 26, kicker: 15 },
    };
  }

  if (aspect < 0.85) {
    // Portrait: leaf up top, text in the lower third where thumbs do not cover it.
    return {
      mode: "portrait",
      width,
      height,
      scale: width / 1080,
      safe: 72 * (width / 1080),
      columnWidth: width * 0.88,
      textAnchor: { x: 0.5, y: 0.7 },
      subjectOffset: { x: 0.5, y: 0.25 },
      // Pulled well back: the blade plus petiole is ~8 units tall, and in a 9:16
      // frame a leaf sized for landscape drops its stem straight into the copy.
      cameraDistanceBias: 3.2,
      type: { display: 76, h1: 58, h2: 40, body: 29, kicker: 16 },
    };
  }

  // Square: leaf behind, text on the lower half.
  return {
    mode: "square",
    width,
    height,
    scale: width / 1080,
    safe: 76 * (width / 1080),
    columnWidth: width * 0.84,
    textAnchor: { x: 0.5, y: 0.66 },
    subjectOffset: { x: 0.5, y: 0.25 },
    cameraDistanceBias: 2.2,
    type: { display: 66, h1: 50, h2: 36, body: 26, kicker: 15 },
  };
};

/** Resolve a type token to pixels for the current layout. */
export const t = (layout: Layout, token: keyof Layout["type"]) =>
  layout.type[token] * layout.scale;
