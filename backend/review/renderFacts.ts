/**
 * File Description: Measures a rendered video's picture: layout persistence, stage clears, cuts and
 * stillness from small decoded frames, and captions, text size, contrast, overlap and on-screen
 * numbers from OCR on full-resolution samples. Everything it returns is a number or a timestamp;
 * the criteria verdicts are decided elsewhere (criteria.ts) so thresholds live in one place.
 */

import os from "node:os";
import { streamSampleFrames, streamSmallFrames } from "./media";
import { analyzeSample, ocrFrame, type SampleAnalysis } from "./ocr";
import { frameFeatures, hardCuts, layoutPersistence, stageClears, staticRuns, type PersistenceResult, type StaticRun } from "./pixels";
import { THRESHOLDS } from "./thresholds";
import type { VideoFacts } from "./types";

/** Everything measured from the picture. */
export interface RenderFacts {
  /** Layout persistence; null when the video is too short or too flat to correlate. */
  persistence: PersistenceResult | null;
  /** Seconds at which the stage was cleared (ink coverage collapsed). */
  stageClearTimes: number[];
  hardCutTimes: number[];
  staticRuns: StaticRun[];
  /** Mean ink coverage of the frame (0 to 1). */
  meanCoverage: number;
  /** One entry per OCR sample, in time order; empty when OCR was not run. */
  samples: SampleAnalysis[];
  ocrRan: boolean;
}

/** Knobs for a render measurement. */
export interface RenderOptions {
  /** Skip the OCR pass (pixel facts only). */
  skipOcr?: boolean;
  onProgress?: (message: string) => void;
}

// Runs the layout pass: decode small frames at 10 fps and reduce each to ink features.
async function pixelPass(file: string) {
  const { fps, width, height, inkLevels } = THRESHOLDS.analysis;
  const coverage: number[] = [];
  const diffs: number[] = [];
  const grids: Float32Array[] = [];
  let prev: Uint8Array | null = null;
  await streamSmallFrames(file, { fps, width, height }, (frame) => {
    const f = frameFeatures(frame, prev, width, height, inkLevels);
    coverage.push(f.coverage);
    diffs.push(f.diff);
    grids.push(f.grid);
    prev = frame;
  });
  return { coverage, diffs, grids, fps };
}

// Runs the OCR pass: one full-resolution frame per sample interval, several tesseract processes at once.
async function ocrPass(file: string, video: VideoFacts, onProgress?: (m: string) => void): Promise<SampleAnalysis[]> {
  const out: SampleAnalysis[] = [];
  const limit = Math.max(1, Math.min(4, os.cpus().length - 1));
  const inflight = new Set<Promise<void>>();
  await streamSampleFrames(file, video, THRESHOLDS.captions.sampleEverySec, async (gray, index, t) => {
    if (t > video.durationSec) return;
    const job = ocrFrame(gray, video.width, video.height).then((words) => {
      out.push(analyzeSample(words, gray, video.width, video.height, t));
      if (index % 10 === 9) onProgress?.(`ocr ${out.length} samples`);
    });
    const tracked = job.finally(() => inflight.delete(tracked));
    inflight.add(tracked);
    if (inflight.size >= limit) await Promise.race(inflight);
  });
  await Promise.all(inflight);
  return out.sort((a, b) => a.t - b.t);
}

// Measures the picture of a rendered video.
export async function measureRender(file: string, video: VideoFacts, opts: RenderOptions = {}): Promise<RenderFacts> {
  opts.onProgress?.("analysing layout");
  const px = await pixelPass(file);
  const T = THRESHOLDS;
  const samples = opts.skipOcr ? [] : await ocrPass(file, video, opts.onProgress);
  return {
    persistence: layoutPersistence(px.grids, px.fps),
    stageClearTimes: stageClears(px.coverage, px.fps),
    hardCutTimes: hardCuts(px.diffs, px.fps, T.pacing.hardCutDiff),
    staticRuns: staticRuns(px.diffs, px.fps, T.pacing.staticDiff, T.pacing.staticRunMaxSec),
    meanCoverage: px.coverage.reduce((a, b) => a + b, 0) / Math.max(1, px.coverage.length),
    samples,
    ocrRan: !opts.skipOcr,
  };
}
