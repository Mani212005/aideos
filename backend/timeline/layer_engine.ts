/**
 * File Description: Generic Layer Interaction Engine for Aideos (Phase L-2).
 * Implements OpenShot timeline operations across arbitrary user-created layers:
 * - Drag-to-move along layer or between layers.
 * - Left/right edge trimming with stored position and derived duration.
 * - Multi-select drag with relative offset preservation.
 * - Non-overlapping layer collision resolution (pushes downstream clips).
 * - Transaction-grouped UpdateAction recording.
 */

import type { LayeredFilm, Layer, Clip } from "../../src/dl/layeredSchema";
import {
  type UpdateAction,
  type TimelineTransaction,
  TimelineTransactionManager,
  generateUUID,
} from "./updates";
import {
  collectSnapTargets,
  calculateStickySnap,
  type SnapTarget,
  type SnapResult,
} from "./snap";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";

export { TimelineTransactionManager, type UpdateAction, type TimelineTransaction, type SnapTarget, type SnapResult };

/**
 * Move a clip to a new position and optionally to a new layer.
 */
export function moveLayerClip(
  film: LayeredFilm,
  clipId: string,
  newPositionSec: number,
  targetLayerId?: string
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = film.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) {
    throw new Error(`Clip "${clipId}" not found in film`);
  }

  const fps = film.fps || 30;
  const clampedPos = Math.max(0, Math.round(newPositionSec * fps) / fps);
  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const targetClip = newClips[clipIndex];

  const oldPos = targetClip.position;
  const oldLayerId = targetClip.layerId;
  const nextLayerId = targetLayerId && film.layers.some((l) => l.id === targetLayerId)
    ? targetLayerId
    : oldLayerId;

  targetClip.position = Number(clampedPos.toFixed(3));
  targetClip.layerId = nextLayerId;

  const txId = generateUUID();
  const actions: UpdateAction[] = [
    {
      type: "update",
      path: ["clips", clipIndex, "position"],
      oldValue: oldPos,
      newValue: targetClip.position,
      transactionId: txId,
      label: `Move ${targetClip.id} to ${targetClip.position.toFixed(2)}s`,
      timestamp: Date.now(),
    },
  ];

  if (oldLayerId !== nextLayerId) {
    actions.push({
      type: "update",
      path: ["clips", clipIndex, "layerId"],
      oldValue: oldLayerId,
      newValue: nextLayerId,
      transactionId: txId,
      label: `Move ${targetClip.id} to layer ${nextLayerId}`,
      timestamp: Date.now(),
    });
  }

  // Handle linked audio/video pair if present
  if (targetClip.linkedClipId) {
    const linkedIdx = newClips.findIndex((c) => c.id === targetClip.linkedClipId);
    if (linkedIdx !== -1) {
      const linkedClip = newClips[linkedIdx];
      const oldLinkedPos = linkedClip.position;
      linkedClip.position = targetClip.position;
      actions.push({
        type: "update",
        path: ["clips", linkedIdx, "position"],
        oldValue: oldLinkedPos,
        newValue: linkedClip.position,
        transactionId: txId,
        label: `Move linked ${linkedClip.id}`,
        timestamp: Date.now(),
      });
    }
  }

  // Resolve layer collisions
  const resolvedClips = resolveLayerCollisions(newClips, clipIndex);

  const updatedFilm: LayeredFilm = {
    ...film,
    clips: resolvedClips,
  };

  return {
    film: updatedFilm,
    actions,
    transactionId: txId,
  };
}

/**
 * Move multiple selected clips while preserving their relative offsets.
 */
export function moveMultipleLayerClips(
  film: LayeredFilm,
  clipIds: string[],
  deltaSec: number
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  if (clipIds.length === 0) {
    return { film, actions: [], transactionId: generateUUID() };
  }

  const fps = film.fps || 30;
  const frameDelta = Math.round(deltaSec * fps) / fps;

  const targetClips = film.clips.filter((c) => clipIds.includes(c.id));
  const minPos = Math.min(...targetClips.map((c) => c.position));
  const effectiveDelta = Math.max(-minPos, frameDelta);

  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const txId = generateUUID();
  const actions: UpdateAction[] = [];

  for (const cid of clipIds) {
    const idx = newClips.findIndex((c) => c.id === cid);
    if (idx === -1) continue;

    const clip = newClips[idx];
    const oldPos = clip.position;
    const newPos = Math.max(0, Number((oldPos + effectiveDelta).toFixed(3)));

    clip.position = newPos;

    actions.push({
      type: "update",
      path: ["clips", idx, "position"],
      oldValue: oldPos,
      newValue: newPos,
      transactionId: txId,
      label: `Move ${clip.id} to ${newPos.toFixed(2)}s`,
      timestamp: Date.now(),
    });
  }

  const updatedFilm: LayeredFilm = {
    ...film,
    clips: newClips,
  };

  return {
    film: updatedFilm,
    actions,
    transactionId: txId,
  };
}

/**
 * Trim a clip's in-point (left) or out-point (right).
 * - Right edge: modifies `end` (and derived duration `end - start`).
 * - Left edge: modifies `start` AND `position` together, leaving `end` unchanged.
 */
export function trimLayerClipEdge(
  film: LayeredFilm,
  clipId: string,
  edge: "left" | "right",
  deltaSec: number
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = film.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) {
    throw new Error(`Clip "${clipId}" not found in film`);
  }

  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const clip = newClips[clipIndex];
  const fps = film.fps || 30;
  const frameDelta = Math.round(deltaSec * fps) / fps;
  const MIN_DUR = 0.05; // 50ms minimum clip duration

  const oldPos = clip.position;
  const oldStart = clip.start;
  const oldEnd = clip.end;
  const txId = generateUUID();
  const actions: UpdateAction[] = [];

  if (edge === "right") {
    const proposedEnd = oldEnd + frameDelta;
    if (proposedEnd - oldStart < MIN_DUR) {
      throw new Error(`Trim rejected: clip duration cannot fall below minimum (${MIN_DUR}s)`);
    }
    clip.end = Number(proposedEnd.toFixed(3));

    actions.push({
      type: "update",
      path: ["clips", clipIndex, "end"],
      oldValue: oldEnd,
      newValue: clip.end,
      transactionId: txId,
      label: `Trim ${clip.id} right edge to ${clip.end.toFixed(2)}s`,
      timestamp: Date.now(),
    });
  } else {
    // Left edge trim: advances in-point (start) and advances position on timeline together
    const proposedStart = oldStart + frameDelta;
    const proposedPos = oldPos + frameDelta;
    if (proposedPos < 0) {
      throw new Error("Trim rejected: position cannot be negative");
    }
    if (oldEnd - proposedStart < MIN_DUR) {
      throw new Error(`Trim rejected: clip duration cannot fall below minimum (${MIN_DUR}s)`);
    }

    clip.start = Number(proposedStart.toFixed(3));
    clip.position = Number(proposedPos.toFixed(3));

    actions.push({
      type: "update",
      path: ["clips", clipIndex, "start"],
      oldValue: oldStart,
      newValue: clip.start,
      transactionId: txId,
      label: `Trim ${clip.id} start to ${clip.start.toFixed(2)}s`,
      timestamp: Date.now(),
    });
    actions.push({
      type: "update",
      path: ["clips", clipIndex, "position"],
      oldValue: oldPos,
      newValue: clip.position,
      transactionId: txId,
      label: `Trim ${clip.id} position to ${clip.position.toFixed(2)}s`,
      timestamp: Date.now(),
    });
  }

  const updatedFilm: LayeredFilm = {
    ...film,
    clips: newClips,
  };

  return {
    film: updatedFilm,
    actions,
    transactionId: txId,
  };
}

/**
 * Split a clip at an exact playhead timestamp into two distinct clips.
 */
export function splitLayerClipAtTime(
  film: LayeredFilm,
  clipId: string,
  playheadSec: number
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = film.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) {
    throw new Error(`Clip "${clipId}" not found in film`);
  }

  const clip = film.clips[clipIndex];
  const dur = clip.end - clip.start;
  const clipEndPos = clip.position + dur;

  if (playheadSec <= clip.position || playheadSec >= clipEndPos) {
    throw new Error(`Playhead at ${playheadSec.toFixed(2)}s is outside clip interior [${clip.position}s..${clipEndPos.toFixed(2)}s]`);
  }

  const splitDelta = playheadSec - clip.position;
  const leftDur = Number(splitDelta.toFixed(3));
  const rightDur = Number((dur - splitDelta).toFixed(3));

  if (leftDur < 0.05 || rightDur < 0.05) {
    throw new Error("Split rejected: resulting segment duration is under minimum 50ms");
  }

  const leftClip: Clip = {
    ...JSON.parse(JSON.stringify(clip)),
    id: `${clip.id}-left`,
    position: clip.position,
    start: clip.start,
    end: Number((clip.start + leftDur).toFixed(3)),
  };

  const rightClip: Clip = {
    ...JSON.parse(JSON.stringify(clip)),
    id: `${clip.id}-right`,
    position: Number(playheadSec.toFixed(3)),
    start: Number((clip.start + leftDur).toFixed(3)),
    end: clip.end,
  };

  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  newClips.splice(clipIndex, 1, leftClip, rightClip);

  const txId = generateUUID();
  const actions: UpdateAction[] = [
    {
      type: "delete",
      path: ["clips", clipIndex],
      oldValue: clip,
      newValue: null,
      transactionId: txId,
      label: `Split ${clip.id}`,
      timestamp: Date.now(),
    },
    {
      type: "insert",
      path: ["clips", clipIndex],
      oldValue: null,
      newValue: leftClip,
      transactionId: txId,
      label: `Insert ${leftClip.id}`,
      timestamp: Date.now(),
    },
    {
      type: "insert",
      path: ["clips", clipIndex + 1],
      oldValue: null,
      newValue: rightClip,
      transactionId: txId,
      label: `Insert ${rightClip.id}`,
      timestamp: Date.now(),
    },
  ];

  return {
    film: { ...film, clips: newClips },
    actions,
    transactionId: txId,
  };
}

/**
 * Delete a clip from the layered film.
 */
export function deleteLayerClip(
  film: LayeredFilm,
  clipId: string
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = film.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) {
    throw new Error(`Clip "${clipId}" not found in film`);
  }

  const deletedClip = film.clips[clipIndex];
  const newClips = film.clips.filter((c) => c.id !== clipId);
  const txId = generateUUID();

  const actions: UpdateAction[] = [
    {
      type: "delete",
      path: ["clips", clipIndex],
      oldValue: deletedClip,
      newValue: null,
      transactionId: txId,
      label: `Delete ${clipId}`,
      timestamp: Date.now(),
    },
  ];

  return {
    film: { ...film, clips: newClips },
    actions,
    transactionId: txId,
  };
}

/**
 * Prevent two clips on the same layer from overlapping in time.
 * Pushes downstream colliding clips.
 */
export function resolveLayerCollisions(clips: Clip[], movedIndex: number): Clip[] {
  const resolved = JSON.parse(JSON.stringify(clips)) as Clip[];
  const target = resolved[movedIndex];
  const targetLayer = target.layerId;
  let targetStart = target.position;
  let targetDur = target.end - target.start;
  let targetEnd = targetStart + targetDur;

  for (let i = 0; i < resolved.length; i++) {
    if (i === movedIndex) continue;
    const s = resolved[i];
    if (s.layerId !== targetLayer) continue;

    const sDur = s.end - s.start;
    const sStart = s.position;
    const sEnd = sStart + sDur;

    // Detect overlap
    if (targetStart < sEnd && targetEnd > sStart) {
      if (targetStart >= sStart) {
        // Target overlaps right side of s -> push target after s
        targetStart = Number(sEnd.toFixed(3));
        target.position = targetStart;
        targetEnd = targetStart + targetDur;
      } else {
        // Target overlaps left side of s -> push s after target
        s.position = Number(targetEnd.toFixed(3));
      }
    }
  }

  return resolved;
}
