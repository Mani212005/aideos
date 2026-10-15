/**
 * File Description: The render disk guard. Remotion writes every frame of a format to the temp dir as an image file before it stitches the mp4 (measured: the frame count only ever grows until the render ends, then all of it is deleted), so a long render can fill the disk. The guard renders a few real frames of the actual film at its real size, image format and quality, measures the bytes each one wrote, and refuses the render only when frames x the largest sample x a safety factor, plus the encoded output, plus a 3 GiB reserve, would not fit in the free space.
 * Inputs and outputs: the film, a frame range, composition size, directories to check and (injectable) a sampler and statfs -> nothing when the render fits, or a RenderDiskError (RENDER_DISK_LOW) naming the sample, the estimate, the free space and the reserve.
 * Used by: backend/pipeline/run.ts (render stage), backend/journeys/harness.test.ts, backend/journeys/j12_render_disk.journey.ts, docs/CI.md.
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { buildTimeline } from "../../src/dl/camera";
import type { Film } from "../../src/dl/schema";
import { ROOT } from "./filmStore";
import { FORMAT_SPECS, RENDER_IMAGE, glFlag, stagePublicDir } from "./render";
import type { ProductionFormat } from "./types";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/** Free space a render must leave untouched, in bytes. A hard floor: no estimate may eat into it. */
export const RENDER_RESERVE_BYTES = 3 * GIB;

/**
 * Multiplier on the largest sampled frame. Frames differ (a dense shot, a full-zoom camera), and
 * five samples cannot see them all, so the frame term assumes every frame is twice the heaviest
 * one measured. Real films sit well under that: the heaviest sample is already picked from the
 * densest shot and the tightest camera zoom.
 */
export const RENDER_FRAME_SAFETY_FACTOR = 2;

/**
 * Temp bytes that exist before the first frame is written and do not scale with it: the Remotion
 * webpack bundle (27 MB for the default film), Chrome profiles and caches, the retimed audio.
 * Measured at about 32 MB on a short real render; kept at four times that.
 */
export const RENDER_FIXED_OVERHEAD_BYTES = 128 * MIB;

/**
 * Ceiling for the encoded mp4 at 1080p x 1920 (the pixel count it is scaled by). The render uses
 * h264 at crf 16, which on this design language (flat fills, hairlines, type) lands at a few
 * Mbps; 20 Mbps is the busy-footage ceiling. Audio is AAC at 320 kbps.
 */
const ENCODED_VIDEO_BYTES_PER_SEC_1080P = (20_000_000 / 8);
const ENCODED_AUDIO_BYTES_PER_SEC = 320_000 / 8;

/** Largest number of frames sampled: an even spread plus the densest shot plus the tightest zoom. */
const SPREAD_SAMPLES = 5;

/** One sampled frame: its index in the composition and the bytes its image file took. */
export interface FrameSample {
  frame: number;
  bytes: number;
}

/** What the sampler reports back: the composition's real size and one measured file per frame. */
export interface RenderSample {
  width: number;
  height: number;
  frames: FrameSample[];
}

/** What the estimate is built from. */
export interface RenderEstimateInput {
  /** Frames the render will write. */
  frames: number;
  fps: number;
  width: number;
  height: number;
  /** Bytes of the heaviest sampled frame. */
  maxFrameBytes: number;
}

/** The estimate split into its parts, so an error can show where the bytes come from. */
export interface RenderEstimate {
  /** Frames x heaviest sampled frame x the safety factor. */
  frameBytes: number;
  /** Ceiling for the encoded mp4. */
  outputBytes: number;
  /** Bundle, browser profiles and other fixed temp. */
  overheadBytes: number;
  /** The three parts added: what the render may write at its peak. */
  totalBytes: number;
}

/** Estimated peak bytes of a render: every frame at the heaviest sampled size (times the safety factor), the mp4 and the fixed overhead. */
export function estimateRenderTempBytes(input: RenderEstimateInput): RenderEstimate {
  const frameBytes = Math.ceil(input.frames * input.maxFrameBytes * RENDER_FRAME_SAFETY_FACTOR);
  const seconds = input.frames / input.fps;
  const pixelScale = (input.width * input.height) / (1920 * 1080);
  const outputBytes = Math.ceil(seconds * (ENCODED_VIDEO_BYTES_PER_SEC_1080P * pixelScale + ENCODED_AUDIO_BYTES_PER_SEC));
  const overheadBytes = RENDER_FIXED_OVERHEAD_BYTES;
  return { frameBytes, outputBytes, overheadBytes, totalBytes: frameBytes + outputBytes + overheadBytes };
}

/** Thrown, with RENDER_DISK_LOW in the message, when a render would eat into the reserve. */
export class RenderDiskError extends Error {
  readonly dir: string;
  readonly estimate: RenderEstimate;
  readonly maxFrameBytes: number;
  readonly freeBytes: number;

  /** Names the folder and every number the decision used: the sample, the estimate, the free space and the reserve. */
  constructor(dir: string, estimate: RenderEstimate, maxFrameBytes: number, sampledFrames: number, frames: number, freeBytes: number) {
    super(
      `RENDER_DISK_LOW: rendering ${frames} frames under ${dir} needs about ${(estimate.totalBytes / GIB).toFixed(2)} GiB ` +
        `(heaviest of ${sampledFrames} sampled frames ${(maxFrameBytes / MIB).toFixed(2)} MiB x ${frames} frames x ${RENDER_FRAME_SAFETY_FACTOR} safety, ` +
        `plus ${(estimate.outputBytes / MIB).toFixed(0)} MiB output and ${(estimate.overheadBytes / MIB).toFixed(0)} MiB fixed) ` +
        `plus a ${(RENDER_RESERVE_BYTES / GIB).toFixed(0)} GiB reserve, but only ${(freeBytes / GIB).toFixed(2)} GiB is free; ` +
        `free some space or render a shorter range (renderFrames)`,
    );
    this.name = "RenderDiskError";
    this.dir = dir;
    this.estimate = estimate;
    this.maxFrameBytes = maxFrameBytes;
    this.freeBytes = freeBytes;
  }
}

/** The part of fs.statfsSync the guard reads, so a test can say how much room there is. */
export type StatFs = (p: string) => { bavail: number | bigint; bsize: number | bigint };

/**
 * Refuses a render whose estimated peak plus the reserve does not fit in the free space of every
 * directory it writes to. The estimate is compared in full against each directory, which
 * over-counts only when they are different disks and then by the small mp4 term.
 */
export function assertRenderDiskBudget(
  input: { frames: number; fps: number; sample: RenderSample; dirs?: string[]; statfs?: StatFs },
): RenderEstimate {
  const { sample, frames, fps } = input;
  if (sample.frames.length === 0) throw new Error("RENDER_SAMPLE_FAILED: no frame was sampled, so the render's disk need cannot be measured");
  const maxFrameBytes = Math.max(...sample.frames.map((f) => f.bytes));
  const estimate = estimateRenderTempBytes({ frames, fps, width: sample.width, height: sample.height, maxFrameBytes });
  const statfs = input.statfs ?? fs.statfsSync;
  for (const dir of input.dirs ?? [os.tmpdir()]) {
    // The output folder may not exist yet; the disk it will be created on is the nearest folder that does.
    let probe = dir;
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    const stat = statfs(probe);
    const free = Number(stat.bavail) * Number(stat.bsize);
    if (free < estimate.totalBytes + RENDER_RESERVE_BYTES) {
      throw new RenderDiskError(dir, estimate, maxFrameBytes, sample.frames.length, frames, free);
    }
  }
  return estimate;
}

/**
 * Picks the frames to sample inside `range`: an even spread across the timeline, the middle of the
 * shot with the most blocks (the densest picture) and the frame of the tightest camera zoom (a
 * scene camera keyframe, else the shot with the largest `zoom`). Sorted and without duplicates.
 */
export function pickSampleFrames(film: Film, range: [number, number], spread = SPREAD_SAMPLES): number[] {
  const [first, last] = range;
  const picks = new Set<number>();
  const clamp = (f: number) => Math.min(last, Math.max(first, Math.round(f)));
  for (let i = 0; i < spread; i++) picks.add(clamp(first + ((i + 0.5) / spread) * (last - first + 1)));

  const timeline = buildTimeline(film);
  const middleOf = (t: { from: number; to: number }) => clamp((t.from + t.to) / 2);
  const inRange = timeline.filter((t) => t.to > first && t.from <= last);
  const densest = [...inRange].sort((a, b) => b.shot.blocks.length - a.shot.blocks.length || b.durationInFrames - a.durationInFrames)[0];
  if (densest) picks.add(middleOf(densest));

  const cameraKeys = film.scene?.camera?.keyframes ?? [];
  if (cameraKeys.length > 0) {
    const tightest = cameraKeys.reduce((best, k) => (k.zoom > best.zoom ? k : best));
    picks.add(clamp(tightest.frame));
  } else {
    const closest = [...inRange].sort((a, b) => b.shot.zoom - a.shot.zoom)[0];
    if (closest) picks.add(middleOf(closest));
  }
  return [...picks].sort((a, b) => a - b);
}

/** Renders `frames` of one composition in a child process with the final render's settings and measures each file. */
export function sampleRenderFrames(
  format: ProductionFormat,
  frames: number[],
  options: { browserExecutable?: string } = {},
): Promise<RenderSample> {
  const publicDir = stagePublicDir();
  const request = {
    composition: FORMAT_SPECS[format].composition,
    frames,
    gl: glFlag().replace("--gl=", ""),
    imageFormat: RENDER_IMAGE.format,
    jpegQuality: RENDER_IMAGE.jpegQuality,
    publicDir: publicDir?.dir ?? null,
    browserExecutable: options.browserExecutable ?? null,
  };
  return new Promise<RenderSample>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "backend/pipeline/renderSampleWorker.mjs"), JSON.stringify(request)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-4000)));
    child.on("error", (e) => {
      publicDir?.cleanup();
      reject(e);
    });
    child.on("close", (code) => {
      publicDir?.cleanup();
      if (code !== 0) {
        reject(new Error(`RENDER_SAMPLE_FAILED: sampling ${format} frames exited with code ${code}:\n${err.trim()}`));
        return;
      }
      try {
        const line = out.trim().split("\n").pop() ?? "";
        resolve(JSON.parse(line) as RenderSample);
      } catch {
        reject(new Error(`RENDER_SAMPLE_FAILED: the frame sampler printed no result:\n${out.slice(-500)}`));
      }
    });
  });
}

/** Samples real frames of the film, then refuses the render when its measured need plus the reserve does not fit. */
export async function checkRenderDiskBudget(input: {
  film: Film;
  format: ProductionFormat;
  /** Inclusive frame range the render will write. */
  range: [number, number];
  dirs?: string[];
  browserExecutable?: string;
  /** Injection points for tests; the real sampler and statfs are the defaults. */
  sampler?: (format: ProductionFormat, frames: number[]) => Promise<RenderSample>;
  statfs?: StatFs;
}): Promise<RenderEstimate> {
  const picks = pickSampleFrames(input.film, input.range);
  const sample = await (input.sampler ?? ((f, frames) => sampleRenderFrames(f, frames, { browserExecutable: input.browserExecutable })))(input.format, picks);
  return assertRenderDiskBudget({
    frames: input.range[1] - input.range[0] + 1,
    fps: input.film.fps,
    sample,
    dirs: input.dirs,
    statfs: input.statfs,
  });
}
