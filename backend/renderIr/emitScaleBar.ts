/**
 * File Description: Lowers the ScaleBar device (src/dl/devices.tsx `ScaleBar`, native Phase 2 P2.8b) to one generated SVG asset
 * in the device's own 520 x 150 units and the element tracks that animate it, for an svg node in the Render IR `/8` overlay.
 * The asset carries the axis, its ticks and mono tick labels, the growing bar and its label. Chrome draws the bar as a rect
 * `grow * 472` wide, 5 tall, with rounded ends of radius 2.5, a pill: the asset draws the same pill as a 5-unit stroke with
 * round caps along the bar's centre line, revealed by its dash offset (one dash `grow * 472 - 5` long between the cap centres),
 * hidden while the bar has no width; the label rides the bar's end by its x translation. Pure: no I/O.
 * Inputs and outputs: a ScaleBar block, the theme colours, the grow function (the device's sweep times its value) and the svg
 * element's box in device units -> the SVG text (clipped to that box, as Chrome clips an svg element), its element ids and
 * the element tracks.
 * Used by: backend/renderIr/emit.ts (the device of a text card or an inset panel).
 */

import { linearKeyframes } from "./irValues";
import type { Keyframe } from "./schema";

/** The device's own units (the component's SVG viewBox) and the geometry devices.tsx sets. */
export const SCALE_BAR_WIDTH = 520;
export const SCALE_BAR_HEIGHT = 150;
const AXIS = 96;
const LEFT = 24;
const RIGHT = SCALE_BAR_WIDTH - 24;
const SPAN = RIGHT - LEFT;
const BAR_TOP = AXIS - 22;
const BAR_HEIGHT = 5;
const CAP = BAR_HEIGHT / 2;

/** The asset's animated element ids. */
const BAR_ID = "scale-bar";
const LABEL_ID = "scale-label";

/** A ScaleBar block as the film schema holds it. */
export interface ScaleBarBlock {
  ticks: string[];
  value: number;
  label?: string;
}

/** The colours a scale bar draws in, as CSS colours. */
export interface ScaleBarColours {
  rule: string;
  accent: string;
  tick: string;
  font: string;
}

/** One element track of the asset. */
export interface ScaleBarElementTrack {
  target: string;
  property: "dashOffset" | "translateX" | "opacity";
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

/**
 * The scale bar's SVG asset and its tracks over `[from, to]`: `grow(f)` is the component's `useSweep(...) * value` at frame f,
 * the bar's width as a fraction of the axis.
 */
export function scaleBarAsset(block: ScaleBarBlock, colours: ScaleBarColours, grow: (f: number) => number, from: number, to: number, viewport: { x: number; y: number; w: number; h: number }): { svg: string; elementIds: string[]; tracks: ScaleBarElementTrack[] } {
  const font = escapeAttr(colours.font);
  const ticks = block.ticks.map((tick, i) => {
    const x = LEFT + (i / (block.ticks.length - 1)) * SPAN;
    return [
      `<path id="scale-tick-${i}" d="M${x} ${AXIS - 7} V${AXIS + 7}" fill="none" stroke="${colours.rule}" stroke-width="1"/>`,
      `<text id="scale-tick-label-${i}" x="${x}" y="${AXIS + 26}" font-family="${font}" font-size="12" fill="${colours.tick}" text-anchor="middle">${escapeText(tick)}</text>`,
    ];
  }).flat();
  // The pill between the cap centres: its dash shows `grow * SPAN - BAR_HEIGHT` of the line, the round caps add the ends.
  const reach = SPAN - BAR_HEIGHT;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCALE_BAR_WIDTH} ${SCALE_BAR_HEIGHT}">`,
    `<defs><clipPath id="scale-viewport"><rect x="${viewport.x}" y="${viewport.y}" width="${viewport.w}" height="${viewport.h}"/></clipPath></defs>`,
    `<g id="scale-clip" clip-path="url(#scale-viewport)">`,
    `<path id="scale-axis" d="M${LEFT} ${AXIS} H${RIGHT}" fill="none" stroke="${colours.rule}" stroke-width="1"/>`,
    ...ticks,
    `<path id="${BAR_ID}" d="M${LEFT + CAP} ${BAR_TOP + CAP} H${RIGHT - CAP}" fill="none" stroke="${colours.accent}" stroke-width="${BAR_HEIGHT}" stroke-linecap="round" stroke-dasharray="${reach} ${reach + BAR_HEIGHT}" stroke-dashoffset="${reach}"/>`,
    ...(block.label ? [`<text id="${LABEL_ID}" x="${LEFT}" y="${AXIS - 34}" font-family="${font}" font-size="12" fill="${colours.accent}" text-anchor="middle">${escapeText(block.label)}</text>`] : []),
    "</g>",
    "</svg>",
  ];
  const elementIds = ["scale-axis", ...block.ticks.flatMap((_, i) => [`scale-tick-${i}`, `scale-tick-label-${i}`]), BAR_ID, ...(block.label ? [LABEL_ID] : [])];
  const width = (f: number) => Math.max(0, grow(f) * SPAN);
  const tracks: ScaleBarElementTrack[] = [
    { target: BAR_ID, property: "dashOffset", keyframes: linearKeyframes((f) => reach - Math.max(0, width(f) - BAR_HEIGHT), from, to) },
    { target: BAR_ID, property: "opacity", keyframes: linearKeyframes((f) => (width(f) > 0 ? 1 : 0), from, to) },
    ...(block.label ? [{ target: LABEL_ID, property: "translateX" as const, keyframes: linearKeyframes((f) => width(f), from, to) }] : []),
  ];
  return { svg: `${parts.join("\n")}\n`, elementIds, tracks };
}
