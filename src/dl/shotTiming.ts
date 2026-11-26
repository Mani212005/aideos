/**
 * File Description: Shared shot duration and timeline position arithmetic.
 * Inputs and outputs: Film shots -> durations and timeline start times.
 * Used by: timeline operations and film conversion.
 */

import type { Shot } from "./schema";

/**
 * Get effective shot duration from end - start, falling back to dur.
 */
export function getShotDuration(shot: Shot): number {
  if (shot.end !== undefined && shot.start !== undefined && shot.end > shot.start) {
    return Number((shot.end - shot.start).toFixed(3));
  }
  return shot.dur || 3;
}

/**
 * Get effective shot position (start time on timeline in seconds).
 */
export function computeShotStartTimes(shots: Shot[]): number[] {
  const startTimes: number[] = [];
  let accumulated = 0;

  for (const shot of shots) {
    const rawDur = getShotDuration(shot);
    const pos = shot.position ?? shot.startSec;
    if (pos !== undefined) {
      startTimes.push(pos);
      accumulated = Math.max(accumulated, pos + rawDur);
    } else {
      startTimes.push(accumulated);
      accumulated += rawDur;
    }
  }

  return startTimes;
}
