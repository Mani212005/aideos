/**
 * File Description: Authoring kit for the RAG explainer's vector scenes.
 * A Canvas collects one asset's SVG markup and its animation timeline together. Its motion helpers
 * work in terms of "where this value should end up" and derive each clip's start value from the last
 * clip on the same element, which keeps the scene engine's continuity rule true by construction.
 * Lyric() lays spoken lines out as kinetic type: every word is its own element that lands on the
 * frame it is spoken, with positions measured from real glyph advances so nothing overflows.
 */

import { escapeXmlText } from "../../src/dl/scene/svgDocument";
import type { SvgAnimatableProperty, SvgEasing } from "../../src/dl/scene/svgAnimation";
import { Timeline, createCues, FPS, type Cues, type NarrationTiming } from "../sceneKit";
import { measureText, type Face } from "./typeMetrics";

/** The locked palette plus the film's single accent. */
export const PAL = {
  canvas: "#0A0A0B",
  ink: "#F5F5F5",
  muted: "#8A8A8E",
  surface: "#101013",
  accent: "#FF5A1F",
  /** The light scene's ground: a neutral within the palette guard's tint tolerance. */
  cream: "#F2F0EE",
} as const;

/** Faint and medium ink for hairlines and quiet fills. */
export const HAIR = "rgba(245,245,245,0.10)";
export const HAIR2 = "rgba(245,245,245,0.22)";

/** Window geometry: authors work in a 1920x1080 window that sits in the middle of the square scene. */
export const W = 1920;
export const H = 1080;
export const OY = 420;

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

type AttrValue = string | number | undefined | null | false;

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

/** Rest value of each property, which is what an untouched element holds. */
const REST: Record<string, number> = { translateX: 0, translateY: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1, drawOn: 1 };

/** Options shared by the motion helpers. */
export interface MotionOpts {
  easing?: SvgEasing;
  /** Frames between consecutive targets' starts. */
  stagger?: number;
  /** Transform origin for scale and rotate, in the element's own (authored translate) space. */
  origin?: { x: number; y: number };
}

/** The frames on which a typed line gains characters, and how many it has typed by then. */
function typingSteps(chars: number, start: number, end: number): Array<{ frame: number; done: number }> {
  const frames = Math.max(1, end - start);
  const out: Array<{ frame: number; done: number }> = [];
  let last = 0;
  for (let f = 0; f < frames; f++) {
    const done = Math.min(chars, Math.round(((f + 1) * chars) / frames));
    if (done !== last) {
      out.push({ frame: start + f, done });
      last = done;
    }
  }
  return out;
}

/** The word a spoken line contributed, for graphics that need to align with it. */
export interface PlacedWord {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  size: number;
  startFrame: number;
  endFrame: number;
}

/** What Lyric() hands back: its words and the box they fill. */
export interface PlacedLine {
  ids: string[];
  words: PlacedWord[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

/** Options for one kinetic lyric line. */
export interface LyricOpts {
  beat: string;
  /** Rows of tokens exactly as narrated; a leading * marks an accent word. */
  rows: string[];
  x: number;
  /** Baseline of the first row. */
  y: number;
  size: number | number[];
  align?: "left" | "center" | "right";
  face?: Face;
  weight?: 500 | 800;
  lead?: number;
  tracking?: number;
  upper?: boolean;
  entry?: "rise" | "slam" | "drop" | "mask";
  /** Overrides `entry` for individual rows (a small row under a huge one should not slam). */
  rowEntry?: Array<"rise" | "slam" | "drop" | "mask" | undefined>;
  /** Markup appended straight after each row is drawn, e.g. the floor a masked row rises from under. */
  afterRow?: (row: number, baseline: number, size: number) => string;
  fill?: string;
  accentFill?: string;
  /** "fade" at the end of the shot, "hold" to keep it, or an explicit frame to start leaving at. */
  exit?: "fade" | "hold" | number;
  /** Left and right limits a row may not cross. */
  bounds?: { x0: number; x1: number };
  /** Frames a word lands ahead of its spoken start. */
  lead0?: number;
}

/** One asset's markup and timeline, authored together. */
export class Canvas {
  readonly name: string;
  readonly durationFrames: number;
  readonly timing: NarrationTiming;
  readonly cues: Cues;
  readonly tl: Timeline;
  private parts: string[] = [];
  private readonly cur = new Map<string, number>();
  private readonly busy = new Map<string, number>();
  private readonly initial = new Map<string, number>();
  private seq = 0;

  // Plain fields rather than parameter properties: backend modules must stay erasable TypeScript.
  constructor(name: string, timing: NarrationTiming, durationFrames: number) {
    this.name = name;
    this.timing = timing;
    this.durationFrames = durationFrames;
    this.cues = createCues(timing);
    this.tl = new Timeline(`${name}-motion`, durationFrames);
  }

  /**
   * The finished timeline. An element declared with init() whose property never moves has no clip,
   * and the engine would leave it at rest (visible, unscaled), so each such value is pinned with a
   * clip that holds it from the first frame.
   */
  timeline() {
    for (const [key, value] of this.initial) {
      if (this.busy.has(key)) continue;
      const [id, prop] = key.split("::");
      this.tl.add({ id: this.uid(`${id}-pin`), targets: [id], property: prop as SvgAnimatableProperty, from: value, to: value, start: 0, end: 1, easing: "linear" });
      this.busy.set(key, 1);
    }
    return this.tl.build();
  }

  /** A fresh unique element id with a readable prefix. */
  uid(prefix: string): string {
    return `${prefix}-${this.seq++}`;
  }

  /** Collects everything added while `fn` runs into one <g> (translated to x, y), then adds that group. */
  group(id: string | undefined, x: number, y: number, fn: () => void, extra: Record<string, AttrValue> = {}): void {
    const outer = this.parts;
    this.parts = [];
    try {
      fn();
      const inner = this.parts.join("\n");
      this.parts = outer;
      this.add(g(id, x, y, inner, extra));
    } finally {
      this.parts = outer;
    }
  }

  /** Appends markup to the asset. */
  add(markup: string): void {
    this.parts.push(markup);
  }

  /** The finished document: a full-scene viewBox whose window offset is applied once, here. */
  svg(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1920" width="1920" height="1920">\n<g transform="translate(0 ${OY})">\n<g id="root">\n${this.parts.join("\n")}\n</g>\n</g>\n</svg>\n`;
  }

  /** Keeps the asset on screen between two frames: it fades in at `from` (unless that is frame 0) and out at `to`. */
  lifetime(from: number, to: number | null): void {
    if (from > 0) {
      this.init("root", { opacity: 0 });
      this.fadeIn("root", from, 4, { easing: "linear" });
    }
    if (to !== null) this.fadeOut("root", to, 6, { easing: "linear" });
  }

  /** Declares what an element holds before its first clip, so it can start hidden or off to one side. */
  init(ids: string | string[], values: Partial<Record<SvgAnimatableProperty, number>>): void {
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      for (const [prop, value] of Object.entries(values)) {
        this.cur.set(`${id}::${prop}`, value as number);
        this.initial.set(`${id}::${prop}`, value as number);
      }
    }
  }

  /** The value an element's property holds right now in authoring order. */
  value(id: string, prop: SvgAnimatableProperty): number {
    return this.cur.get(`${id}::${prop}`) ?? REST[prop];
  }

  /**
   * Moves a property of each target to a value between two frames. The start value is whatever the
   * previous clip left, so a snap cannot be authored. Targets start `stagger` frames apart.
   */
  to(ids: string | string[], prop: SvgAnimatableProperty, value: number, start: number, end: number, opts: MotionOpts = {}): void {
    const list = Array.isArray(ids) ? ids : [ids];
    list.forEach((id, i) => {
      const s = start + (opts.stagger ?? 0) * i;
      const e = end + (opts.stagger ?? 0) * i;
      const key = `${id}::${prop}`;
      const from = this.cur.get(key) ?? REST[prop];
      if (from === value && !this.busy.has(key)) {
        // Nothing to do, but remember the slot is now explicitly held.
        this.cur.set(key, value);
        return;
      }
      const freeAt = this.busy.get(key) ?? 0;
      if (s < freeAt) {
        throw new Error(`[${this.name}] ${id} ${prop}: a clip starting at ${s} overlaps the previous one ending at ${freeAt}.`);
      }
      this.tl.add({
        id: this.uid(`${id}-${prop}`),
        targets: [id],
        property: prop,
        from,
        to: value,
        start: s,
        end: e,
        easing: opts.easing,
        origin: opts.origin,
      });
      this.cur.set(key, value);
      this.busy.set(key, e);
    });
  }

  /** Fades elements in over a span. */
  fadeIn(ids: string | string[], start: number, dur = 8, opts: MotionOpts = {}): void {
    this.to(ids, "opacity", 1, start, start + dur, opts);
  }

  /** Fades elements out over a span. */
  fadeOut(ids: string | string[], start: number, dur = 8, opts: MotionOpts = {}): void {
    this.to(ids, "opacity", 0, start, start + dur, opts);
  }

  /** Cuts an element on at a frame (a one-frame fade, which is the shortest clip the engine takes). */
  cutOn(ids: string | string[], frame: number, opts: MotionOpts = {}): void {
    this.to(ids, "opacity", 1, frame, frame + 1, { easing: "linear", ...opts });
  }

  /** Cuts an element off at a frame. */
  cutOff(ids: string | string[], frame: number, opts: MotionOpts = {}): void {
    this.to(ids, "opacity", 0, frame, frame + 1, { easing: "linear", ...opts });
  }

  /** Draws stroked elements on from nothing; they start undrawn. */
  draw(ids: string | string[], start: number, end: number, opts: MotionOpts = {}): void {
    const list = Array.isArray(ids) ? ids : [ids];
    this.init(list, { drawOn: 0 });
    this.to(list, "drawOn", 1, start, end, opts);
  }

  /** Starts elements hidden and fades them in; the most common entrance. */
  appear(ids: string | string[], start: number, dur = 8, opts: MotionOpts = {}): void {
    this.init(ids, { opacity: 0 });
    this.fadeIn(ids, start, dur, opts);
  }

  /**
   * Reveals monospace text one character at a time by shrinking a cover (painted in the panel's own
   * colour, exactly as wide as the text) toward the text's far edge. The cover is the animated
   * element; the text itself is plain static markup.
   */
  typeReveal(coverId: string, left: number, width: number, chars: number, start: number, end: number): void {
    const origin = { x: left + width, y: 0 };
    this.init(coverId, { scaleX: 1 });
    for (const step of typingSteps(chars, start, end)) {
      this.to(coverId, "scaleX", Math.max(0, 1 - step.done / chars), step.frame, step.frame + 1, { easing: "linear", origin });
    }
  }

  /** Steps a caret along a typed line, one character pitch per step. */
  typeCaret(caretId: string, charWidth: number, chars: number, start: number, end: number): void {
    for (const step of typingSteps(chars, start, end)) {
      this.to(caretId, "translateX", charWidth * step.done, step.frame, step.frame + 1, { easing: "linear" });
    }
  }

  /**
   * Lays one spoken line out as kinetic type. Each word is placed from measured glyph advances and
   * lands on the frame it is spoken; the line is checked against the narration so a rewritten line
   * fails the build instead of silently mis-timing the film.
   */
  lyric(o: LyricOpts): PlacedLine {
    const segment = this.timing.segments.find((s) => s.shotId === o.beat);
    if (!segment) throw new Error(`[${this.name}] no narrated shot "${o.beat}".`);
    const face = o.face ?? "sans";
    const weight = o.weight ?? 800;
    const tracking = o.tracking ?? (face === "sans" ? -0.03 : 0);
    const lead = o.lead ?? 1.06;
    const accent = o.accentFill ?? PAL.accent;
    const fill = o.fill ?? PAL.ink;
    const bounds = o.bounds ?? { x0: 100, x1: W - 100 };

    const tokens = o.rows.map((row) => row.split(/\s+/).filter(Boolean));
    const flat = tokens.flat();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (flat.length !== segment.words.length || flat.some((t, i) => norm(t) !== norm(segment.words[i].word))) {
      throw new Error(
        `[${this.name}] lyric rows for "${o.beat}" do not match the narration.\n  rows: ${flat.join(" ")}\n  said: ${segment.words.map((w) => w.word).join(" ")}`,
      );
    }

    const sizes = o.rows.map((_, r) => (Array.isArray(o.size) ? o.size[r] ?? o.size[o.size.length - 1] : o.size));
    const shape = (t: string) => {
      const bare = t.replace(/\*/g, "").replace(/[.,:;]/g, "");
      return o.upper ? bare.toUpperCase() : bare;
    };

    // A *...* span may cover several tokens: it opens on a token that starts with * and closes on one that ends with *.
    let inAccent = false;
    const placed: PlacedWord[] = [];
    const entries = new Map<string, string>();
    const ids: string[] = [];
    let wordIndex = 0;
    let baseline = o.y;
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const shotEnd = this.cues.to(o.beat);

    tokens.forEach((row, r) => {
      const size = sizes[r];
      const space = measureText(" ", size, face, weight, 0) + tracking * size;
      const widths = row.map((t) => measureText(shape(t), size, face, weight, tracking));
      const rowWidth = widths.reduce((a, b) => a + b, 0) + space * (row.length - 1);
      let x = o.align === "center" ? o.x - rowWidth / 2 : o.align === "right" ? o.x - rowWidth : o.x;
      if (x < bounds.x0 - 0.5 || x + rowWidth > bounds.x1 + 0.5) {
        throw new Error(`[${this.name}] row "${row.join(" ")}" of "${o.beat}" spans ${Math.round(x)}..${Math.round(x + rowWidth)}, outside ${bounds.x0}..${bounds.x1}.`);
      }
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x + rowWidth);
      box.y0 = Math.min(box.y0, baseline - size * 0.78);
      box.y1 = Math.max(box.y1, baseline + size * 0.22);

      row.forEach((tok, i) => {
        const word = segment.words[wordIndex];
        const id = this.uid(`w-${o.beat}`);
        if (tok.startsWith("*")) inAccent = true;
        const isAccent = inAccent;
        if (tok.length > 1 && tok.endsWith("*")) inAccent = false;
        const land = Math.max(0, frameOf(word.startSec) - (o.lead0 ?? 1));
        this.add(text(shape(tok), { id, x, y: baseline, size, face, weight, fill: isAccent ? accent : fill, tracking }));
        ids.push(id);
        placed.push({ id, text: shape(tok), x, y: baseline, w: widths[i], size, startFrame: land, endFrame: frameOf(word.endSec) });

        const entry = o.rowEntry?.[r] ?? o.entry ?? "rise";
        entries.set(id, entry);
        if (entry === "mask") {
          // A masked word is always opaque; it simply rises from behind the floor drawn after its row.
          this.init(id, { translateY: size * 1.02 });
          this.to(id, "translateY", 0, land, land + 14);
          x += widths[i] + space;
          wordIndex++;
          return;
        }
        this.init(id, { opacity: 0 });
        if (entry === "slam") {
          const origin = { x: widths[i] / 2, y: -size * 0.3 };
          this.init(id, { scale: 1.5 });
          this.to(id, "scale", 1, land, land + 9, { origin });
        } else {
          const from = entry === "drop" ? -size * 0.5 : size * 0.4;
          this.init(id, { translateY: from });
          this.to(id, "translateY", 0, land, land + 10);
        }
        this.to(id, "opacity", 1, land, land + 6, { easing: "linear" });
        x += widths[i] + space;
        wordIndex++;
      });
      if (o.afterRow) this.add(o.afterRow(r, baseline, size));
      baseline += Math.max(sizes[r], sizes[r + 1] ?? 0) * lead;
    });

    if (o.exit !== "hold" && o.entry !== "mask") {
      const leaveAt = typeof o.exit === "number" ? o.exit : shotEnd - 8;
      placed.forEach((w) => {
        // A word that is still landing when the line leaves has nothing to leave from.
        const from = Math.max(leaveAt, w.startFrame + 11);
        this.to(w.id, "opacity", 0, from, from + 7, { easing: "linear" });
        if (entries.get(w.id) !== "slam") this.to(w.id, "translateY", -w.size * 0.18, from, from + 7, { easing: "linear" });
      });
    }
    return { ids, words: placed, box };
  }
}
