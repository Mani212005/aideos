/**
 * File Description: The Render IR emitter (R4 of the native renderer plan): turns one format of a scene film (film.json, its scene and SVG artwork, the delivery timeline and the layout tokens) into an `aideos.render/1` document the native renderer draws. Every number is resolved here from the same modules the Remotion render reads (scene compiler clip semantics, camera track, `layoutFor`, `getEndCardLayout`, `deliveryTimeline`, motion constants), so the native picture follows the authored film rather than a second description of it. Text is measured with the native renderer's own fonts through an injected measurer, so layout and drawing share one set of metrics. Films that use something the native renderer does not draw yet are refused with every reason listed (`nativeSupport`), which is what lets callers fall back to Remotion.
 * Inputs and outputs: a Film, a format, the scene's SVG sources and a text measurer -> a validated RenderIr plus the package files it references (fonts, artwork, audio) and the reasons a film is not supported.
 * Used by: backend/nativeRenderer.ts (prepare), backend/renderIr/emit.test.ts.
 */

import { normalizeFilmSoundtrack, type Film, type Shot } from "../../src/dl/schema";
import type { Scene, EnvironmentAsset } from "../../src/dl/scene/types";
import { validateSvgTimeline, applySvgEasing, type SvgAnimationClip, type SvgEasing } from "../../src/dl/scene/svgAnimation";
import { compileCameraTrack } from "../../src/dl/scene/cameraTrack";
import { compileScene } from "../../src/dl/scene/compile";
import { parseSvgDocument, collectSvgElementIds } from "../../src/dl/scene/svgDocument";
import { buildTimeline, shotAt, type TimedShot } from "../../src/dl/camera";
import { deliveryTimeline, DELIVERY_CONFIG, type CardWord } from "../../src/dl/delivery";
import { getEndCardLayout, subscribePressFrame } from "../../src/dl/endCardLayout";
import { BACKGROUND_THEMES, PALETTE, layoutFor, tokensFor, type DLLayout } from "../../src/dl/tokens";
import { DRIFT, EXPO, MS, frames } from "../../src/dl/motion";
import { compactNumber } from "../../src/dl/numberFormat";
import { captionWordsForFilm } from "../../src/dl/captionsParser";
import { resolveCaptionPlacement } from "../../src/dl/captionPlacement";
import { SUBTITLE_FONT_RATIO } from "../../src/dl/fullScreenHeroLayout";
import { getRetimedAudioRelPath } from "../../src/dl/audio/retime";
import { buildVoiceTimeline } from "../../src/dl/audio/voiceActivity";
import { dbGain, effectGain, mixSections, sectionEnvelope, soundtrackItem, soundtrackItemSrc, speechGain, usesSectionMixer } from "../../src/dl/audio/sectionMixer";
import { RENDER_IR_VERSION, ELEMENT_PROPERTIES, type Keyframe, type Node, type RenderIr, type Asset } from "./schema";
import { validateRenderIr } from "./validate";

export type NativeFormat = "long" | "reel";

/** Pixel size of each delivered format. */
export const FORMAT_SIZE: Record<NativeFormat, { width: number; height: number }> = {
  long: { width: 1920, height: 1080 },
  reel: { width: 1080, height: 1920 },
};

/** The vendored variable fonts (repo-relative); see native/fonts/README.md. */
export const NATIVE_FONT_FILES = { sans: "native/fonts/Geist-latin.ttf", mono: "native/fonts/JetBrainsMono-latin.ttf" } as const;

/** One font file for the measurer: an id, a file, a family and the weight its variable axis is set to. */
export interface MeasureFont {
  id: string;
  path: string;
  family: string;
  weight: number;
}

/** One run measured on a single line; letter spacing in pixels. */
export interface MeasureRun {
  text: string;
  font: string;
  size: number;
  letterSpacing: number;
}

/** A face's `line-height: normal` metrics at one size, in pixels. */
export interface LineMetrics {
  baseline: number;
  height: number;
  ascent: number;
  descent: number;
}

/** The measure request and answer of `aideos-render measure`. */
export interface MeasureRequest {
  fonts: MeasureFont[];
  runs: MeasureRun[];
  metrics: Array<{ font: string; size: number }>;
}
export interface MeasureReport {
  widths: number[];
  metrics: LineMetrics[];
}
export type Measurer = (request: MeasureRequest) => MeasureReport;

/** A file the IR references, at its package-relative path: copied from a file, or written from text. */
export type PackageFile = { path: string; from: string } | { path: string; text: string };

export interface EmitInput {
  film: Film;
  format: NativeFormat;
  /** SVG source text keyed by each scene asset's `svgSource`. */
  svgSources: Record<string, string>;
  /** Measures text with the native renderer's fonts. */
  measure: Measurer;
  /** Resolves a repo-relative path (font files, `videos/<slug>/...` sources) to an absolute file path. */
  resolvePath: (repoRelative: string) => string;
}

export interface EmitResult {
  ir: RenderIr;
  files: PackageFile[];
}

/** Raised when a film uses something the native renderer does not draw yet; `reasons` names each one. */
export class NativeUnsupportedError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`The native renderer cannot draw this film yet: ${reasons.join("; ")}`);
    this.name = "NativeUnsupportedError";
    this.reasons = reasons;
  }
}

/** Block kinds the emitter lays out (the text cards of Phase 1). */
const SUPPORTED_BLOCKS = new Set(["TextReveal", "StatCounter"]);

/**
 * Lists every reason this film cannot be drawn natively in this format; empty means supported.
 * Phase 1 covers SVG scene films: the stage, the camera, `frame` text cards (TextReveal, StatCounter),
 * the chapter rail, the burned-in kinetic captions, the end card and the narration. Everything else stays with Remotion for now.
 */
export function nativeSupport(film: Film, format: NativeFormat): string[] {
  const reasons: string[] = [];
  const scene = film.scene;
  if (!scene) reasons.push("node-graph films (no film.scene) are Phase 2 of the native renderer");
  else {
    if (scene.renderer === "three") reasons.push("Three-stage character films stay on Remotion until Phase 4");
    if (scene.actors && scene.actors.length > 0) reasons.push("scene actors (character rigs) are not drawn natively");
    for (const asset of [scene.background, ...scene.props].filter(Boolean) as EnvironmentAsset[]) {
      if (asset.subGroups && asset.subGroups.length > 0) reasons.push(`asset ${asset.assetId}: sub-group rotation is not drawn natively`);
      if (!asset.svgSource) reasons.push(`asset ${asset.assetId} has no SVG source`);
    }
  }
  const uncovered = uncoveredChapters(film, buildTimeline(film));
  if (uncovered.length) reasons.push(`chapters with no shots cannot be drawn on the native rail: ${uncovered.join(", ")}`);
  if (film.videoClips?.length) reasons.push("imported video clips are Phase 2");
  if (film.overlayClips?.length) reasons.push("standalone overlay clips are Phase 2");
  const theme = BACKGROUND_THEMES[film.theme?.background ?? "paper-white"] ?? BACKGROUND_THEMES["paper-white"];
  if (theme.gridType !== "none") reasons.push(`the ${theme.id} theme's ${theme.gridType} texture is not drawn natively`);
  if (film.music || film.audio || film.sfx?.length || film.audioClips?.length) reasons.push("legacy music, effects and timeline audio clips are not mixed natively (library soundtracks are)");
  const soundtrack = normalizeFilmSoundtrack(film);
  if ((soundtrack.sections.length || soundtrack.sfx.length) && !usesSectionMixer(soundtrack)) reasons.push("path-only legacy soundtrack sections are not mixed natively (library soundtracks are)");
  for (const shot of film.shots) {
    if (shot.stage !== "frame" && shot.stage !== "none") reasons.push(`shot ${shot.id}: stage "${shot.stage}" panels are Phase 2`);
    if (shot.blocks.length > 1) reasons.push(`shot ${shot.id}: more than one block in a shot is not laid out natively`);
    for (const block of shot.blocks) {
      if (!SUPPORTED_BLOCKS.has(block.c)) reasons.push(`shot ${shot.id}: ${block.c} blocks are Phase 2`);
    }
    if (shot.needsFootage) reasons.push(`shot ${shot.id}: footage is Phase 2`);
  }
  if (format !== "long" && format !== "reel") reasons.push(`unknown format ${String(format)}`);
  return reasons;
}

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
function rgbHex(hex: string): string {
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

/** One clip bound to one of its targets, as the scene compiler schedules it. */
interface Binding {
  clip: SvgAnimationClip;
  start: number;
  end: number;
}

/** The clip's value for one target at a frame: `from` before, `to` after, eased between (svgAnimation.ts). */
function bindingValue(b: Binding, f: number): number {
  if (f <= b.start) return b.clip.from;
  if (f >= b.end) return b.clip.to;
  return b.clip.from + (b.clip.to - b.clip.from) * applySvgEasing(b.clip.easing, (f - b.start) / b.clip.durationFrames);
}

/** The IR ease of a clip easing (the compiler's default is ease-out-expo). */
function irEase(easing: SvgEasing | undefined): NonNullable<Keyframe["ease"]> {
  return easing ?? "expoOut";
}

/**
 * Turns the bindings driving one element slot into keyframes that reproduce the compiler's governing
 * rule exactly (the latest started binding governs; values hold before the first and after the last),
 * evaluated only up to `lastFrame` (the stage holds that frame afterwards). The scene validator forbids
 * overlapping clips on one slot, so a binding is cut short only by an adjacent clip that starts the frame
 * it ends, or by `lastFrame`. Each binding stays one eased segment wherever that is exact; otherwise the
 * part that plays is written as per-frame linear keyframes.
 */
export function slotKeyframes(bindings: Binding[], lastFrame: number): Keyframe[] {
  const sorted = bindings
    .map((b, i) => ({ b, i }))
    .sort((x, y) => x.b.start - y.b.start || x.i - y.i)
    .map((x) => x.b);
  // For equal starts only the last listed binding ever governs.
  const governing = sorted.filter((b, i) => i === sorted.length - 1 || sorted[i + 1].start !== b.start);
  const keys: Keyframe[] = [];
  const push = (frame: number, value: number, ease?: Keyframe["ease"]) => {
    const last = keys[keys.length - 1];
    if (last && frame <= last.frame) return;
    keys.push(ease ? { frame, value, ease } : { frame, value });
  };
  // Before any binding starts the compiler holds the first binding's start value.
  const first = governing[0];
  if (first.start > 0 && first.start <= lastFrame && sorted[0].clip.from !== first.clip.from) push(first.start - 1, sorted[0].clip.from, "hold");
  for (let i = 0; i < governing.length; i++) {
    const b = governing[i];
    if (b.start > lastFrame) break;
    const nextBinding = governing[i + 1];
    const nextStart = nextBinding ? nextBinding.start : Number.POSITIVE_INFINITY;
    // The first frame this binding no longer decides (the next binding, or the stage's hold).
    const stop = Math.min(nextStart, lastFrame + 1);
    const ease = irEase(b.clip.easing);
    if (b.end < stop) {
      // It plays out: its eased segment, then its end value held until the next binding.
      push(b.start, b.clip.from, ease);
      push(b.end, b.clip.to, "hold");
    } else if (b.end === nextStart && nextStart <= lastFrame && nextBinding.clip.from === b.clip.to) {
      // An adjacent clip continues from this one's end value: its own keyframe closes this segment exactly.
      push(b.start, b.clip.from, ease);
    } else if (ease === "linear" || ease === "hold") {
      // Cut by the stage hold or a snapping clip: a straight or held segment ends exactly at its last value.
      const lastPlayed = stop - 1;
      push(b.start, b.clip.from, ease === "hold" ? "hold" : "linear");
      if (lastPlayed > b.start) push(lastPlayed, bindingValue(b, lastPlayed), "hold");
    } else {
      // An eased segment cut short: per-frame values over the part that plays, then held.
      for (let f = b.start; f < stop; f++) push(f, bindingValue(b, f), f === stop - 1 ? "hold" : "linear");
    }
  }
  if (keys.length === 0) return [{ frame: 0, value: sorted[0].clip.from }];
  delete keys[keys.length - 1].ease;
  return keys;
}

/** The IR element tracks of one asset's animation timeline, up to `lastFrame`. */
function elementTracks(asset: EnvironmentAsset, lastFrame: number) {
  const clips = asset.animation?.clips ?? [];
  const slots = new Map<string, { target: string; slot: string; bindings: Binding[] }>();
  const origins = new Map<string, { x: number; y: number }>();
  for (const clip of clips) {
    clip.targets.forEach((target, i) => {
      if (clip.origin) origins.set(target, clip.origin);
      const start = clip.startFrame + (clip.staggerFrames ?? 0) * i;
      const binding = { clip, start, end: start + clip.durationFrames };
      for (const slot of clip.property === "scale" ? ["scaleX", "scaleY"] : [clip.property]) {
        const key = `${target}\u0000${slot}`;
        const entry = slots.get(key) ?? { target, slot, bindings: [] };
        entry.bindings.push(binding);
        slots.set(key, entry);
      }
    });
  }
  return [...slots.values()].map(({ target, slot, bindings }) => {
    const origin = origins.get(target);
    const takesOrigin = slot === "scaleX" || slot === "scaleY" || slot === "rotate";
    const property = ELEMENT_PROPERTIES.find((p) => p === slot);
    if (!property) throw new Error(`asset ${asset.assetId}: clip property ${slot} has no Render IR element property`);
    return {
      target,
      property,
      ...(origin && takesOrigin ? { origin: { x: origin.x, y: origin.y } } : {}),
      keyframes: slotKeyframes(bindings, lastFrame),
    };
  });
}

/** Everything the overlay layout needs about the frame. */
interface LayoutCtx {
  film: Film;
  format: NativeFormat;
  width: number;
  height: number;
  layout: DLLayout;
  tokens: ReturnType<typeof tokensFor>;
  accent: string;
  fps: number;
  width_: (run: MeasureRun) => number;
  metrics: (font: string, size: number) => LineMetrics;
}

/** The font asset id of a family at a weight. */
const sansId = (weight: number) => `geist-${weight}`;
const monoId = (weight: number) => `mono-${weight}`;
const SANS_WEIGHTS = [400, 500, 600, 700];
const MONO_WEIGHTS = [400, 500, 700];

/** Splits a headline into words with their accent flags (primitives.tsx `parseHeadline`). */
function parseHeadline(text: string, accentWord?: string): Array<{ word: string; accent: boolean }> {
  const stripPunct = (w: string) => w.replace(/[^\p{L}\p{N}-]/gu, "").toLowerCase();
  const spans: [number, number][] = [];
  let clean = "";
  let open: number | null = null;
  for (const ch of text) {
    if (ch === "*") {
      if (open === null) open = clean.length;
      else {
        spans.push([open, clean.length]);
        open = null;
      }
      continue;
    }
    clean += ch;
  }
  if (open !== null) clean = text.replace(/\*/g, (_m, i) => (i === open ? "*" : ""));
  const target = accentWord ? stripPunct(accentWord) : null;
  const out: Array<{ word: string; accent: boolean }> = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean)) !== null) {
    const at = match.index;
    out.push({ word: match[0], accent: spans.some(([a, b]) => at >= a && at < b) || (target !== null && stripPunct(match[0]) === target) });
  }
  return out;
}

/** Ease-out-expo progress through `[from, from + duration]` at a frame (motion.ts `useProgress`). */
function progressAt(f: number, from: number, duration: number): number {
  return EXPO(Math.max(0, Math.min(1, (f - from) / duration)));
}

/** Dense linear keyframes of an entrance-shaped value over the frames where it moves. */
function motionTrack(property: "opacity" | "y" | "x" | "scaleX", value: (f: number) => number, from: number, to: number) {
  return { property, keyframes: linearKeyframes(value, Math.max(0, Math.floor(from)), Math.max(0, Math.ceil(to))) };
}

/** A shot's text-card box: the frame inside its margins (Film.tsx `Stage` for a `frame` stage). */
function stageRect(ctx: LayoutCtx) {
  const m = ctx.layout.margin;
  return { x: m.left, y: m.top, w: ctx.width - m.left - m.right, h: ctx.height - m.top - m.bottom };
}

/** Lays out a TextReveal block: per-word text nodes with their entrance, and the accent word's underline. */
function textRevealNodes(ctx: LayoutCtx, id: string, block: { text: string; size?: "display" | "headline" | "subhead"; accentWord?: string }, start: number, index: number): Node[] {
  const type = ctx.layout.type(block.size ?? "headline");
  const fs = type.fontSize;
  const em = parseFloat(type.letterSpacing) || 0;
  const font = sansId(type.fontWeight);
  const lineH = type.lineHeight * fs;
  const colGap = 0.28 * fs;
  const rowGap = 0.06 * fs;
  const rect = stageRect(ctx);
  const measure = (text: string) => ctx.width_({ text, font, size: fs, letterSpacing: em * fs });
  const words = parseHeadline(block.text, block.accentWord).map((t) => {
    const [, core, tail] = t.accent ? (/^(.*?)([^\p{L}\p{N}]*)$/u.exec(t.word) ?? ["", t.word, ""]) : ["", t.word, ""];
    return { ...t, core, tail, width: measure(t.word), coreWidth: t.accent ? measure(core) : 0 };
  });
  // Greedy flex wrap, each row centred (justify-content: center), the block centred in the stage.
  const rows: Array<{ items: typeof words; width: number }> = [];
  for (const w of words) {
    const row = rows[rows.length - 1];
    if (row && row.width + colGap + w.width <= rect.w) {
      row.items.push(w);
      row.width += colGap + w.width;
    } else rows.push({ items: [w], width: w.width });
  }
  const blockH = rows.length * lineH + (rows.length - 1) * rowGap;
  const top = rect.y + (rect.h - blockH) / 2;
  const base = start + frames(MS.stagger * index, ctx.fps);
  const enterFrames = frames(MS.enter, ctx.fps);
  const rise = ctx.layout.px(12);
  const nodes: Node[] = [];
  let wordIndex = 0;
  rows.forEach((row, r) => {
    let x = rect.x + rect.w / 2 - row.width / 2;
    const y = top + r * (lineH + rowGap);
    for (const w of row.items) {
      const i = wordIndex++;
      const from = base + frames(MS.stagger * i, ctx.fps);
      const enter = (f: number) => progressAt(f, from, enterFrames);
      const tracks = [
        motionTrack("opacity", enter, from, from + enterFrames),
        motionTrack("y", (f) => (1 - enter(f)) * rise, from, from + enterFrames),
      ];
      const text = (suffix: string, s: string, dx: number, color: string): Node => ({
        kind: "text",
        id: `${id}-w${i}${suffix}`,
        text: s,
        font,
        color,
        align: "left",
        lineHeight: type.lineHeight,
        letterSpacing: em,
        tracks,
        placement: { [ctx.format]: { x: x + dx, y, w: ctx.width_({ text: s, font, size: fs, letterSpacing: em * fs }) + fs, h: lineH, fontSize: fs } },
      });
      if (!w.accent) nodes.push(text("", w.word, 0, ctx.tokens.ink));
      else {
        if (w.core) nodes.push(text("-core", w.core, 0, ctx.accent));
        if (w.tail) nodes.push(text("-tail", w.tail, w.coreWidth, ctx.tokens.ink));
        // The underline draws from the left once the word has landed (useProgress at 0.6 of the entrance).
        const drawFrom = base + frames(MS.stagger * i + MS.enter * 0.6, ctx.fps);
        const draw = (f: number) => progressAt(f, drawFrom, enterFrames);
        const h = ctx.layout.px(2);
        nodes.push({
          kind: "rect",
          id: `${id}-w${i}-underline`,
          fill: ctx.accent,
          radius: 0,
          tracks: [
            ...tracks,
            motionTrack("scaleX", draw, drawFrom, drawFrom + enterFrames),
            motionTrack("x", (f) => ((draw(f) - 1) * w.coreWidth) / 2, drawFrom, drawFrom + enterFrames),
          ],
          placement: { [ctx.format]: { x, y: y + lineH + 0.1 * fs - h, w: w.coreWidth, h } },
        });
      }
      x += w.width + colGap;
    }
  });
  return nodes;
}

/** Formats a counter value as StatCounter does. */
function counterText(value: number, to: number, format: "plain" | "compact"): string {
  if (format === "compact") return compactNumber(value);
  return (to >= 1900 && to <= 2100) || format === "plain" ? String(value) : value.toLocaleString("en-US");
}

/** Lays out a StatCounter block: one group per displayed value (number, suffix, label) inside the block's entrance. */
function statCounterNodes(ctx: LayoutCtx, id: string, block: { to: number; label: string; format: "plain" | "compact"; suffix?: string }, start: number, index: number, span: { from: number; to: number }): Node {
  const numSize = ctx.layout.type("headline").fontSize * 0.9;
  const numFont = monoId(700);
  const numLs = -0.03 * numSize;
  const suffixSize = 0.42 * numSize;
  const labelSize = 16 * (ctx.format === "long" ? 1.4 : 1) * ctx.layout.k * 0.75;
  const labelFont = monoId(400);
  const labelLs = 0.14 * labelSize;
  const numM = ctx.metrics(numFont, numSize);
  const sufM = ctx.metrics(numFont, suffixSize);
  const labM = ctx.metrics(labelFont, labelSize);
  const gap = ctx.layout.grid;
  const rect = stageRect(ctx);
  const label = block.label.toUpperCase();
  const labelW = ctx.width_({ text: label, font: labelFont, size: labelSize, letterSpacing: labelLs });
  const suffix = block.suffix ?? "";
  const suffixW = suffix ? ctx.width_({ text: suffix, font: numFont, size: suffixSize, letterSpacing: numLs }) : 0;
  const suffixTrim = suffix.replace(/^\s+/, "");
  const suffixLead = suffix ? suffixW - ctx.width_({ text: suffixTrim || suffix, font: numFont, size: suffixSize, letterSpacing: numLs }) : 0;
  const blockH = numM.height + gap + labM.height;
  const top = rect.y + (rect.h - blockH) / 2;
  const from = start + frames(MS.stagger * index, ctx.fps);
  const countFrames = frames(900, ctx.fps);
  const value = (f: number) => Math.round(block.to * progressAt(f, from, countFrames));
  // One group per value shown, visible over the frames that value is on screen.
  const groups: Node[] = [];
  let f = span.from;
  while (f < span.to) {
    const v = value(f);
    let end = f + 1;
    while (end < span.to && value(end) === v) end++;
    const numText = counterText(v, block.to, block.format);
    const numW = ctx.width_({ text: numText, font: numFont, size: numSize, letterSpacing: numLs });
    const lineW = numW + suffixW;
    const blockW = Math.max(lineW, labelW);
    const x = rect.x + rect.w / 2 - blockW / 2;
    const children: Node[] = [
      {
        kind: "text", id: `${id}-v${v}-number`, text: numText, font: numFont, color: ctx.accent, align: "left",
        lineHeight: numM.height / numSize, letterSpacing: -0.03, tracks: [],
        placement: { [ctx.format]: { x, y: top, w: numW + numSize, h: numM.height, fontSize: numSize } },
      },
      {
        kind: "text", id: `${id}-v${v}-label`, text: label, font: labelFont, color: ctx.tokens.muted, align: "left",
        lineHeight: labM.height / labelSize, letterSpacing: 0.14, tracks: [],
        placement: { [ctx.format]: { x, y: top + numM.height + gap, w: labelW + labelSize, h: labM.height, fontSize: labelSize } },
      },
    ];
    if (suffixTrim) {
      children.push({
        kind: "text", id: `${id}-v${v}-suffix`, text: suffixTrim, font: numFont, color: ctx.tokens.muted, align: "left",
        // Baseline-aligned with the number; the suffix inherits the number's letter spacing in pixels.
        lineHeight: sufM.height / suffixSize, letterSpacing: numLs / suffixSize, tracks: [],
        placement: { [ctx.format]: { x: x + numW + suffixLead, y: top + numM.baseline - sufM.baseline, w: suffixW + suffixSize, h: sufM.height, fontSize: suffixSize } },
      });
    }
    groups.push({ kind: "group", id: `${id}-v${v}`, visible: { fromFrame: f, toFrame: end }, x: 0, y: 0, scale: 1, rotation: 0, tracks: [], children });
    f = end;
  }
  const enterFrames = frames(MS.enter, ctx.fps);
  const rise = ctx.layout.px(12);
  const enter = (fr: number) => progressAt(fr, from, enterFrames);
  return {
    kind: "group", id, x: 0, y: 0, scale: 1, rotation: 0,
    tracks: [motionTrack("opacity", enter, from, from + enterFrames), motionTrack("y", (fr) => (1 - enter(fr)) * rise, from, from + enterFrames)],
    children: groups,
  };
}

/** The text cards of every `frame` shot: a scrim band and the block, visible while the shot is on screen. */
function textCards(ctx: LayoutCtx, timeline: TimedShot[], storyFrames: number, total: number): Node[] {
  const cards: Node[] = [];
  const rect = stageRect(ctx);
  const canvas = ctx.tokens.canvas;
  for (const t of timeline) {
    const shot: Shot = t.shot;
    if (shot.stage !== "frame" || shot.blocks.length === 0) continue;
    // The last shot stays on screen under the end card (Film.tsx freezes the story's last frame).
    const span = { from: t.from, to: t.to >= storyFrames ? total : Math.min(t.to, total) };
    if (span.to <= span.from) continue;
    const id = `card-${t.index}`;
    const children: Node[] = [
      {
        kind: "rect", id: `${id}-scrim`, radius: 0, tracks: [],
        gradient: { stops: [
          { offset: 0, color: hexAlpha(canvas, 0) }, { offset: 0.26, color: hexAlpha(canvas, 0.86) },
          { offset: 0.74, color: hexAlpha(canvas, 0.86) }, { offset: 1, color: hexAlpha(canvas, 0) },
        ] },
        placement: { [ctx.format]: { x: rect.x, y: rect.y + rect.h / 2 - 0.21 * rect.h, w: rect.w, h: 0.42 * rect.h } },
      },
    ];
    shot.blocks.forEach((block, i) => {
      if (block.c === "TextReveal") children.push(...textRevealNodes(ctx, `${id}-b${i}`, block, t.from, i));
      else if (block.c === "StatCounter") children.push(statCounterNodes(ctx, `${id}-b${i}`, block, t.from, i, span));
    });
    cards.push({ kind: "group", id, visible: { fromFrame: span.from, toFrame: span.to }, x: 0, y: 0, scale: 1, rotation: 0, tracks: [], children });
  }
  return cards;
}

/** The scene's stage nodes: background then props, each with its element tracks frozen after `lastFrame`. */
function stageNodes(scene: Scene, svgIds: Record<string, string[]>, lastFrame: number): Node[] {
  const assets = [scene.background, ...scene.props].filter(Boolean) as EnvironmentAsset[];
  const needsDense = assets.some((a) => (a.tracks ?? []).some((t) => t.keyframes.length > 0));
  // Asset-level tracks are Catmull-Rom curves the IR has no ease for: take them from the compiler, per frame.
  const compiled = needsDense ? compileScene(scene, { clockMs: 0, assetElementIds: svgIds }) : null;
  return assets.map((asset) => {
    const tracks = [];
    if (compiled) {
      const entity = (f: number) => compiled.frames[Math.min(f, lastFrame)].entities.find((e) => e.entityId === asset.assetId)!.transform;
      for (const [property, key] of [["x", "x"], ["y", "y"], ["scale", "scale"], ["rotation", "rotation"], ["opacity", "opacity"]] as const) {
        if ((asset.tracks ?? []).some((t) => t.trackId === key && t.keyframes.length > 0)) {
          tracks.push({ property, keyframes: linearKeyframes((f) => entity(f)[key], 0, lastFrame) });
        }
      }
    }
    return {
      kind: "svg" as const,
      id: `asset-${asset.assetId}`,
      asset: `svg-${asset.assetId}`,
      x: asset.position.x,
      y: asset.position.y,
      scale: asset.scale ?? 1,
      rotation: asset.rotation ?? 0,
      ...(asset.opacity !== undefined && asset.opacity !== 1 ? { opacity: asset.opacity } : {}),
      layer: asset.layer ?? Math.round(asset.position.y),
      tracks,
      elementTracks: elementTracks(asset, lastFrame),
    };
  });
}

/** Emits the overlay and stage for one format, given a text measurer callback pair. */
function build(input: EmitInput, width_: LayoutCtx["width_"], metrics: LayoutCtx["metrics"]): RenderIr {
  const { film, format } = input;
  const scene = film.scene as unknown as Scene;
  const { width, height } = FORMAT_SIZE[format];
  const theme = BACKGROUND_THEMES[film.theme?.background ?? "paper-white"] ?? BACKGROUND_THEMES["paper-white"];
  const tokens = tokensFor(theme);
  const layout = layoutFor(width, height, theme);
  const accent = rgbHex(film.accent ?? PALETTE.accent);
  const fps = film.fps;
  const timeline = buildTimeline(film);
  const delivery = deliveryTimeline(film, format, { timeline });
  const total = delivery.totalFrames;
  const storyFrames = delivery.storyFrames;
  const card = delivery.card;
  // Through the end card the story holds its last frame; the scene also holds its own last frame.
  const storyLast = Math.max(0, storyFrames - 1);
  const sceneLast = Math.min(storyLast, scene.durationFrames - 1);
  const frozen = (f: number) => Math.min(f, storyLast);
  const ctx: LayoutCtx = { film, format, width, height, layout, tokens: { ...tokens, ink: rgbHex(tokens.ink), muted: rgbHex(tokens.muted), canvas: rgbHex(tokens.canvas) } as LayoutCtx["tokens"], accent, fps, width_, metrics };

  // The whole picture scales about the frame centre: a held shot's drift and the end card's slow push.
  const cameraPush = Boolean(scene.camera?.holdPush);
  const frameScale = (f: number) => {
    const holdScale = card && f >= card.from ? 1 + 0.01 * Math.min(1, (f - card.from) / Math.max(1, card.durationInFrames)) : 1;
    const ff = frozen(f);
    const current = shotAt(timeline, ff);
    const progress = Math.max(0, Math.min(1, (ff - current.from) / Math.max(1, current.durationInFrames)));
    const drift = current.shot.drift && !cameraPush ? 1 + (DRIFT - 1) * progress : 1;
    return holdScale * drift;
  };

  const svgIds: Record<string, string[]> = {};
  const assets: Asset[] = [];
  for (const a of [scene.background, ...scene.props].filter(Boolean) as EnvironmentAsset[]) {
    const source = a.svgSource ? input.svgSources[a.svgSource] : undefined;
    if (source === undefined) throw new NativeUnsupportedError([`asset ${a.assetId} has no SVG source`]);
    svgIds[a.assetId] = collectSvgElementIds(parseSvgDocument(source));
    assets.push({ kind: "svg", id: `svg-${a.assetId}`, path: `visuals/${a.assetId}.svg`, elementIds: svgIds[a.assetId] });
  }
  // Validates each timeline exactly as the compiler does (unknown targets, overlaps), without compiling frames.
  for (const a of [scene.background, ...scene.props].filter(Boolean) as EnvironmentAsset[]) {
    const errors = a.animation ? validateSvgTimeline(a.animation, { durationFrames: scene.durationFrames, availableElementIds: svgIds[a.assetId] }) : [];
    if (errors.length) throw new Error(`asset ${a.assetId}: ${errors.map((e) => `[${e.clipId}] ${e.message}`).join("; ")}`);
  }
  for (const w of SANS_WEIGHTS) assets.push({ kind: "font", id: sansId(w), path: "fonts/Geist-latin.ttf", family: "Geist", weight: w });
  for (const w of MONO_WEIGHTS) assets.push({ kind: "font", id: monoId(w), path: "fonts/JetBrainsMono-latin.ttf", family: "JetBrains Mono", weight: w });

  const cam = compileCameraTrack(scene.camera, scene.durationFrames, scene.sceneSize, fps);
  const camAt = (f: number) => cam[Math.min(frozen(f), sceneLast)];
  const last = total - 1;
  const camera = {
    centerX: linearKeyframes((f) => camAt(f).center.x, 0, last),
    centerY: linearKeyframes((f) => camAt(f).center.y, 0, last),
    zoom: linearKeyframes((f) => camAt(f).zoom * frameScale(f), 0, last),
    rotation: linearKeyframes((f) => camAt(f).rotation, 0, last),
  };

  const overlay: Node[] = [];
  const cards = textCards(ctx, timeline, storyFrames, total);
  if (cards.length) {
    const s = frameScale;
    overlay.push({
      kind: "group", id: "story-overlay", x: 0, y: 0, scale: 1, rotation: 0,
      tracks: [
        { property: "scale", keyframes: linearKeyframes(s, 0, last) },
        { property: "x", keyframes: linearKeyframes((f) => (width / 2) * (1 - s(f)), 0, last) },
        { property: "y", keyframes: linearKeyframes((f) => (height / 2) * (1 - s(f)), 0, last) },
      ],
      children: cards,
    });
  }

  // The chapter rail (Film.tsx `Rail`), until the end card.
  const railSize = 16 * (format === "long" ? 1.4 : 1) * layout.k * 0.75;
  const railFont = monoId(400);
  const railLine = metrics(railFont, railSize).height;
  const barH = layout.px(format === "long" ? 2 : 3);
  const railH = railLine + layout.grid * 1.5 + barH;
  const railBottom = format === "reel" ? layout.margin.bottom * 0.55 : layout.margin.bottom * 0.5;
  const chapters = railChapters(film, timeline, storyFrames);
  overlay.push({
    kind: "rail",
    id: "rail",
    ...(card ? { visible: { fromFrame: 0, toFrame: card.from } } : {}),
    font: railFont,
    ink: ctx.tokens.ink,
    labelColor: ctx.tokens.muted,
    accent,
    trackColor: cssColor(tokens.rule()),
    scrim: ctx.tokens.canvas,
    chapters,
    progressFrames: storyFrames,
    placement: { [format]: { x: layout.margin.left, y: height - railBottom - railH, w: width - layout.margin.left - layout.margin.right, h: railH, fontSize: railSize, scrimHeight: layout.margin.bottom * 0.5 + layout.px(120) } },
  });

  // The compulsory end card over the held stage.
  if (card) {
    const copy = DELIVERY_CONFIG.endCard;
    const geo = getEndCardLayout({ format, width, height, hasHandle: copy.handle.trim().length > 0, headline: copy.headline });
    overlay.push({
      kind: "endCard",
      id: "end-card",
      visible: { fromFrame: card.from, toFrame: total },
      sansFont: sansId(500),
      monoFont: monoId(400),
      chipFont: monoId(700),
      fill: accent,
      ink: ctx.tokens.ink,
      dim: hexAlpha(ctx.tokens.canvas, 0.55),
      surface: rgbHex(theme.surface),
      hairline: cssColor(theme.hairline),
      muted: ctx.tokens.muted,
      copy: { label: copy.label, headline: copy.headline, likeLabel: copy.like, subscribeLabel: copy.subscribe, handle: copy.handle.trim() || " " },
      pressFrame: subscribePressFrame(card, delivery.cardWords, copy.subscribe, fps),
      layout: { [format]: { card: geo.card, scale: geo.scale, padX: geo.padX, padY: geo.padY, gap: geo.gap, radius: geo.radius, type: geo.type, chip: geo.chip } },
    });
  }

  // Burned-in kinetic captions (Film.tsx draws KineticSubtitles after the rail and the end card).
  const captions = captionsNode(film, format, timeline, delivery.cardWords, accent, total);
  if (captions) overlay.push(captions);

  // The hairline at the very edge of the frame (Film.tsx's inset 1px box shadow).
  overlay.push({
    kind: "rect", id: "edge-hairline", radius: 0, tracks: [],
    stroke: { color: cssColor(theme.hairline), width: 1 },
    placement: { [format]: { x: 0.5, y: 0.5, w: width - 1, h: height - 1 } },
  });

  const audio = resolveAudio(film, delivery);
  return {
    schema: RENDER_IR_VERSION,
    film: { id: film.id, fps, durationFrames: total },
    scene: { width: scene.sceneSize.w, height: scene.sceneSize.h },
    formats: { [format]: { width, height } },
    background: ctx.tokens.canvas,
    assets: [...assets, ...audio.assets],
    camera,
    stage: stageNodes(scene, svgIds, sceneLast),
    overlay,
    audio: audio.clips,
  };
}

/**
 * The kinetic captions node (Film.tsx's `KineticSubtitles`): the spoken words plus the end card's line, the white,
 * accent and card colours the component defaults to, and the owner-resolved placement as one span per shot where
 * the resolved placement changes (it is read at a phrase's first word, as `captionPlacementAt` does). Null when
 * the film has captions off or no words. Line breaking and the card are the native evaluator's job.
 */
function captionsNode(film: Film, format: NativeFormat, timeline: TimedShot[], cardWords: CardWord[], accent: string, total: number): Node | null {
  if (film.subtitles === false || film.captions === "off") return null;
  const words = [...captionWordsForFilm(film), ...cardWords].filter((w) => w.startFrame < total).map((w) => ({ text: w.text, startFrame: w.startFrame, endFrame: Math.min(total, w.endFrame) }));
  if (words.length === 0) return null;
  const { width, height } = FORMAT_SIZE[format];
  const spans: Array<{ fromFrame: number; x: number; y: number; w?: number }> = [];
  for (const t of timeline) {
    const p = resolveCaptionPlacement(film, format, t.shot.id);
    const prev = spans[spans.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y && prev.w === p.w) continue;
    if (t.from >= total) break;
    spans.push({ fromFrame: t.from, x: p.x, y: p.y, ...(p.w === undefined ? {} : { w: p.w }) });
  }
  return {
    kind: "captions",
    id: "captions",
    font: sansId(700),
    color: "#FFFFFF",
    highlightColor: accent,
    backgroundColor: cssColor("rgba(10, 15, 29, 0.88)"),
    words,
    placement: { [format]: { fontSize: Math.round(Math.min(width, height) * SUBTITLE_FONT_RATIO), spans } },
  };
}

/** The film's chapters that no shot in the timeline belongs to. */
function uncoveredChapters(film: Film, timeline: TimedShot[]): string[] {
  const covered = new Set(timeline.map((t) => Math.min(t.chapter, film.chapters.length - 1)));
  return film.chapters.filter((_, i) => !covered.has(i));
}

/** The rail's chapters: one per film chapter, spanning the shots the timeline assigns to it. */
function railChapters(film: Film, timeline: TimedShot[], storyFrames: number) {
  const n = film.chapters.length;
  const spans: Array<{ title: string; startFrame: number; endFrame: number } | undefined> = new Array(n);
  for (const t of timeline) {
    const c = Math.min(t.chapter, n - 1);
    const span = spans[c];
    if (!span) spans[c] = { title: film.chapters[c], startFrame: t.from, endFrame: Math.min(t.to, storyFrames) };
    else span.endFrame = Math.min(t.to, storyFrames);
  }
  return spans as Array<{ title: string; startFrame: number; endFrame: number }>;
}

/** The narration file the Remotion soundtrack plays (the retimed copy when the film is sped up or slowed). */
export function voiceoverSource(film: Film): string {
  const src = film.voiceover?.src ?? "";
  const speed = film.voiceover?.speed ?? 1;
  return Math.abs(speed - 1) > 0.001 ? film.voiceover?.retimedSrc || getRetimedAudioRelPath(src, speed) : src;
}

/** A file extension including its dot, or an empty string. */
function extOf(p: string): string {
  const m = /\.[A-Za-z0-9]+$/.exec(p.split(/[?#]/)[0]);
  return m ? m[0].toLowerCase() : "";
}

/** The film's audio resolved for the IR: assets, clips with every gain as a per-frame envelope, and the source files. */
interface ResolvedAudio {
  assets: Asset[];
  clips: RenderIr["audio"];
  sources: Array<{ path: string; source: string }>;
}

/**
 * Resolves the soundtrack exactly as Soundtrack.tsx plays it in the delivered format: the narration with its
 * head and tail ramps (`voiceLevel`), the end card's spoken line, each library music section with its gain,
 * equal-power envelope and speech ducking (`mixSections`, `sectionEnvelope`, `speechGain`), and each library
 * effect at its capped gain (`effectGain`). Every clip has gain 1 and carries its level in the envelope, so it
 * reads the same whether a mixer multiplies the envelope by the gain or takes it as the gain.
 */
function resolveAudio(film: Film, delivery: ReturnType<typeof deliveryTimeline>): ResolvedAudio {
  const fps = film.fps;
  const story = delivery.storyFrames;
  const total = delivery.totalFrames;
  const card = delivery.card;
  const out: ResolvedAudio = { assets: [], clips: [], sources: [] };
  const add = (id: string, src: string, clip: Omit<RenderIr["audio"][number], "id" | "asset" | "gain">) => {
    const path = `audio/${id}${extOf(src)}`;
    out.assets.push({ kind: "audio", id, path });
    out.sources.push({ path, source: src });
    out.clips.push({ id, asset: id, gain: 1, ...clip });
  };
  const envelope = (gainAt: (filmFrame: number) => number, from: number, to: number) => linearKeyframes((f) => Math.min(4, Math.max(0, gainAt(f))), from, to);
  const level = film.voiceover?.volume ?? 1;
  if (film.voiceover?.src) {
    const voice = (f: number) => level * Math.min(1, f / 6) * Math.min(1, Math.max(0, story - f) / 12);
    add("voiceover", voiceoverSource(film), { startFrame: 0, durationFrames: story, sourceStartMs: 0, gainEnvelope: envelope(voice, 0, story) });
  }
  if (card && film.endCardVoice?.src && card.lineFrom !== null && card.lineFrom < card.to) {
    add("end-card-voice", film.endCardVoice.src, { startFrame: card.lineFrom, durationFrames: card.to - card.lineFrom, sourceStartMs: 0, gainEnvelope: envelope(() => level, card.lineFrom, card.lineFrom) });
  }
  const soundtrack = normalizeFilmSoundtrack(film);
  if (!usesSectionMixer(soundtrack)) return out;
  // The voice the music ducks under: the measured speech, plus the end card's line.
  const voiceRuns = [
    ...soundtrack.speech.map((i) => ({ startSec: i.startSec, endSec: Math.min(i.endSec, story / fps) })),
    ...(card && film.endCardVoice && card.lineFrom !== null
      ? [{ startSec: card.lineFrom / fps, endSec: Math.min(card.to / fps, card.lineFrom / fps + film.endCardVoice.durationSec) }]
      : []),
  ];
  const voice = buildVoiceTimeline(voiceRuns);
  mixSections(soundtrack, delivery).forEach((section, i) => {
    const gain = (f: number) => section.gain * sectionEnvelope(section, f - section.from) *
      (section.duck ? speechGain(f / fps, voice, soundtrack.mix, story / fps) : dbGain(soundtrack.mix.musicOnlyGainDb));
    add(`music-${i}`, section.src, {
      startFrame: section.from, durationFrames: section.durationInFrames, sourceStartMs: (section.trimBefore / fps) * 1000,
      gainEnvelope: envelope(gain, section.from, section.from + section.durationInFrames),
    });
  });
  const narrationPeakDb = (soundtrack.narrationPeakDb ?? -1) + 20 * Math.log10(level || 1e-10);
  soundtrack.sfx.forEach((sfx, i) => {
    const item = soundtrackItem(sfx.item, sfx.sha256);
    const startFrame = Math.round(sfx.timeSec * fps);
    if (startFrame >= total) return;
    const frames = Math.min(Math.max(1, Math.ceil(item.durationSec * fps)), total - startFrame);
    const g = effectGain(sfx, soundtrack.mix, narrationPeakDb);
    add(`sfx-${i}`, sfx.src || soundtrackItemSrc(item), { startFrame, durationFrames: frames, sourceStartMs: 0, gainEnvelope: envelope(() => g, startFrame, startFrame) });
  });
  return out;
}

/** Emits a validated Render IR for one format of a film and lists the package files it references. */
export function emitRenderIr(input: EmitInput): EmitResult {
  const reasons = nativeSupport(input.film, input.format);
  if (reasons.length) throw new NativeUnsupportedError(reasons);
  const fonts: MeasureFont[] = [
    ...SANS_WEIGHTS.map((w) => ({ id: sansId(w), path: input.resolvePath(NATIVE_FONT_FILES.sans), family: "Geist", weight: w })),
    ...MONO_WEIGHTS.map((w) => ({ id: monoId(w), path: input.resolvePath(NATIVE_FONT_FILES.mono), family: "JetBrains Mono", weight: w })),
  ];
  // Layout is pure, so it runs once to collect what it measures, then again with the answers.
  const runs = new Map<string, MeasureRun>();
  const queries = new Map<string, { font: string; size: number }>();
  const runKey = (r: MeasureRun) => JSON.stringify([r.text, r.font, r.size, r.letterSpacing]);
  const queryKey = (font: string, size: number) => JSON.stringify([font, size]);
  build(
    input,
    (r) => (runs.set(runKey(r), r), 1),
    (font, size) => (queries.set(queryKey(font, size), { font, size }), { baseline: 1, height: 1, ascent: 1, descent: 0 }),
  );
  const runList = [...runs.values()];
  const queryList = [...queries.values()];
  const report = input.measure({ fonts, runs: runList, metrics: queryList });
  if (report.widths.length !== runList.length || report.metrics.length !== queryList.length) throw new Error("the measurer answered a different number of runs or metrics than were asked");
  const widths = new Map(runList.map((r, i) => [runKey(r), report.widths[i]]));
  const lines = new Map(queryList.map((q, i) => [queryKey(q.font, q.size), report.metrics[i]]));
  const ir = build(
    input,
    (r) => widths.get(runKey(r)) ?? (() => { throw new Error(`unmeasured run ${r.text}`); })(),
    (font, size) => lines.get(queryKey(font, size)) ?? (() => { throw new Error(`unmeasured face ${font}`); })(),
  );
  const checked = validateRenderIr(ir);
  if (!checked.ok) throw new Error(`the emitted Render IR is invalid: ${JSON.stringify(checked.error)}`);

  const scene = input.film.scene as unknown as Scene;
  const files: PackageFile[] = [
    { path: "fonts/Geist-latin.ttf", from: input.resolvePath(NATIVE_FONT_FILES.sans) },
    { path: "fonts/JetBrainsMono-latin.ttf", from: input.resolvePath(NATIVE_FONT_FILES.mono) },
  ];
  for (const a of [scene.background, ...scene.props].filter(Boolean) as EnvironmentAsset[]) {
    files.push({ path: `visuals/${a.assetId}.svg`, text: input.svgSources[a.svgSource!] });
  }
  const delivery = deliveryTimeline(input.film, input.format);
  for (const a of resolveAudio(input.film, delivery).sources) files.push({ path: a.path, from: input.resolvePath(a.source) });
  return { ir: checked.ir, files };
}

/** Exposed for tests: an IR track's value at a frame, with the R2 evaluator's semantics for the eases the emitter writes. */
export function sampleTrack(keys: Keyframe[], frame: number): number {
  if (frame <= keys[0].frame) return keys[0].value;
  const lastKey = keys[keys.length - 1];
  if (frame >= lastKey.frame) return lastKey.value;
  let i = 0;
  while (keys[i + 1].frame <= frame) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = (frame - a.frame) / (b.frame - a.frame);
  const ease = a.ease === "spline" ? "linear" : a.ease;
  return a.value + (b.value - a.value) * applySvgEasing(ease as SvgEasing, t);
}

