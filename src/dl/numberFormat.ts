/**
 * File Description: Formats numeric values for compact display in animated counters.
 * Inputs and outputs: numeric value -> compact magnitude label or plain digits.
 * Used by: src/dl/primitives.tsx and backend/reelCut/constraints.ts.
 */

// Formats a counter value with the compact thresholds used by the film design system.
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return String(value);
}
