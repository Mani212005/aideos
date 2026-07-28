/**
 * Theme packs, with no imports.
 *
 * Dependency-free on purpose so build scripts and the storyboard generator read
 * the same values the renderer uses. Anything pulling in fonts, React or
 * `remotion` cannot be imported from plain Node.
 *
 * Accents are *roles* (`primary` / `secondary`), not pigment names. The leaf
 * episode happens to map them to chlorophyll green and anthocyanin purple; an
 * episode about tokenisation will map them to something else entirely without
 * touching a single component.
 */

export type AccentTone = {
  /** The colour itself, used for type and marks. */
  base: string;
  /** A dark variant for fills and washes. */
  deep: string;
  /** A luminous variant for glows and rim light. */
  glow: string;
};

export type ThemePack = {
  id: string;
  /** Never pure #000 — it crushes in H.264. */
  bgDeep: string;
  bgLift: string;
  inkHigh: string;
  inkMid: string;
  inkLow: string;
  hairline: string;
  glass: string;
  primary: AccentTone;
  secondary: AccentTone;
};

/** Shared neutrals. Every pack starts from these unless it overrides them. */
const NEUTRALS = {
  bgDeep: "#05070A",
  bgLift: "#0C1117",
  inkHigh: "#F2F6F3",
  inkMid: "#A6B1AB",
  inkLow: "#66716C",
  hairline: "rgba(242, 246, 243, 0.10)",
  glass: "rgba(255, 255, 255, 0.035)",
} as const;

/**
 * Botanical: chlorophyll green / anthocyanin purple.
 * Deliberately not Tailwind's #22c55e / #a855f7, which clip on consumer displays
 * and read as "web UI" rather than "film".
 */
export const BOTANICAL: ThemePack = {
  id: "botanical",
  ...NEUTRALS,
  primary: { base: "#5FE3A1", deep: "#0E5137", glow: "#2BC47E" },
  secondary: { base: "#B77BFF", deep: "#3B1D6B", glow: "#8B4DE8" },
};

/** Circuit: for machine-learning and systems topics. */
export const CIRCUIT: ThemePack = {
  id: "circuit",
  ...NEUTRALS,
  primary: { base: "#6FD5FF", deep: "#0B3A56", glow: "#2FA8E0" },
  secondary: { base: "#FFB86B", deep: "#5A320B", glow: "#E8892F" },
};

/** Signal: for news and current-affairs topics. */
export const SIGNAL: ThemePack = {
  id: "signal",
  ...NEUTRALS,
  primary: { base: "#F2F6F3", deep: "#2A3038", glow: "#9AA6AE" },
  secondary: { base: "#FF6B6B", deep: "#5A1717", glow: "#E03A3A" },
};

export const THEMES = {
  botanical: BOTANICAL,
  circuit: CIRCUIT,
  signal: SIGNAL,
} as const;

export type ThemeId = keyof typeof THEMES;

/**
 * `#rrggbb` -> `rgba(r, g, b, a)`.
 *
 * Atmosphere layers need translucent versions of the accents. Hardcoding the
 * rgba strings is what kept the glows green and purple no matter which theme was
 * selected, so every one of them is derived through here instead.
 */
export const withAlpha = (hex: string, alpha: number): string => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
