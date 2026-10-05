/**
 * File Description: SVG authoring primitives shared by every scene film.
 * The locked palette, the 1920x1080 authoring window inside the square scene, a seeded random
 * source for procedural art, and small string builders (attributes, elements, groups, text) that
 * produce the markup the scene engine animates. Pure and free of Node imports, so it is safe in
 * any bundle that reaches the kit.
 * Inputs and outputs: SVG element tags, attributes, and children -> formatted SVG XML markup strings.
 * Used by: backend/sceneKit/canvas.ts, backend/stillTalking/artwork.ts.
 */

import { escapeXmlText } from "../../src/dl/scene/svgDocument";
import { FPS, FORMAT_WINDOWS } from "./stage";
import type { Face } from "./typeMetrics";

/** The locked neutral palette (src/dl/README.md). A film adds exactly one accent of its own. */
export const PAL = {
  canvas: "#0A0A0B",
  ink: "#F5F5F5",
  muted: "#8A8A8E",
  surface: "#101013",
  /** The light scene's ground: a neutral within the design check's tint tolerance. */
  cream: "#F2F0EE",
} as const;

/** The design system's accent, used when a film does not pick its own. */
export const DEFAULT_ACCENT = "#635BFF";

/** Faint and medium ink for hairlines and quiet fills. */
export const HAIR = "rgba(245,245,245,0.10)";
export const HAIR2 = "rgba(245,245,245,0.22)";

/** Window geometry: authors work in a 1920x1080 window that sits in the middle of the square scene. */
export const W = FORMAT_WINDOWS.wide.x1 - FORMAT_WINDOWS.wide.x0;
export const H = FORMAT_WINDOWS.wide.y1 - FORMAT_WINDOWS.wide.y0;
export const OY = FORMAT_WINDOWS.wide.y0;

/** Family names as the film loads them (src/dl/tokens.ts). */
export const FONT: Record<Face, string> = { sans: "Geist", mono: "JetBrains Mono" };

/** Converts seconds to the nearest frame. */
export const frameOf = (sec: number): number => Math.round(sec * FPS);

/** A small deterministic random source, so procedural art is identical on every build. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Formats a number for an attribute: at most three decimals, no trailing noise. */
export const n = (v: number): string => String(Math.round(v * 1000) / 1000);

export type AttrValue = string | number | undefined | null | false;

/** Serializes an attribute record, skipping empty values. */
export function attrs(o: Record<string, AttrValue>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${typeof v === "number" ? n(v) : v}"`)
    .join(" ");
}

/** Builds one element from a tag, attributes and inner markup. */
export function el(tag: string, o: Record<string, AttrValue>, inner?: string): string {
  const a = attrs(o);
  return inner === undefined ? `<${tag} ${a}/>` : `<${tag} ${a}>${inner}</${tag}>`;
}

/** Builds a <g> positioned by an authored translate, so local animation origins sit at its anchor. */
export function g(id: string | undefined, x: number, y: number, inner: string, extra: Record<string, AttrValue> = {}): string {
  return el("g", { id, transform: x || y ? `translate(${n(x)} ${n(y)})` : undefined, ...extra }, inner);
}

/** Options for a text element. */
export interface TextOpts {
  id?: string;
  x?: number;
  y?: number;
  size: number;
  face?: Face;
  weight?: number;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  tracking?: number;
  opacity?: number;
}

/** Builds a <text> element whose anchor is its own origin, so it can animate about that point. */
export function text(content: string, o: TextOpts): string {
  const face = o.face ?? "sans";
  return el(
    "text",
    {
      id: o.id,
      transform: o.x || o.y ? `translate(${n(o.x ?? 0)} ${n(o.y ?? 0)})` : undefined,
      "font-family": FONT[face],
      "font-weight": o.weight ?? (face === "mono" ? 500 : 800),
      "font-size": o.size,
      fill: o.fill ?? PAL.ink,
      "text-anchor": o.anchor && o.anchor !== "start" ? o.anchor : undefined,
      "letter-spacing": o.tracking ? n(o.tracking * o.size) : undefined,
      opacity: o.opacity,
    },
    escapeXmlText(content),
  );
}

/** Stroke defaults used across the drawings. */
export const stroke = (color: string, width = 2, extra: Record<string, AttrValue> = {}) => ({
  fill: "none",
  stroke: color,
  "stroke-width": width,
  ...extra,
});
