/**
 * File Description: Pure Functional Timeline Operations Engine for Aideos.
 * Implements Phase T-B (Direct manipulation, move along track, left/right trim,
 * multi-select with offset preservation, collision handling, snap calculation)
 * and Phase T-C (Universal undo/redo stack & shortcuts).
 * Operates in two modes: Narration-Locked (default ripple editing) and Free-Edit.
 */

import type { Film, Shot } from "../../src/dl/schema";

export type TimelineMode = "narration-locked" | "free-edit";

export interface SnapTarget {
  timeSec: number;
  type: "playhead" | "boundary" | "grid" | "marker";
  label?: string;
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

  constructor(maxDepth = 60) {
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
 * Uses explicit `shot.startSec` if defined, otherwise accumulates preceding durations.
 */
export function computeShotStartTimes(shots: Shot[]): number[] {
  const startTimes: number[] = [];
  let accumulated = 0;

  for (const shot of shots) {
    if (shot.startSec !== undefined) {
      startTimes.push(shot.startSec);
      accumulated = Math.max(accumulated, shot.startSec + shot.dur);
    } else {
      startTimes.push(accumulated);
      accumulated += shot.dur;
    }
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
 * TB-1: Move a clip along its track to a new start time.
 * In Free-Edit mode: sets explicit `shot.startSec` with collision handling.
 * In Narration-Locked mode: reorders shots sequentially based on new drop position.
 */
export function moveShot(
  film: Film,
  shotIndex: number,
  newStartSec: number,
  mode: TimelineMode = "free-edit"
): Film {
  if (shotIndex < 0 || shotIndex >= film.shots.length) {
    throw new Error(`Invalid shotIndex ${shotIndex}`);
  }

  const fps = film.fps || 30;
  const clampedStart = Math.max(0, Math.round(newStartSec * fps) / fps);
  const newShots = JSON.parse(JSON.stringify(film.shots)) as Shot[];
  const targetShot = newShots[shotIndex];

  if (mode === "free-edit") {
    targetShot.startSec = Number(clampedStart.toFixed(3));
    // Enforce non-overlapping track collision rule (TB-7)
    const resolvedShots = resolveTrackCollisions(newShots, shotIndex);
    return { ...film, shots: resolvedShots };
  } else {
    // Narration-Locked mode: reorder sequence based on timestamp
    const movingShot = newShots.splice(shotIndex, 1)[0];
    delete movingShot.startSec; // keep sequential

    let insertIndex = newShots.length;
    let accumulated = 0;
    for (let i = 0; i < newShots.length; i++) {
      const mid = accumulated + newShots[i].dur / 2;
      if (clampedStart < mid) {
        insertIndex = i;
        break;
      }
      accumulated += newShots[i].dur;
    }

    newShots.splice(insertIndex, 0, movingShot);
    return { ...film, shots: newShots };
  }
}

/**
 * TB-6: Move multiple selected shots while preserving relative offsets.
 */
export function moveMultipleShots(
  film: Film,
  shotIndices: number[],
  deltaSec: number,
  _mode: TimelineMode = "free-edit"
): Film {
  if (shotIndices.length === 0) return film;

  const fps = film.fps || 30;
  const frameDelta = Math.round(deltaSec * fps) / fps;
  const currentStarts = computeShotStartTimes(film.shots);
  const minCurrentStart = Math.min(...shotIndices.map((i) => currentStarts[i]));
  const effectiveDelta = Math.max(-minCurrentStart, frameDelta);

  const newShots = JSON.parse(JSON.stringify(film.shots)) as Shot[];

  for (const idx of shotIndices) {
    const origStart = currentStarts[idx];
    const newStart = Math.max(0, Number((origStart + effectiveDelta).toFixed(3)));
    newShots[idx].startSec = newStart;
  }

  return {
    ...film,
    shots: newShots,
  };
}

/**
 * TB-7: Collision / overlap handler.
 * Prevents two clips on the same track from overlapping. Pushes downstream clips if colliding.
 */
export function resolveTrackCollisions(shots: Shot[], movedIndex: number): Shot[] {
  const resolved = JSON.parse(JSON.stringify(shots)) as Shot[];
  const initialStarts = computeShotStartTimes(shots);
  const target = resolved[movedIndex];
  const targetTrack = target.track || 0;
  let targetStart = target.startSec ?? initialStarts[movedIndex];
  let targetEnd = targetStart + target.dur;

  for (let i = 0; i < resolved.length; i++) {
    if (i === movedIndex) continue;
    const s = resolved[i];
    const sTrack = s.track || 0;
    if (sTrack !== targetTrack) continue;

    const sStart = s.startSec ?? initialStarts[i];
    const sEnd = sStart + s.dur;

    // Check collision
    if (targetStart < sEnd && targetEnd > sStart) {
      if (targetStart >= sStart) {
        // Target is overlapping right side of s -> push target after s
        targetStart = Number(sEnd.toFixed(3));
        target.startSec = targetStart;
        targetEnd = targetStart + target.dur;
      } else {
        // Target is overlapping left side of s -> push s after target
        s.startSec = Number(targetEnd.toFixed(3));
      }
    }
  }

  return resolved;
}

/**
 * TB-2: Drag-to-trim shot edge.
 * - Right edge: modifies duration only.
 * - Left edge: modifies start time AND duration together.
 * - In narration-locked mode: ripples duration to adjacent shot.
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
  const MIN_DUR = 0.5; // Schema minimum duration

  if (mode === "narration-locked") {
    if (edge === "right") {
      if (shotIndex >= newShots.length - 1) {
        throw new Error("Cannot extend last shot in narration-locked mode without changing audio length");
      }
      const currentDurA = newShots[shotIndex].dur;
      const currentDurB = newShots[shotIndex + 1].dur;

      const proposedDurA = currentDurA + frameDelta;
      const proposedDurB = currentDurB - frameDelta;

      if (proposedDurA < MIN_DUR || proposedDurB < MIN_DUR) {
        throw new Error(`Trim rejected: shot duration cannot fall below minimum (${MIN_DUR.toFixed(3)}s)`);
      }

      newShots[shotIndex].dur = Number(proposedDurA.toFixed(3));
      newShots[shotIndex + 1].dur = Number(proposedDurB.toFixed(3));
    } else {
      // Left edge trim in locked mode ripples into previous shot
      if (shotIndex === 0) {
        throw new Error("Cannot trim left edge of first shot in narration-locked mode");
      }
      const currentDurPrev = newShots[shotIndex - 1].dur;
      const currentDurCurr = newShots[shotIndex].dur;

      const proposedDurPrev = currentDurPrev + frameDelta;
      const proposedDurCurr = currentDurCurr - frameDelta;

      if (proposedDurPrev < MIN_DUR || proposedDurCurr < MIN_DUR) {
        throw new Error(`Trim rejected: shot duration cannot fall below minimum (${MIN_DUR.toFixed(3)}s)`);
      }

      newShots[shotIndex - 1].dur = Number(proposedDurPrev.toFixed(3));
      newShots[shotIndex].dur = Number(proposedDurCurr.toFixed(3));
    }
  } else {
    // Free-edit mode: Left edge changes start time + duration; Right edge changes duration only
    const shot = newShots[shotIndex];
    const currentStarts = computeShotStartTimes(film.shots);
    const currentStart = shot.startSec !== undefined ? shot.startSec : currentStarts[shotIndex];

    if (edge === "right") {
      const proposedDur = shot.dur + frameDelta;
      if (proposedDur < MIN_DUR) {
        throw new Error(`Trim rejected: shot duration cannot fall below minimum (${MIN_DUR.toFixed(3)}s)`);
      }
      shot.dur = Number(proposedDur.toFixed(3));
    } else {
      const proposedStart = currentStart + frameDelta;
      const proposedDur = shot.dur - frameDelta;
      if (proposedStart < 0) {
        throw new Error("Trim rejected: start time cannot be negative");
      }
      if (proposedDur < MIN_DUR) {
        throw new Error(`Trim rejected: shot duration cannot fall below minimum (${MIN_DUR.toFixed(3)}s)`);
      }
      shot.startSec = Number(proposedStart.toFixed(3));
      shot.dur = Number(proposedDur.toFixed(3));
    }
  }

  return {
    ...film,
    shots: newShots,
  };
}

/**
 * Move shot to a different track (e.g. 0 = Main Shots, 1 = B-Roll/Overlay).
 */
export function moveShotToTrack(
  film: Film,
  shotIndex: number,
  targetTrack: number
): Film {
  if (shotIndex < 0 || shotIndex >= film.shots.length) {
    throw new Error(`Invalid shotIndex ${shotIndex}`);
  }
  const newShots = JSON.parse(JSON.stringify(film.shots)) as Shot[];
  newShots[shotIndex].track = targetTrack;
  return { ...film, shots: newShots };
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

  if (durLeft < 0.5 || durRight < 0.5) {
    throw new Error("Split rejected: split produces segment shorter than schema minimum 0.5s");
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
    ...(targetShot.startSec !== undefined ? { startSec: targetShot.startSec + durLeft } : {}),
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
    const targetNeighbor = shotIndex > 0 ? shotIndex - 1 : 0;
    newShots[targetNeighbor].dur = Number((newShots[targetNeighbor].dur + deletedDur).toFixed(3));
  }

  return {
    ...film,
    shots: newShots,
  };
}
