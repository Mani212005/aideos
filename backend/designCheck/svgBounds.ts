/**
 * File Description: Conservative 2D geometry for SVG artwork: affine transforms and the bounding box of one drawn element.
 * Shapes are measured from their attributes and path control points, never rasterized, so the result is an upper bound that errs toward "this element reaches there".
 * Inputs and outputs: an SVG node's attributes or a transform string -> an affine matrix or a local bounding box.
 * Used by: backend/designCheck/insetRegion.ts, backend/designCheck/svgBounds.test.ts.
 */

import type { SvgNode } from "../../src/dl/scene/svgDocument";

/** A 2D affine matrix in SVG's `matrix(a b c d e f)` order. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** An axis-aligned box from its top-left to its bottom-right corner. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The identity matrix. */
export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

// Multiplies two matrices so the result applies `m2` first, then `m1` (the SVG list order m1 m2).
export function multiply(m1: Affine, m2: Affine): Affine {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

// Builds a translation matrix.
export function translation(x: number, y: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

// Builds a scale matrix.
export function scaling(x: number, y: number): Affine {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

// Builds a rotation matrix from degrees.
export function rotation(deg: number): Affine {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

// Applies a matrix to one point.
export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

// Reads every number out of a transform or path argument list.
function numbers(text: string): number[] {
  return (text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

// Parses an SVG `transform` attribute (translate, scale, rotate, matrix, skewX, skewY) into one matrix.
export function parseTransform(value: string | undefined): Affine {
  let m = IDENTITY;
  if (!value) return m;
  for (const part of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = numbers(part[2]);
    let t: Affine | null = null;
    switch (part[1]) {
      case "translate":
        t = translation(n[0] ?? 0, n[1] ?? 0);
        break;
      case "scale":
        t = scaling(n[0] ?? 1, n[1] ?? n[0] ?? 1);
        break;
      case "rotate":
        t = n.length >= 3 ? multiply(multiply(translation(n[1], n[2]), rotation(n[0] ?? 0)), translation(-n[1], -n[2])) : rotation(n[0] ?? 0);
        break;
      case "matrix":
        if (n.length === 6) t = { a: n[0], b: n[1], c: n[2], d: n[3], e: n[4], f: n[5] };
        break;
      case "skewX":
        t = { a: 1, b: 0, c: Math.tan(((n[0] ?? 0) * Math.PI) / 180), d: 1, e: 0, f: 0 };
        break;
      case "skewY":
        t = { a: 1, b: Math.tan(((n[0] ?? 0) * Math.PI) / 180), c: 0, d: 1, e: 0, f: 0 };
        break;
    }
    if (t) m = multiply(m, t);
  }
  return m;
}

// Collects the points a path's commands touch: endpoints, control points, and arc extents.
function pathPoints(d: string): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  for (const seg of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    const up = seg[1].toUpperCase();
    const rel = seg[1] !== up;
    if (up === "Z") {
      x = startX;
      y = startY;
      continue;
    }
    const n = numbers(seg[2]);
    const arity = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 }[up] ?? 2;
    for (let i = 0; i + arity <= n.length; i += arity) {
      const a = n.slice(i, i + arity);
      // Relative arguments are measured from the current point, which moves after each repeat.
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      if (up === "M" || up === "L" || up === "T") {
        x = a[0] + ox;
        y = a[1] + oy;
        if (up === "M" && i === 0) {
          startX = x;
          startY = y;
        }
        pts.push([x, y]);
      } else if (up === "H") {
        x = a[0] + ox;
        pts.push([x, y]);
      } else if (up === "V") {
        y = a[0] + oy;
        pts.push([x, y]);
      } else if (up === "C") {
        pts.push([a[0] + ox, a[1] + oy], [a[2] + ox, a[3] + oy]);
        x = a[4] + ox;
        y = a[5] + oy;
        pts.push([x, y]);
      } else if (up === "S" || up === "Q") {
        pts.push([a[0] + ox, a[1] + oy]);
        x = a[2] + ox;
        y = a[3] + oy;
        pts.push([x, y]);
      } else {
        // An arc stays inside the box of radius max(rx, ry) around its endpoints.
        const r = Math.max(Math.abs(a[0]), Math.abs(a[1]));
        const ex = a[5] + ox;
        const ey = a[6] + oy;
        pts.push([x - r, y - r], [x + r, y + r], [ex - r, ey - r], [ex + r, ey + r]);
        x = ex;
        y = ey;
      }
    }
  }
  return pts;
}

// Reads one numeric attribute, or a fallback when it is missing or not a plain number.
function num(node: SvgNode, name: string, fallback = 0): number {
  const v = Number.parseFloat(node.attrs[name] ?? "");
  return Number.isFinite(v) ? v : fallback;
}

// Reads a style property from a node's attributes or its inline style.
function styleValue(node: SvgNode, name: string): string | undefined {
  const inline = node.attrs.style?.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`));
  return (inline?.[1] ?? node.attrs[name])?.trim();
}

/** Tags that only define things to be referenced and draw nothing where they sit. */
export const NON_DRAWING_TAGS = new Set(["defs", "clipPath", "mask", "linearGradient", "radialGradient", "symbol", "marker", "pattern", "filter", "style", "title", "desc", "metadata"]);

/** Whether the element paints a stroke (and so how far past its geometry it reaches). */
function strokeReach(node: SvgNode): number {
  const stroke = styleValue(node, "stroke");
  if (!stroke || stroke === "none") return 0;
  return (Number.parseFloat(styleValue(node, "stroke-width") ?? "1") || 1) / 2;
}

// Whether the element paints nothing at all: no fill and no stroke.
export function paintsNothing(node: SvgNode): boolean {
  const fill = styleValue(node, "fill");
  const stroke = styleValue(node, "stroke");
  // Fill defaults to black, so an unset fill still paints.
  return fill === "none" && (!stroke || stroke === "none");
}

// Whether the element's own fill is absent, so only its stroke can reveal it (relevant to drawOn).
export function isStrokeOnly(node: SvgNode): boolean {
  const fill = styleValue(node, "fill");
  return fill === "none" && Boolean(styleValue(node, "stroke")) && styleValue(node, "stroke") !== "none";
}

// Returns a drawn leaf element's bounding box in its own coordinate space (before its transform), or null.
export function leafBounds(node: SvgNode): Box | null {
  const reach = strokeReach(node);
  const pad = (b: Box): Box => ({ x0: b.x0 - reach, y0: b.y0 - reach, x1: b.x1 + reach, y1: b.y1 + reach });
  switch (node.tag) {
    case "rect":
    case "image":
      return pad({ x0: num(node, "x"), y0: num(node, "y"), x1: num(node, "x") + num(node, "width"), y1: num(node, "y") + num(node, "height") });
    case "circle": {
      const r = num(node, "r");
      return pad({ x0: num(node, "cx") - r, y0: num(node, "cy") - r, x1: num(node, "cx") + r, y1: num(node, "cy") + r });
    }
    case "ellipse": {
      const rx = num(node, "rx");
      const ry = num(node, "ry");
      return pad({ x0: num(node, "cx") - rx, y0: num(node, "cy") - ry, x1: num(node, "cx") + rx, y1: num(node, "cy") + ry });
    }
    case "line":
      return pad({
        x0: Math.min(num(node, "x1"), num(node, "x2")),
        y0: Math.min(num(node, "y1"), num(node, "y2")),
        x1: Math.max(num(node, "x1"), num(node, "x2")),
        y1: Math.max(num(node, "y1"), num(node, "y2")),
      });
    case "polyline":
    case "polygon":
    case "path": {
      const pts: Array<[number, number]> = [];
      if (node.tag === "path") pts.push(...pathPoints(node.attrs.d ?? ""));
      else {
        const n = numbers(node.attrs.points ?? "");
        for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      }
      if (pts.length === 0) return null;
      return pad({
        x0: Math.min(...pts.map((p) => p[0])),
        y0: Math.min(...pts.map((p) => p[1])),
        x1: Math.max(...pts.map((p) => p[0])),
        y1: Math.max(...pts.map((p) => p[1])),
      });
    }
    case "text": {
      const fontSize = Number.parseFloat(styleValue(node, "font-size") ?? "16") || 16;
      const content = textOf(node);
      if (!content) return null;
      const width = content.length * fontSize * 0.62;
      const anchor = styleValue(node, "text-anchor");
      const x = num(node, "x");
      const y = num(node, "y");
      const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
      return { x0: left, y0: y - fontSize, x1: left + width, y1: y + fontSize * 0.3 };
    }
    default:
      return null;
  }
}

// Joins a text element's own text and its tspans' text.
function textOf(node: SvgNode): string {
  return [node.text ?? "", ...node.children.map(textOf)].join("").trim();
}
