/**
 * File Description: Balanced line wrapping for display type.
 * A greedy wrap leaves a stray word alone on the last row. This wrapper finds the fewest rows a
 * greedy fill needs, then shrinks the row limit as far as that same row count allows, so the rows
 * come out even. Every token is measured as it will be set (kerned words, trailing punctuation).
 */

import { tokenWidth, measureText, type Face } from "./typeMetrics";
import { shape } from "./text";

/** How the line will be set, which decides how wide each token is. */
export interface WrapOpts {
  size: number;
  /** The widest a row may be, in px. */
  maxWidth: number;
  face?: Face;
  weight?: 500 | 800;
  /** Letter-spacing in em. */
  tracking?: number;
}

/** Splits a marked display line into balanced rows that fit `maxWidth`, keeping each token's markup. */
export function wrapBalanced(marked: string, o: WrapOpts): string[] {
  const face = o.face ?? "sans";
  const weight = o.weight ?? 800;
  const tracking = o.tracking ?? (face === "sans" ? -0.03 : 0);
  const tokens = marked.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const space = measureText(" ", o.size, face, weight, tracking);
  const widths = tokens.map((t) => tokenWidth(shape(t), o.size, face, weight, tracking));

  // Greedy fill at a given limit, returning the rows as token index ranges.
  const fill = (limit: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let start = 0;
    let w = 0;
    tokens.forEach((_, i) => {
      const next = i === start ? widths[i] : w + space + widths[i];
      if (i > start && next > limit) {
        out.push([start, i]);
        start = i;
        w = widths[i];
      } else w = next;
    });
    out.push([start, tokens.length]);
    return out;
  };

  const rowCount = fill(o.maxWidth).length;
  let lo = o.maxWidth / rowCount;
  let hi = o.maxWidth;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (fill(mid).length <= rowCount) hi = mid;
    else lo = mid;
  }
  return fill(hi).map(([a, b]) => tokens.slice(a, b).join(" "));
}
