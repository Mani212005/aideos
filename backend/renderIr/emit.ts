/**
 * File Description: The Render IR emitter (R4 of the native renderer plan, P4.1 to P4.3 for the Three stage): turns one format of a scene film (film.json, its scene and SVG artwork, the delivery timeline and the layout tokens) into an `aideos.render/1` document the native renderer draws, an `aideos.render/2` document when the film has a Three stage (its stage3d node and mesh file come from emitStage3d.ts), or an `aideos.render/3` document when it places pictures (the illustrated stage: each raster asset becomes an image node over its pinned PNG). A node-graph film (no scene) has its canvas emitted as an `aideos.render/5` document (emitNodeGraph.ts, Phase 2 P2.2b, on for render jobs since P2.2c) under the flat camera; the CSS 3D camera angles are refused. Every number is resolved here from the same modules the Remotion render reads (scene compiler clip semantics, camera track, `layoutFor`, `getEndCardLayout`, `deliveryTimeline`, motion constants), so the native picture follows the authored film rather than a second description of it. Text is measured with the native renderer's own fonts through an injected measurer, so layout and drawing share one set of metrics. Films that use something the native renderer does not draw yet are refused with every reason listed (`nativeSupport`), which is what lets callers fall back to Remotion.
 * Inputs and outputs: a Film, a format, the scene's SVG sources and a text measurer -> a validated RenderIr plus the package files it references (fonts, artwork, audio) and the reasons a film is not supported.
 * Used by: backend/nativeRenderer.ts (prepare), backend/rendererSelection.ts (nativeSupport), backend/renderIr/emit.test.ts, backend/renderIr/emitNodeGraph.test.ts, backend/renderIr/stage3d.test.ts.
 */

import { normalizeFilmSoundtrack, type Block, type Film, type Shot } from "../../src/dl/schema";
import type { Scene, EnvironmentAsset } from "../../src/dl/scene/types";
import { validateSvgTimeline, applySvgEasing, type SvgAnimationClip, type SvgEasing } from "../../src/dl/scene/svgAnimation";
import { compileCameraTrack } from "../../src/dl/scene/cameraTrack";
import { compileScene } from "../../src/dl/scene/compile";
import { parseHeadline } from "../../src/dl/headline";
import { parseSvgDocument, collectSvgElementIds } from "../../src/dl/scene/svgDocument";
import { buildTimeline, shotAt, type TimedShot } from "../../src/dl/camera";
import { deliveryTimeline, DELIVERY_CONFIG, type CardWord } from "../../src/dl/delivery";
import { getEndCardLayout, subscribePressFrame } from "../../src/dl/endCardLayout";
import { BACKGROUND_THEMES, PALETTE, layoutFor, tokensFor, type DLLayout } from "../../src/dl/tokens";
import { DRIFT, EXPO, MS, frames } from "../../src/dl/motion";
import { compactNumber } from "../../src/dl/numberFormat";
import { captionWordsForFilm } from "../../src/dl/captionsParser";
import { resolveCaptionPlacement } from "../../src/dl/captionPlacement";
import {
  SUBTITLE_FONT_RATIO,
  adjustStageCameraForFormat,
  getInsetRegion,
  getStageCardRect,
} from "../../src/dl/fullScreenHeroLayout";
import { getRetimedAudioRelPath } from "../../src/dl/audio/retime";
import { buildVoiceTimeline } from "../../src/dl/audio/voiceActivity";
import { dbGain, effectDuckGain, effectGain, mixSections, sectionEnvelope, soundtrackItem, soundtrackItemSrc, speechGain, usesSectionMixer } from "../../src/dl/audio/sectionMixer";
import { RENDER_IR_VERSION, RENDER_IR_VERSION_2, RENDER_IR_VERSION_3, RENDER_IR_VERSION_5, RENDER_IR_VERSION_7, ELEMENT_PROPERTIES, IMAGE_ELEMENT_PROPERTIES, ID_PATTERN, type Keyframe, type Node, type RenderIr, type Asset } from "./schema";
import { rasterElementIds } from "../../src/dl/scene/raster";
import { validateRenderIr } from "./validate";
import { cssColor, hexAlpha, linearKeyframes, rgbHex } from "./irValues";
import { prettyLines, type WordPosition } from "./bodyWrap";

export { cssColor, hexAlpha, linearKeyframes };
import { emitStage3d, stage3dCarryReasons, STAGE_MESH_PATH, type EmittedStage3d } from "./emitStage3d";
import { emitNodeGraphCanvas, nodeGraphCanvasReasons } from "./emitNodeGraph";
import { canvasBehindGraph, themeTexture } from "./emitThemeTexture";

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

/** A file the IR references, at its package-relative path: copied from a file, or written from text or bytes. */
export type PackageFile = { path: string; from: string } | { path: string; text: string } | { path: string; bytes: Uint8Array };

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
const SUPPORTED_BLOCKS = new Set(["TextReveal", "StatCounter", "Body", "TokenStrip", "LayerStack"]);
/** The shared IR identifier rule applied to generated asset and node identifiers. */
const IR_ID = new RegExp(ID_PATTERN);

/** The word shapes whose line breaks were measured against Chrome: optional opening mark, a lone & or letters and digits with internal . , ' groups, optional closing mark, optional one trailing . , ; : ! ?. */
const MEASURED_BODY_WORD = /^[("']?(?:&|[A-Za-z0-9]+(?:[.,'][A-Za-z0-9]+)*)[)"']?[.,;:!?]?$/;

/** The first white-space separated word of Body copy outside the measured shapes (one Chrome's UAX 14 breaker may break inside), or undefined when all are measured. */
function firstUnmeasuredBodyWord(text: string): string | undefined {
  return text.split(/[ \t\r\n]+/).find((word) => word !== "" && !MEASURED_BODY_WORD.test(word));
}

/**
 * Lists film-only reasons this film cannot be drawn natively in this format; empty means no known film-only refusal.
 * Phase 1 covers SVG scene films: the stage, the camera, `frame` text cards (TextReveal, StatCounter),
 * the chapter rail, the burned-in kinetic captions, the end card and the narration. Phase 4 adds the Three stage
 * (P4.1 carries it in the IR, P4.2 and P4.3 draw it in the cel treatment with any number of performers, P4.4 draws
 * the dots-v1 treatment too). Everything else stays with Remotion for now.
 * This film-only check cannot predict failures that require SVG source, evaluated Three-stage data, generated IR,
 * or the native measurer's response. Those failures still surface during preparation.
 */
export function nativeSupport(film: Film, format: NativeFormat): string[] {
  const reasons: string[] = [];
  const scene = film.scene;
  // A node-graph film (no scene): the canvas emitter (P2.2b) draws the flat camera, natively since P2.2c (its parity
  // journey, backend/journeys/node_graph_native.journey.ts, holds every measured frame at the stage bar).
  if (!scene) reasons.push(...nodeGraphCanvasReasons(film));
  else {
    if (scene.renderer === "three") reasons.push(...stage3dCarryReasons(scene));
    if (scene.actors && scene.actors.length > 0) reasons.push("scene actors (character rigs) are not drawn natively");
    const seenAssetIds = new Set<string>();
    for (const asset of [scene.background, ...scene.props].filter(Boolean) as EnvironmentAsset[]) {
      if (seenAssetIds.has(asset.assetId)) reasons.push(`asset ${asset.assetId}: its id is used by more than one asset`);
      seenAssetIds.add(asset.assetId);
      if (asset.subGroups && asset.subGroups.length > 0) reasons.push(`asset ${asset.assetId}: sub-group rotation is not drawn natively`);
      if (!asset.svgSource && !asset.raster) reasons.push(`asset ${asset.assetId} has no SVG source`);
      if (!IR_ID.test(`asset-${asset.assetId}`)) reasons.push(`asset ${asset.assetId}: its id cannot be used in the native Render IR`);
      if (asset.animation) {
        const errors = validateSvgTimeline(asset.animation, {
          durationFrames: scene.durationFrames,
          ...(asset.raster ? { availableElementIds: rasterElementIds(asset) } : {}),
        });
        if (errors.length) reasons.push(`asset ${asset.assetId}: ${errors.map((e) => `[${e.clipId}] ${e.message}`).join("; ")}`);
        for (const clip of asset.animation.clips) {
          if (asset.raster && !(IMAGE_ELEMENT_PROPERTIES as readonly string[]).includes(clip.property)) {
            reasons.push(`asset ${asset.assetId}: a picture's ${clip.property} cannot be animated; move, scale, rotate or fade it`);
          }
        }
      }
    }
  }
  const uncovered = uncoveredChapters(film, buildTimeline(film));
  if (uncovered.length) reasons.push(`chapters with no shots cannot be drawn on the native rail: ${uncovered.join(", ")}`);
  if (film.videoClips?.length) reasons.push("imported video clips are Phase 2");
  if (film.overlayClips?.length) reasons.push("standalone overlay clips are Phase 2");
  const theme = BACKGROUND_THEMES[film.theme?.background ?? "paper-white"] ?? BACKGROUND_THEMES["paper-white"];
  // Every theme texture (the blueprint grid and the dot matrix since P2.4a, the paper grain since P2.4b) is lowered into the
  // `/7` underlay for node-graph films only, which is what was measured; over a scene it is not measured yet.
  if (film.scene && theme.gridType !== "none") {
    reasons.push(`the ${theme.id} theme's ${theme.gridType} texture over a scene has not been measured against Remotion yet`);
  }
  if (film.music || film.audio || film.sfx?.length || film.audioClips?.length) reasons.push("legacy music, effects and timeline audio clips are not mixed natively (library soundtracks are)");
  const soundtrack = normalizeFilmSoundtrack(film);
  if ((soundtrack.sections.length || soundtrack.sfx.length) && !usesSectionMixer(soundtrack)) reasons.push("path-only legacy soundtrack sections are not mixed natively (library soundtracks are)");
  for (const shot of film.shots) {
    if (shot.stage === "inset") {
      // P2.6a and P2.6b: the measured inset forms are drawn: a scene film's inset holding exactly one StatCounter, on a cut,
      // the first shot, or a shot that opens on a camera move.
      if (!film.scene) reasons.push(`shot ${shot.id}: stage "inset" panels in a node-graph film (no scene) are not measured against Remotion yet`);
      if (shot.blocks.length === 0) reasons.push(`shot ${shot.id}: a stage "inset" panel with no block is not measured against Remotion yet`);
      if (shot.blocks.some((b) => b.c !== "StatCounter" && b.c !== "TokenStrip" && b.c !== "LayerStack")) reasons.push(`shot ${shot.id}: stage "inset" panels hold only a StatCounter, a TokenStrip or a LayerStack natively`);
    } else if (shot.stage !== "frame" && shot.stage !== "none") reasons.push(`shot ${shot.id}: stage "${shot.stage}" panels are Phase 2`);
    // P2.5a and P2.5b: the measured columns are the compiler's text card (a headline then its support copy, design.ts
    // `buildTextBlocks`) and its device card (a headline then a TokenStrip, `buildBlocksForShotVisual`).
    const headlinePair = shot.blocks.length === 2 && shot.blocks[0].c === "TextReveal" && (shot.blocks[1].c === "Body" || shot.blocks[1].c === "TokenStrip" || shot.blocks[1].c === "LayerStack");
    if (shot.blocks.length > 1 && !headlinePair) reasons.push(`shot ${shot.id}: more than one block in a shot is not laid out natively (only a TextReveal followed by a Body, a TokenStrip or a LayerStack is)`);
    if (shot.blocks.length === 1 && shot.blocks[0].c === "LayerStack" && shot.stage !== "inset") reasons.push(`shot ${shot.id}: a LayerStack on its own outside an inset panel is not measured against Remotion yet (only under a TextReveal, or in an inset)`);
    if (shot.blocks.some((b) => b.c === "LayerStack" && b.prompt !== undefined)) reasons.push(`shot ${shot.id}: a LayerStack prompt is not measured against Remotion yet`);
    if (shot.blocks.length === 1 && shot.blocks[0].c === "Body") reasons.push(`shot ${shot.id}: a Body block on its own is not measured against Remotion yet (only under a TextReveal)`);
    if (shot.blocks.length === 1 && shot.blocks[0].c === "TokenStrip" && shot.stage !== "inset") reasons.push(`shot ${shot.id}: a TokenStrip on its own outside an inset panel is not measured against Remotion yet (only under a TextReveal, or in an inset)`);
    const strip = shot.blocks.find((b) => b.c === "TokenStrip");
    if (strip?.c === "TokenStrip" && FORMAT_SIZE[format]) {
      const wide = tokenStripTooWide(strip, layoutFor(FORMAT_SIZE[format].width, FORMAT_SIZE[format].height, theme), format, shot.stage === "inset", film.subtitles !== false && film.captions !== "off");
      if (wide) reasons.push(`shot ${shot.id}: ${wide}`);
    }
    for (const block of shot.blocks) {
      if (!SUPPORTED_BLOCKS.has(block.c)) reasons.push(`shot ${shot.id}: ${block.c} blocks are Phase 2`);
      const size = block.c === "Body" && FORMAT_SIZE[format] ? bodySizes(layoutFor(FORMAT_SIZE[format].width, FORMAT_SIZE[format].height, theme)) : undefined;
      if (size && size.advance === undefined) reasons.push(`shot ${shot.id}: Body copy at ${size.fs} px has no measured Chrome advance size`);
      const unmeasured = block.c === "Body" ? firstUnmeasuredBodyWord(block.text) : undefined;
      if (unmeasured !== undefined) {
        reasons.push(`shot ${shot.id}: Body copy word ${JSON.stringify(unmeasured)} is not a measured word shape; only white-space line breaks between measured word shapes (letters and digits, with an optional opening or closing ( ) " ' mark, internal . , ' groups and one trailing . , ; : ! ?) are measured against Chrome`);
      }
    }
    if (shot.needsFootage) reasons.push(`shot ${shot.id}: footage is Phase 2`);
  }
  if (format !== "long" && format !== "reel") reasons.push(`unknown format ${String(format)}`);
  return reasons;
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

/** Ease-out-expo progress through `[from, from + duration]` at a frame (motion.ts `useProgress`). */
function progressAt(f: number, from: number, duration: number): number {
  return EXPO(Math.max(0, Math.min(1, (f - from) / duration)));
}

/** Dense linear keyframes of an entrance-shaped value over the frames where it moves. */
function motionTrack(property: "opacity" | "y" | "x" | "scaleX", value: (f: number) => number, from: number, to: number) {
  return { property, keyframes: linearKeyframes(value, Math.max(0, Math.floor(from)), Math.max(0, Math.ceil(to))) };
}

/** Rounds a layout coordinate to a whole pixel as Blink's `ToRoundedVector2d` does (half away from zero). */
function blinkPixelSnap(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/**
 * The inset panel (Film.tsx `Stage` for an `inset` stage, P2.6a): the format's inset region as a CSS box with a 1 px hairline
 * border, filled with the theme's surface colour (CSS paints the background under the border), the border on its own band,
 * rounded by the card radius, no shadow. The render sizes it border-box (measured: its border box is exactly the region,
 * 1152 to 1823 on the long frame). Drawn on a cut shot.
 */
function insetPanel(ctx: LayoutCtx, id: string): Node[] {
  const theme = BACKGROUND_THEMES[ctx.film.theme?.background ?? "paper-white"] ?? BACKGROUND_THEMES["paper-white"];
  const r = getInsetRegion(ctx.format, ctx.width, ctx.height);
  const radius = ctx.layout.radius.card;
  return [
    { kind: "rect", id: `${id}-panel`, fill: rgbHex(theme.surface), radius, tracks: [], placement: { [ctx.format]: { x: r.x, y: r.y, w: r.w, h: r.h } } },
    { kind: "rect", id: `${id}-panel-border`, radius: radius - 0.5, tracks: [], stroke: { color: cssColor(theme.hairline), width: 1 }, placement: { [ctx.format]: { x: r.x + 0.5, y: r.y + 0.5, w: r.w - 1, h: r.h - 1 } } },
  ];
}

/**
 * Where an inset panel's content is centred: Film.tsx's inner column fills the panel inside its 1 px border, border-box, so its
 * content box is the region less the border and its padding (3 grid) on every side (measured: the counter is centred in the
 * region, as this gives).
 */
function insetContentRect(ctx: LayoutCtx): { x: number; y: number; w: number; h: number } {
  const r = getInsetRegion(ctx.format, ctx.width, ctx.height);
  const pad = ctx.layout.grid * 3;
  return { x: r.x + 1 + pad, y: r.y + 1 + pad, w: r.w - 2 - 2 * pad, h: r.h - 2 - 2 * pad };
}

/**
 * The open and close of an inset panel on a shot that is not a cut (Film.tsx `Stage`, P2.6b): the panel's opacity is
 * `min(1, 1.4 * open) * (1 - close)`, `open` the ease-out-expo over the camera move from the shot's start and `close` the same
 * ease over the shot's last 420 ms; its content column fades in linearly from 55% of the move to its end, and the blocks start
 * their own entrance when that fade starts.
 */
function insetMotion(ctx: LayoutCtx, t: TimedShot): { panelTrack: ReturnType<typeof motionTrack>; contentTrack: ReturnType<typeof motionTrack>; contentStart: number } {
  const openFrames = frames(MS.move, ctx.fps);
  const closeFrames = frames(INSET_CLOSE_MS, ctx.fps);
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const ease = (v: number) => EXPO(clamp01(v));
  // Past the shot's last frame (the last shot, held under the end card) the panel stays as Film.tsx froze it.
  const panel = (frame: number) => {
    const f = Math.min(frame, t.to - 1);
    return clamp01(ease((f - t.from) / openFrames) * 1.4) * (1 - clamp01(ease((f - (t.to - closeFrames)) / closeFrames)));
  };
  const fadeFrom = t.from + openFrames * 0.55;
  const fadeTo = t.from + openFrames;
  const contentIn = (f: number) => clamp01((f - fadeFrom) / (fadeTo - fadeFrom));
  return {
    panelTrack: motionTrack("opacity", panel, t.from, t.to),
    contentTrack: motionTrack("opacity", contentIn, fadeFrom, fadeTo),
    contentStart: t.from + Math.round(openFrames * 0.55),
  };
}

/** The tops of a headline and the block under it (Body copy or a TokenStrip) in the stage's centred column: their heights and the 2.5-grid gap, centred as a whole. */
function columnTops(ctx: LayoutCtx, headline: { text: string; size?: "display" | "headline" | "subhead"; accentWord?: string }, second: Block): [number, number] {
  const rect = stageRect(ctx);
  const first = textRevealLayout(ctx, headline).blockH;
  const gap = ctx.layout.grid * 2.5;
  const secondH = second.c === "Body" ? bodyLayout(ctx, second).height : second.c === "TokenStrip" ? tokenStripLayout(ctx, second, rect).height : 0;
  const total = first + gap + secondH;
  const top = rect.y + (rect.h - total) / 2;
  return [top, top + first + gap];
}

/** Film.tsx's `CLOSE_MS`: how long a panel takes to fade out at the end of its shot. */
const INSET_CLOSE_MS = 420;

/** A shot's text-card box: the frame inside its margins (Film.tsx `Stage` for a `frame` stage). */
function stageRect(ctx: LayoutCtx) {
  const captions = ctx.film.subtitles !== false && ctx.film.captions !== "off";
  return getStageCardRect(ctx.format, ctx.width, ctx.height, ctx.layout.margin, captions);
}

/**
 * The font size whose shaped advances equal Chrome's for Geist 400 at each body size a film uses (Remotion's Chrome, with its
 * `--font-render-hinting=none`, measured over every word prefix of 400 sentences): 24 px advances as 24 px, but 33.6 px
 * advances as 33.585 px (all 2402 prefixes within 1/64 px; at 33.6 px only 37 are). Line breaking needs Chrome's widths.
 */
const CHROME_BODY_ADVANCE_SIZE = new Map<number, number>([[24, 24], [33.599999999999994, 33.585]]);

/** The body size of a format, and the size Chrome's advances at that size are measured at (nativeSupport refuses any other). */
function bodySizes(layout: DLLayout): { fs: number; advance: number | undefined } {
  const fs = layout.type("body").fontSize;
  return { fs, advance: CHROME_BODY_ADVANCE_SIZE.get(fs) };
}

/**
 * A Body block's layout (primitives.tsx `Body`, P2.5a): Geist at the body size in the muted colour, left-aligned (no panel
 * gives a centred `AlignContext`) in a box as wide as its text up to its measure (680 px on the long frame, the stage on the
 * reel) and centred in the stage, broken into lines as Chrome breaks `text-wrap: pretty` (backend/renderIr/bodyWrap.ts) on
 * Chrome's advances, each line `line-height` 1.5 (in 1/64 px). Words are placed one by one at Chrome's positions.
 */
function bodyLayout(ctx: LayoutCtx, block: { text: string }) {
  const type = ctx.layout.type("body");
  const { fs, advance } = bodySizes(ctx.layout);
  const em = parseFloat(type.letterSpacing) || 0;
  const font = sansId(type.fontWeight);
  const rect = stageRect(ctx);
  const measure = ctx.format === "long" ? ctx.layout.px(680) : rect.w;
  // CSS collapses runs of white space into one space between words.
  const words = block.text.trim().split(/\s+/).filter(Boolean);
  const width = (text: string) => ctx.width_({ text, font, size: advance ?? fs, letterSpacing: em * fs });
  // Each word's end is the paragraph's width up to it; the next word starts where its own width ends the next prefix.
  const ends = words.map((_, i) => width(words.slice(0, i + 1).join(" ")));
  const own = words.map((w) => width(w));
  const positions: WordPosition[] = ends.map((end, i) => ({ end, next: i + 1 < words.length ? ends[i + 1] - own[i + 1] : end }));
  const maxContent = ends.length ? ends[ends.length - 1] : 0;
  const boxW = Math.min(maxContent, measure, rect.w);
  const starts = prettyLines(positions, boxW, fs);
  const lineH = Math.floor(type.lineHeight * fs * 64) / 64;
  return { fs, em, font, rect, words, own, positions, boxW, starts, lineH, height: starts.length * lineH };
}

/** Lays out a Body block from `top`: one text node per word at Chrome's positions, the block entering as one (rise and fade). */
function bodyNodes(ctx: LayoutCtx, id: string, block: { text: string }, start: number, index: number, top: number): Node {
  const { fs, em, font, rect, words, own, positions, boxW, starts, lineH } = bodyLayout(ctx, block);
  const boxX = rect.x + (rect.w - boxW) / 2;
  const children: Node[] = [];
  starts.forEach((first, line) => {
    const last = line + 1 < starts.length ? starts[line + 1] : words.length;
    const lineStart = first === 0 ? 0 : positions[first - 1].next;
    for (let i = first; i < last; i++) {
      const wordStart = i === 0 ? 0 : positions[i - 1].next;
      children.push({
        kind: "text", id: `${id}-w${i}`, text: words[i], font, color: ctx.tokens.muted, align: "left",
        lineHeight: lineH / fs, letterSpacing: em, tracks: [],
        placement: { [ctx.format]: { x: boxX + wordStart - lineStart, y: top + line * lineH, w: own[i] + fs, h: lineH, fontSize: fs } },
      });
    }
  });
  const from = start + frames(MS.stagger * index, ctx.fps);
  const enterFrames = frames(MS.enter, ctx.fps);
  const rise = ctx.layout.px(12);
  const enter = (f: number) => progressAt(f, from, enterFrames);
  return {
    kind: "group", id, x: 0, y: 0, scale: 1, rotation: 0,
    tracks: [motionTrack("opacity", enter, from, from + enterFrames), motionTrack("y", (f) => (1 - enter(f)) * rise, from, from + enterFrames)],
    children,
  };
}

/** JetBrains Mono's advance for every Latin glyph, in em (600 of 1000 units): a mono run's width needs no measuring. */
const MONO_ADVANCE_EM = 0.6;

/**
 * Why a TokenStrip cannot be laid out natively in its panel, or undefined: its caption must fit on one line in the column (a
 * caption that wraps is not measured). Uses the mono advance, so it runs before any measuring.
 */
function tokenStripTooWide(block: { caption?: string }, layout: DLLayout, format: NativeFormat, inset: boolean, captions: boolean): string | undefined {
  if (!block.caption) return undefined;
  const { width, height } = FORMAT_SIZE[format];
  const region = inset ? getInsetRegion(format, width, height) : getStageCardRect(format, width, height, layout.margin, captions);
  const available = inset ? region.w - 2 - 6 * layout.grid : region.w;
  const size = Number(layout.label().fontSize);
  const captionW = block.caption.length * (MONO_ADVANCE_EM + 0.14) * size;
  return captionW > available ? `a TokenStrip caption ${Math.round(captionW)} px wide wraps in its ${Math.round(available)} px column, which is not measured against Remotion yet` : undefined;
}

/**
 * A TokenStrip's layout (devices.tsx `TokenStrip`, P2.5b): mono chips (0.9 of the body size, padding one grid by 1.5 grid,
 * a 1 px border, the chip radius times 0.6) in a wrapping row with a one-grid gap, and an optional label-style caption two
 * grids below. The block is as wide as its widest content up to the column (`fit-content`) and centred in it; chips wrap
 * greedily and sit at the left of each row; the caption sits at the block's left.
 */
function tokenStripLayout(ctx: LayoutCtx, block: { tokens: string[]; caption?: string }, rect: { x: number; y: number; w: number; h: number }) {
  const g = ctx.layout.grid;
  const size = ctx.layout.type("body").fontSize * 0.9;
  const font = monoId(400);
  // Blink's `line-height: normal` is the rounded ascent plus the rounded descent (JetBrains Mono has no line gap): 28 px at the
  // reel's 21.6 px, where the native line metrics round the sum instead (29).
  const metrics = ctx.metrics(font, size);
  const m = { ...metrics, height: Math.round(metrics.ascent) + Math.round(metrics.descent) };
  const chipH = m.height + 2 * g + 2;
  const chips = block.tokens.map((text) => {
    const textW = ctx.width_({ text, font, size, letterSpacing: 0 });
    return { text, textW, w: textW + 3 * g + 2 };
  });
  const labelSize = Number(ctx.layout.label().fontSize);
  const labelM = ctx.metrics(font, labelSize);
  const caption = block.caption ? block.caption.toUpperCase() : "";
  const captionW = caption ? ctx.width_({ text: caption, font, size: labelSize, letterSpacing: 0.14 * labelSize }) : 0;
  let rowMax = 0;
  let rowX = 0;
  for (const c of chips) {
    rowMax = rowX + c.w;
    rowX += c.w + g;
  }
  const width = Math.min(Math.max(rowMax, captionW), rect.w);
  const placed: Array<{ text: string; textW: number; w: number; x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  for (const chip of chips) {
    if (x > 0 && x + chip.w > width) {
      x = 0;
      y += chipH + g;
    }
    placed.push({ ...chip, x, y });
    x += chip.w + g;
  }
  const rowsH = y + chipH;
  const height = rowsH + (caption ? 2 * g + labelM.height : 0);
  return { g, size, font, m, chipH, chips: placed, labelSize, labelM, caption, captionW, rowsH, width, height };
}

/**
 * Lays out a TokenStrip from `top` in `rect`: each chip off (sunken fill, rule border, muted text) until the shot's sweep
 * reaches it (devices.tsx `useSweep`: linear from the entrance's end to a move before the shot's end), then on (an accent
 * fill fading from 0.1 to 0.18 as the sweep crosses it, an accent border at 0.5, ink text); a `lit` chip is on from the
 * start at 0.22. The block enters as one.
 */
function tokenStripNodes(ctx: LayoutCtx, id: string, block: { tokens: string[]; lit: number[]; caption?: string }, start: number, index: number, top: number, rect: { x: number; y: number; w: number; h: number }, duration: number, span: { from: number; to: number }): Node {
  const L = tokenStripLayout(ctx, block, rect);
  const x0 = rect.x + (rect.w - L.width) / 2;
  const radius = ctx.layout.radius.chip * 0.6;
  const sweepFrom = start + frames(MS.enter, ctx.fps);
  const sweepSpan = Math.max(1, duration - frames(MS.enter + MS.move, ctx.fps));
  const head = (f: number) => Math.max(0, Math.min(1, (f - sweepFrom) / sweepSpan)) * block.tokens.length;
  const accent = ctx.accent;
  const children: Node[] = [];
  // One chip in one state: its fill, its border on the 1 px band, and its text.
  const chipNodes = (key: string, chip: (typeof L.chips)[number], fill: string, border: string, ink: string, fillTracks: ReturnType<typeof motionTrack>[] = []): Node[] => {
    const cx = x0 + chip.x;
    const cy = top + chip.y;
    // Blink paints a box's background and border pixel-snapped (each edge rounded to a whole pixel), so the 1 px border is one
    // crisp row; the text inside keeps its fractional position.
    const bx = Math.round(cx);
    const by = Math.round(cy);
    const bw = Math.round(cx + chip.w) - bx;
    const bh = Math.round(cy + L.chipH) - by;
    return [
      { kind: "rect", id: `${key}-fill`, fill, radius, tracks: fillTracks, placement: { [ctx.format]: { x: bx, y: by, w: bw, h: bh } } },
      { kind: "rect", id: `${key}-border`, radius: radius - 0.5, tracks: [], stroke: { color: border, width: 1 }, placement: { [ctx.format]: { x: bx + 0.5, y: by + 0.5, w: bw - 1, h: bh - 1 } } },
      {
        kind: "text", id: `${key}-text`, text: chip.text, font: L.font, color: ink, align: "left", lineHeight: L.m.height / L.size, letterSpacing: 0, tracks: [],
        placement: { [ctx.format]: { x: cx + 1 + 1.5 * L.g, y: cy + 1 + L.g, w: chip.textW + L.size, h: L.m.height, fontSize: L.size } },
      },
    ];
  };
  const onBorder = hexAlpha(accent, 0.5);
  L.chips.forEach((chip, i) => {
    const key = `${id}-c${i}`;
    if (block.lit.includes(i)) {
      children.push(...chipNodes(key, chip, hexAlpha(accent, 0.22), onBorder, rgbHex(ctx.tokens.ink)));
      return;
    }
    let on = span.from;
    while (on < span.to && !(head(on) > i)) on++;
    if (on > span.from) {
      children.push({ kind: "group", id: `${key}-off`, visible: { fromFrame: span.from, toFrame: on }, x: 0, y: 0, scale: 1, rotation: 0, tracks: [],
        children: chipNodes(`${key}-off`, chip, cssColor(ctx.tokens.sunken), cssColor(ctx.tokens.rule()), rgbHex(ctx.tokens.muted)) });
    }
    if (on < span.to) {
      const landing = (f: number) => 0.1 + Math.max(0, Math.min(1, head(f) - i)) * 0.08;
      children.push({ kind: "group", id: `${key}-on`, visible: { fromFrame: on, toFrame: span.to }, x: 0, y: 0, scale: 1, rotation: 0, tracks: [],
        children: chipNodes(`${key}-on`, chip, accent, onBorder, rgbHex(ctx.tokens.ink), [motionTrack("opacity", landing, on, Math.min(span.to, Math.ceil(sweepFrom + ((i + 1) / block.tokens.length) * sweepSpan) + 1))]) });
    }
  });
  if (L.caption) {
    children.push({
      kind: "text", id: `${id}-caption`, text: L.caption, font: L.font, color: rgbHex(ctx.tokens.muted), align: "left", lineHeight: L.labelM.height / L.labelSize, letterSpacing: 0.14, tracks: [],
      placement: { [ctx.format]: { x: x0, y: top + L.rowsH + 2 * L.g, w: L.captionW + L.labelSize, h: L.labelM.height, fontSize: L.labelSize } },
    });
  }
  const from = start + frames(MS.stagger * index, ctx.fps);
  const enterFrames = frames(MS.enter, ctx.fps);
  const rise = ctx.layout.px(12);
  const enter = (f: number) => progressAt(f, from, enterFrames);
  return {
    kind: "group", id, x: 0, y: 0, scale: 1, rotation: 0,
    tracks: [motionTrack("opacity", enter, from, from + enterFrames), motionTrack("y", (f) => (1 - enter(f)) * rise, from, from + enterFrames)],
    children,
  };
}

/** Blink's `line-height: normal` for a face: the rounded ascent plus the rounded descent (the vendored fonts have no line gap). */
function blinkNormalLineHeight(m: LineMetrics): number {
  return Math.round(m.ascent) + Math.round(m.descent);
}

/** A box's edges as Blink paints its background and border: each edge rounded to a whole pixel. */
function snapBox(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const sx = Math.round(x);
  const sy = Math.round(y);
  return { x: sx, y: sy, w: Math.round(x + w) - sx, h: Math.round(y + h) - sy };
}

/**
 * Lays out a LayerStack (devices.tsx `LayerStack`, P2.5c) in `box`, the height its column leaves it (`flex: 1`): a stack of
 * equal bars (`flex: 1`, a 6 px gap and a 28 px minimum for named layers, 3 px and 3 px otherwise) as wide as 640 px (named) or
 * 460 px, at most 80% or 60% of the box, beside a label column (the top label, the lit step as "k / n" in the accent, the bottom
 * label) spread top to bottom, the two centred together with a 2.5-grid gap. A linear sweep over the shot (devices.tsx
 * `useSweep`) lights one bar at a time (from the bottom for named layers, from the top otherwise), marked by a small accent tab
 * to its left. Named bars carry their label and dimension in mono. Each bar is drawn unlit outside its lit step, lit within it.
 */
function layerStackNodes(ctx: LayoutCtx, id: string, block: { count?: number; bottomLabel?: string; topLabel?: string; layers?: Array<string | { label: string; dim?: string }> }, start: number, index: number, box: { x: number; y: number; w: number; h: number }, duration: number, span: { from: number; to: number }): Node {
  const px = ctx.layout.px;
  const g = ctx.layout.grid;
  const named = (block.layers ?? []).map((e) => (typeof e === "string" ? { label: e, dim: undefined as string | undefined } : { label: e.label, dim: e.dim }));
  const rows = named.length > 0 ? named.length : block.count ?? 32;
  const shown = [...named].reverse();
  const gapPx = px(named.length > 0 ? 6 : 3);
  const minH = px(named.length > 0 ? 28 : 3);
  // The label column: label-style mono, as wide as its widest line; empty labels take no height.
  const labelSize = Number(ctx.layout.label().fontSize);
  const font = monoId(400);
  const labelLineH = blinkNormalLineHeight(ctx.metrics(font, labelSize));
  const labelW = (text: string) => (text ? ctx.width_({ text, font, size: labelSize, letterSpacing: 0.14 * labelSize }) : 0);
  const top = (block.topLabel ?? "").toUpperCase();
  const bottom = (block.bottomLabel ?? "").toUpperCase();
  const counterText = (k: number) => `${k} / ${rows}`;
  const labelColW = Math.max(labelW(top), labelW(bottom), labelW(counterText(rows)));
  const stackW = Math.min(px(named.length > 0 ? 640 : 460), (named.length > 0 ? 0.8 : 0.6) * box.w);
  const rowGap = g * 2.5;
  const left = box.x + (box.w - (stackW + rowGap + labelColW)) / 2;
  const labelX = left + stackW + rowGap;
  const rowH = Math.max(minH, (box.h - gapPx * (rows - 1)) / rows);
  const stackH = box.h;
  const barY = (i: number) => box.y + i * (rowH + gapPx);
  // The sweep: the lit step, its displayed bar, and the frames each step holds.
  const sweepFrom = start + frames(MS.enter, ctx.fps);
  const sweepSpan = Math.max(1, duration - frames(MS.enter + MS.move, ctx.fps));
  const stepAt = (f: number) => Math.min(rows - 1, Math.floor(Math.max(0, Math.min(1, (f - sweepFrom) / sweepSpan)) * rows));
  const litBar = (step: number) => (named.length > 0 ? rows - 1 - step : step);
  const steps: Array<{ step: number; from: number; to: number }> = [];
  for (let f = span.from; f < span.to; f++) {
    const step = stepAt(f);
    const last = steps[steps.length - 1];
    if (last && last.step === step) last.to = f + 1;
    else steps.push({ step, from: f, to: f + 1 });
  }
  const barSize = ctx.layout.type("body").fontSize * 0.85;
  const barM = ctx.metrics(font, barSize);
  const barLineH = blinkNormalLineHeight(barM);
  const accent = ctx.accent;
  const radius = px(2);
  // One bar in one state: its fill, its 1 px border and, for a named layer, its label and dimension.
  const bar = (key: string, i: number, lit: boolean): Node[] => {
    const b = snapBox(left, barY(i), stackW, rowH);
    const nodes: Node[] = [
      { kind: "rect", id: `${key}-fill`, fill: lit ? hexAlpha(accent, 0.3) : cssColor(ctx.tokens.inkAt(0.03)), radius, tracks: [], placement: { [ctx.format]: b } },
      { kind: "rect", id: `${key}-border`, radius: radius - 0.5, tracks: [], stroke: { color: lit ? accent : cssColor(ctx.tokens.rule()), width: 1 }, placement: { [ctx.format]: { x: b.x + 0.5, y: b.y + 0.5, w: b.w - 1, h: b.h - 1 } } },
    ];
    const part = shown[i];
    if (part) {
      const textY = barY(i) + 1 + (rowH - 2 - barLineH) / 2;
      const labelWidth = ctx.width_({ text: part.label, font, size: barSize, letterSpacing: 0 });
      nodes.push({
        kind: "text", id: `${key}-label`, text: part.label, font, color: rgbHex(lit ? ctx.tokens.ink : ctx.tokens.muted), align: "left", lineHeight: barLineH / barSize, letterSpacing: 0, tracks: [],
        placement: { [ctx.format]: { x: left + 1 + 1.5 * g, y: textY, w: labelWidth + barSize, h: barLineH, fontSize: barSize } },
      });
      if (part.dim) {
        const dimW = ctx.width_({ text: part.dim, font, size: barSize, letterSpacing: 0 });
        nodes.push({
          kind: "text", id: `${key}-dim`, text: part.dim, font, color: lit ? accent : rgbHex(ctx.tokens.muted), align: "left", lineHeight: barLineH / barSize, letterSpacing: 0, tracks: [],
          placement: { [ctx.format]: { x: left + stackW - 1 - 1.5 * g - dimW, y: textY, w: dimW + barSize, h: barLineH, fontSize: barSize } },
        });
      }
    }
    return nodes;
  };
  const group = (key: string, from: number, to: number, children: Node[]): Node => ({ kind: "group", id: key, visible: { fromFrame: from, toFrame: to }, x: 0, y: 0, scale: 1, rotation: 0, tracks: [], children });
  const children: Node[] = [];
  for (let i = 0; i < rows; i++) {
    // Each bar is lit over the steps that light it (one run of frames) and unlit before and after.
    const litSteps = steps.filter((s) => litBar(s.step) === i);
    const litFrom = litSteps.length ? litSteps[0].from : span.to;
    const litTo = litSteps.length ? litSteps[litSteps.length - 1].to : span.to;
    if (litFrom > span.from) children.push(group(`${id}-r${i}-a`, span.from, litFrom, bar(`${id}-r${i}-a`, i, false)));
    if (litTo > litFrom) children.push(group(`${id}-r${i}-lit`, litFrom, litTo, bar(`${id}-r${i}-lit`, i, true)));
    if (litTo < span.to) children.push(group(`${id}-r${i}-b`, litTo, span.to, bar(`${id}-r${i}-b`, i, false)));
  }
  // The label column: items spread with space-between over the stack's height.
  const items = [
    { key: "top", text: top, color: rgbHex(ctx.tokens.muted) },
    { key: "counter", text: "", color: accent },
    { key: "bottom", text: bottom, color: rgbHex(ctx.tokens.muted) },
  ];
  const heights = items.map((it) => (it.key === "counter" || it.text ? labelLineH : 0));
  const free = stackH - heights.reduce((a, b) => a + b, 0);
  const itemTop = (k: number) => box.y + heights.slice(0, k).reduce((a, b) => a + b, 0) + (free / 2) * k;
  const labelText = (key: string, text: string, color: string, y: number): Node => ({
    kind: "text", id: key, text, font, color, align: "left", lineHeight: labelLineH / labelSize, letterSpacing: 0.14, tracks: [],
    placement: { [ctx.format]: { x: labelX, y, w: labelW(text) + labelSize, h: labelLineH, fontSize: labelSize } },
  });
  if (top) children.push(labelText(`${id}-top`, top, items[0].color, itemTop(0)));
  if (bottom) children.push(labelText(`${id}-bottom`, bottom, items[2].color, itemTop(2)));
  for (const s of steps) {
    const k = named.length > 0 ? s.step + 1 : litBar(s.step) + 1;
    const lit = litBar(s.step);
    children.push(group(`${id}-s${s.from}`, s.from, s.to, [
      labelText(`${id}-s${s.from}-counter`, counterText(k), accent, itemTop(1)),
      { kind: "rect", id: `${id}-s${s.from}-tab`, fill: accent, radius: px(1), tracks: [], placement: { [ctx.format]: { x: left - px(14), y: box.y + (lit / rows) * stackH, w: px(5), h: px(10) } } },
    ]));
  }
  const from = start + frames(MS.stagger * index, ctx.fps);
  const enterFrames = frames(MS.enter, ctx.fps);
  const rise = ctx.layout.px(12);
  const enter = (f: number) => progressAt(f, from, enterFrames);
  return {
    kind: "group", id, x: 0, y: 0, scale: 1, rotation: 0,
    tracks: [motionTrack("opacity", enter, from, from + enterFrames), motionTrack("y", (f) => (1 - enter(f)) * rise, from, from + enterFrames)],
    children,
  };
}

/** A TextReveal block's type, measured words and greedy flex-wrapped rows, shared by its nodes and its height in a column. */
function textRevealLayout(ctx: LayoutCtx, block: { text: string; size?: "display" | "headline" | "subhead"; accentWord?: string }) {
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
  // Greedy flex wrap. Rows start at the block's left (TextReveal's `justify-content` is `flex-start`: no panel provides a
  // centred `AlignContext`), and the block, as wide as its widest content up to the stage, is centred in it (the panel's
  // `align-items: center`), so a headline that wraps starts at the stage's left edge.
  const rows: Array<{ items: typeof words; width: number }> = [];
  for (const w of words) {
    const row = rows[rows.length - 1];
    if (row && row.width + colGap + w.width <= rect.w) {
      row.items.push(w);
      row.width += colGap + w.width;
    } else rows.push({ items: [w], width: w.width });
  }
  const blockH = rows.length * lineH + (rows.length - 1) * rowGap;
  return { type, fs, em, font, lineH, colGap, rowGap, rect, words, rows, blockH };
}

/** Lays out a TextReveal block (centred in the stage, or from `columnTop` in a column): per-word text nodes with their entrance, and the accent word's underline. */
function textRevealNodes(ctx: LayoutCtx, id: string, block: { text: string; size?: "display" | "headline" | "subhead"; accentWord?: string }, start: number, index: number, columnTop?: number): Node[] {
  const { type, fs, em, font, lineH, colGap, rowGap, rect, words, rows, blockH } = textRevealLayout(ctx, block);
  const top = columnTop ?? rect.y + (rect.h - blockH) / 2;
  // The block's max-content width: every word on one row, summed exactly as a row's width is.
  const maxContent = words.reduce((sum, w, i) => (i === 0 ? w.width : sum + (colGap + w.width)), 0);
  const blockW = Math.min(maxContent, rect.w);
  // Written as the single-row centring always was, so a headline on one row is placed bit for bit as before.
  const blockX = rect.x + rect.w / 2 - blockW / 2;
  const base = start + frames(MS.stagger * index, ctx.fps);
  const enterFrames = frames(MS.enter, ctx.fps);
  const rise = ctx.layout.px(12);
  const nodes: Node[] = [];
  let wordIndex = 0;
  rows.forEach((row, r) => {
    let x = blockX;
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
        // The underline carries a `scaleX` transform, which is not a pure translation, so Blink rounds its paint offset to
        // whole pixels (it drops the subpixel accumulation): its box paints at the rounded layout position, not the
        // fractional one (measured 0.45 px lower than unsnapped at frames 45 and 60 of node-graph-flat). Its size stays exact.
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
          placement: { [ctx.format]: { x: blinkPixelSnap(x), y: blinkPixelSnap(y + lineH + 0.1 * fs - h), w: w.coreWidth, h } },
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
function statCounterNodes(ctx: LayoutCtx, id: string, block: { to: number; label: string; format: "plain" | "compact"; suffix?: string }, start: number, index: number, span: { from: number; to: number }, rect: { x: number; y: number; w: number; h: number }): Node {
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
    const inset = shot.stage === "inset";
    if ((shot.stage !== "frame" && !inset) || (!inset && shot.blocks.length === 0)) continue;
    // The last shot stays on screen under the end card (Film.tsx freezes the story's last frame).
    const span = { from: t.from, to: t.to >= storyFrames ? total : Math.min(t.to, total) };
    if (span.to <= span.from) continue;
    const id = `card-${t.index}`;
    // A card printed onto a scene has a scrim band behind its type; a node-graph film's frame panel has none (Film.tsx).
    const children: Node[] = inset ? insetPanel(ctx, id) : ctx.film.scene ? [
      {
        kind: "rect", id: `${id}-scrim`, radius: 0, tracks: [],
        gradient: { stops: [
          { offset: 0, color: hexAlpha(canvas, 0) }, { offset: 0.26, color: hexAlpha(canvas, 0.86) },
          { offset: 0.74, color: hexAlpha(canvas, 0.86) }, { offset: 1, color: hexAlpha(canvas, 0) },
        ] },
        placement: { [ctx.format]: { x: rect.x, y: rect.y + rect.h / 2 - 0.21 * rect.h, w: rect.w, h: 0.42 * rect.h } },
      },
    ] : [];
    // Film.tsx draws a non-frame panel on a shot that is not a cut (and not the first) with its open and close fade, and its
    // content later, fading in on its own (P2.6b); a cut or the first shot is drawn still.
    const motion = inset && shot.move !== "cut" && t.index !== 0 ? insetMotion(ctx, t) : undefined;
    const content: Node[] = [];
    const contentStart = motion ? motion.contentStart : t.from;
    // A headline and its support copy stack in the panel's centred column (Film.tsx: `gap` 2.5 grid, `justify-content: center`).
    const column = shot.blocks.length === 2 && shot.blocks[0].c === "TextReveal" && (shot.blocks[1].c === "Body" || shot.blocks[1].c === "TokenStrip") ? columnTops(ctx, shot.blocks[0], shot.blocks[1]) : undefined;
    // A LayerStack grows (`flex: 1`) into all the height its column leaves, so the column has no free space to centre: a
    // headline sits at the top and the stack fills the rest below the 2.5-grid gap.
    const fillTop = shot.blocks.length === 2 && shot.blocks[0].c === "TextReveal" && shot.blocks[1].c === "LayerStack" ? stageRect(ctx).y : undefined;
    shot.blocks.forEach((block, i) => {
      if (block.c === "TextReveal") content.push(...textRevealNodes(ctx, `${id}-b${i}`, block, contentStart, i, column?.[i] ?? fillTop));
      else if (block.c === "LayerStack") {
        const rect = inset ? insetContentRect(ctx) : stageRect(ctx);
        const above = fillTop !== undefined && shot.blocks[0].c === "TextReveal" ? textRevealLayout(ctx, shot.blocks[0]).blockH + ctx.layout.grid * 2.5 : 0;
        content.push(layerStackNodes(ctx, `${id}-b${i}`, block, contentStart, i, { x: rect.x, y: rect.y + above, w: rect.w, h: rect.h - above }, t.to - t.from, span));
      }
      else if (block.c === "Body" && column) content.push(bodyNodes(ctx, `${id}-b${i}`, block, contentStart, i, column[i]));
      else if (block.c === "TokenStrip") {
        const rect = inset ? insetContentRect(ctx) : stageRect(ctx);
        const top = column ? column[i] : rect.y + (rect.h - tokenStripLayout(ctx, block, rect).height) / 2;
        content.push(tokenStripNodes(ctx, `${id}-b${i}`, block, contentStart, i, top, rect, t.to - t.from, span));
      }
      else if (block.c === "StatCounter") content.push(statCounterNodes(ctx, `${id}-b${i}`, block, contentStart, i, span, inset ? insetContentRect(ctx) : stageRect(ctx)));
    });
    if (motion) children.push({ kind: "group", id: `${id}-content`, x: 0, y: 0, scale: 1, rotation: 0, tracks: [motion.contentTrack], children: content });
    else children.push(...content);
    cards.push({ kind: "group", id, visible: { fromFrame: span.from, toFrame: span.to }, x: 0, y: 0, scale: 1, rotation: 0, tracks: motion ? [motion.panelTrack] : [], children });
  }
  return cards;
}

/** The Render IR image asset id of a picture asset. */
const imageAssetId = (assetId: string) => `img-${assetId}`;

/** Where a picture is staged inside the render package: by its pinned sha256, so a picture used twice is copied once. */
export const picturePackagePath = (sha256: string) => `pictures/${sha256}.png`;

/** The scene's stage nodes: background then props (or the `assets` given, for one plane of a Three film), each with its element tracks frozen after `lastFrame`. */
function stageNodes(scene: Scene, svgIds: Record<string, string[]>, lastFrame: number, assets = [scene.background, ...scene.props].filter(Boolean) as EnvironmentAsset[]): Node[] {
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
    if (asset.raster) {
      // A picture: the same placement and clips as an svg node, on its one element, drawn into its pixel box.
      return {
        kind: "image" as const,
        id: `asset-${asset.assetId}`,
        asset: imageAssetId(asset.assetId),
        x: asset.position.x,
        y: asset.position.y,
        scale: asset.scale ?? 1,
        rotation: asset.rotation ?? 0,
        ...(asset.opacity !== undefined && asset.opacity !== 1 ? { opacity: asset.opacity } : {}),
        layer: asset.layer ?? Math.round(asset.position.y),
        width: asset.raster.width,
        height: asset.raster.height,
        element: rasterElementIds(asset)[0],
        tracks,
        elementTracks: elementTracks(asset, lastFrame),
      };
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

/**
 * The stage of a Three film, as SceneStage draws it: the ground plane (the background and `plane: "background"`
 * props), the Three stage, then the foreground plane (`plane: "foreground"` props over a transparent background).
 * Props with no plane are not drawn on a Three film. The renderer draws stage siblings of equal layer in document
 * order, and groups and the stage3d node count as layer 0, so the planes keep this order.
 */
function threeStageNodes(scene: Scene, svgIds: Record<string, string[]>, lastFrame: number, stage3d: EmittedStage3d): Node[] {
  const group = (id: string, children: Node[]): Node => ({ kind: "group", id, x: 0, y: 0, scale: 1, rotation: 0, tracks: [], children });
  const ground = [scene.background, ...scene.props.filter((p) => p.plane === "background")].filter(Boolean) as EnvironmentAsset[];
  const foreground = scene.props.filter((p) => p.plane === "foreground");
  return [
    group("ground-plane", stageNodes(scene, svgIds, lastFrame, ground)),
    stage3d.node,
    ...(foreground.length ? [group("foreground-plane", stageNodes(scene, svgIds, lastFrame, foreground))] : []),
  ];
}

/** Whether a scene places any picture (raster asset), which makes its document `aideos.render/3`. */
function hasPictures(scene: Scene): boolean {
  return [scene.background, ...scene.props].some((a) => a?.raster !== undefined);
}

/** The film's scene. The native renderer emits scene films only, and nativeSupport refuses the rest before any emit. */
function sceneOf(film: Film): Scene {
  if (!film.scene) throw new Error(`film "${film.id}" has no scene; the native renderer emits scene films only`);
  return film.scene;
}

/** Emits the overlay and stage for one format, given a text measurer callback pair and, for a Three film, its emitted stage. */
function build(input: EmitInput, width_: LayoutCtx["width_"], metrics: LayoutCtx["metrics"], stage3d?: EmittedStage3d): Built {
  const { film, format } = input;
  const scene = film.scene;
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
  // Through the end card the story holds its last frame.
  const storyLast = Math.max(0, storyFrames - 1);
  const frozen = (f: number) => Math.min(f, storyLast);
  const ctx: LayoutCtx = { film, format, width, height, layout, tokens: { ...tokens, ink: rgbHex(tokens.ink), muted: rgbHex(tokens.muted), canvas: rgbHex(tokens.canvas) } as LayoutCtx["tokens"], accent, fps, width_, metrics };

  // The whole picture scales about the frame centre: a held shot's drift and the end card's slow push.
  const frameScale = (f: number) => {
    const holdScale = card && f >= card.from ? 1 + 0.01 * Math.min(1, (f - card.from) / Math.max(1, card.durationInFrames)) : 1;
    const ff = frozen(f);
    const current = shotAt(timeline, ff);
    // A film or shot that opted into the camera's own hold push-in does not also drift (Film.tsx `cameraPush`).
    const cameraPush = scene ? Boolean(scene.camera?.holdPush) : Boolean(current.shot.holdPush);
    const progress = Math.max(0, Math.min(1, (ff - current.from) / Math.max(1, current.durationInFrames)));
    // Film.tsx never drifts a Three film: the stage camera owns all of its framing.
    const drift = current.shot.drift && !cameraPush && !stage3d ? 1 + (DRIFT - 1) * progress : 1;
    return holdScale * drift;
  };

  const last = total - 1;
  const fonts: Asset[] = [
    ...SANS_WEIGHTS.map((w): Asset => ({ kind: "font", id: sansId(w), path: "fonts/Geist-latin.ttf", family: "Geist", weight: w })),
    ...MONO_WEIGHTS.map((w): Asset => ({ kind: "font", id: monoId(w), path: "fonts/JetBrainsMono-latin.ttf", family: "JetBrains Mono", weight: w })),
  ];
  const stagePart = scene
    ? sceneStagePart(input, scene, frozen, storyLast, last, frameScale, fonts, stage3d)
    : nodeGraphStagePart({ film, timeline, width, height, fps, accent, muted: ctx.tokens.muted, canvasColor: canvasBehindGraph(theme, ctx.tokens.canvas), frozen, frameScale, last, fonts,
      measure: width_, metrics, fontId: (family, weight) => (family === "sans" ? sansId(weight) : monoId(weight)) });

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

  // The theme texture under the canvas (Film.tsx draws it under the stage, pushed with it by the end card but not drifted), in the `/7` underlay; node-graph films only (nativeSupport refuses a textured scene film).
  const holdScale = (f: number) => (card && f >= card.from ? 1 + 0.01 * Math.min(1, (f - card.from) / Math.max(1, card.durationInFrames)) : 1);
  const texture = film.videoClips?.length || film.scene ? null : themeTexture(theme, width, height, holdScale, last);

  const audio = resolveAudio(film, delivery);
  const ir: RenderIr = {
    schema: texture ? RENDER_IR_VERSION_7 : stagePart.schema,
    film: { id: film.id, fps, durationFrames: total },
    scene: stagePart.sceneSize,
    formats: { [format]: { width, height } },
    background: ctx.tokens.canvas,
    assets: [...stagePart.assets, ...(texture ? [texture.asset] : []), ...audio.assets],
    camera: stagePart.camera,
    ...(texture ? { underlay: [texture.node] } : {}),
    stage: stagePart.stage,
    overlay,
    audio: audio.clips,
  };
  return { ir, files: [...stagePart.files, ...(texture ? [texture.file] : [])] };
}

/** One build of a document, with the generated package files its stage needs (a node-graph film's canvas artwork). */
interface Built {
  ir: RenderIr;
  files: PackageFile[];
}

/** The part of a document that depends on what the film's canvas is: its version, scene size, assets, camera and stage. */
interface StagePart {
  schema: RenderIr["schema"];
  sceneSize: { width: number; height: number };
  assets: Asset[];
  camera: NonNullable<RenderIr["camera"]>;
  stage: Node[];
  files: PackageFile[];
}

/** The stage of a scene film: its SVG artwork and pictures (or Three stage) under the scene's compiled camera. */
function sceneStagePart(input: EmitInput, scene: Scene, frozen: (f: number) => number, storyLast: number, last: number, frameScale: (f: number) => number, fonts: Asset[], stage3d?: EmittedStage3d): StagePart {
  const { format } = input;
  const { width, height } = FORMAT_SIZE[format];
  const fps = input.film.fps;
  // The scene holds its own last frame.
  const sceneLast = Math.min(storyLast, scene.durationFrames - 1);
  const svgIds: Record<string, string[]> = {};
  const assets: Asset[] = [];
  for (const a of [scene.background, ...scene.props].filter(Boolean) as EnvironmentAsset[]) {
    if (a.raster) {
      svgIds[a.assetId] = rasterElementIds(a);
      assets.push({ kind: "image", id: imageAssetId(a.assetId), path: picturePackagePath(a.raster.sha256), sha256: a.raster.sha256, width: a.raster.width, height: a.raster.height });
      continue;
    }
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

  const cam = compileCameraTrack(scene.camera, scene.durationFrames, scene.sceneSize, fps);
  const camAt = (f: number) => adjustStageCameraForFormat(cam[Math.min(frozen(f), sceneLast)], width, height, scene.sceneSize);
  const camera = {
    centerX: linearKeyframes((f) => camAt(f).center.x, 0, last),
    centerY: linearKeyframes((f) => camAt(f).center.y, 0, last),
    zoom: linearKeyframes((f) => camAt(f).zoom * frameScale(f), 0, last),
    rotation: linearKeyframes((f) => camAt(f).rotation, 0, last),
  };
  return {
    // A film with a picture is `/3`; else a film with a Three stage is `/2`; any other film stays `/1`, byte for byte what it was before `/2` existed.
    schema: hasPictures(scene) ? RENDER_IR_VERSION_3 : stage3d ? RENDER_IR_VERSION_2 : RENDER_IR_VERSION,
    sceneSize: { width: scene.sceneSize.w, height: scene.sceneSize.h },
    assets: [...assets, ...fonts, ...(stage3d ? [stage3d.mesh] : [])],
    camera,
    stage: stage3d ? threeStageNodes(scene, svgIds, sceneLast, stage3d) : stageNodes(scene, svgIds, sceneLast),
    files: [],
  };
}

/** The stage of a node-graph film (P2.2b): its canvas as one generated SVG asset under the flat camera, as `/5` (colour and dash offset tracks). */
function nodeGraphStagePart(input: Parameters<typeof emitNodeGraphCanvas>[0] & { fonts: Asset[] }): StagePart {
  const canvas = emitNodeGraphCanvas(input);
  return {
    schema: RENDER_IR_VERSION_5,
    // The scene is the size of the format, so the camera's cover fit is 1 and its zoom is the canvas's pixels per unit.
    sceneSize: { width: input.width, height: input.height },
    assets: [{ kind: "svg", id: "svg-canvas", path: "visuals/canvas.svg", elementIds: canvas.elementIds }, ...input.fonts],
    camera: canvas.camera,
    stage: [{
      kind: "svg", id: "canvas", asset: "svg-canvas", x: 0, y: 0, scale: 1, rotation: 0, layer: 0,
      tracks: [{ property: "opacity", keyframes: canvas.opacity }],
      elementTracks: canvas.elementTracks,
      colorTracks: canvas.colorTracks,
    }],
    files: [{ path: "visuals/canvas.svg", text: canvas.svg }],
  };
}

/**
 * The Geist weight the Remotion render actually draws the captions in: KineticSubtitles asks for 700, but
 * `tokens.ts` loads Geist at 300 to 600 only, so the browser falls back to the heaviest loaded face (600).
 * The native renderer matches what the Remotion render shows, so parity holds; loading 700 in `tokens.ts`
 * would change that render and is a separate decision.
 */
const CAPTION_FONT_WEIGHT = 600;

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
    font: sansId(CAPTION_FONT_WEIGHT),
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
 * effect at its capped gain (`effectGain`), a transition effect ducked under the same measured speech (`effectDuckGain`). Every clip has gain 1 and carries its level in the envelope, so it
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
  // The voice the music and library effects duck under: the measured speech, plus the end card's line.
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
    const gain = (f: number) => g * effectDuckGain(sfx, f / fps, voice, soundtrack.mix);
    add(`sfx-${i}`, sfx.src || soundtrackItemSrc(item), { startFrame, durationFrames: frames, sourceStartMs: 0, gainEnvelope: envelope(gain, startFrame, startFrame + frames) });
  });
  return out;
}

/** The last frame the scene shows in a format: the story holds its last frame through the end card, and the scene its own. */
function sceneLastFrame(film: Film, format: NativeFormat): number {
  const scene = sceneOf(film);
  const storyLast = Math.max(0, deliveryTimeline(film, format).storyFrames - 1);
  return Math.min(storyLast, scene.durationFrames - 1);
}

/** Emits a validated Render IR for one format of a film and lists the package files it references. */
export function emitRenderIr(input: EmitInput): EmitResult {
  const reasons = nativeSupport(input.film, input.format);
  if (reasons.length) throw new NativeUnsupportedError(reasons);
  const threeScene = input.film.scene?.renderer === "three" ? input.film.scene : undefined;
  // The stage is evaluated once: both layout passes below share it.
  const stage3d = threeScene ? emitStage3d(threeScene, sceneLastFrame(input.film, input.format) + 1) : undefined;
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
    stage3d,
  );
  const runList = [...runs.values()];
  const queryList = [...queries.values()];
  const report = input.measure({ fonts, runs: runList, metrics: queryList });
  if (report.widths.length !== runList.length || report.metrics.length !== queryList.length) throw new Error("the measurer answered a different number of runs or metrics than were asked");
  const widths = new Map(runList.map((r, i) => [runKey(r), report.widths[i]]));
  const lines = new Map(queryList.map((q, i) => [queryKey(q.font, q.size), report.metrics[i]]));
  const built = build(
    input,
    (r) => widths.get(runKey(r)) ?? (() => { throw new Error(`unmeasured run ${r.text}`); })(),
    (font, size) => lines.get(queryKey(font, size)) ?? (() => { throw new Error(`unmeasured face ${font}`); })(),
    stage3d,
  );
  const checked = validateRenderIr(built.ir);
  if (!checked.ok) throw new Error(`the emitted Render IR is invalid: ${JSON.stringify(checked.error)}`);

  const scene = input.film.scene;
  const files: PackageFile[] = [
    { path: "fonts/Geist-latin.ttf", from: input.resolvePath(NATIVE_FONT_FILES.sans) },
    { path: "fonts/JetBrainsMono-latin.ttf", from: input.resolvePath(NATIVE_FONT_FILES.mono) },
    ...built.files,
  ];
  for (const a of scene ? [scene.background, ...scene.props].filter(Boolean) as EnvironmentAsset[] : []) {
    if (a.raster) {
      // The approved file itself, byte for byte: the renderer checks it against the pinned sha256.
      const path = picturePackagePath(a.raster.sha256);
      if (!files.some((f) => f.path === path)) files.push({ path, from: input.resolvePath(a.raster.src) });
      continue;
    }
    files.push({ path: `visuals/${a.assetId}.svg`, text: input.svgSources[a.svgSource!] });
  }
  if (stage3d) files.push({ path: STAGE_MESH_PATH, bytes: stage3d.meshBytes });
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

