/**
 * File Description: Pure pixel analysis for `aideos review` (stage persistence, cuts, stillness).
 * Works on small gray frames. "Ink" is every pixel more than a fixed number of levels away from the
 * frame's median, which is the background; the coarse ink layout of a frame is a 48x27 grid of ink
 * density. Persistence is measured by how well the layout correlates with the layout two seconds
 * earlier, stage-clear events by ink coverage collapsing, never by overlapping pixels in place (that
 * rewards a diagram that simply sits still). Camera is deliberately not measured from pixels: a static
 * grid and HUD dominate global correlation, so camera comes from film data (see source.ts).
 * Inputs and outputs: grayscale video frames -> layout persistence metrics, cut locations, and stillness scores.
 * Used by: backend/review/renderFacts.ts.
 */

export const GRID_W = 48;
export const GRID_H = 27;

/** What is kept of one decoded frame. */
export interface FrameFeatures {
  /** Share of pixels that are ink (0 to 1). */
  coverage: number;
  /** Ink density per coarse cell, GRID_W x GRID_H, row-major. */
  grid: Float32Array;
  /** Mean absolute pixel difference from the previous frame (0 to 255); 0 for the first frame. */
  diff: number;
}

// Finds the median gray level of a frame from a 256-bin histogram.
function medianLevel(frame: Uint8Array): number {
  const bins = new Uint32Array(256);
  for (let i = 0; i < frame.length; i++) bins[frame[i]]++;
  const half = frame.length / 2;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += bins[v];
    if (seen >= half) return v;
  }
  return 128;
}

// Reduces one gray frame to its ink coverage, coarse ink layout and difference from the previous frame.
export function frameFeatures(frame: Uint8Array, prev: Uint8Array | null, width: number, height: number, inkLevels: number): FrameFeatures {
  const median = medianLevel(frame);
  const grid = new Float32Array(GRID_W * GRID_H);
  const cellW = width / GRID_W;
  const cellH = height / GRID_H;
  let inkTotal = 0;
  let diffTotal = 0;
  for (let y = 0; y < height; y++) {
    const gy = Math.min(GRID_H - 1, Math.floor(y / cellH));
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const v = frame[row + x];
      if (Math.abs(v - median) > inkLevels) {
        inkTotal++;
        grid[gy * GRID_W + Math.min(GRID_W - 1, Math.floor(x / cellW))]++;
      }
      if (prev) diffTotal += Math.abs(v - prev[row + x]);
    }
  }
  const cellPixels = cellW * cellH;
  for (let i = 0; i < grid.length; i++) grid[i] /= cellPixels;
  return { coverage: inkTotal / (width * height), grid, diff: prev ? diffTotal / frame.length : 0 };
}

// Pearson correlation of two equal-length vectors; null when either is constant.
export function correlation(a: Float32Array, b: Float32Array): number | null {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa === 0 || sbb === 0) return null;
  return sab / Math.sqrt(saa * sbb);
}

// Linear-interpolated percentile (p in 0..100) of a list of numbers; NaN for an empty list.
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  const pos = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** How well the on-screen layout holds from one moment to the next. */
export interface PersistenceResult {
  median: number;
  p10: number;
  min: number;
  /** The weakest samples, lowest correlation first, as times in seconds. */
  weakest: Array<{ t: number; corr: number }>;
  samples: number;
}

// Correlates the ink layout at every half second with the layout two seconds earlier.
export function layoutPersistence(grids: Float32Array[], fps: number, lagSec = 2, stepSec = 0.5): PersistenceResult | null {
  const lag = Math.round(lagSec * fps);
  const step = Math.max(1, Math.round(stepSec * fps));
  const samples: Array<{ t: number; corr: number }> = [];
  for (let i = lag; i < grids.length; i += step) {
    const c = correlation(grids[i], grids[i - lag]);
    if (c !== null) samples.push({ t: i / fps, corr: c });
  }
  if (samples.length === 0) return null;
  const corrs = samples.map((s) => s.corr);
  return {
    median: percentile(corrs, 50),
    p10: percentile(corrs, 10),
    min: Math.min(...corrs),
    weakest: [...samples].sort((a, b) => a.corr - b.corr).slice(0, 5),
    samples: samples.length,
  };
}

// Finds stage-clear events: moments ink coverage drops below `ratio` of its trailing 3 s median within the next second.
export function stageClears(coverage: number[], fps: number, ratio = 0.45): number[] {
  const trail = 3 * fps;
  const ahead = fps;
  const events: number[] = [];
  let last = -Infinity;
  for (let i = trail; i < coverage.length - ahead; i++) {
    const base = percentile(coverage.slice(i - trail, i), 50);
    if (base <= 0.01) continue;
    let low = Infinity;
    for (let k = i; k < i + ahead; k++) low = Math.min(low, coverage[k]);
    if (low < ratio * base && i - last > trail) {
      events.push(i / fps);
      last = i;
    }
  }
  return events;
}

// Lists the times at which consecutive frames differ by more than `threshold` (hard cuts).
export function hardCuts(diffs: number[], fps: number, threshold: number): number[] {
  const cuts: number[] = [];
  diffs.forEach((d, i) => {
    if (i > 0 && d > threshold) cuts.push(i / fps);
  });
  return cuts;
}

/** A stretch where the picture did not change. */
export interface StaticRun {
  start: number;
  end: number;
}

// Finds runs longer than `minSec` in which every frame differs from the last by less than `threshold`.
export function staticRuns(diffs: number[], fps: number, threshold: number, minSec: number): StaticRun[] {
  const runs: StaticRun[] = [];
  let from = -1;
  const close = (endIdx: number) => {
    if (from >= 0 && (endIdx - from) / fps > minSec) runs.push({ start: from / fps, end: endIdx / fps });
    from = -1;
  };
  for (let i = 1; i < diffs.length; i++) {
    if (diffs[i] < threshold) {
      if (from < 0) from = i - 1;
    } else close(i);
  }
  close(diffs.length);
  return runs;
}
