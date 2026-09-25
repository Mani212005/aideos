/**
 * File Description: Frame sampler for the vision judge.
 * Picks every 5-7th frame of a scene film, describes what each one is meant to say (its shot's
 * narration and on-screen copy) and rasterizes it once through backend/scene/renderStill.ts (SVG
 * markup, headless Chrome, 1920x1080 PNG with the size verified). Nothing opens a browser against
 * localhost and nothing plays video: the stills are produced here once and every later check
 * (the coding model's critique, the embedding score, the log) reads the same files.
 */

import fs from "node:fs";
import path from "node:path";
import type { Film } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import { compileScene, type CompiledFrame } from "../../src/dl/scene/compile";
import { loadSceneAssets } from "../scene/loadSceneAssets";
import { renderFrameStill, type RenderStillOptions } from "../scene/renderStill";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** Fewest frames between two samples. */
export const MIN_SAMPLE_STRIDE = 5;
/** Most frames between two samples. */
export const MAX_SAMPLE_STRIDE = 7;
/** Stride used when none is given (about five samples a second at 30 fps). */
export const DEFAULT_SAMPLE_STRIDE = 6;
/** Most samples one pass renders; a longer film is thinned evenly rather than truncated. */
export const DEFAULT_MAX_SAMPLES = 48;

/** One sampled frame: where it is, what it should say, and the still rendered for it. */
export interface SampleStill {
  frame: number;
  timeSec: number;
  shotId: string;
  /** The narration of the shot the frame belongs to: the intent text the frame is judged against. */
  narration: string;
  /** Every string the shot's blocks put on screen. */
  onscreen: string[];
  /** Absolute path of the rendered PNG. */
  png: string;
}

/** Options for sampling and rendering. */
export interface SampleOptions {
  stride?: number;
  maxSamples?: number;
  /** Renders one frame to a PNG; injectable so tests never need Chrome. */
  renderStill?: (frame: CompiledFrame, outputPath: string, options: RenderStillOptions) => string;
  /** Where the PNGs go (default .frames/<film>/judge). */
  outDir?: string;
}

// Clamps a requested stride into the 5-7 frame window the judge samples at.
export function clampStride(stride: number | undefined): number {
  const value = Math.round(stride ?? DEFAULT_SAMPLE_STRIDE);
  return Math.min(MAX_SAMPLE_STRIDE, Math.max(MIN_SAMPLE_STRIDE, Number.isFinite(value) ? value : DEFAULT_SAMPLE_STRIDE));
}

// Lists the frame numbers to sample: every stride-th frame from mid-stride, thinned evenly past the cap.
export function sampleFrameNumbers(totalFrames: number, options: { stride?: number; maxSamples?: number } = {}): number[] {
  const stride = clampStride(options.stride);
  const frames: number[] = [];
  for (let f = Math.floor(stride / 2); f < totalFrames; f += stride) frames.push(f);
  const cap = Math.max(1, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
  if (frames.length <= cap) return frames;
  if (cap === 1) return [frames[Math.floor(frames.length / 2)]];
  return Array.from({ length: cap }, (_, k) => frames[Math.round((k * (frames.length - 1)) / (cap - 1))]);
}

// Collects every string a block puts on screen, skipping structural fields.
function blockStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (value.trim()) out.push(value.trim());
  } else if (Array.isArray(value)) {
    for (const v of value) blockStrings(v, out);
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (key === "c" || key === "type" || key === "id" || key === "kind" || key === "state" || key === "size") continue;
      blockStrings(v, out);
    }
  }
}

// Finds the shot a frame plays in (cumulative rounding, as the camera does) with its narration and on-screen copy.
export function describeFrame(film: Film, frame: number): Pick<SampleStill, "shotId" | "narration" | "onscreen"> {
  const fps = film.fps ?? 30;
  let cursor = 0;
  let found = film.shots[film.shots.length - 1];
  for (const shot of film.shots) {
    const end = Math.round(cursor + shot.dur * fps);
    if (frame < end) {
      found = shot;
      break;
    }
    cursor = end;
  }
  const onscreen: string[] = [];
  blockStrings(found?.blocks ?? [], onscreen);
  return { shotId: found?.id ?? "unknown", narration: found?.scriptText ?? "", onscreen };
}

// Returns the folder a film's judge stills are rendered into.
export function judgeFramesDir(filmId: string): string {
  return path.join(REPO_ROOT, ".frames", filmId, "judge");
}

// Samples a scene film and renders each sampled frame once to a verified 1920x1080 PNG.
export function renderSamples(filmId: string, film: Film, options: SampleOptions = {}): SampleStill[] {
  const scene = film.scene as Scene | undefined;
  if (!scene) throw new Error(`film "${filmId}" has no scene, so there is nothing to sample stills from`);
  const { svgSources, elementIdsByAssetId } = loadSceneAssets(scene);
  const compiled = compileScene(scene, { assetElementIds: elementIdsByAssetId });
  const outDir = options.outDir ?? judgeFramesDir(filmId);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const render = options.renderStill ?? renderFrameStill;
  const fps = film.fps ?? scene.fps ?? 30;
  return sampleFrameNumbers(compiled.frames.length, options).map((frame) => {
    const png = render(compiled.frames[frame], path.join(outDir, `frame-${String(frame).padStart(6, "0")}.png`), {
      width: 1920,
      height: 1080,
      sceneSize: scene.sceneSize,
      svgSources,
    });
    return { frame, timeSec: Number((frame / fps).toFixed(3)), png, ...describeFrame(film, frame) };
  });
}
