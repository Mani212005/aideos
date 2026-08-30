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

export interface MediaAssetInput {
  filename: string;
  src: string;
  type: "video" | "audio" | "image";
  duration: number;
  width?: number;
  height?: number;
}

/**
 * Import an external media asset into a LayeredFilm (U-6 & U-10).
 * If the asset is video, it splits into TWO linked clips: [videoClip + audioClip].
 */
export function importMediaAssetToLayeredFilm(
  film: LayeredFilm,
  asset: MediaAssetInput,
  positionSec = 0
): {
  film: LayeredFilm;
  actions: UpdateAction[];
  transactionId: string;
  videoClipId?: string;
  audioClipId?: string;
} {
  const newLayers = JSON.parse(JSON.stringify(film.layers)) as Layer[];
  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const txId = generateUUID();
  const actions: UpdateAction[] = [];

  const slug = asset.filename.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 16);
  const dur = Math.max(0.5, Number(asset.duration.toFixed(3)));
  const pos = Math.max(0, Number(positionSec.toFixed(3)));

  if (asset.type === "video") {
    // 1. Ensure video layer exists
    let videoLayer = newLayers.find((l) => l.id === "layer-video" || l.label.toLowerCase().includes("video"));
    if (!videoLayer) {
      videoLayer = {
        id: "layer-video",
        number: 15,
        label: "Video Footage",
        locked: false,
        hidden: false,
        muted: false,
        height: 72,
      };
      newLayers.push(videoLayer);
      actions.push({
        type: "insert",
        path: ["layers", newLayers.length - 1],
        oldValue: null,
        newValue: videoLayer,
        transactionId: txId,
        label: "Create video layer",
        timestamp: Date.now(),
      });
    }

    // 2. Ensure audio layer exists
    let audioLayer = newLayers.find((l) => l.id === "layer-audio-footage" || l.id === "layer-audio-spine");
    if (!audioLayer) {
      audioLayer = {
        id: "layer-audio-footage",
        number: 5,
        label: "Footage Audio",
        locked: false,
        hidden: false,
        muted: false,
        height: 48,
      };
      newLayers.push(audioLayer);
      actions.push({
        type: "insert",
        path: ["layers", newLayers.length - 1],
        oldValue: null,
        newValue: audioLayer,
        transactionId: txId,
        label: "Create footage audio layer",
        timestamp: Date.now(),
      });
    }

    const videoClipId = `clip-video-${slug}-${generateUUID().slice(0, 4)}`;
    const audioClipId = `clip-audio-${slug}-${generateUUID().slice(0, 4)}`;

    const videoClip: Clip = {
      id: videoClipId,
      layerId: videoLayer.id,
      position: pos,
      start: 0,
      end: dur,
      kind: "video",
      payload: {
        src: asset.src,
        width: asset.width,
        height: asset.height,
      },
      linkedClipId: audioClipId, // Symmetric link (U-6)
      opacity: 1,
      volume: 1,
    };

    const audioClip: Clip = {
      id: audioClipId,
      layerId: audioLayer.id,
      position: pos,
      start: 0,
      end: dur,
      kind: "audio",
      payload: {
        src: asset.src,
        channel: "external",
      },
      linkedClipId: videoClipId, // Symmetric link (U-6)
      opacity: 1,
      volume: 1,
    };

    newClips.push(videoClip, audioClip);

    actions.push(
      {
        type: "insert",
        path: ["clips", newClips.length - 2],
        oldValue: null,
        newValue: videoClip,
        transactionId: txId,
        label: `Import video clip ${videoClip.id}`,
        timestamp: Date.now(),
      },
      {
        type: "insert",
        path: ["clips", newClips.length - 1],
        oldValue: null,
        newValue: audioClip,
        transactionId: txId,
        label: `Import audio clip ${audioClip.id}`,
        timestamp: Date.now(),
      }
    );

    return {
      film: { ...film, layers: newLayers, clips: newClips },
      actions,
      transactionId: txId,
      videoClipId,
      audioClipId,
    };
  } else if (asset.type === "audio") {
    let audioLayer = newLayers.find((l) => l.number === 0 || l.id.includes("audio")) || newLayers[0];
    const audioClipId = `clip-audio-${slug}-${generateUUID().slice(0, 4)}`;
    const audioClip: Clip = {
      id: audioClipId,
      layerId: audioLayer.id,
      position: pos,
      start: 0,
      end: dur,
      kind: "audio",
      payload: {
        src: asset.src,
        channel: "external",
      },
      opacity: 1,
      volume: 1,
    };

    newClips.push(audioClip);
    actions.push({
      type: "insert",
      path: ["clips", newClips.length - 1],
      oldValue: null,
      newValue: audioClip,
      transactionId: txId,
      label: `Import audio clip ${audioClip.id}`,
      timestamp: Date.now(),
    });

    return {
      film: { ...film, layers: newLayers, clips: newClips },
      actions,
      transactionId: txId,
      audioClipId,
    };
  } else {
    // Image Asset
    let imageLayer = newLayers.find((l) => l.number > 0) || newLayers[0];
    const imageClipId = `clip-image-${slug}-${generateUUID().slice(0, 4)}`;
    const imageClip: Clip = {
      id: imageClipId,
      layerId: imageLayer.id,
      position: pos,
      start: 0,
      end: dur,
      kind: "image",
      payload: {
        src: asset.src,
        scale: 1,
      },
      opacity: 1,
      volume: 1,
    };

    newClips.push(imageClip);
    actions.push({
      type: "insert",
      path: ["clips", newClips.length - 1],
      oldValue: null,
      newValue: imageClip,
      transactionId: txId,
      label: `Import image clip ${imageClip.id}`,
      timestamp: Date.now(),
    });

    return {
      film: { ...film, layers: newLayers, clips: newClips },
      actions,
      transactionId: txId,
      videoClipId: imageClipId,
    };
  }
}

/**
 * Unlink a linked video/audio pair so they can be moved or edited independently (U-6).
 */
export function unlinkClips(
  film: LayeredFilm,
  clipId: string
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = film.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) {
    throw new Error(`Clip "${clipId}" not found`);
  }

  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const clip = newClips[clipIndex];
  const partnerId = clip.linkedClipId;
  const txId = generateUUID();
  const actions: UpdateAction[] = [];

  clip.linkedClipId = null;
  actions.push({
    type: "update",
    path: ["clips", clipIndex, "linkedClipId"],
    oldValue: partnerId,
    newValue: null,
    transactionId: txId,
    label: `Unlink ${clip.id}`,
    timestamp: Date.now(),
  });

  if (partnerId) {
    const partnerIdx = newClips.findIndex((c) => c.id === partnerId);
    if (partnerIdx !== -1) {
      newClips[partnerIdx].linkedClipId = null;
      actions.push({
        type: "update",
        path: ["clips", partnerIdx, "linkedClipId"],
        oldValue: clip.id,
        newValue: null,
        transactionId: txId,
        label: `Unlink partner ${partnerId}`,
        timestamp: Date.now(),
      });
    }
  }

  return {
    film: { ...film, clips: newClips },
    actions,
    transactionId: txId,
  };
}

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
