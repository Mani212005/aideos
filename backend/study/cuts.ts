/**
 * File Description: Cut count, cut cadence and shot length distribution for `aideos study`, by two independent methods. Method A is ffmpeg's
 * scene score (mean frame difference, threshold stated in STUDY.cuts). Method B is changed-block coverage: the share of 8x8 gray blocks whose
 * content changed between two frames, which a cut changes almost everywhere and a camera move or an object moving does not.
 * Inputs and outputs: a video file and per-frame block coverage -> CutRecord list, cut metrics and shot length metrics with agreement.
 * Used by: backend/study/study.ts.
 */

import { spawnSyncBounded } from "../proc";
import { matchTimes } from "./agreement";
import { round, STUDY, type CutRecord, type MethodReading, type Metric } from "./types";

/** A cut method A found: its time and ffmpeg scene score. */
export interface SceneCut {
  t: number;
  score: number;
}

// Parses ffmpeg `metadata=print` output of the scene filter into cuts.
export function parseSceneCuts(text: string): SceneCut[] {
  const cuts: SceneCut[] = [];
  let t: number | null = null;
  for (const line of text.split("\n")) {
    const time = /pts_time:(-?\d+(?:\.\d+)?)/.exec(line);
    if (time) t = Number(time[1]);
    const score = /lavfi\.scene_score=(\d+(?:\.\d+)?)/.exec(line);
    if (score && t !== null) cuts.push({ t, score: Number(score[1]) });
  }
  return cuts;
}

// Method A: runs ffmpeg's scene detection (frames scaled to 640 px on the long side, score above the stated threshold).
export function sceneCutsFfmpeg(file: string, threshold: number = STUDY.cuts.sceneThreshold): SceneCut[] {
  const filter = `scale='if(gt(iw,ih),min(640,iw),-2)':'if(gt(iw,ih),-2,min(640,ih))':flags=area,select='gt(scene,${threshold})',metadata=print:file=-`;
  const r = spawnSyncBounded("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", filter, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run ffmpeg: ${r.error.message}. Install ffmpeg to use aideos study.`);
  if (r.status !== 0) throw new Error(`ffmpeg scene detection failed on ${file}: ${r.stderr.trim().slice(0, 300)}`);
  return parseSceneCuts(r.stdout);
}

// Method B signal: the share of 8x8 blocks whose mean absolute gray difference from the previous frame exceeds STUDY.cuts.blockChangeLevels.
export function changedBlockShare(prev: Uint8Array, cur: Uint8Array, width: number, height: number): number {
  const bw = Math.max(1, Math.floor(width / 8));
  const bh = Math.max(1, Math.floor(height / 8));
  let changed = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      let n = 0;
      for (let y = by * 8; y < Math.min(height, by * 8 + 8); y++) {
        const row = y * width;
        for (let x = bx * 8; x < Math.min(width, bx * 8 + 8); x++) {
          sum += Math.abs(cur[row + x] - prev[row + x]);
          n++;
        }
      }
      if (n > 0 && sum / n > STUDY.cuts.blockChangeLevels) changed++;
    }
  }
  return changed / (bw * bh);
}

/** The cut metrics, the cut list and the shot lengths of one reference. */
export interface CutAnalysis {
  records: CutRecord[];
  shotLengthsSec: number[];
  metrics: Metric[];
  /** Times (s) of cuts either method found, for masking the camera pass. */
  anyCutTimes: number[];
}

// Returns the q-quantile (0 to 1) of a list by linear interpolation; null for an empty list.
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// A metric derived from another one: it keeps that metric's agreement (a derived number of an unresolved list is unresolved).
export function derivedMetric(from: Metric, id: string, label: string, unit: string, value: number | null): Metric {
  const agreed = from.status === "agreed" && value !== null;
  const reading: MethodReading = { method: `derived from ${from.id}`, value };
  return {
    id, label, unit,
    status: agreed ? "agreed" : "unresolved",
    value: agreed ? round(value as number) : null,
    methods: [{ ...reading, value: value === null ? null : round(value) }],
    tolerance: from.tolerance,
    delta: from.delta,
    seedEligible: agreed,
    ...(agreed ? {} : { reason: `${from.id} is ${from.status}, so this number is excluded from the seed` }),
  };
}

// Compares the two methods' cut lists and builds the cut and shot length metrics.
export function analyzeCuts(sceneCuts: SceneCut[], blockCuts: Array<{ t: number; share: number }>, durationSec: number): CutAnalysis {
  const match = matchTimes(sceneCuts.map((c) => c.t), blockCuts.map((c) => c.t), STUDY.cuts.matchWithinSec);
  const scoreAt = (t: number) => sceneCuts.find((c) => c.t === t)?.score ?? null;
  const shareAt = (t: number) => blockCuts.find((c) => c.t === t)?.share ?? null;
  const records: CutRecord[] = [
    ...match.matched.map((m) => ({ t: round(m.a, 3), sceneScore: scoreAt(m.a) === null ? null : round(scoreAt(m.a) as number, 3), changedBlockShare: shareAt(m.b) === null ? null : round(shareAt(m.b) as number, 3), agreed: true })),
    ...match.onlyA.map((t) => ({ t: round(t, 3), sceneScore: round(scoreAt(t) as number, 3), changedBlockShare: null, agreed: false })),
    ...match.onlyB.map((t) => ({ t: round(t, 3), sceneScore: null, changedBlockShare: round(shareAt(t) as number, 3), agreed: false })),
  ].sort((x, y) => x.t - y.t);
  const total = match.matched.length + match.onlyA.length + match.onlyB.length;
  const unmatchedShare = total === 0 ? 0 : (match.onlyA.length + match.onlyB.length) / total;
  const agreed = unmatchedShare <= STUDY.cuts.unmatchedShareMax;
  const tolerance = `every cut found by both methods within ${STUDY.cuts.matchWithinSec} s; at most ${Math.round(STUDY.cuts.unmatchedShareMax * 100)}% of cuts unmatched`;
  const countMetric: Metric = {
    id: "cuts.count",
    label: "Hard cuts (agreed by both methods)",
    unit: "cuts",
    status: agreed ? "agreed" : "unresolved",
    value: agreed ? match.matched.length : null,
    methods: [
      { method: `ffmpeg scene score above ${STUDY.cuts.sceneThreshold}`, value: sceneCuts.length },
      { method: `changed-block coverage: at least ${Math.round(STUDY.cuts.changedBlockShareMin * 100)}% of 8x8 blocks differ by more than ${STUDY.cuts.blockChangeLevels} gray levels`, value: blockCuts.length },
    ],
    tolerance,
    delta: match.onlyA.length + match.onlyB.length,
    seedEligible: agreed,
    ...(agreed ? {} : { reason: `${match.onlyA.length} cut(s) only the scene score found and ${match.onlyB.length} only the block coverage found; the cut list is unresolved and excluded from the seed` }),
  };
  const perMinute = derivedMetric(countMetric, "cuts.perMinute", "Hard cuts per minute", "cuts/min", durationSec > 0 ? (match.matched.length / durationSec) * 60 : null);
  const bounds = [0, ...match.matched.map((m) => m.a), durationSec];
  const shotLengthsSec = bounds.slice(1).map((t, i) => round(t - bounds[i], 3)).filter((len) => len > 0);
  const metrics: Metric[] = [
    countMetric,
    perMinute,
    derivedMetric(countMetric, "shots.medianLengthSec", "Median shot length", "s", quantile(shotLengthsSec, 0.5)),
    derivedMetric(countMetric, "shots.p10LengthSec", "10th percentile shot length", "s", quantile(shotLengthsSec, 0.1)),
    derivedMetric(countMetric, "shots.p90LengthSec", "90th percentile shot length", "s", quantile(shotLengthsSec, 0.9)),
  ];
  return { records, shotLengthsSec, metrics, anyCutTimes: [...sceneCuts.map((c) => c.t), ...blockCuts.map((c) => c.t)] };
}
