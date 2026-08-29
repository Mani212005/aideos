/**
 * File Description: Sticky Snapping Engine for Aideos Timeline.
 * Implements Pattern 3 (OpenShot / Premiere geometry architecture):
 * - Broad target collection (clip boundaries, markers, playhead, 0s, end).
 * - _snap_ignore_ids: Excludes dragged clip from its own targets to prevent self-snap jitter.
 * - _snap_active_targets: Stickiness caching that holds snap until 12px threshold is broken.
 * - 12px threshold computed in screen pixel space and converted to seconds.
 */

import type { Film } from "../../src/dl/schema";

export interface SnapTarget {
  timeSec: number;
  type: "playhead" | "boundary" | "marker" | "zero" | "end" | "grid";
  sourceId?: string;
  label?: string;
}

export interface SnapResult {
  snappedTimeSec: number;
  activeSnap: SnapTarget | null;
  hasSnapped: boolean;
}

/**
 * Collect all candidate snap targets across the film or layered film, excluding ignored clip IDs.
 */
export function collectSnapTargets(
  film: Film | { shots?: any[]; clips?: any[] },
  playheadSec: number,
  totalDurationSec: number,
  ignoreIds: string[] = []
): SnapTarget[] {
  const targets: SnapTarget[] = [
    { timeSec: 0, type: "zero", label: "0.0s" },
    { timeSec: totalDurationSec, type: "end", label: `${totalDurationSec.toFixed(1)}s` },
    { timeSec: playheadSec, type: "playhead", label: "Playhead" },
  ];

  let accumulated = 0;

  if (Array.isArray((film as any).clips)) {
    for (const clip of (film as any).clips) {
      const dur = (clip.end !== undefined && clip.start !== undefined) ? clip.end - clip.start : 3;
      const startSec = clip.position ?? 0;
      const endSec = startSec + dur;

      if (!ignoreIds.includes(clip.id)) {
        targets.push({ timeSec: startSec, type: "boundary", sourceId: clip.id, label: `${clip.id} start` });
        targets.push({ timeSec: endSec, type: "boundary", sourceId: clip.id, label: `${clip.id} cut` });
      }
      accumulated = Math.max(accumulated, endSec);
    }
  } else if (Array.isArray(film.shots)) {
    for (const shot of film.shots) {
      const rawDur = (shot.end !== undefined && shot.start !== undefined && shot.end > shot.start)
        ? shot.end - shot.start
        : shot.dur || 3;
      const startSec = shot.position ?? shot.startSec ?? accumulated;
      const endSec = startSec + rawDur;

      if (!ignoreIds.includes(shot.id)) {
        targets.push({ timeSec: startSec, type: "boundary", sourceId: shot.id, label: `${shot.id} start` });
        targets.push({ timeSec: endSec, type: "boundary", sourceId: shot.id, label: `${shot.id} cut` });
      }

      accumulated = Math.max(accumulated, endSec);
    }
  }

  // 1-second interval grid marks
  for (let s = 1; s < totalDurationSec; s += 1) {
    targets.push({ timeSec: s, type: "grid" });
  }

  return targets;
}

/**
 * Calculate snap with sticky target caching and 12px tolerance.
 */
export function calculateStickySnap(
  targetTimeSec: number,
  snapTargets: SnapTarget[],
  zoomLevel: number,
  activeTarget: SnapTarget | null = null,
  tolerancePx = 12
): SnapResult {
  // 1. Check if previously locked active target is still within tolerance (Stickiness)
  if (activeTarget) {
    const distToActivePx = Math.abs(targetTimeSec - activeTarget.timeSec) * zoomLevel;
    if (distToActivePx <= tolerancePx) {
      return {
        snappedTimeSec: activeTarget.timeSec,
        activeSnap: activeTarget,
        hasSnapped: true,
      };
    }
  }

  // 2. Find closest new target within tolerance
  let closestDistPx = Infinity;
  let bestTarget: SnapTarget | null = null;

  for (const target of snapTargets) {
    const distPx = Math.abs(target.timeSec - targetTimeSec) * zoomLevel;
    if (distPx <= tolerancePx && distPx < closestDistPx) {
      closestDistPx = distPx;
      bestTarget = target;
    }
  }

  if (bestTarget) {
    return {
      snappedTimeSec: bestTarget.timeSec,
      activeSnap: bestTarget,
      hasSnapped: true,
    };
  }

  return {
    snappedTimeSec: targetTimeSec,
    activeSnap: null,
    hasSnapped: false,
  };
}
