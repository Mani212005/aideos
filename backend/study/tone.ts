/**
 * File Description: Luma, contrast, black point and saturation of a reference for `aideos study`, by two independent methods. Method A is ffmpeg's
 * signalstats filter on full-resolution frames (YAVG, YLOW, YHIGH, SATAVG). Method B decodes area-scaled yuv444p frames and computes the same
 * statistics itself from the planes. Both are normalised to 0..1 on the limited video range: luma (Y-16)/219, chroma magnitude sqrt(U'^2+V'^2)/112.
 * Inputs and outputs: a video file -> tone metrics (mean luma, black point = 10th percentile luma, contrast = p90 - p10, saturation) with agreement.
 * Used by: backend/study/study.ts.
 */

import { spawnSync } from "node:child_process";
import { resolveMetric } from "./agreement";
import { analysisSize, streamRawFrames } from "./decode";
import { STUDY, type MethodReading, type Metric } from "./types";

/** The four tone statistics, on 0..1 scales (mean over the sampled frames). */
export interface ToneStats {
  meanLuma: number;
  blackPoint: number;
  highlight: number;
  saturation: number;
}

// Limited-range luma level (16..235) to 0..1.
export function normLuma(y: number): number {
  return Math.min(1, Math.max(0, (y - 16) / 219));
}

// Parses signalstats metadata printed by ffmpeg and averages each statistic over frames; null when no frame was read.
export function parseSignalstats(text: string): ToneStats | null {
  const sums = { YAVG: 0, YLOW: 0, YHIGH: 0, SATAVG: 0 };
  const counts = { YAVG: 0, YLOW: 0, YHIGH: 0, SATAVG: 0 };
  for (const line of text.split("\n")) {
    const m = /lavfi\.signalstats\.(YAVG|YLOW|YHIGH|SATAVG)=(-?\d+(?:\.\d+)?)/.exec(line);
    if (!m) continue;
    const key = m[1] as keyof typeof sums;
    sums[key] += Number(m[2]);
    counts[key]++;
  }
  if (!counts.YAVG) return null;
  return {
    meanLuma: normLuma(sums.YAVG / counts.YAVG),
    blackPoint: normLuma(sums.YLOW / counts.YLOW),
    highlight: normLuma(sums.YHIGH / counts.YHIGH),
    saturation: sums.SATAVG / counts.SATAVG / 112,
  };
}

// Method A: ffmpeg signalstats on frames sampled at STUDY.tone.sampleFps, at full resolution.
export function toneWithSignalstats(file: string): ToneStats | null {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", `fps=${STUDY.tone.sampleFps},signalstats,metadata=print:file=-`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run ffmpeg: ${r.error.message}. Install ffmpeg to use aideos study.`);
  return r.status === 0 ? parseSignalstats(r.stdout) : null;
}

// Statistics of one yuv444p frame: mean, 10th and 90th percentile of luma (0..1) and mean chroma magnitude (0..1).
export function frameTone(frame: Uint8Array, pixels: number): ToneStats {
  const bins = new Uint32Array(256);
  let ySum = 0;
  let chroma = 0;
  for (let i = 0; i < pixels; i++) {
    const y = frame[i];
    bins[y]++;
    ySum += y;
    chroma += Math.hypot(frame[pixels + i] - 128, frame[2 * pixels + i] - 128);
  }
  const at = (p: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += bins[v];
      if (seen >= p * pixels) return v;
    }
    return 255;
  };
  return { meanLuma: normLuma(ySum / pixels), blackPoint: normLuma(at(0.1)), highlight: normLuma(at(0.9)), saturation: chroma / pixels / 112 };
}

// Method B: decodes area-scaled yuv444p frames and averages the statistics computed here.
export async function toneFromPlanes(file: string, width: number, height: number): Promise<ToneStats | null> {
  const size = analysisSize(width, height);
  const pixels = size.width * size.height;
  const frames: ToneStats[] = [];
  await streamRawFrames(file, `fps=${STUDY.tone.sampleFps},scale=${size.width}:${size.height}:flags=area`, "yuv444p", pixels * 3, (frame) => {
    frames.push(frameTone(frame, pixels));
  });
  if (!frames.length) return null;
  const mean = (pick: (s: ToneStats) => number) => frames.reduce((sum, s) => sum + pick(s), 0) / frames.length;
  return { meanLuma: mean((s) => s.meanLuma), blackPoint: mean((s) => s.blackPoint), highlight: mean((s) => s.highlight), saturation: mean((s) => s.saturation) };
}

// Measures tone by both methods and builds the metrics.
export async function measureTone(file: string, width: number, height: number): Promise<Metric[]> {
  const nameA = `ffmpeg signalstats, full-resolution frames at ${STUDY.tone.sampleFps} fps (YAVG, YLOW = 10th percentile, YHIGH = 90th, SATAVG)`;
  const nameB = `own statistics on area-scaled yuv444p planes at ${STUDY.tone.sampleFps} fps (mean, 10th and 90th percentile, chroma magnitude)`;
  let a: ToneStats | null = null;
  let b: ToneStats | null = null;
  let errA: string | undefined;
  let errB: string | undefined;
  try { a = toneWithSignalstats(file); } catch (e) { errA = e instanceof Error ? e.message : String(e); }
  try { b = await toneFromPlanes(file, width, height); } catch (e) { errB = e instanceof Error ? e.message : String(e); }
  const read = (method: string, stats: ToneStats | null, pick: (s: ToneStats) => number, err?: string): MethodReading => ({ method, value: stats ? pick(stats) : null, ...(stats ? {} : { note: err ?? "no frames decoded" }) });
  const tol: { abs: number } = { abs: STUDY.tone.toleranceAbs };
  const both = (id: string, label: string, pick: (s: ToneStats) => number, tolerance = tol): Metric =>
    resolveMetric({ id, label, unit: "0..1", a: read(nameA, a, pick, errA), b: read(nameB, b, pick, errB), tolerance });
  const contrast = (s: ToneStats) => s.highlight - s.blackPoint;
  return [
    both("tone.meanLuma", "Mean luma", (s) => s.meanLuma),
    both("tone.blackPoint", "Black point (10th percentile luma)", (s) => s.blackPoint),
    both("tone.contrast", "Contrast (90th minus 10th percentile luma)", contrast, { abs: STUDY.tone.toleranceAbs * 2 }),
    both("tone.saturation", "Mean chroma saturation", (s) => s.saturation),
  ];
}
