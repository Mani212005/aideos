/**
 * File Description: Small statistics helpers for farm metrics: nearest-rank percentiles and a distribution summary.
 * Inputs and outputs: a list of numbers -> a percentile or a Distribution (count, mean, p50, p95, max).
 * Used by: backend/farm/sqliteQueue.ts, backend/farm/loadTest.ts.
 */

import type { Distribution } from "./queue";

/** The nearest-rank percentile `p` (0 to 100) of a list; 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Summarizes a list of numbers. */
export function summarize(values: readonly number[]): Distribution {
  if (values.length === 0) return { count: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return { count: values.length, mean: sum / values.length, p50: percentile(values, 50), p95: percentile(values, 95), max: Math.max(...values) };
}
