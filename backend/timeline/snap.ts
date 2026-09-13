/**
 * File Description: Sticky Snapping Engine for Aideos Timeline.
 * Implements Pattern 3 (OpenShot / Premiere geometry architecture):
 * - Broad target collection (clip boundaries, markers, playhead, zero, end, time grid).
 * - Self-ignore, including a dragged clip's linked partner, so a pair never snaps to itself.
 * - Sticky caching that holds a snap until the pointer breaks the pixel threshold.
 * - A threshold measured in screen pixels and converted to seconds through the current zoom, so
 *   snapping feels identical at every zoom level.
 * - Grid density that scales with zoom, so a zoomed-out timeline is not sticky everywhere.
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

export interface ClipSnapResult extends SnapResult {
  /** Which edge of the dragged clip landed on the target. */
  snappedEdge: "start" | "end" | null;
}

/** Specificity used to break ties: an explicit boundary always beats a background grid line. */
const TARGET_PRIORITY: Record<SnapTarget["type"], number> = {
  playhead: 0,
  boundary: 1,
  marker: 2,
  zero: 3,
  end: 4,
  grid: 5,
};

/** Choose a grid step in seconds so grid lines stay roughly 60 pixels apart at the current zoom. */
export function gridStepForZoom(pxPerSec: number): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const targetPx = 60;
  for (const step of steps) {
    if (step * pxPerSec >= targetPx) return step;
  }
  return steps[steps.length - 1];
}

/**
 * Collect all candidate snap targets across the film or layered film, excluding ignored clip ids.
 * `pxPerSec` controls how dense the background time grid is; omit it to keep the legacy 1s grid.
 */
export function collectSnapTargets(
  film: Film | { shots?: any[]; clips?: any[] },
  playheadSec: number,
  totalDurationSec: number,
  ignoreIds: string[] = [],
  pxPerSec?: number,
): SnapTarget[] {
  const targets: SnapTarget[] = [
    { timeSec: 0, type: "zero", label: "0.0s" },
    { timeSec: totalDurationSec, type: "end", label: `${totalDurationSec.toFixed(1)}s` },
    { timeSec: playheadSec, type: "playhead", label: "Playhead" },
  ];

  const ignore = new Set(ignoreIds);
  let accumulated = 0;

  if (Array.isArray((film as any).clips)) {
    const clips = (film as any).clips as Array<Record<string, any>>;
    // A dragged clip's linked partner is ignored too, otherwise the pair snaps to itself.
    for (const clip of clips) {
      if (ignore.has(clip.id) && clip.linkedClipId) ignore.add(clip.linkedClipId);
    }
    for (const clip of clips) {
      const dur = clip.end !== undefined && clip.start !== undefined ? clip.end - clip.start : 3;
      const startSec = clip.position ?? 0;
      const endSec = startSec + dur;

      if (!ignore.has(clip.id)) {
        targets.push({ timeSec: startSec, type: "boundary", sourceId: clip.id, label: `${clip.id} start` });
        targets.push({ timeSec: endSec, type: "boundary", sourceId: clip.id, label: `${clip.id} cut` });
      }
      accumulated = Math.max(accumulated, endSec);
    }
  } else if (Array.isArray(film.shots)) {
    for (const shot of film.shots) {
      const rawDur =
        shot.end !== undefined && shot.start !== undefined && shot.end > shot.start
          ? shot.end - shot.start
          : shot.dur || 3;
      const startSec = shot.position ?? shot.startSec ?? accumulated;
      const endSec = startSec + rawDur;

      if (!ignore.has(shot.id)) {
        targets.push({ timeSec: startSec, type: "boundary", sourceId: shot.id, label: `${shot.id} start` });
        targets.push({ timeSec: endSec, type: "boundary", sourceId: shot.id, label: `${shot.id} cut` });
      }

      accumulated = Math.max(accumulated, endSec);
    }
  }

  const step = pxPerSec && pxPerSec > 0 ? gridStepForZoom(pxPerSec) : 1;
  for (let s = step; s < totalDurationSec; s += step) {
    targets.push({ timeSec: Number(s.toFixed(3)), type: "grid" });
  }

  return targets;
}

/**
 * Calculate a snap for a single time value with sticky target caching and a pixel tolerance.
 */
export function calculateStickySnap(
  targetTimeSec: number,
  snapTargets: SnapTarget[],
  zoomLevel: number,
  activeTarget: SnapTarget | null = null,
  tolerancePx = 12,
): SnapResult {
  // 1. A previously locked target keeps the snap until the pointer breaks the threshold.
  if (activeTarget) {
    const distToActivePx = Math.abs(targetTimeSec - activeTarget.timeSec) * zoomLevel;
    if (distToActivePx <= tolerancePx) {
      return { snappedTimeSec: activeTarget.timeSec, activeSnap: activeTarget, hasSnapped: true };
    }
  }

  // 2. Otherwise take the closest target inside the threshold, preferring specific targets.
  let closestDistPx = Infinity;
  let bestPriority = Infinity;
  let bestTarget: SnapTarget | null = null;

  for (const target of snapTargets) {
    const distPx = Math.abs(target.timeSec - targetTimeSec) * zoomLevel;
    if (distPx > tolerancePx) continue;
    const priority = TARGET_PRIORITY[target.type];
    if (distPx < closestDistPx - 0.5 || (Math.abs(distPx - closestDistPx) <= 0.5 && priority < bestPriority)) {
      closestDistPx = distPx;
      bestPriority = priority;
      bestTarget = target;
    }
  }

  if (bestTarget) {
    return { snappedTimeSec: bestTarget.timeSec, activeSnap: bestTarget, hasSnapped: true };
  }

  return { snappedTimeSec: targetTimeSec, activeSnap: null, hasSnapped: false };
}

/**
 * Snap a dragged clip by testing BOTH of its edges against every target, which is what makes a
 * drag feel like a professional NLE: butting a clip up against the previous clip's out-point works
 * whether the user is eyeing the head or the tail of the clip they are moving.
 */
export function calculateClipSnap(
  candidateStartSec: number,
  clipDurationSec: number,
  snapTargets: SnapTarget[],
  pxPerSec: number,
  activeTarget: SnapTarget | null = null,
  tolerancePx = 10,
): ClipSnapResult {
  const startResult = calculateStickySnap(candidateStartSec, snapTargets, pxPerSec, activeTarget, tolerancePx);
  const endResult = calculateStickySnap(
    candidateStartSec + clipDurationSec,
    snapTargets,
    pxPerSec,
    activeTarget,
    tolerancePx,
  );

  const startDist = startResult.hasSnapped ? Math.abs(startResult.snappedTimeSec - candidateStartSec) : Infinity;
  const endDist = endResult.hasSnapped
    ? Math.abs(endResult.snappedTimeSec - (candidateStartSec + clipDurationSec))
    : Infinity;

  if (!startResult.hasSnapped && !endResult.hasSnapped) {
    return { snappedTimeSec: candidateStartSec, activeSnap: null, hasSnapped: false, snappedEdge: null };
  }

  if (startDist <= endDist) {
    return {
      snappedTimeSec: Math.max(0, startResult.snappedTimeSec),
      activeSnap: startResult.activeSnap,
      hasSnapped: true,
      snappedEdge: "start",
    };
  }

  return {
    snappedTimeSec: Math.max(0, endResult.snappedTimeSec - clipDurationSec),
    activeSnap: endResult.activeSnap,
    hasSnapped: true,
    snappedEdge: "end",
  };
}
