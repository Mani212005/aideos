/**
 * File Description: The two-method agreement rule of `aideos study`. A pixel-derived metric enters a bible only when two independent
 * methods read it within a stated tolerance; a disagreement (or a method that could not run) is recorded as unresolved with both numbers and
 * excluded from the seed. Pure functions, no I/O.
 * Inputs and outputs: two method readings and a tolerance -> a Metric with status, delta and seed eligibility; two time lists -> matched and unmatched times.
 * Used by: backend/study/study.ts, backend/study/cuts.ts, backend/study/camera.ts, backend/study/tone.ts, backend/study/audio.ts, backend/study/captions.ts.
 */

import { round, type MethodReading, type Metric } from "./types";

/** A stated tolerance: the readings agree when their difference is within `abs`, or within `rel` of the larger reading (either bound met). */
export interface Tolerance {
  abs?: number;
  rel?: number;
}

/** Everything a two-method metric needs. */
export interface TwoMethodSpec {
  id: string;
  label: string;
  unit: string;
  a: MethodReading;
  b: MethodReading;
  tolerance: Tolerance;
}

// Words for a tolerance, so the bible states the rule it applied.
export function describeTolerance(tolerance: Tolerance, unit: string): string {
  const parts: string[] = [];
  if (tolerance.abs !== undefined) parts.push(`${tolerance.abs} ${unit}`.trim());
  if (tolerance.rel !== undefined) parts.push(`${Math.round(tolerance.rel * 100)}% of the larger reading`);
  return parts.length ? `within ${parts.join(" or ")}` : "exact";
}

// True when two readings differ by no more than the tolerance allows.
export function withinTolerance(a: number, b: number, tolerance: Tolerance): boolean {
  const diff = Math.abs(a - b);
  if (!Number.isFinite(diff)) return false;
  if (tolerance.abs !== undefined && diff <= tolerance.abs + 1e-12) return true;
  if (tolerance.rel !== undefined && diff <= tolerance.rel * Math.max(Math.abs(a), Math.abs(b)) + 1e-12) return true;
  return tolerance.abs === undefined && tolerance.rel === undefined ? diff === 0 : false;
}

// Builds a metric from two independent readings: agreed inside the tolerance, otherwise unresolved and excluded from the seed.
export function resolveMetric(spec: TwoMethodSpec): Metric {
  const { a, b } = spec;
  const tolerance = describeTolerance(spec.tolerance, spec.unit);
  const base = { id: spec.id, label: spec.label, unit: spec.unit, methods: [roundReading(a), roundReading(b)], tolerance };
  if (a.value === null || b.value === null) {
    const missing = a.value === null ? a : b;
    return { ...base, status: "unresolved", value: null, delta: null, seedEligible: false, reason: `method "${missing.method}" could not measure${missing.note ? `: ${missing.note}` : ""}; a metric needs two methods` };
  }
  const delta = round(Math.abs(a.value - b.value));
  if (withinTolerance(a.value, b.value, spec.tolerance)) {
    return { ...base, status: "agreed", value: round(a.value), delta, seedEligible: true };
  }
  return { ...base, status: "unresolved", value: null, delta, seedEligible: false, reason: `the two methods disagree by ${delta} ${spec.unit} (${tolerance} allowed); both readings are kept, the metric is excluded from the seed` };
}

// Builds a metric read from container metadata or the audio track by one named method (no pixel claim), which may seed a look.
export function notPixelMetric(spec: { id: string; label: string; unit: string; reading: MethodReading }): Metric {
  const ok = spec.reading.value !== null;
  return { id: spec.id, label: spec.label, unit: spec.unit, status: "not-pixel", value: ok ? round(spec.reading.value as number) : null, methods: [roundReading(spec.reading)], tolerance: null, delta: null, seedEligible: ok };
}

// Rounds a reading's value for readable output.
function roundReading(reading: MethodReading): MethodReading {
  return { ...reading, value: reading.value === null ? null : round(reading.value) };
}

/** The result of matching two sorted time lists. */
export interface TimeMatch {
  matched: Array<{ a: number; b: number }>;
  onlyA: number[];
  onlyB: number[];
}

// Pairs each time in `a` with the nearest unused time in `b` within `withinSec`; the rest are unmatched on their side.
export function matchTimes(a: number[], b: number[], withinSec: number): TimeMatch {
  const used = new Set<number>();
  const matched: Array<{ a: number; b: number }> = [];
  const onlyA: number[] = [];
  for (const ta of a) {
    let best = -1;
    let bestDist = Infinity;
    b.forEach((tb, i) => {
      const d = Math.abs(tb - ta);
      if (!used.has(i) && d <= withinSec + 1e-9 && d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched.push({ a: ta, b: b[best] });
    } else onlyA.push(ta);
  }
  return { matched, onlyA, onlyB: b.filter((_, i) => !used.has(i)) };
}
