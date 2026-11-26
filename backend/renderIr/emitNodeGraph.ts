/**
 * File Description: The node-graph canvas of the Render IR emitter (native renderer Phase 2, P2.2b): lowers `CanvasGraph.tsx` with the flat camera into one generated SVG asset in canvas units plus the tracks that animate it, and gives the camera `camAt` solves as IR camera keyframes. Every number is read from the modules the Remotion render reads (`camera.ts` for the timeline, camera, arrivals and edge paths, `motion.ts` for the entrance curve, `tokens.ts` for the accent and muted colours), and each piece of the component is drawn as Chrome draws it: a card is its 145 degree gradient under its border (Chrome draws the `1.5px` border at 1 px, centred on its own band so the rounded corners match), its CSS `box-shadow` list becomes SVG filter shadows (blur radius / 2 as the deviation, outer shadows cut out of the box, inset ones kept inside the padding box), its text is laid out as the flex column lays it out (packed from the top when it overflows, as Chrome does), and the live state, the entrance, the beacon pulse, the breathing glow and the travelling packets are element, colour and dash offset tracks sampled per frame. Remotion's `interpolateColors` rounding is reproduced so a border's colour matches frame for frame. The card's `backdrop-filter` is drawn as Chrome draws it: a copy of what lies behind it (the canvas colour and the edges that pass under it) clipped to its box and mirrored at the box's edges, blurred and cut to the rounded box. Cards that overlap are refused (`nodeGraphCanvasReasons`): a card's backdrop over another card is not drawn.
 * Inputs and outputs: a node-graph film, its timeline, a format, the text measurer and the frame clock -> the canvas SVG source, its element ids, element and colour tracks, the canvas opacity track and the camera keyframes.
 * Used by: backend/renderIr/emit.ts (build, for every node-graph film), backend/renderIr/emitNodeGraph.test.ts, backend/journeys/node_graph_native.journey.ts (through the emitter).
 */

import { camAt, edgePath, nodeArrivals, shotAt, type TimedShot } from "../../src/dl/camera";
import { easeExpo, frames, MS } from "../../src/dl/motion";
import { stageCenterY } from "../../src/dl/fullScreenHeroLayout";
import type { Film, Shot } from "../../src/dl/schema";
import { cssColor, linearKeyframes } from "./irValues";
import type { ColorKeyframe, ColorTrack, Keyframe } from "./schema";

/** One measured run on one line: its text, font id, size and letter spacing in pixels. */
export interface CanvasRun {
  text: string;
  font: string;
  size: number;
  letterSpacing: number;
}

/** A face's `line-height: normal` metrics at one size, in pixels (as `aideos-render measure` reports them). */
export interface CanvasLineMetrics {
  baseline: number;
  height: number;
  ascent: number;
  descent: number;
}

/** What the canvas lowering needs from the emitter. */
export interface NodeGraphInput {
  film: Film;
  timeline: TimedShot[];
  width: number;
  height: number;
  fps: number;
  /** The film's accent, `#RRGGBB`. */
  accent: string;
  /** The theme's muted colour, `#RRGGBB` (the unlit label's start colour). */
  muted: string;
  /** The colour behind the graph, `#RRGGBB`: the theme's canvas colour under its texture when the texture is uniform (`canvasBehindGraph`), so behind a card's backdrop. */
  canvasColor: string;
  /** The story frame a film frame shows (the end card holds the story's last frame). */
  frozen: (f: number) => number;
  /** The whole picture's scale about the frame centre (a held shot's drift, the end card's slow push). */
  frameScale: (f: number) => number;
  /** The last frame of the film. */
  last: number;
  measure: (run: CanvasRun) => number;
  metrics: (font: string, size: number) => CanvasLineMetrics;
  /** The IR font id of a family at a weight. */
  fontId: (family: "sans" | "mono", weight: number) => string;
}

/** An element track as the IR carries it. */
interface ElementTrack {
  target: string;
  property: "opacity" | "scale" | "dashOffset";
  origin?: { x: number; y: number };
  keyframes: Keyframe[];
}

/** The lowered canvas: its SVG, element ids, tracks, the canvas opacity and the camera. */
export interface NodeGraphCanvas {
  svg: string;
  elementIds: string[];
  elementTracks: ElementTrack[];
  colorTracks: ColorTrack[];
  /** The canvas's own opacity (it dims under a panel). */
  opacity: Keyframe[];
  camera: { centerX: Keyframe[]; centerY: Keyframe[]; zoom: Keyframe[]; rotation: Keyframe[] };
}

/** How long a node takes to light or dim, as `CanvasGraph`'s `HOLD_MS`. */
const HOLD_MS = 700;
/** Blink draws a CSS border of 1 px or more at a whole number of pixels, rounded down, so the card's `1.5px` border is 1 px. */
const cssBorder = (width: number) => (width >= 1 ? Math.floor(width) : width);
/** The card's border width (as drawn) and padding, as `CanvasGraph`'s node style. */
const BORDER = cssBorder(1.5);
const PAD_X = 18;
const PAD_Y = 12;
const RADIUS = 14;
/** The card's `backdrop-filter: blur(12px)`: a Gaussian of deviation 12. */
const BACKDROP_BLUR = 12;
/** The families and weights Chrome draws the card text in: the chip asks for mono 600, which `tokens.ts` does not load, so the browser draws the nearest heavier face, 700. */
const CHIP = { family: "mono", weight: 700, size: 9, spacingEm: 0.12 } as const;
const LABEL = { family: "sans", weight: 600, size: 18, spacingEm: -0.015, lineHeight: 1.2 } as const;
const SUB = { family: "mono", weight: 500, size: 10.5, spacingEm: 0.08 } as const;

/** An RGBA colour with 0 to 255 channels and a 0 to 1 alpha. */
type Rgba = [number, number, number, number];

/** Parses `#RRGGBB`, `#RRGGBBAA` or `rgba()` into channels. */
function parseColor(css: string): Rgba {
  const hex = cssColor(css);
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [n(1), n(3), n(5), hex.length === 9 ? n(7) / 255 : 1];
}

/** Remotion's `interpolateColors` between two colours at `t` in [0, 1]: each channel mixed, red, green and blue rounded, alpha to 3 decimals. */
function mixColors(t: number, a: string, b: string): string {
  const [x, y] = [parseColor(a), parseColor(b)];
  const k = Math.max(0, Math.min(1, t));
  const c = x.map((v, i) => v + (y[i] - v) * k);
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${Number(c[3].toFixed(3))})`;
}

/** `accentAt` of tokens.ts: the accent at an alpha. */
function accentAt(accent: string, alpha: number): string {
  const [r, g, b] = parseColor(accent);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Whether a shot looks at a node (CanvasGraph's `looksAt`). */
function looksAt(shot: Shot, id: string): boolean {
  return shot.look !== "all" && (Array.isArray(shot.look) ? shot.look.includes(id) : shot.look === id);
}

/** Per-frame colours as hold keyframes at every change (exact at every frame). */
function colorKeyframes(value: (f: number) => string, last: number): ColorKeyframe[] {
  const keys: ColorKeyframe[] = [];
  let previous = "";
  for (let f = 0; f <= last; f++) {
    const c = cssColor(value(f));
    if (c !== previous) keys.push({ frame: f, color: c });
    previous = c;
  }
  return keys.map((k, i) => (i < keys.length - 1 ? { ...k, ease: "hold" as const } : k));
}

/** Escapes text for an SVG text node or attribute. */
function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Rounds a coordinate for the SVG source (a thousandth of a canvas unit). */
function n(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** The SVG family name of a family key. */
function familyName(family: "sans" | "mono"): string {
  return family === "sans" ? "Geist" : "JetBrains Mono";
}

/** Breaks text into lines no wider than `width` at spaces, greedily, as a CSS block does (a word wider than the line overflows it). Each word and the space are measured on their own, so the runs asked for never depend on where lines break. */
function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const space = words.length > 1 ? measure(" ") : 0;
  const widths = words.map((w) => measure(w));
  const lines: string[] = [];
  let line = "";
  let lineW = 0;
  words.forEach((w, i) => {
    if (line && lineW + space + widths[i] > width) {
      lines.push(line);
      line = w;
      lineW = widths[i];
    } else {
      lineW = line ? lineW + space + widths[i] : widths[i];
      line = line ? `${line} ${w}` : w;
    }
  });
  if (line) lines.push(line);
  return lines;
}

/** The baseline of a line box of height `lineHeight` below its top, placed as Blink places it (rounded ascent and descent, half the leading above, rounded down). */
function baselineIn(m: CanvasLineMetrics, lineHeight: number): number {
  const ascent = Math.round(m.ascent);
  const descent = Math.round(m.descent);
  return ascent + Math.floor((lineHeight - (ascent + descent)) / 2);
}

/** An SVG filter of one outer CSS box shadow on the element's own shape: blurred, offset, coloured and cut out of the shape. */
function outerShadowFilter(id: string, box: { x: number; y: number; w: number; h: number }, dx: number, dy: number, blur: number, color: string): string {
  const [r, g, b, a] = parseColor(color);
  const sigma = blur / 2;
  const pad = 4 * sigma + 2;
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${n(box.x - pad + Math.min(0, dx))}" y="${n(box.y - pad + Math.min(0, dy))}" width="${n(box.w + 2 * pad + Math.abs(dx))}" height="${n(box.h + 2 * pad + Math.abs(dy))}" color-interpolation-filters="sRGB">`
    + `<feGaussianBlur in="SourceAlpha" stdDeviation="${n(sigma)}" result="b"/><feOffset in="b" dx="${n(dx)}" dy="${n(dy)}" result="o"/>`
    + `<feFlood flood-color="rgb(${r}, ${g}, ${b})" flood-opacity="${n(a)}" result="f"/><feComposite in="f" in2="o" operator="in" result="s"/>`
    + `<feComposite in="s" in2="SourceAlpha" operator="out"/></filter>`;
}

/** An SVG filter of one inset CSS box shadow inside the element's own shape (the padding box). */
function insetShadowFilter(id: string, box: { x: number; y: number; w: number; h: number }, dx: number, dy: number, blur: number, color: string): string {
  const [r, g, b, a] = parseColor(color);
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${n(box.x - 1)}" y="${n(box.y - 1)}" width="${n(box.w + 2)}" height="${n(box.h + 2)}" color-interpolation-filters="sRGB">`
    + `<feOffset in="SourceAlpha" dx="${n(dx)}" dy="${n(dy)}" result="o"/><feGaussianBlur in="o" stdDeviation="${n(blur / 2)}" result="b"/>`
    + `<feFlood flood-color="rgb(${r}, ${g}, ${b})" flood-opacity="${n(a)}" result="f"/><feComposite in="f" in2="b" operator="out" result="s"/>`
    + `<feComposite in="s" in2="SourceAlpha" operator="in"/></filter>`;
}

/** The points a CSS `linear-gradient(<angle>deg, ...)` runs between on a box (the gradient line through the centre, long enough to reach the corners). */
function cssGradientLine(box: { x: number; y: number; w: number; h: number }, degrees: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = (degrees * Math.PI) / 180;
  const dir = { x: Math.sin(a), y: -Math.cos(a) };
  const half = (Math.abs(box.w * Math.sin(a)) + Math.abs(box.h * Math.cos(a))) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return { x1: cx - dir.x * half, y1: cy - dir.y * half, x2: cx + dir.x * half, y2: cy + dir.y * half };
}

/** A stop of an SVG gradient from a CSS colour. */
function stop(offset: number, css: string): string {
  const [r, g, b, a] = parseColor(css);
  return `<stop offset="${offset}" stop-color="rgb(${r}, ${g}, ${b})" stop-opacity="${n(a)}"/>`;
}

/** Lowers the node-graph canvas of a flat-camera film into an SVG asset and its tracks. */
export function emitNodeGraphCanvas(input: NodeGraphInput): NodeGraphCanvas {
  const { film, timeline, fps, accent, frozen, last } = input;
  const nodes = film.canvas.nodes;
  const arrivals = nodeArrivals(film, timeline);
  const holdFrames = frames(HOLD_MS, fps);
  const defs: string[] = [];
  const body: string[] = [];
  const ids: string[] = [];
  const elementTracks: ElementTrack[] = [];
  const colorTracks: ColorTrack[] = [];
  const id = (v: string) => (ids.push(v), v);
  const opacityTrack = (target: string, value: (f: number) => number) => elementTracks.push({ target, property: "opacity", keyframes: linearKeyframes((f) => value(frozen(f)), 0, last) });
  const colorTrack = (target: string, property: "fill" | "stroke", value: (f: number) => string) => colorTracks.push({ target, property, keyframes: colorKeyframes((f) => value(frozen(f)), last) });

  // Activeness and arrival of a node at a story frame (CanvasGraph's `useActiveness` and the entrance).
  const activeness = (nodeId: string, f: number): number => {
    const current = shotAt(timeline, f);
    const previous = current.index > 0 ? timeline[current.index - 1] : null;
    const now = looksAt(current.shot, nodeId);
    const before = previous ? looksAt(previous.shot, nodeId) : false;
    const p = easeExpo((f - current.from) / holdFrames);
    if (now) return before ? 1 : p;
    return before ? 1 - p : 0;
  };
  const arrivedAt = (nodeId: string, f: number) => easeExpo((f - (arrivals.get(nodeId) ?? Infinity) - frames(MS.stagger, fps)) / frames(MS.enter, fps));
  const live = (nodeId: string, f: number) => activeness(nodeId, f) > 0.4;

  // Edges (CanvasGraph's `Edges`): drawn first, under every card.
  defs.push(`<filter id="neonGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="blur1"/><feGaussianBlur stdDeviation="8" result="blur2"/><feMerge><feMergeNode in="blur2"/><feMergeNode in="blur1"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
  defs.push(`<linearGradient id="activeEdgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">${stop(0, accent)}${stop(1, accentAt(accent, 0.45))}</linearGradient>`);
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  // One edge's paths, with their tracks, under an id prefix: drawn once on the canvas and again inside the backdrop of
  // every card it passes behind.
  interface EdgeDraw { d: string; box: { x0: number; y0: number; x1: number; y1: number }; draw: (prefix: string) => string }
  const edgeDraws: EdgeDraw[] = [];
  film.canvas.edges.forEach((edge, i) => {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) return;
    const d = edgePath(a, b);
    const dash = edge.dashed ? ` stroke-dasharray="6 6"` : "";
    const arrival = arrivals.get(edge.to) ?? Infinity;
    const seen = (f: number) => Number.isFinite(arrival) && f >= arrival;
    const isLive = (f: number) => looksAt(shotAt(timeline, f).shot, edge.to);
    const draw = (prefix: string): string => {
      const e = `${prefix}edge-${i}`;
      const out: string[] = [];
      out.push(`<path id="${id(`${e}-base`)}" d="${d}" fill="none" stroke="rgb(255, 255, 255)" stroke-opacity="0.09" stroke-width="2"${dash}/>`);
      opacityTrack(`${e}-base`, (f) => (seen(f) ? 1 : 0.15));
      out.push(`<path id="${id(`${e}-glow`)}" d="${d}" fill="none" stroke="${accent}" stroke-width="5" filter="url(#neonGlow)"${dash}/>`);
      opacityTrack(`${e}-glow`, (f) => (isLive(f) ? 0.45 : 0));
      // The crisp path: its pathLength and dash offset draw nothing without a dash array, so a solid edge is always whole.
      out.push(`<path id="${id(`${e}-off`)}" d="${d}" fill="none" stroke="rgb(255, 255, 255)" stroke-opacity="0.22" stroke-width="1.5"${dash}/>`);
      opacityTrack(`${e}-off`, (f) => (isLive(f) ? 0 : seen(f) ? 1 : 0.18));
      out.push(`<path id="${id(`${e}-live`)}" d="${d}" fill="none" stroke="url(#activeEdgeGrad)" stroke-width="2.5"${dash}/>`);
      opacityTrack(`${e}-live`, (f) => (isLive(f) ? (seen(f) ? 1 : 0.18) : 0));
      // The travelling packets, once the edge is seen.
      for (const [suffix, stroke, width, alpha, on] of [["pk-off", accent, 2, 0.4, false], ["pk-live", "#FFFFFF", 3, 0.95, true]] as const) {
        out.push(`<path id="${id(`${e}-${suffix}`)}" d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-dasharray="6 28"/>`);
        opacityTrack(`${e}-${suffix}`, (f) => (seen(f) && isLive(f) === on ? alpha : 0));
        elementTracks.push({ target: `${e}-${suffix}`, property: "dashOffset", keyframes: linearKeyframes((f) => -frozen(f) * 3.5, 0, last) });
      }
      return out.join("");
    };
    // The path's control points bound it; its glow reaches three deviations (8) beyond.
    const coords = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const xs = coords.filter((_, j) => j % 2 === 0);
    const ys = coords.filter((_, j) => j % 2 === 1);
    const reach = 3 * 8 + 5;
    edgeDraws.push({ d, box: { x0: Math.min(...xs) - reach, y0: Math.min(...ys) - reach, x1: Math.max(...xs) + reach, y1: Math.max(...ys) + reach }, draw });
    body.push(draw(""));
  });

  // Cards (CanvasGraph's `Node`), in canvas order.
  nodes.forEach((node, index) => {
    const k = `node-${index}`;
    const box = { x: node.x, y: node.y, w: node.w, h: node.h };
    const padBox = { x: box.x + BORDER, y: box.y + BORDER, w: box.w - 2 * BORDER, h: box.h - 2 * BORDER };
    const rect = (b: typeof box, r: number) => `x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(r)}"`;
    const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const parts: string[] = [];

    // Shadows, the bottom of the list first: the live glow under the live drop shadow; the resting drop shadow.
    defs.push(outerShadowFilter(`${k}-glow-f`, box, 0, 0, 28, accent));
    parts.push(`<rect id="${id(`${k}-glow`)}" ${rect(box, RADIUS)} fill="#000000" filter="url(#${k}-glow-f)" opacity="0.35"/>`);
    opacityTrack(`${k}-glow`, (f) => (live(node.id, f) ? 0.35 * (0.5 + 0.5 * Math.sin((f / fps) * 3.0)) : 0));
    defs.push(outerShadowFilter(`${k}-shadow-live-f`, box, 0, 16, 40, "rgba(0, 0, 0, 0.6)"));
    parts.push(`<rect id="${id(`${k}-shadow-live`)}" ${rect(box, RADIUS)} fill="#000000" filter="url(#${k}-shadow-live-f)"/>`);
    opacityTrack(`${k}-shadow-live`, (f) => (live(node.id, f) ? 1 : 0));
    defs.push(outerShadowFilter(`${k}-shadow-f`, box, 0, 8, 24, "rgba(0, 0, 0, 0.4)"));
    parts.push(`<rect id="${id(`${k}-shadow`)}" ${rect(box, RADIUS)} fill="#000000" filter="url(#${k}-shadow-f)"/>`);
    opacityTrack(`${k}-shadow`, (f) => (live(node.id, f) ? 0 : 1));

    // The backdrop (`backdrop-filter: blur(12px)`): what lies behind the card, blurred and cut to its box. Chrome blurs only
    // what is inside the card's border box, with mirrored edges (light just outside the box never reaches it, and the box's
    // edge does not darken), so the copy is the content clipped to the box plus its mirror images across each edge and
    // corner, blurred, then cut to the rounded box. Behind a card on this canvas is the canvas colour and any edge passing
    // under it; a card no edge reaches needs none (blurring a flat colour changes nothing).
    const reach = 3 * BACKDROP_BLUR;
    const behind = edgeDraws.filter((e) => e.box.x0 < box.x + box.w && e.box.x1 > box.x && e.box.y0 < box.y + box.h && e.box.y1 > box.y);
    if (behind.length) {
      const region = { x0: box.x - reach, y0: box.y - reach, x1: box.x + box.w + reach, y1: box.y + box.h + reach };
      defs.push(`<clipPath id="${k}-clip"><rect ${rect(box, RADIUS)}/></clipPath>`);
      defs.push(`<clipPath id="${k}-bd-box"><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}"/></clipPath>`);
      defs.push(`<filter id="${k}-backdrop-f" filterUnits="userSpaceOnUse" x="${n(region.x0)}" y="${n(region.y0)}" width="${n(region.x1 - region.x0)}" height="${n(region.y1 - region.y0)}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${BACKDROP_BLUR}"/></filter>`);
      const inBox = (prefix: string, edges: EdgeDraw[]) => `<g clip-path="url(#${k}-bd-box)"><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" fill="${input.canvasColor}"/>${edges.map((e) => e.draw(prefix)).join("")}</g>`;
      // A mirror copy only reaches the filter region from the band of the box next to its reflecting edge (`reach` wide, the whole side on a kept axis); content deeper inside mirrors beyond the region and is cropped, so keeping only the edges in that band is exact.
      const band = (s: number, lo: number, size: number): [number, number] => (s < 0 ? [lo, lo + reach] : s > 0 ? [lo + size - reach, lo + size] : [lo, lo + size]);
      // A reflection across the left or right edge (sx -1 or 1) and the top or bottom edge (sy -1 or 1); 0 keeps the axis.
      const mirror = (sx: number, sy: number) => {
        const ex = sx < 0 ? box.x : box.x + box.w;
        const ey = sy < 0 ? box.y : box.y + box.h;
        return `matrix(${sx ? -1 : 1} 0 0 ${sy ? -1 : 1} ${n(sx ? 2 * ex : 0)} ${n(sy ? 2 * ey : 0)})`;
      };
      const copies = [inBox(`${k}-bd-`, behind)];
      for (const [sx, sy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const [bx0, bx1] = band(sx, box.x, box.w);
        const [by0, by1] = band(sy, box.y, box.h);
        const reaching = behind.filter((e) => e.box.x0 < bx1 && e.box.x1 > bx0 && e.box.y0 < by1 && e.box.y1 > by0);
        copies.push(`<g transform="${mirror(sx, sy)}">${inBox(`${k}-bd${sx + 1}${sy + 1}-`, reaching)}</g>`);
      }
      parts.push(`<g clip-path="url(#${k}-clip)"><g filter="url(#${k}-backdrop-f)">${copies.join("")}</g></g>`);
    }

    // The background, its 145 degree gradient: resting and lit.
    const line = cssGradientLine(box, 145);
    const grad = (gid: string, from: string, to: string) => `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n(line.x1)}" y1="${n(line.y1)}" x2="${n(line.x2)}" y2="${n(line.y2)}">${stop(0, from)}${stop(1, to)}</linearGradient>`;
    defs.push(grad(`${k}-bg-g`, "rgba(22, 26, 36, 0.88)", "rgba(12, 14, 20, 0.96)"));
    defs.push(grad(`${k}-bg-live-g`, accentAt(accent, 0.18), accentAt(accent, 0.06)));
    parts.push(`<rect id="${id(`${k}-bg`)}" ${rect(box, RADIUS)} fill="url(#${k}-bg-g)"/>`);
    opacityTrack(`${k}-bg`, (f) => (live(node.id, f) ? 0 : 1));
    parts.push(`<rect id="${id(`${k}-bg-live`)}" ${rect(box, RADIUS)} fill="url(#${k}-bg-live-g)"/>`);
    opacityTrack(`${k}-bg-live`, (f) => (live(node.id, f) ? 1 : 0));

    // The inset top highlight, inside the padding box: resting and lit.
    for (const [suffix, color, on] of [["inset", "rgba(255, 255, 255, 0.08)", false], ["inset-live", "rgba(255, 255, 255, 0.35)", true]] as const) {
      defs.push(insetShadowFilter(`${k}-${suffix}-f`, padBox, 0, 1, 1, color));
      parts.push(`<rect id="${id(`${k}-${suffix}`)}" ${rect(padBox, RADIUS - BORDER)} fill="#000000" filter="url(#${k}-${suffix}-f)"/>`);
      opacityTrack(`${k}-${suffix}`, (f) => (live(node.id, f) === on ? 1 : 0));
    }

    // The border, centred on its own band so its outer and inner corners are CSS's.
    const borderBox = { x: box.x + BORDER / 2, y: box.y + BORDER / 2, w: box.w - BORDER, h: box.h - BORDER };
    parts.push(`<rect id="${id(`${k}-border`)}" ${rect(borderBox, RADIUS - BORDER / 2)} fill="none" stroke="#FFFFFF" stroke-width="${BORDER}"/>`);
    colorTrack(`${k}-border`, "stroke", (f) => mixColors(activeness(node.id, f), mixColors(arrivedAt(node.id, f), "rgba(255, 255, 255, 0.08)", "rgba(255, 255, 255, 0.16)"), accent));

    // The content: a flex column of the tag row, the label and the sub line, packed from the top when it overflows.
    const font = (t: { family: "sans" | "mono"; weight: number }) => input.fontId(t.family, t.weight);
    const measure = (t: typeof CHIP | typeof SUB | typeof LABEL, text: string) => input.measure({ text, font: font(t), size: t.size, letterSpacing: t.spacingEm * t.size });
    const contentX = box.x + BORDER + PAD_X;
    const contentY = box.y + BORDER + PAD_Y;
    const contentW = box.w - 2 * BORDER - 2 * PAD_X;
    const contentH = box.h - 2 * BORDER - 2 * PAD_Y;
    const chipM = input.metrics(font(CHIP), CHIP.size);
    const chipText = `${String(index + 1).padStart(2, "0")} / ${String(nodes.length).padStart(2, "0")}`.toUpperCase();
    const chipH = chipM.height + 2 * 2 + 2 * 1;
    const chipW = measure(CHIP, chipText) + 2 * 8 + 2 * 1;
    const rowH = Math.max(chipH, 10);
    const labelM = input.metrics(font(LABEL), LABEL.size);
    // Line boxes keep their fractional height (21.6 px); Blink rounds each glyph baseline to a whole pixel when it paints.
    const labelLine = LABEL.lineHeight * LABEL.size;
    const labelLines = wrap(node.label, contentW, (s) => measure(LABEL, s));
    const subM = input.metrics(font(SUB), SUB.size);
    const subText = node.sub ? node.sub.toUpperCase() : "";
    const subLines = node.sub ? wrap(subText, contentW, (s) => measure(SUB, s)) : [];
    const items = [rowH, labelLines.length * labelLine, ...(node.sub ? [subLines.length * subM.height] : [])];
    const free = contentH - items.reduce((s, h) => s + h, 0);
    const gap = free > 0 && items.length > 1 ? free / (items.length - 1) : 0;
    const tops: number[] = [];
    items.reduce((y, h) => (tops.push(y), y + h + gap), contentY);

    // The tag chip and the beacon, centred in the tag row.
    // Blink paints a box at whole pixels (its edges rounded), so the chip's fractional width (its text run) is snapped.
    const snap = (b: { x: number; y: number; w: number; h: number }) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.x + b.w) - Math.round(b.x), h: Math.round(b.y + b.h) - Math.round(b.y) });
    const chipBox = snap({ x: contentX, y: tops[0] + (rowH - chipH) / 2, w: chipW, h: chipH });
    parts.push(`<rect id="${id(`${k}-chip`)}" ${rect(chipBox, 6)} fill="#FFFFFF" fill-opacity="1"/>`);
    colorTrack(`${k}-chip`, "fill", (f) => (live(node.id, f) ? accentAt(accent, 0.16) : "rgba(255, 255, 255, 0.06)"));
    const chipBorder = { x: chipBox.x + 0.5, y: chipBox.y + 0.5, w: chipBox.w - 1, h: chipBox.h - 1 };
    parts.push(`<rect id="${id(`${k}-chip-border`)}" ${rect(chipBorder, 5.5)} fill="none" stroke="#FFFFFF" stroke-width="1"/>`);
    colorTrack(`${k}-chip-border`, "stroke", (f) => (live(node.id, f) ? accentAt(accent, 0.3) : "rgba(255, 255, 255, 0.08)"));
    parts.push(`<text id="${id(`${k}-chip-text`)}" x="${n(chipBox.x + 1 + 8)}" y="${n(Math.round(chipBox.y + 1 + 2 + baselineIn(chipM, chipM.height)))}" font-family="${familyName(CHIP.family)}" font-size="${CHIP.size}" font-weight="${CHIP.weight}" letter-spacing="${n(CHIP.spacingEm * CHIP.size)}" fill="#FFFFFF">${xml(chipText)}</text>`);
    colorTrack(`${k}-chip-text`, "fill", (f) => (live(node.id, f) ? accent : "rgba(255, 255, 255, 0.5)"));
    const beacon = { x: contentX + contentW - 10, y: tops[0] + (rowH - 10) / 2 };
    const bc = { x: beacon.x + 5, y: beacon.y + 5 };
    // The pulse ring: a 10 px circle with a 1.5 px border (drawn 1 px), its stroke centred on the border's band.
    const ring = cssBorder(1.5);
    parts.push(`<circle id="${id(`${k}-pulse`)}" cx="${n(bc.x)}" cy="${n(bc.y)}" r="${n(5 - ring / 2)}" fill="none" stroke="${accent}" stroke-width="${ring}"/>`);
    opacityTrack(`${k}-pulse`, (f) => (live(node.id, f) ? Math.max(0, 1 - (f % 30) / 30) : 0));
    elementTracks.push({ target: `${k}-pulse`, property: "scale", origin: bc, keyframes: linearKeyframes((f) => 1 + 0.8 * ((frozen(f) % 30) / 30), 0, last) });
    defs.push(outerShadowFilter(`${k}-dot-glow-f`, { x: bc.x - 3, y: bc.y - 3, w: 6, h: 6 }, 0, 0, 8, accent));
    parts.push(`<circle id="${id(`${k}-dot-glow`)}" cx="${n(bc.x)}" cy="${n(bc.y)}" r="3" fill="#000000" filter="url(#${k}-dot-glow-f)"/>`);
    opacityTrack(`${k}-dot-glow`, (f) => (live(node.id, f) ? 1 : 0));
    parts.push(`<circle id="${id(`${k}-dot`)}" cx="${n(bc.x)}" cy="${n(bc.y)}" r="3" fill="#FFFFFF"/>`);
    colorTrack(`${k}-dot`, "fill", (f) => (live(node.id, f) ? accent : "rgba(255, 255, 255, 0.2)"));

    // The label: lines of 1.2 times the size, lit white or arriving from the muted colour.
    const labelBase = baselineIn(labelM, labelLine);
    const labelTexts = labelLines.map((t, i) => `<text x="${n(contentX)}" y="${n(Math.round(tops[1] + i * labelLine + labelBase))}">${xml(t)}</text>`).join("");
    parts.push(`<g id="${id(`${k}-label`)}" font-family="${familyName(LABEL.family)}" font-size="${LABEL.size}" font-weight="${LABEL.weight}" letter-spacing="${n(LABEL.spacingEm * LABEL.size)}" fill="#FFFFFF">${labelTexts}</g>`);
    colorTrack(`${k}-label`, "fill", (f) => (live(node.id, f) ? "#FFFFFF" : mixColors(arrivedAt(node.id, f), input.muted, "#E2E8F0")));
    if (node.sub) {
      const subBase = baselineIn(subM, subM.height);
      const subTexts = subLines.map((t, i) => `<text x="${n(contentX)}" y="${n(Math.round(tops[2] + i * subM.height + subBase))}">${xml(t)}</text>`).join("");
      parts.push(`<g id="${id(`${k}-sub`)}" font-family="${familyName(SUB.family)}" font-size="${SUB.size}" font-weight="${SUB.weight}" letter-spacing="${n(SUB.spacingEm * SUB.size)}" fill="#FFFFFF">${subTexts}</g>`);
      colorTrack(`${k}-sub`, "fill", (f) => (live(node.id, f) ? "rgba(255, 255, 255, 0.85)" : "#8E8E98"));
    }

    // The whole card: its entrance opacity and the lit card's 2% lift about its centre.
    body.push(`<g id="${id(k)}">${parts.join("")}</g>`);
    opacityTrack(k, (f) => 0.35 + 0.65 * Math.max(0, Math.min(1, arrivedAt(node.id, f))));
    elementTracks.push({ target: k, property: "scale", origin: centre, keyframes: linearKeyframes((f) => (live(node.id, frozen(f)) ? 1.02 : 1), 0, last) });
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><defs>${defs.join("")}</defs>${body.join("")}</svg>\n`;

  // The canvas dims under a panel (Film.tsx `canvasOpacity`).
  const opacity = linearKeyframes((g) => {
    const f = frozen(g);
    const current = shotAt(timeline, f);
    const panelOpen = current.shot.stage === "none" ? 0 : Math.max(0, Math.min(1, easeExpo((f - current.from) / frames(MS.move, fps))));
    return current.shot.stage === "frame" ? 1 - 0.97 * panelOpen : 1 - 0.72 * panelOpen;
  }, 0, last);

  // The camera: `camAt` maps (cx, cy) to the frame's stage centre at `ppu` pixels per canvas unit. With the scene the size of
  // the format (a cover fit of 1), the IR camera centre is the point that lands on the frame centre.
  const size = { width: input.width, height: input.height };
  const centreShift = stageCenterY(input.width, input.height) - input.height / 2;
  const cam = (g: number) => camAt(film, timeline, frozen(g), size);
  const camera = {
    centerX: linearKeyframes((g) => cam(g).cx, 0, last),
    centerY: linearKeyframes((g) => { const c = cam(g); return c.cy - centreShift / c.ppu; }, 0, last),
    zoom: linearKeyframes((g) => cam(g).ppu * input.frameScale(g), 0, last),
    rotation: [{ frame: 0, value: 0 }],
  };
  return { svg, elementIds: ids, elementTracks, colorTracks, opacity, camera };
}

/** Reasons a node-graph film's canvas cannot be drawn natively yet (empty when it can). */
export function nodeGraphCanvasReasons(film: Film): string[] {
  const reasons: string[] = [];
  const angles = new Set([film.theme?.cameraAngle ?? "flat", ...film.shots.map((s) => s.cameraAngle ?? film.theme?.cameraAngle ?? "flat")]);
  for (const a of angles) if (a !== "flat" && a !== "top-down") reasons.push(`the node-graph camera angle "${a}" (a CSS 3D perspective) is Phase 2 step P2.3`);
  if (film.canvas.nodes.length === 0) reasons.push("a node-graph film with no nodes has no canvas to draw");
  // A card over an earlier card: Chrome's backdrop-filter blurs that card into it, and the canvas's backdrop copy carries
  // only the canvas colour and the edges (measured 0.990 against Remotion). The lit card's 2% lift counts as overlap.
  const lifted = (nd: { x: number; y: number; w: number; h: number }) => ({ x0: nd.x - 0.01 * nd.w, y0: nd.y - 0.01 * nd.h, x1: nd.x + 1.01 * nd.w, y1: nd.y + 1.01 * nd.h });
  film.canvas.nodes.forEach((a, i) => film.canvas.nodes.slice(i + 1).forEach((b) => {
    const [p, q] = [lifted(a), lifted(b)];
    if (p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1) reasons.push(`the node-graph cards "${a.id}" and "${b.id}" overlap: a card's backdrop blur over another card is not drawn natively`);
  }));
  return reasons;
}
