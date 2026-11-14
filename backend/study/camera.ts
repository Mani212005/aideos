/**
 * File Description: Camera motion profile for `aideos study` (how much of the time the frame moves, how fast, and for how many frames per move),
 * by two independent estimators of global motion (translation plus zoom) between consecutive frames. Method A is a tile-wise iterative
 * Lucas-Kanade sub-pixel estimator over a 4x4 grid with the caption band masked and a robust (Tukey) similarity fit over the tile vectors.
 * Method B is coarse-to-fine block matching with parabolic sub-pixel refinement over the whole unmasked frame with a median estimate.
 * They fail differently (low texture, large motion), which is the point of asking both. A static sharp-edged overlay (a grid, a HUD, a logo) biases both toward zero,
 * so for every frame pair the pixels on sharp edges that did not move are masked out of both methods. Speed is the fastest frame corner in frame widths per second.
 * Inputs and outputs: consecutive gray frames -> a global motion model per pair; per-pair speeds -> camera metrics, moves and the speed profile.
 * Used by: backend/study/study.ts.
 */

import { resolveMetric } from "./agreement";
import { quantile } from "./cuts";
import { round, STUDY, type Metric, type MoveRecord } from "./types";

/** Global motion between two frames: translation (px) and zoom per pixel of offset from the frame centre. */
export interface MotionModel {
  tx: number;
  ty: number;
  scale: number;
}

/** One displacement vector at a point, offsets relative to the frame centre. */
interface Vector {
  cx: number;
  cy: number;
  dx: number;
  dy: number;
}

/** Pixels that must not steer the motion estimate (static overlay edges), at full and half size; 1 means masked. */
export interface OverlayMask {
  full: Uint8Array;
  half: Uint8Array;
}

/** A decoded frame as float images at two resolutions, each with central-difference gradients. */
export interface FramePyramid {
  width: number;
  height: number;
  levels: Array<{ w: number; h: number; img: Float32Array; gx: Float32Array; gy: Float32Array }>;
}

// Computes central-difference gradients of a float image (zero at the border).
function gradients(img: Float32Array, w: number, h: number): { gx: Float32Array; gy: Float32Array } {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      gx[i] = 0.5 * (img[i + 1] - img[i - 1]);
      gy[i] = 0.5 * (img[i + w] - img[i - w]);
    }
  }
  return { gx, gy };
}

// Builds the two-level pyramid of a gray frame: a [1 2 1] smoothed full-size image and its 2x2 average.
export function buildPyramid(gray: Uint8Array, width: number, height: number): FramePyramid {
  const tmp = new Float32Array(width * height);
  const full = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const l = gray[y * width + Math.max(0, x - 1)];
      const r = gray[y * width + Math.min(width - 1, x + 1)];
      tmp[y * width + x] = (l + 2 * gray[y * width + x] + r) / 4;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      full[y * width + x] = (tmp[Math.max(0, y - 1) * width + x] + 2 * tmp[y * width + x] + tmp[Math.min(height - 1, y + 1) * width + x]) / 4;
    }
  }
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);
  const half = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const i = 2 * y * width + 2 * x;
      half[y * hw + x] = (full[i] + full[i + 1] + full[i + width] + full[i + width + 1]) / 4;
    }
  }
  const g0 = gradients(full, width, height);
  const g1 = gradients(half, hw, hh);
  return { width, height, levels: [{ w: width, h: height, img: full, ...g0 }, { w: hw, h: hh, img: half, ...g1 }] };
}

// Finds the static overlay of a frame pair. The motion direction is read from the pixels themselves (the frame difference against the gradient; a static overlay adds nothing
// to it). Along that direction every edge pixel (directional gradient of at least `minEdge`) has an apparent shift; the content moves by about the same shift and an overlay
// edge by almost none. Edge pixels that shifted less than `staticRatio` of the typical (75th percentile) shift are the overlay, grown by `dilate` px because the smoothing and the
// gradient spread an edge. Null when the content does not visibly move (`minShift`) or when there is no overlay (under `minShare` of the pixels). A dense overlay leaves the
// estimators too little to read, and they then report no motion for the pair instead of a biased one.
export function staticOverlayMask(prev: FramePyramid, cur: FramePyramid): OverlayMask | null {
  const { minEdge, staticRatio, minShift, dilate, minShare } = STUDY.camera.overlay;
  const { w, h, img, gx, gy } = prev.levels[0];
  const other = cur.levels[0].img;
  let vx = 0, vy = 0;
  for (let i = 0; i < w * h; i++) {
    const d = other[i] - img[i];
    vx -= d * gx[i];
    vy -= d * gy[i];
  }
  const norm = Math.hypot(vx, vy);
  if (norm < 1e-9) return null;
  const ux = vx / norm, uy = vy / norm;
  // Apparent shift along the motion direction of every edge pixel: the frame difference over the directional gradient.
  const shift = new Float32Array(w * h).fill(NaN);
  const shifts: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const e = gx[i] * ux + gy[i] * uy;
    if (Math.abs(e) < minEdge) continue;
    shift[i] = -(other[i] - img[i]) / e;
    shifts.push(shift[i]);
  }
  const typical = quantile(shifts, 0.75);
  if (typical === null || typical < minShift) return null;
  const seed = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (shift[i] <= staticRatio * typical) { seed[i] = 1; count++; }
  }
  if (count < minShare * w * h) return null;
  // Separable box dilation.
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!seed[y * w + x]) continue;
    for (let k = Math.max(0, x - dilate); k <= Math.min(w - 1, x + dilate); k++) rows[y * w + k] = 1;
  }
  const full = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!rows[y * w + x]) continue;
    for (let k = Math.max(0, y - dilate); k <= Math.min(h - 1, y + dilate); k++) full[k * w + x] = 1;
  }
  const { w: hw, h: hh } = prev.levels[1];
  const half = new Uint8Array(hw * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * w + 2 * x;
    half[y * hw + x] = full[i] | full[i + 1] | full[i + w] | full[i + w + 1];
  }
  return { full, half };
}

// Bilinear sample of a float image; the caller guarantees the point is inside.
function sample(img: Float32Array, w: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * w + x0;
  return img[i] * (1 - fx) * (1 - fy) + img[i + 1] * fx * (1 - fy) + img[i + w] * (1 - fx) * fy + img[i + w + 1] * fx * fy;
}

// Iterative Lucas-Kanade translation of one rectangle at one pyramid level: content at x in `prev` is at x+d in `cur`. Null when the rectangle is textureless or diverges.
function lucasKanade(prev: FramePyramid["levels"][number], cur: FramePyramid["levels"][number], rect: { x0: number; y0: number; x1: number; y1: number }, init: { dx: number; dy: number }, minEnergy: number, mask?: Uint8Array): { dx: number; dy: number } | null {
  let dx = init.dx;
  let dy = init.dy;
  const { w, h } = prev;
  for (let iter = 0; iter < 6; iter++) {
    let sxx = 0, sxy = 0, syy = 0, sxr = 0, syr = 0, n = 0;
    for (let y = Math.max(1, rect.y0); y < Math.min(h - 1, rect.y1); y++) {
      for (let x = Math.max(1, rect.x0); x < Math.min(w - 1, rect.x1); x++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 1 || py < 1 || px >= w - 2 || py >= h - 2) continue;
        const i = y * w + x;
        if (mask && mask[i]) continue;
        const gx = prev.gx[i];
        const gy = prev.gy[i];
        const r = prev.img[i] - sample(cur.img, w, px, py);
        sxx += gx * gx; sxy += gx * gy; syy += gy * gy; sxr += gx * r; syr += gy * r;
        n++;
      }
    }
    if (n < 16 || (sxx + syy) / n < minEnergy) return null;
    const det = sxx * syy - sxy * sxy;
    if (det < 1e-6 * (sxx + syy) * (sxx + syy)) return null;
    const ddx = (syy * sxr - sxy * syr) / det;
    const ddy = (sxx * syr - sxy * sxr) / det;
    dx += ddx;
    dy += ddy;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return null;
    if (Math.abs(ddx) < 0.005 && Math.abs(ddy) < 0.005) break;
  }
  return { dx, dy };
}

// Fits translation and zoom to displacement vectors with iteratively reweighted least squares (Tukey weights); null with fewer than 4 usable vectors.
export function fitSimilarity(vectors: Vector[]): MotionModel | null {
  if (vectors.length < 4) return null;
  let weights = vectors.map(() => 1);
  let model: MotionModel | null = null;
  for (let iter = 0; iter < 5; iter++) {
    let sw = 0, swx = 0, swy = 0, swdx = 0, swdy = 0, sww = 0, swd = 0;
    vectors.forEach((v, i) => {
      const wi = weights[i];
      sw += wi; swx += wi * v.cx; swy += wi * v.cy; swdx += wi * v.dx; swdy += wi * v.dy;
      sww += wi * (v.cx * v.cx + v.cy * v.cy);
      swd += wi * (v.cx * v.dx + v.cy * v.dy);
    });
    if (sw < 3) return null;
    // Normal equations for [tx, ty, s]: [[sw,0,swx],[0,sw,swy],[swx,swy,sww]] p = [swdx, swdy, swd].
    // Eliminate: tx = (swdx - swx*s)/sw, ty = (swdy - swy*s)/sw, then s from the third equation.
    const denom = sww - (swx * swx + swy * swy) / sw;
    if (Math.abs(denom) < 1e-9) return null;
    const scale = (swd - (swx * swdx + swy * swdy) / sw) / denom;
    const tx = (swdx - swx * scale) / sw;
    const ty = (swdy - swy * scale) / sw;
    model = { tx, ty, scale };
    const residuals = vectors.map((v) => Math.hypot(v.dx - tx - scale * v.cx, v.dy - ty - scale * v.cy));
    const mad = quantile(residuals, 0.5) ?? 0;
    const cutoff = Math.max(1.4826 * mad, 0.05) * 3;
    weights = residuals.map((r) => (r < cutoff ? (1 - (r / cutoff) ** 2) ** 2 : 0));
    if (weights.filter((wi) => wi > 0).length < 4) return null;
  }
  return model;
}

// Method A: tile-wise multi-level Lucas-Kanade with the caption band masked, then a robust similarity fit over the tile vectors.
export function estimateTiles(prev: FramePyramid, cur: FramePyramid, mask?: OverlayMask): MotionModel | null {
  const { width, height } = prev;
  const { cols, rows, maskBottomShare, minTextureEnergy } = STUDY.camera.tiles;
  const vectors: Vector[] = [];
  const tw = width / cols;
  const th = height / rows;
  for (let r = 0; r < rows; r++) {
    const centerY = (r + 0.5) * th;
    if (centerY >= (1 - maskBottomShare) * height) continue;
    for (let c = 0; c < cols; c++) {
      const rect = { x0: Math.round(c * tw), y0: Math.round(r * th), x1: Math.round((c + 1) * tw), y1: Math.round((r + 1) * th) };
      const coarse = lucasKanade(prev.levels[1], cur.levels[1], { x0: rect.x0 >> 1, y0: rect.y0 >> 1, x1: rect.x1 >> 1, y1: rect.y1 >> 1 }, { dx: 0, dy: 0 }, minTextureEnergy, mask?.half);
      const fine = lucasKanade(prev.levels[0], cur.levels[0], rect, coarse ? { dx: coarse.dx * 2, dy: coarse.dy * 2 } : { dx: 0, dy: 0 }, minTextureEnergy, mask?.full);
      if (!fine) continue;
      vectors.push({ cx: (rect.x0 + rect.x1) / 2 - width / 2, cy: (rect.y0 + rect.y1) / 2 - height / 2, dx: fine.dx, dy: fine.dy });
    }
  }
  return fitSimilarity(vectors);
}

// Median of a list (0 for an empty one).
function median(values: number[]): number {
  return quantile(values, 0.5) ?? 0;
}

// Method B: coarse-to-fine block matching over the whole frame (full search on the half-size image, then a 3x3 search on squared differences with parabolic sub-pixel refinement at full size), then median translation and median radial zoom.
export function estimateBlocks(prev: FramePyramid, cur: FramePyramid, mask?: OverlayMask): MotionModel | null {
  const { width, height } = prev;
  const { size, coarseRadius, minVariance } = STUDY.camera.blocks;
  const margin = coarseRadius * 2 + 1;
  const a = prev.levels[0].img;
  const b = cur.levels[0].img;
  const ha = prev.levels[1].img;
  const hb = cur.levels[1].img;
  const hw = prev.levels[1].w;
  const half = size / 2;
  const side = 2 * coarseRadius + 1;
  const vectors: Vector[] = [];
  // Sum of absolute (or, for the fine step, squared: a parabola fits it near the minimum) differences of one block between two images, for a block at (x0,y0) in `p` and (x0+u,y0+v) in `q`.
  // Pixels of `p` under the overlay mask (`m`) are skipped; the mask follows `p`, so every offset sums the same pixels.
  const sad = (p: Float32Array, q: Float32Array, w: number, x0: number, y0: number, u: number, v: number, n: number, m?: Uint8Array, squared = false) => {
    let sum = 0;
    for (let y = 0; y < n; y++) {
      const ra = (y0 + y) * w + x0;
      const rb = (y0 + y + v) * w + x0 + u;
      for (let x = 0; x < n; x++) {
        if (m && m[ra + x]) continue;
        const d = p[ra + x] - q[rb + x];
        sum += squared ? d * d : Math.abs(d);
      }
    }
    return sum;
  };
  const parab = (m1: number, c: number, p1: number) => {
    const den = m1 - 2 * c + p1;
    return Math.abs(den) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (m1 - p1)) / den));
  };
  for (let y0 = margin; y0 + size + margin <= height; y0 += size) {
    for (let x0 = margin; x0 + size + margin <= width; x0 += size) {
      // Texture of the block from the pixels the overlay mask leaves; a block that is mostly overlay is skipped.
      let mean = 0, open = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!mask?.full[(y0 + y) * width + x0 + x]) { mean += a[(y0 + y) * width + x0 + x]; open++; }
      if (open < size * size * STUDY.camera.overlay.minOpenBlockShare) continue;
      mean /= open;
      let variance = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!mask?.full[(y0 + y) * width + x0 + x]) variance += (a[(y0 + y) * width + x0 + x] - mean) ** 2;
      if (variance / open < minVariance) continue;
      // Coarse: full search at half size (the block is half as wide, offsets of one pixel are two at full size).
      const hx = x0 >> 1;
      const hy = y0 >> 1;
      let best = Infinity, bu = 0, bv = 0, total = 0;
      for (let v = -coarseRadius; v <= coarseRadius; v++) {
        for (let u = -coarseRadius; u <= coarseRadius; u++) {
          const s = sad(ha, hb, hw, hx, hy, u, v, half, mask?.half);
          total += s;
          if (s < best) { best = s; bu = u; bv = v; }
        }
      }
      // A block whose best match is not clearly better than the average offset has no usable texture along some direction.
      if (best > 0.7 * (total / (side * side))) continue;
      // Fine: a 3x3 search on squared differences around the coarse result, re-centred once when the best sits on the window edge so the parabola has a minimum inside.
      let cu = bu * 2;
      let cv = bv * 2;
      const cost = new Float64Array(9);
      let fu = 0, fv = 0;
      for (let round = 0; round < 2; round++) {
        let fb = Infinity;
        for (let v = -1; v <= 1; v++) {
          for (let u = -1; u <= 1; u++) {
            const s = sad(a, b, width, x0, y0, cu + u, cv + v, size, mask?.full, true);
            cost[(v + 1) * 3 + u + 1] = s;
            if (s < fb) { fb = s; fu = u; fv = v; }
          }
        }
        if ((fu === 0 && fv === 0) || round === 1) break;
        cu += fu;
        cv += fv;
        fu = 0;
        fv = 0;
      }
      const at = (u: number, v: number) => cost[(v + 1) * 3 + u + 1];
      const su = fu > -1 && fu < 1 ? parab(at(fu - 1, fv), at(fu, fv), at(fu + 1, fv)) : 0;
      const sv = fv > -1 && fv < 1 ? parab(at(fu, fv - 1), at(fu, fv), at(fu, fv + 1)) : 0;
      vectors.push({ cx: x0 + size / 2 - width / 2, cy: y0 + size / 2 - height / 2, dx: cu + fu + su, dy: cv + fv + sv });
    }
  }
  if (vectors.length < 6) return null;
  const tx = median(vectors.map((v) => v.dx));
  const ty = median(vectors.map((v) => v.dy));
  const radial = vectors.filter((v) => Math.hypot(v.cx, v.cy) > width / 8).map((v) => ((v.dx - tx) * v.cx + (v.dy - ty) * v.cy) / (v.cx * v.cx + v.cy * v.cy));
  return { tx, ty, scale: radial.length >= 4 ? median(radial) : 0 };
}

// The speed of the fastest frame corner under a motion model, in frame widths per second.
export function cornerSpeed(model: MotionModel, width: number, height: number, fps: number): number {
  let worst = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      worst = Math.max(worst, Math.hypot(model.tx + model.scale * sx * (width / 2), model.ty + model.scale * sy * (height / 2)));
    }
  }
  return (worst * fps) / width;
}

/** The speed series of one method: widths per second per frame pair, null where the pair was a cut or could not be measured. */
export type SpeedSeries = Array<number | null>;

/** Moving runs of one series: smoothed flags and the move list. */
export interface MoveSummary {
  measured: number;
  movingFrames: number;
  movingShare: number | null;
  medianSpeed: number | null;
  p90Speed: number | null;
  moves: MoveRecord[];
}

// Turns a speed series into moving flags (bridging short gaps, dropping short runs) and summarises moves and speeds.
export function summarizeMoves(series: SpeedSeries, fps: number): MoveSummary {
  const { moveMinWidthsPerSec, minMoveFrames, bridgeGapFrames } = STUDY.camera;
  const moving = series.map((s) => s !== null && s >= moveMinWidthsPerSec);
  const known = series.map((s) => s !== null);
  // Bridge gaps of up to bridgeGapFrames still pairs between two moving pairs.
  let i = 0;
  while (i < moving.length) {
    if (moving[i]) {
      let j = i + 1;
      while (j < moving.length && !moving[j]) j++;
      if (j < moving.length && j - i - 1 <= bridgeGapFrames) for (let k = i + 1; k < j; k++) moving[k] = known[k];
      i = j;
    } else i++;
  }
  const moves: MoveRecord[] = [];
  const keep = moving.map(() => false);
  let start = -1;
  for (let k = 0; k <= moving.length; k++) {
    if (k < moving.length && moving[k]) {
      if (start < 0) start = k;
    } else if (start >= 0) {
      if (k - start >= minMoveFrames) {
        const speeds = series.slice(start, k).map((s) => s ?? 0);
        for (let m = start; m < k; m++) keep[m] = true;
        moves.push({ startSec: round(start / fps, 3), frames: k - start, peakWidthsPerSec: round(Math.max(...speeds)), meanWidthsPerSec: round(speeds.reduce((p, q) => p + q, 0) / speeds.length) });
      }
      start = -1;
    }
  }
  const measured = known.filter(Boolean).length;
  const movingSpeeds = series.filter((s, idx): s is number => s !== null && keep[idx]);
  return {
    measured,
    movingFrames: keep.filter(Boolean).length,
    movingShare: measured > 0 ? keep.filter(Boolean).length / measured : null,
    medianSpeed: measured > 0 ? (quantile(movingSpeeds, 0.5) ?? 0) : null,
    p90Speed: measured > 0 ? (quantile(movingSpeeds, 0.9) ?? 0) : null,
    moves,
  };
}

/** The camera metrics and the moves of method A. */
export interface CameraAnalysis {
  metrics: Metric[];
  moves: MoveRecord[];
}

// Builds the camera metrics from the two methods' speed series; `minPairs` pairs must be measured by each method.
export function analyzeCamera(seriesA: SpeedSeries, seriesB: SpeedSeries, fps: number, minPairs = 10): CameraAnalysis {
  const tol = STUDY.camera.tolerance;
  const a = summarizeMoves(seriesA, fps);
  const b = summarizeMoves(seriesB, fps);
  const nameA = `tile Lucas-Kanade, ${STUDY.camera.tiles.cols}x${STUDY.camera.tiles.rows} tiles, bottom ${Math.round(STUDY.camera.tiles.maskBottomShare * 100)}% masked, robust similarity fit`;
  const nameB = `coarse-to-fine block matching, ${STUDY.camera.blocks.size}x${STUDY.camera.blocks.size} blocks, +-${STUDY.camera.blocks.coarseRadius * 2 + 1} px search, parabolic sub-pixel, whole frame, median estimate`;
  const unusable = (s: MoveSummary) => s.measured < minPairs;
  const note = (s: MoveSummary) => (unusable(s) ? `only ${s.measured} frame pairs could be measured (need ${minPairs})` : undefined);
  const reading = (method: string, s: MoveSummary, v: number | null) => ({ method, value: unusable(s) ? null : v, note: note(s) });
  const metrics: Metric[] = [
    resolveMetric({ id: "camera.movingShare", label: "Share of frames where the camera moves", unit: "share", a: reading(nameA, a, a.movingShare), b: reading(nameB, b, b.movingShare), tolerance: { abs: tol.movingShareAbs } }),
    resolveMetric({ id: "camera.medianSpeedWidthsPerSec", label: "Median camera speed while moving (fastest frame corner)", unit: "frame widths/s", a: reading(nameA, a, a.medianSpeed), b: reading(nameB, b, b.medianSpeed), tolerance: { abs: tol.speedAbsWidthsPerSec, rel: tol.speedRel } }),
    resolveMetric({ id: "camera.p90SpeedWidthsPerSec", label: "90th percentile camera speed while moving", unit: "frame widths/s", a: reading(nameA, a, a.p90Speed), b: reading(nameB, b, b.p90Speed), tolerance: { abs: tol.speedAbsWidthsPerSec, rel: tol.speedRel } }),
    resolveMetric({ id: "camera.moveCount", label: "Camera moves", unit: "moves", a: reading(nameA, a, a.moves.length), b: reading(nameB, b, b.moves.length), tolerance: { abs: tol.moveCountAbs } }),
    resolveMetric({ id: "camera.framesPerMove", label: "Median frames per camera move", unit: "frames", a: reading(nameA, a, quantile(a.moves.map((m) => m.frames), 0.5) ?? 0), b: reading(nameB, b, quantile(b.moves.map((m) => m.frames), 0.5) ?? 0), tolerance: { abs: tol.moveFramesAbs, rel: tol.moveFramesRel } }),
  ];
  // The move list is published only when the methods agree on how much, how many and how long the moves are.
  const published = ["camera.movingShare", "camera.moveCount", "camera.framesPerMove"].every((id) => metrics.find((m) => m.id === id)?.status === "agreed");
  return { metrics, moves: published ? a.moves : [] };
}
