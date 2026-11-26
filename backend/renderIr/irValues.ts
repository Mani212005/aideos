/**
 * File Description: Small value helpers shared by the Render IR emitters: CSS colours normalized to the IR's `#RRGGBB` or `#RRGGBBAA`, and per-frame values compressed into the fewest linear keyframes that reproduce them at every frame.
 * Inputs and outputs: colours and per-frame value functions -> IR colour strings and keyframe lists.
 * Used by: backend/renderIr/emit.ts, backend/renderIr/emitNodeGraph.ts.
 */

import type { Keyframe } from "./schema";

/** `#RRGGBB` plus an alpha in [0, 1] as `#RRGGBBAA`. */
export function hexAlpha(hex: string, alpha: number): string {
  const base = rgbHex(hex);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return a === 255 ? base : `${base}${a.toString(16).padStart(2, "0").toUpperCase()}`;
}

/** Normalizes a `#RRGGBB` or `rgba(r, g, b, a)` CSS colour to `#RRGGBB` or `#RRGGBBAA`. */
export function cssColor(css: string): string {
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(css.trim());
  if (rgba) {
    const hex = `#${[rgba[1], rgba[2], rgba[3]].map((c) => Number(c).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    return rgba[4] === undefined ? hex : hexAlpha(hex, Number(rgba[4]));
  }
  return rgbHex(css);
}

/** Validates and upper-cases a `#RRGGBB` colour. */
export function rgbHex(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`expected a #RRGGBB colour, got ${hex}`);
  return hex.toUpperCase();
}

/**
 * Compresses per-frame values into the fewest linear keyframes that reproduce them exactly at every
 * integer frame in `[from, to]` (holding outside it): a frame is kept only where the slope changes.
 */
export function linearKeyframes(values: (f: number) => number, from: number, to: number): Keyframe[] {
  const keys: Keyframe[] = [];
  const v = (f: number) => values(f);
  for (let f = from; f <= to; f++) {
    if (f === from || f === to) {
      keys.push({ frame: f, value: v(f) });
      continue;
    }
    const before = v(f) - v(f - 1);
    const after = v(f + 1) - v(f);
    if (Math.abs(before - after) > 1e-9) keys.push({ frame: f, value: v(f) });
  }
  return withEases(keys, "linear");
}

/** Gives every keyframe but the last the same ease. */
function withEases(keys: Keyframe[], ease: Keyframe["ease"]): Keyframe[] {
  return keys.map((k, i) => (i < keys.length - 1 ? { frame: k.frame, value: k.value, ease } : { frame: k.frame, value: k.value }));
}

