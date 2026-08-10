import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadSerif } from "@remotion/google-fonts/SourceSerif4";
import { useVideoConfig } from "remotion";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE — TOKENS
 * ---------------------------------------------------------------------------
 * Implements §01 Color and §02 Type of the Video Design Language.
 *
 * Loaded at module scope so Remotion blocks the render until the faces are
 * ready; without this, headless Chrome falls back to Helvetica mid-render and
 * every measurement in this file becomes a lie.
 */

/** Geist speaks. Everything a human reads as a sentence. */
export const { fontFamily: SANS } = loadGeist("normal", {
  weights: ["300", "400", "500", "600"],
  subsets: ["latin"],
});

/** Mono measures. Every number, axis label, dimension and timecode. */
export const { fontFamily: MONO } = loadMono("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});

/**
 * Italic serif holds the maths. This is the one register that says "explainer"
 * rather than "dev tooling", which is why it is never used for prose.
 */
export const { fontFamily: SERIF } = loadSerif("italic", {
  weights: ["400", "600"],
  subsets: ["latin"],
});

/**
 * Six values, no more. Anything else on screen is one of these at an alpha, and
 * the helpers below are the only sanctioned way to get there — a seventh
 * hardcoded hex is how a system stops being one.
 */
export const PALETTE = {
  /** Tactile Archival White Paper Canvas */
  canvas: "#F8F6F0",
  /** Crisp elevated cards sitting on the paper canvas. */
  surface: "#FFFFFF",
  ink: "#111827",
  muted: "#64748B",
  hairline: "rgba(17, 24, 39, 0.12)",
  /** Architectural Terracotta Accent. */
  accent: "#FF6B00",
} as const;

/** Deep slate archival ink at an arbitrary alpha. Hairlines, scrims, grid lines. */
export const ink = (alpha: number) => `rgba(17, 24, 39, ${alpha})`;

/**
 * Hairline at a multiple of its base strength. `1` is the token; `2` is the
 * emphasis used for chart axes, which need to out-read the grid behind them.
 */
export const rule = (strength = 1) => ink(0.12 * strength);

/** Muted, dimmed. Axis ticks and legend text that must sit under the labels. */
export const FAINT = "#94A3B8";

/** Surface, dimmed. A card inside a card — the only nesting depth allowed. */
export const SUNKEN = "#F1EFEA";

/** Accent at an alpha. Fills behind an active border are always this at ~0.10. */
export const accentAt = (hex: string, alpha: number) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/**
 * There are exactly two deliverables and they are the same film. `reel` is a
 * narrower camera on the canvas, not a redesign of it (§06 rule 05).
 */
export type Format = "reel" | "long";

export type TypeToken = "display" | "headline" | "subhead" | "body" | "caption";

/**
 * The scale, expressed at reel size on a 1080-wide frame. Long-form multiplies
 * every size by 1.4 and renders on a 1920-wide frame, which is why the spec
 * writes the scale as pairs: 96/134, 64/90, 40/56, 24/34, 16/22.
 */
const SCALE: Record<
  TypeToken,
  { size: number; lineHeight: number; letterSpacing: string; weight: number }
> = {
  display: { size: 96, lineHeight: 1.02, letterSpacing: "-0.03em", weight: 500 },
  headline: { size: 64, lineHeight: 1.06, letterSpacing: "-0.025em", weight: 500 },
  subhead: { size: 40, lineHeight: 1.2, letterSpacing: "-0.015em", weight: 400 },
  body: { size: 24, lineHeight: 1.5, letterSpacing: "0", weight: 400 },
  caption: { size: 16, lineHeight: 1.5, letterSpacing: "0", weight: 400 },
};

/** Long-form is the same scale, 1.4× larger on a 1.78× wider frame. */
const FORMAT_TYPE_SCALE: Record<Format, number> = { reel: 1, long: 1.4 };

/** The frame each format's absolute pixel sizes were authored against. */
const REFERENCE_WIDTH: Record<Format, number> = { reel: 1080, long: 1920 };

export type DLLayout = {
  format: Format;
  width: number;
  height: number;
  /** Scales the authored pixel values to whatever frame we actually render. */
  k: number;
  /** Content never crosses this. Reels reserve the bottom for platform chrome. */
  margin: { top: number; right: number; bottom: number; left: number };
  /** The 8px grid, in render pixels. */
  grid: number;
  radius: { card: number; inner: number; chip: number };
  type: (token: TypeToken) => {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    letterSpacing: string;
    fontWeight: number;
  };
  /** Uppercase mono label — the system's only decorative treatment. */
  label: (size?: number) => React.CSSProperties;
  /** A raw size in authored pixels, converted to render pixels. */
  px: (n: number) => number;
};

export const useLayout = (): DLLayout => {
  const { width, height } = useVideoConfig();
  const format: Format = width < height ? "reel" : "long";
  const k = width / REFERENCE_WIDTH[format];
  const typeScale = FORMAT_TYPE_SCALE[format];
  const px = (n: number) => n * k;

  // Long-form is even on all four sides. A reel is not: the bottom fifth of a
  // Reels/Shorts frame is covered by the caption, the handle and the CTA, so
  // nothing that must be read is allowed to live there.
  const margin =
    format === "long"
      ? { top: px(96), right: px(96), bottom: px(96), left: px(96) }
      : { top: px(120), right: px(64), bottom: px(240), left: px(64) };

  return {
    format,
    width,
    height,
    k,
    margin,
    grid: px(8),
    radius: { card: px(12), inner: px(8), chip: px(6) },
    px,
    type: (token) => {
      const s = SCALE[token];
      return {
        fontFamily: SANS,
        fontSize: s.size * typeScale * k,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        fontWeight: s.weight,
      };
    },
    label: (size = 16) => ({
      fontFamily: MONO,
      fontSize: size * typeScale * k * 0.75,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: PALETTE.muted,
    }),
  };
};
