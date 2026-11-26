/**
 * File Description: Lowers the Plot device (src/dl/primitives.tsx `Plot`, native Phase 2 P2.8a) to one generated SVG asset in
 * the plot's own 520 x 300 units and the element tracks that animate it, for an svg node in the Render IR overlay (`/8`). The
 * asset carries the three quarter grid lines, the axes, the curve (the shared `plotSpline` Catmull-Rom path, dashed by its
 * numeric length so the dash offset draws it on, as Chrome draws `stroke-dasharray`), the travelling dot and the mono axis
 * labels; the tracks are the curve's dash offset, the dot's translation along the curve and its opacity, sampled per frame
 * from the component's own progress (ease-out-expo over 2600 ms). Pure: no I/O.
 * Inputs and outputs: a Plot block, the theme colours, the progress function and the svg element's box in plot units -> the SVG
 * text (its content clipped to that box, as Chrome clips an svg element), its element ids and the element tracks.
 * Used by: backend/renderIr/emit.ts (the device of a text card or an inset panel).
 */

import { spline, type Pt } from "../../src/dl/plotSpline";
import { linearKeyframes } from "./irValues";
import type { Keyframe } from "./schema";

/** The plot's own units (the component's SVG viewBox) and its padding, as primitives.tsx sets them. */
export const PLOT_WIDTH = 520;
export const PLOT_HEIGHT = 300;
const PAD = { l: 40, r: 30, t: 24, b: 40 };

/** The plot's element ids in its asset. */
const LINE_ID = "plot-line";
const DOT_ID = "plot-dot";

/** A Plot block as the film schema holds it. */
export interface PlotBlock {
  points: [number, number][];
  xLabel?: string;
  yLabel?: string;
  endLabel?: string;
}

/** The colours a plot draws in, as CSS colours (`rgba()` or hex). */
export interface PlotColours {
  grid: string;
  axes: string;
  accent: string;
  label: string;
  font: string;
}

/** One element track of the asset. */
export interface PlotElementTrack {
  target: string;
  property: "dashOffset" | "translateX" | "translateY" | "opacity";
  keyframes: Keyframe[];
}

/** Escapes text for an SVG text node. */
function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes a value for a double-quoted SVG attribute. */
function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/** The plot's points mapped into its own units (origin top left), as the component maps them. */
function mappedPoints(block: PlotBlock): Pt[] {
  return block.points.map(([x, y]) => ({
    x: PAD.l + x * (PLOT_WIDTH - PAD.l - PAD.r),
    y: PLOT_HEIGHT - PAD.b - y * (PLOT_HEIGHT - PAD.t - PAD.b),
  }));
}

/**
 * The plot's SVG asset and its tracks over `[from, to]`: `progress(f)` is the component's `useProgress` value at frame f. The
 * curve is dashed with one dash its numeric length long and offset by `length * (1 - progress)`; the dot starts on the first
 * point and is translated to the curve's point at the progress, shown once the progress passes 0.02.
 */
export function plotAsset(block: PlotBlock, colours: PlotColours, progress: (f: number) => number, from: number, to: number, viewport: { x: number; y: number; w: number; h: number }): { svg: string; elementIds: string[]; tracks: PlotElementTrack[] } {
  const mapped = mappedPoints(block);
  const { d, at, length } = spline(mapped);
  const start = at(0);
  const text = (id: string, x: number, y: number, anchor: "start" | "end", value: string) =>
    `<text id="${id}" x="${x}" y="${y}" font-family="${escapeAttr(colours.font)}" font-size="11" fill="${colours.label}" text-anchor="${anchor}">${escapeText(value)}</text>`;
  const grid = [0.25, 0.5, 0.75].map((f, i) => `<path id="plot-grid-${i}" d="M${PAD.l} ${PAD.t + f * (PLOT_HEIGHT - PAD.t - PAD.b)} H${PLOT_WIDTH - PAD.r}" fill="none" stroke="${colours.grid}" stroke-width="1"/>`);
  // Chrome clips an svg element's content to its own box (`overflow: hidden`): a label left of the axis (x < 0 in plot units)
  // is cut where a width-limited plot's box starts. The box, in plot units, is the clip of everything drawn.
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}">`,
    `<defs><clipPath id="plot-viewport"><rect x="${viewport.x}" y="${viewport.y}" width="${viewport.w}" height="${viewport.h}"/></clipPath></defs>`,
    `<g id="plot-clip" clip-path="url(#plot-viewport)">`,
    ...grid,
    `<path id="plot-axes" d="M${PAD.l} ${PAD.t} V${PLOT_HEIGHT - PAD.b} H${PLOT_WIDTH - PAD.r}" fill="none" stroke="${colours.axes}" stroke-width="1"/>`,
    `<path id="${LINE_ID}" d="${d}" fill="none" stroke="${colours.accent}" stroke-width="2.5" stroke-dasharray="${length}" stroke-dashoffset="${length}"/>`,
    // The dot's visibility is its opacity track alone (hidden until the progress passes 0.02).
    `<circle id="${DOT_ID}" cx="${start.x}" cy="${start.y}" r="4.5" fill="${colours.accent}"/>`,
    ...(block.yLabel ? [text("plot-y-label", PAD.l - 8, PAD.t + 4, "end", block.yLabel)] : []),
    ...(block.xLabel ? [text("plot-x-label", PAD.l, PLOT_HEIGHT - 12, "start", block.xLabel)] : []),
    ...(block.endLabel ? [text("plot-end-label", PLOT_WIDTH - PAD.r, PLOT_HEIGHT - 12, "end", block.endLabel)] : []),
    "</g>",
    "</svg>",
  ];
  const elementIds = ["plot-grid-0", "plot-grid-1", "plot-grid-2", "plot-axes", LINE_ID, DOT_ID, ...(block.yLabel ? ["plot-y-label"] : []), ...(block.xLabel ? ["plot-x-label"] : []), ...(block.endLabel ? ["plot-end-label"] : [])];
  const head = (f: number) => at(progress(f));
  const tracks: PlotElementTrack[] = [
    { target: LINE_ID, property: "dashOffset", keyframes: linearKeyframes((f) => length * (1 - progress(f)), from, to) },
    { target: DOT_ID, property: "translateX", keyframes: linearKeyframes((f) => head(f).x - start.x, from, to) },
    { target: DOT_ID, property: "translateY", keyframes: linearKeyframes((f) => head(f).y - start.y, from, to) },
    { target: DOT_ID, property: "opacity", keyframes: linearKeyframes((f) => (progress(f) > 0.02 ? 1 : 0), from, to) },
  ];
  return { svg: `${parts.join("\n")}\n`, elementIds, tracks };
}
