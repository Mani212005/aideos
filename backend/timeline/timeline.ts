/**
 * File Description: Pure Functional Timeline Operations Engine for Aideos.
 * Implements direct manipulation, ripple trimming, snap calculation,
 * split/delete transformations, and universal undo/redo state management.
 * Conforms strictly to Axiom 1 (pure data mutations) and Phase T-B/T-C specifications.
 */

import type { Film, Shot } from "../../src/dl/schema";

export type TimelineMode = "narration-locked" | "free-edit";

export interface ClipSelection {
  shotIds: string[];
}

export interface SnapTarget {
  timeSec: number;
  type: "playhead" | "boundary" | "grid" | "marker";
  label?: string;
}

export interface TimelineState {
  film: Film;
  mode: TimelineMode;
  selectedShotIds: string[];
  playheadSec: number;
  zoomLevel: number; // pixels per second
}

export interface UndoEntry {
  film: Film;
  label: string;
  timestamp: number;
}

export class TimelineUndoStack {
  private past: UndoEntry[] = [];
  private future: UndoEntry[] = [];
  private readonly maxDepth: number;

  constructor(maxDepth = 50) {
    this.maxDepth = maxDepth;
  }

  push(film: Film, label: string): void {
    const clone = JSON.parse(JSON.stringify(film)) as Film;
    this.past.push({ film: clone, label, timestamp: Date.now() });
    if (this.past.length > this.maxDepth) {
      this.past.shift();
    }
    this.future = []; // Clear redo stack on new action
  }

  undo(currentFilm: Film): { film: Film; label: string } | null {
    if (this.past.length === 0) return null;
    const previous = this.past.pop()!;
    const currentClone = JSON.parse(JSON.stringify(currentFilm)) as Film;
    this.future.push({ film: currentClone, label: previous.label, timestamp: Date.now() });
    return { film: JSON.parse(JSON.stringify(previous.film)), label: previous.label };
  }

  redo(currentFilm: Film): { film: Film; label: string } | null {
    if (this.future.length === 0) return null;
    const next = this.future.pop()!;
    const currentClone = JSON.parse(JSON.stringify(currentFilm)) as Film;
    this.past.push({ film: currentClone, label: next.label, timestamp: Date.now() });
    return { film: JSON.parse(JSON.stringify(next.film)), label: next.label };
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  get depth(): number {
    return this.past.length;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

/**
 * Compute start times for all shots in sequence.
 */
export function computeShotStartTimes(shots: Shot[]): number[] {
  const startTimes: number[] = [];
  let accumulated = 0;
  for (const shot of shots) {
    startTimes.push(accumulated);
    accumulated += shot.dur;
  }
  return startTimes;
}

/**
 * Find closest snap point within pixel threshold.
 */
export function calculateSnap(
  targetTimeSec: number,
  snapTargets: SnapTarget[],
  zoomLevel: number,
  thresholdPx = 8
): { snappedTimeSec: number; activeSnap: SnapTarget | null } {
  let closestDistPx = Infinity;
  let activeSnap: SnapTarget | null = null;
  let snappedTimeSec = targetTimeSec;

  for (const target of snapTargets) {
    const distPx = Math.abs(target.timeSec - targetTimeSec) * zoomLevel;
    if (distPx <= thresholdPx && distPx < closestDistPx) {
      closestDistPx = distPx;
      activeSnap = target;
      snappedTimeSec = target.timeSec;
    }
  }

  return { snappedTimeSec, activeSnap };
}

/**
 * Ripple trim shot edge.
 * - In narration-locked mode: right edge trim of shot i borrows/adds duration to shot i+1, preserving total film duration.
 * - In free-edit mode: right edge trim adjusts shot i duration directly.
 */
export function trimShotEdge(
  film: Film,
  shotIndex: number,
  edge: "left" | "right",
  deltaSec: number,
  mode: TimelineMode = "narration-locked"
): Film {
  if (shotIndex < 0 || shotIndex >= film.shots.length) {
    throw new Error(`Invalid shotIndex ${shotIndex}`);
  }

  const newShots = JSON.parse(JSON.stringify(film.shots)) as Shot[];
  const fps = film.fps || 30;
  const frameDelta = Math.round(deltaSec * fps) / fps;
  const MIN_DUR = 1 / fps; // Minimum 1 frame

  if (mode === "narration-locked") {
    if (edge === "right") {
      if (shotIndex >= newShots.length - 1) {
        // Last shot cannot borrow from next in locked mode without breaking total sum
        throw new Error("Cannot extend last shot in narration-locked mode without changing audio length");
      }
      const currentDurA = newShots[shotIndex].dur;
      const currentDurB = newShots[shotIndex + 1].dur;

      const proposedDurA = currentDurA + frameDelta;
      const proposedDurB = currentDurB - frameDelta;

      if (proposedDurA < MIN_DUR || proposedDurB < MIN_DUR) {
        throw new Error(`Trim rejected: shot duration cannot fall below 1 frame (${MIN_DUR.toFixed(3)}s)`);
      }

      newShots[shotIndex].dur = Number(proposedDurA.toFixed(3));
      newShots[shotIndex + 1].dur = Number(proposedDurB.toFixed(3));
    } else {
      // Left edge trim
      if (shotIndex === 0) {
        throw new Error("Cannot trim left edge of first shot in narration-locked mode");
      }
      const currentDurPrev = newShots[shotIndex - 1].dur;
      const currentDurCurr = newShots[shotIndex].dur;

      const proposedDurPrev = currentDurPrev + frameDelta;
      const proposedDurCurr = currentDurCurr - frameDelta;

      if (proposedDurPrev < MIN_DUR || proposedDurCurr < MIN_DUR) {
        throw new Error(`Trim rejected: shot duration cannot fall below 1 frame (${MIN_DUR.toFixed(3)}s)`);
      }

      newShots[shotIndex - 1].dur = Number(proposedDurPrev.toFixed(3));
      newShots[shotIndex].dur = Number(proposedDurCurr.toFixed(3));
    }
  } else {
    // Free-edit mode
    if (edge === "right") {
      const proposedDur = newShots[shotIndex].dur + frameDelta;
      if (proposedDur < MIN_DUR) {
        throw new Error(`Trim rejected: shot duration cannot fall below 1 frame (${MIN_DUR.toFixed(3)}s)`);
      }
      newShots[shotIndex].dur = Number(proposedDur.toFixed(3));
    } else {
      const proposedDur = newShots[shotIndex].dur - frameDelta;
      if (proposedDur < MIN_DUR) {
        throw new Error(`Trim rejected: shot duration cannot fall below 1 frame (${MIN_DUR.toFixed(3)}s)`);
      }
      newShots[shotIndex].dur = Number(proposedDur.toFixed(3));
    }
  }

  return {
    ...film,
    shots: newShots,
  };
}

/**
 * Split a shot at an exact playhead timestamp.
 */
export function splitShotAtTime(film: Film, playheadSec: number): Film {
  const startTimes = computeShotStartTimes(film.shots);
  const fps = film.fps || 30;
  let targetIndex = -1;
  let splitOffsetSec = 0;

  for (let i = 0; i < film.shots.length; i++) {
    const start = startTimes[i];
    const end = start + film.shots[i].dur;
    if (playheadSec > start && playheadSec < end) {
      targetIndex = i;
      splitOffsetSec = playheadSec - start;
      break;
    }
  }

  if (targetIndex === -1) {
    throw new Error(`Playhead at ${playheadSec.toFixed(3)}s does not fall within a trimmable shot interior`);
  }

  const targetShot = film.shots[targetIndex];
  const durLeft = Number((Math.round(splitOffsetSec * fps) / fps).toFixed(3));
  const durRight = Number((targetShot.dur - durLeft).toFixed(3));

  if (durLeft <= 0 || durRight <= 0) {
    throw new Error("Split produces zero-length shot segment");
  }

  const leftShot: Shot = {
    ...JSON.parse(JSON.stringify(targetShot)),
    id: `${targetShot.id}-a`,
    dur: durLeft,
  };

  const rightShot: Shot = {
    ...JSON.parse(JSON.stringify(targetShot)),
    id: `${targetShot.id}-b`,
    dur: durRight,
  };

  const newShots = JSON.parse(JSON.stringify(film.shots)) as Shot[];
  newShots.splice(targetIndex, 1, leftShot, rightShot);

  return {
    ...film,
    shots: newShots,
  };
}

/**
 * Delete a shot and optionally ripple or preserve total duration.
 */
export function deleteShot(
  film: Film,
  shotIndex: number,
  mode: TimelineMode = "narration-locked"
): Film {
  if (film.shots.length <= 1) {
    throw new Error("Cannot delete the only remaining shot in film");
  }
  if (shotIndex < 0 || shotIndex >= film.shots.length) {
    throw new Error(`Invalid shotIndex ${shotIndex}`);
  }

  const deletedDur = film.shots[shotIndex].dur;
  const newShots = (JSON.parse(JSON.stringify(film.shots)) as Shot[]).filter((_, idx) => idx !== shotIndex);

  if (mode === "narration-locked") {
    // Distribute deleted duration across remaining neighbor to preserve ±50ms audio invariant
    const targetNeighbor = shotIndex > 0 ? shotIndex - 1 : 0;
    newShots[targetNeighbor].dur = Number((newShots[targetNeighbor].dur + deletedDur).toFixed(3));
  }

  return {
    ...film,
    shots: newShots,
  };
}
