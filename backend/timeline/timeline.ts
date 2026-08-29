/**
 * File Description: Pure Functional Timeline Operations Engine for Aideos.
 * Implements the 5 Foundational Geometry Patterns:
 * 1. Stored position, start, end, layer data model (duration derived).
 * 2. Transaction-grouped UpdateAction architecture.
 * 3. Sticky snapping with self-ignore.
 * 4. Explicit drag state transitions.
 * 5. Pending overrides live preview layer.
 */

import type { Film, Shot } from "../../src/dl/schema";
import {
  type UpdateAction,
  type TimelineTransaction,
  TimelineTransactionManager,
  generateUUID,
} from "./updates";
import {
  type SnapTarget,
  type SnapResult,
  collectSnapTargets,
  calculateStickySnap,
} from "./snap";

export {
  TimelineTransactionManager,
  type UpdateAction,
  type TimelineTransaction,
  type SnapTarget,
  type SnapResult,
  collectSnapTargets,
  calculateStickySnap,
};

export interface PendingClipOverride {
  position?: number;
  start?: number;
  end?: number;
  layer?: number;
}

export type PendingOverridesMap = Record<string, PendingClipOverride>;

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

/**
 * Move a single clip to a new timeline position.
 */
export function moveShot(
  film: Film,
  shotIndex: number,
  newPositionSec: number
): { film: Film; actions: UpdateAction[]; transactionId: string } {
  if (shotIndex < 0 || shotIndex >= film.shots.length) {
    throw new Error(`Invalid shotIndex ${shotIndex}`);
  }

  const fps = film.fps || 30;
  const clampedPos = Math.max(0, Math.round(newPositionSec * fps) / fps);
  const newShots = JSON.parse(JSON.stringify(film.shots)) as Shot[];
  const targetShot = newShots[shotIndex];
  const oldPos = targetShot.position ?? targetShot.startSec;

  targetShot.position = Number(clampedPos.toFixed(3));
  targetShot.startSec = targetShot.position; // sync alias

  const txId = generateUUID();
  const actions: UpdateAction[] = [
    {
      type: "update",
      path: ["shots", shotIndex, "position"],
      oldValue: oldPos,
      newValue: targetShot.position,
      transactionId: txId,
      label: `Move ${targetShot.id} to ${targetShot.position.toFixed(2)}s`,
      timestamp: Date.now(),
    },
  ];

  // Resolve collisions on same layer
  const resolvedShots = resolveTrackCollisions(newShots, shotIndex);

  return {
    film: { ...film, shots: resolvedShots },
    actions,
    transactionId: txId,
  };
}

/**
 * Move multiple selected shots while preserving relative time offsets.
 */
export function moveMultipleShots(
  film: Film,
  shotIndices: number[],
  deltaSec: number
): { film: Film; actions: UpdateAction[]; transactionId: string } {
  if (shotIndices.length === 0) {
    return { film, actions: [], transactionId: generateUUID() };
  }

  const fps = film.fps || 30;
  const frameDelta = Math.round(deltaSec * fps) / fps;
  const currentStarts = computeShotStartTimes(film.shots);
  const minCurrentStart = Math.min(...shotIndices.map((i) => currentStarts[i]));
  const effectiveDelta = Math.max(-minCurrentStart, frameDelta);

  const newShots = JSON.parse(JSON.stringify(film.shots)) as Shot[];
  const txId = generateUUID();
  const actions: UpdateAction[] = [];

  for (const idx of shotIndices) {
    const origStart = currentStarts[idx];
    const newStart = Math.max(0, Number((origStart + effectiveDelta).toFixed(3)));
    const oldVal = newShots[idx].position ?? newShots[idx].startSec;

    newShots[idx].position = newStart;
    newShots[idx].startSec = newStart;

    actions.push({
      type: "update",
      path: ["shots", idx, "position"],
      oldValue: oldVal,
      newValue: newStart,
      transactionId: txId,
      label: `Move ${newShots[idx].id} to ${newStart.toFixed(2)}s`,
      timestamp: Date.now(),
    });
  }

  return {
    film: { ...film, shots: newShots },
    actions,
    transactionId: txId,
  };
}

/**
 * Prevent two clips on the same track/layer from overlapping.
 */
export function resolveTrackCollisions(shots: Shot[], movedIndex: number): Shot[] {
  const resolved = JSON.parse(JSON.stringify(shots)) as Shot[];
  const initialStarts = computeShotStartTimes(shots);
  const target = resolved[movedIndex];
  const targetLayer = target.layer ?? target.track ?? 0;
  const targetDur = getShotDuration(target);
  let targetStart = target.position ?? target.startSec ?? initialStarts[movedIndex];
  let targetEnd = targetStart + targetDur;

  for (let i = 0; i < resolved.length; i++) {
    if (i === movedIndex) continue;
    const s = resolved[i];
    const sLayer = s.layer ?? s.track ?? 0;
    if (sLayer !== targetLayer) continue;

    const sDur = getShotDuration(s);
    const sStart = s.position ?? s.startSec ?? initialStarts[i];
    const sEnd = sStart + sDur;

    // Check collision
    if (targetStart < sEnd && targetEnd > sStart) {
      if (targetStart >= sStart) {
        // Target overlaps right side of s -> push target after s
        targetStart = Number(sEnd.toFixed(3));
        target.position = targetStart;
        target.startSec = targetStart;
        targetEnd = targetStart + targetDur;
      } else {
        // Target overlaps left side of s -> push s after target
        s.position = Number(targetEnd.toFixed(3));
        s.startSec = s.position;
      }
    }
  }

  return resolved;
}

/**
 * Pattern 1 Trimming:
 * - Dragging right edge changes `end` (and updates derived duration).
 * - Dragging left edge changes `start` AND `position` together.
 */
export function trimShotEdge(
  film: Film,
  shotIndex: number,
  edge: "left" | "right",
  deltaSec: number
): { film: Film; actions: UpdateAction[]; transactionId: string } {
  if (shotIndex < 0 || shotIndex >= film.shots.length) {
    throw new Error(`Invalid shotIndex ${shotIndex}`);
  }

  const newShots = JSON.parse(JSON.stringify(film.shots)) as Shot[];
  const shot = newShots[shotIndex];
  const fps = film.fps || 30;
  const frameDelta = Math.round(deltaSec * fps) / fps;
  const MIN_DUR = 0.5; // 0.5s schema minimum duration

  const currentStarts = computeShotStartTimes(film.shots);
  const currentPos = shot.position ?? shot.startSec ?? currentStarts[shotIndex];
  const currentIn = shot.start ?? shot.inSec ?? 0;
  const currentDur = getShotDuration(shot);
  const currentOut = shot.end ?? (currentIn + currentDur);

  const txId = generateUUID();
  const actions: UpdateAction[] = [];

  if (edge === "right") {
    const proposedOut = currentOut + frameDelta;
    const proposedDur = proposedOut - currentIn;
    if (proposedDur < MIN_DUR) {
      throw new Error(`Trim rejected: shot duration cannot fall below minimum (${MIN_DUR.toFixed(3)}s)`);
    }
    shot.start = currentIn;
    shot.end = Number(proposedOut.toFixed(3));
    shot.dur = Number(proposedDur.toFixed(3));

    actions.push({
      type: "update",
      path: ["shots", shotIndex, "end"],
      oldValue: currentOut,
      newValue: shot.end,
      transactionId: txId,
      label: `Trim ${shot.id} right edge to ${shot.end.toFixed(2)}s`,
      timestamp: Date.now(),
    });
  } else {
    // Left edge trim: advances in-point (start) and advances timeline position together
    const proposedIn = currentIn + frameDelta;
    const proposedPos = currentPos + frameDelta;
    const proposedDur = currentOut - proposedIn;

    if (proposedPos < 0) {
      throw new Error("Trim rejected: start time cannot be negative");
    }
    if (proposedDur < MIN_DUR) {
      throw new Error(`Trim rejected: shot duration cannot fall below minimum (${MIN_DUR.toFixed(3)}s)`);
    }

    shot.start = Number(proposedIn.toFixed(3));
    shot.end = currentOut;
    shot.position = Number(proposedPos.toFixed(3));
    shot.startSec = shot.position;
    shot.dur = Number(proposedDur.toFixed(3));

    actions.push({
      type: "update",
      path: ["shots", shotIndex, "position"],
      oldValue: currentPos,
      newValue: shot.position,
      transactionId: txId,
      label: `Trim ${shot.id} left edge to start at ${shot.position.toFixed(2)}s`,
      timestamp: Date.now(),
    });
  }

  return {
    film: { ...film, shots: newShots },
    actions,
    transactionId: txId,
  };
}

/**
 * Split a shot at an exact playhead timestamp.
 */
export function splitShotAtTime(
  film: Film,
  playheadSec: number
): { film: Film; actions: UpdateAction[]; transactionId: string } {
  const startTimes = computeShotStartTimes(film.shots);
  const fps = film.fps || 30;
  let targetIndex = -1;
  let splitOffsetSec = 0;

  for (let i = 0; i < film.shots.length; i++) {
    const start = startTimes[i];
    const dur = getShotDuration(film.shots[i]);
    const end = start + dur;
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
  const origDur = getShotDuration(targetShot);
  const durLeft = Number((Math.round(splitOffsetSec * fps) / fps).toFixed(3));
  const durRight = Number((origDur - durLeft).toFixed(3));

  if (durLeft < 0.5 || durRight < 0.5) {
    throw new Error("Split rejected: segment shorter than schema minimum 0.5s");
  }

  const origIn = targetShot.start ?? 0;
  const origPos = targetShot.position ?? targetShot.startSec ?? startTimes[targetIndex];

  const leftShot: Shot = {
    ...JSON.parse(JSON.stringify(targetShot)),
    id: `${targetShot.id}-a`,
    position: origPos,
    startSec: origPos,
    start: origIn,
    end: Number((origIn + durLeft).toFixed(3)),
    dur: durLeft,
  };

  const rightShot: Shot = {
    ...JSON.parse(JSON.stringify(targetShot)),
    id: `${targetShot.id}-b`,
    position: Number((origPos + durLeft).toFixed(3)),
    startSec: Number((origPos + durLeft).toFixed(3)),
    start: Number((origIn + durLeft).toFixed(3)),
    end: Number((origIn + origDur).toFixed(3)),
    dur: durRight,
  };

  const newShots = JSON.parse(JSON.stringify(film.shots)) as Shot[];
  newShots.splice(targetIndex, 1, leftShot, rightShot);

  const txId = generateUUID();
  const actions: UpdateAction[] = [
    {
      type: "delete",
      path: ["shots", targetIndex],
      oldValue: targetShot,
      newValue: null,
      transactionId: txId,
      label: `Split ${targetShot.id}`,
      timestamp: Date.now(),
    },
    {
      type: "insert",
      path: ["shots", targetIndex],
      oldValue: null,
      newValue: leftShot,
      transactionId: txId,
      label: `Insert ${leftShot.id}`,
      timestamp: Date.now(),
    },
    {
      type: "insert",
      path: ["shots", targetIndex + 1],
      oldValue: null,
      newValue: rightShot,
      transactionId: txId,
      label: `Insert ${rightShot.id}`,
      timestamp: Date.now(),
    },
  ];

  return {
    film: { ...film, shots: newShots },
    actions,
    transactionId: txId,
  };
}

/**
 * Delete a shot.
 */
export function deleteShot(
  film: Film,
  shotIndex: number
): { film: Film; actions: UpdateAction[]; transactionId: string } {
  if (film.shots.length <= 1) {
    throw new Error("Cannot delete the only remaining shot in film");
  }
  if (shotIndex < 0 || shotIndex >= film.shots.length) {
    throw new Error(`Invalid shotIndex ${shotIndex}`);
  }

  const deletedShot = film.shots[shotIndex];
  const newShots = (JSON.parse(JSON.stringify(film.shots)) as Shot[]).filter((_, idx) => idx !== shotIndex);
  const txId = generateUUID();

  const actions: UpdateAction[] = [
    {
      type: "delete",
      path: ["shots", shotIndex],
      oldValue: deletedShot,
      newValue: null,
      transactionId: txId,
      label: `Delete ${deletedShot.id}`,
      timestamp: Date.now(),
    },
  ];

  return {
    film: { ...film, shots: newShots },
    actions,
    transactionId: txId,
  };
}
