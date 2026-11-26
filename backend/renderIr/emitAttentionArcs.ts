/**
 * File Description: Lowers the AttentionArcs device (src/dl/devices.tsx `AttentionArcs`, native Phase 2 P2.8c) to one generated
 * SVG asset in the device's own 560 x 240 units and the element tracks that animate it, for an svg node in the Render IR `/8`
 * overlay. The asset carries the baseline, the tokens in mono (the focus in the accent) and one arc per link (the strongest in
 * the accent, the rest in the rule colour at falling opacity). Chrome draws each arc on with `pathLength={1}`,
 * `stroke-dasharray={1}` and a dash offset of `1 - EXPO(p)`: the visible part is the eased fraction of the arc's own length, so
 * the asset dashes each arc by its measured length (with a gap longer than the arc) and the track offsets it by that length times
 * `1 - EXPO(p)`. Pure: no I/O.
 * Inputs and outputs: an AttentionArcs block, the theme colours, the sweep function and the svg element's box in device units ->
 * the SVG text (clipped to that box, as Chrome clips an svg element), its element ids and the element tracks.
 * Used by: backend/renderIr/emit.ts (the device of a text card or an inset panel).
 */

import { EXPO } from "../../src/dl/motion";
import { linearKeyframes } from "./irValues";
import type { Keyframe } from "./schema";

/** The device's own units (the component's SVG viewBox) and its baseline, as devices.tsx sets them. */
export const ATTENTION_ARCS_WIDTH = 560;
export const ATTENTION_ARCS_HEIGHT = 240;
const BASELINE = 96;

/** An AttentionArcs block as the film schema holds it. */
export interface AttentionArcsBlock {
  tokens: string[];
  focus: number;
  links: number[];
  note?: string;
}

/** The colours the arcs draw in, as CSS colours. */
export interface AttentionArcsColours {
  rule: string;
  ruleStrong: string;
  accent: string;
  muted: string;
  font: string;
}

/** One element track of the asset. */
export interface AttentionArcsElementTrack {
  target: string;
  property: "dashOffset";
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

/** The length of a cubic bezier, by fine sampling (the dash is cut to it, so it must match the arc Chrome measures). */
function cubicLength(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]): number {
  const at = (t: number): [number, number] => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  };
  let length = 0;
  let last = at(0);
  for (let i = 1; i <= 4096; i++) {
    const p = at(i / 4096);
    length += Math.hypot(p[0] - last[0], p[1] - last[1]);
    last = p;
  }
  return length;
}

/**
 * The arcs' SVG asset and its tracks over `[from, to]`: `sweep(f)` is the component's `useSweep` at frame f; arc i draws on as
 * `EXPO(clamp((sweep - 0.12 i) / 0.5))`.
 */
export function attentionArcsAsset(block: AttentionArcsBlock, colours: AttentionArcsColours, sweep: (f: number) => number, from: number, to: number, viewport: { x: number; y: number; w: number; h: number }): { svg: string; elementIds: string[]; tracks: AttentionArcsElementTrack[] } {
  const step = ATTENTION_ARCS_WIDTH / (block.tokens.length + 1);
  const at = (i: number) => step * (i + 1);
  const font = escapeAttr(colours.font);
  const tracks: AttentionArcsElementTrack[] = [];
  const arcs = block.links.map((target, i) => {
    // Strongest link first, so opacity encodes rank without a colour ramp.
    const weight = 1 - i / (block.links.length + 0.6);
    const x1 = at(block.focus);
    const x2 = at(target);
    const drop = BASELINE + 40 + Math.abs(x1 - x2) * 0.22;
    const top = BASELINE + 8;
    const length = cubicLength([x1, top], [x1, drop], [x2, drop], [x2, top]);
    const id = `arc-link-${i}`;
    const drawn = (f: number) => EXPO(Math.max(0, Math.min(1, (sweep(f) - i * 0.12) / 0.5)));
    tracks.push({ target: id, property: "dashOffset", keyframes: linearKeyframes((f) => length * (1 - drawn(f)), from, to) });
    return `<path id="${id}" d="M${x1} ${top} C${x1} ${drop}, ${x2} ${drop}, ${x2} ${top}" fill="none" stroke="${i === 0 ? colours.accent : colours.ruleStrong}" stroke-width="${i === 0 ? 2 : 1.2}" opacity="${weight}" stroke-dasharray="${length} ${length + 16}" stroke-dashoffset="${length}"/>`;
  });
  const tokens = block.tokens.map((token, i) =>
    `<text id="arc-token-${i}" x="${at(i)}" y="${BASELINE - 14}" font-family="${font}" font-size="16" text-anchor="middle" fill="${i === block.focus ? colours.accent : colours.muted}">${escapeText(token)}</text>`);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ATTENTION_ARCS_WIDTH} ${ATTENTION_ARCS_HEIGHT}">`,
    `<defs><clipPath id="arc-viewport"><rect x="${viewport.x}" y="${viewport.y}" width="${viewport.w}" height="${viewport.h}"/></clipPath></defs>`,
    `<g id="arc-clip" clip-path="url(#arc-viewport)">`,
    `<path id="arc-baseline" d="M${step * 0.4} ${BASELINE} H${ATTENTION_ARCS_WIDTH - step * 0.4}" fill="none" stroke="${colours.rule}" stroke-width="1"/>`,
    ...arcs,
    ...tokens,
    "</g>",
    "</svg>",
  ];
  const elementIds = ["arc-baseline", ...block.links.map((_, i) => `arc-link-${i}`), ...block.tokens.map((_, i) => `arc-token-${i}`)];
  return { svg: `${parts.join("\n")}\n`, elementIds, tracks };
}
