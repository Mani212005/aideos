/**
 * File Description: Frame furniture shared by scene films: the corner brackets, the dotted backdrop
 * with its soft accent glow, a muted mono tag, and a readout whose value changes over the film.
 * These are the quiet, persistent pieces that keep a dark canvas from being flat; they carry no topic.
 */

import type { Canvas } from "./canvas";
import { H, HAIR2, OY, PAL, W, el, n, stroke, text } from "./svg";

/**
 * Corner brackets. The bottom pair sits at `bottom` rather than at the frame's edge, because the
 * film's chapter rail paints an opaque scrim over the last ~90px of the window.
 */
export function corners(inset = 44, bottom = 940, len = 30, color: string = HAIR2): string {
  const c = (x: number, y: number, dx: number, dy: number) =>
    el("path", { d: `M${n(x + dx * len)} ${n(y)} L${n(x)} ${n(y)} L${n(x)} ${n(y + dy * len)}`, ...stroke(color, 2) });
  return [c(inset, inset, 1, 1), c(W - inset, inset, -1, 1), c(inset, bottom, 1, -1), c(W - inset, bottom, -1, -1)].join("");
}

/** Options for the static backdrop. */
export interface BackdropOpts {
  /** The film's accent, used for the glow. */
  accent: string;
  /** Glow centre and radius as percentages of the window; defaults to the middle, slightly low. */
  glow?: { cx: number; cy: number; r: number; opacity?: number };
  /** Opacity of the dot grid. */
  dotOpacity?: number;
}

/** The static backdrop: a dotted grid and a soft accent glow, sized to the square scene with the window in the middle. */
export function backdropSvg(o: BackdropOpts): string {
  const glow = o.glow ?? { cx: 50, cy: 58, r: 55 };
  const defs =
    `<defs>` +
    `<pattern id="dots" width="48" height="48" patternUnits="userSpaceOnUse"><circle cx="24" cy="24" r="1.3" fill="${PAL.ink}" fill-opacity="${o.dotOpacity ?? 0.1}"/></pattern>` +
    `<radialGradient id="glow" cx="${glow.cx}%" cy="${glow.cy}%" r="${glow.r}%"><stop offset="0" stop-color="${o.accent}" stop-opacity="${glow.opacity ?? 0.1}"/><stop offset="1" stop-color="${o.accent}" stop-opacity="0"/></radialGradient>` +
    `</defs>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1920" width="1920" height="1920">${defs}` +
    `<rect x="0" y="0" width="1920" height="1920" fill="${PAL.canvas}"/>` +
    `<rect x="0" y="${OY}" width="${W}" height="${H}" fill="url(#dots)"/>` +
    `<rect x="0" y="${OY}" width="${W}" height="${H}" fill="url(#glow)"/>` +
    `</svg>\n`
  );
}

/** A small muted mono tag, for naming the film in a corner of the HUD. */
export function hudTag(label: string, x = 84, y = 92, anchor: "start" | "end" = "start"): string {
  return text(label, { x, y, size: 20, face: "mono", weight: 500, fill: PAL.muted, anchor, tracking: 0.08 });
}

/** A mono readout whose value changes over the film: each value is its own element, cut on and off at its frame. */
export function readoutSeries(c: Canvas, prefix: string, x: number, y: number, values: Array<{ label: string; frame: number }>): void {
  const ids = values.map((v, i) => {
    const id = `${prefix}-${i}`;
    c.add(text(v.label, { id, x, y, size: 20, face: "mono", weight: 500, fill: PAL.muted, anchor: "end", tracking: 0.08 }));
    return id;
  });
  ids.forEach((id, i) => {
    c.init(id, { opacity: i === 0 ? 1 : 0 });
    if (i > 0) c.cutOn(id, values[i].frame);
    if (i < ids.length - 1) c.cutOff(id, values[i + 1].frame);
  });
}
