/**
 * File Description: Generic Layer Interaction Engine for Aideos (Phase L-2).
 * Implements OpenShot-grade timeline operations across arbitrary user-created layers:
 * - Drag-to-move along a layer or between layers, with locked layers refusing every edit.
 * - Left/right edge trimming with stored position, derived duration and media-bound clamping.
 * - Multi-select drag with relative offset preservation.
 * - Linked video/audio pairs that stay in sync through move, trim, split and delete.
 * - Deterministic non-overlapping collision resolution that never displaces the anchor the user
 *   just dropped, and ripples every other clip on the layer downstream.
 * - Transaction-grouped UpdateAction recording so one gesture is one undo step.
 */

import type { LayeredFilm, Layer, Clip } from "../../src/dl/layeredSchema";
import {
  type UpdateAction,
  type TimelineTransaction,
  TimelineTransactionManager,
  generateUUID,
} from "./updates";
import { type SnapTarget, type SnapResult } from "./snap";

export { TimelineTransactionManager, type UpdateAction, type TimelineTransaction, type SnapTarget, type SnapResult };

/** Minimum clip duration in seconds. Below this a clip is not selectable or renderable. */
export const MIN_CLIP_DURATION = 0.05;

/** Tolerance used for every float comparison on the timeline, a tenth of a millisecond. */
const EPS = 1e-4;

export type TimelineEditErrorCode =
  | "clip-not-found"
  | "layer-not-found"
  | "layer-locked"
  | "min-duration"
  | "negative-position"
  | "media-bounds"
  | "out-of-range";

/**
 * Error thrown when an edit is rejected by the layer model rather than failing unexpectedly.
 * The editor surfaces `code` to the user instead of logging a stack trace.
 */
export class TimelineEditError extends Error {
  readonly code: TimelineEditErrorCode;

  constructor(code: TimelineEditErrorCode, message: string) {
    super(message);
    this.name = "TimelineEditError";
    this.code = code;
  }
}

export interface MediaAssetInput {
  filename: string;
  src: string;
  type: "video" | "audio" | "image";
  duration: number;
  width?: number;
  height?: number;
}

/** Round a seconds value to millisecond precision so stored positions stay comparable. */
function round3(value: number): number {
  return Number(value.toFixed(3));
}

/** Derived timeline length of a clip, always end minus start. */
export function clipDuration(clip: Clip): number {
  return clip.end - clip.start;
}

/** Timeline time at which a clip stops playing. */
export function clipEndSec(clip: Clip): number {
  return clip.position + clipDuration(clip);
}

/** Look a layer up by id, returning undefined when the film has no such layer. */
export function findLayer(film: LayeredFilm, layerId: string): Layer | undefined {
  return film.layers.find((l) => l.id === layerId);
}

/** Throw when the named layer is missing or locked, naming the edit that was refused. */
function assertLayerEditable(film: LayeredFilm, layerId: string, action: string): Layer {
  const layer = findLayer(film, layerId);
  if (!layer) {
    throw new TimelineEditError("layer-not-found", `Layer "${layerId}" not found`);
  }
  if (layer.locked) {
    throw new TimelineEditError(
      "layer-locked",
      `${action} rejected: layer "${layer.label}" is locked. Unlock the layer to edit its clips.`,
    );
  }
  return layer;
}

/** Locate a clip by id, throwing a typed rejection when it is absent. */
function requireClipIndex(film: LayeredFilm, clipId: string): number {
  const index = film.clips.findIndex((c) => c.id === clipId);
  if (index === -1) {
    throw new TimelineEditError("clip-not-found", `Clip "${clipId}" not found in film`);
  }
  return index;
}

/** Index of a clip's linked partner, or -1 when it has none or the partner is missing. */
function linkedPartnerIndex(clips: Clip[], clip: Clip): number {
  if (!clip.linkedClipId) return -1;
  return clips.findIndex((c) => c.id === clip.linkedClipId);
}

/** True when two half-open timeline intervals genuinely overlap beyond float noise. */
export function clipsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd - EPS && aEnd > bStart + EPS;
}

/**
 * Prevent two clips on the same layer from overlapping in time, using a single deterministic left
 * to right ripple sweep. Clips are visited in stored position order and each is placed at the later
 * of its own position and the end of the clip before it, so a collision only ever pushes work
 * downstream and the pass always terminates. Clips named by `anchor` are the ones the user just
 * placed, so they win ties at identical positions. Passing a single index keeps the original
 * single-clip call shape used across the engine.
 */
export function resolveLayerCollisions(clips: Clip[], anchor: number | number[]): Clip[] {
  const resolved = JSON.parse(JSON.stringify(clips)) as Clip[];
  const anchorList = (Array.isArray(anchor) ? anchor : [anchor]).filter(
    (i) => Number.isInteger(i) && i >= 0 && i < resolved.length,
  );
  if (anchorList.length === 0) return resolved;

  const anchors = new Set(anchorList);
  const touchedLayers = new Set(anchorList.map((i) => resolved[i].layerId));

  for (const layerId of touchedLayers) {
    const order = resolved
      .map((c, i) => (c.layerId === layerId ? i : -1))
      .filter((i) => i !== -1)
      .sort(
        (a, b) =>
          resolved[a].position - resolved[b].position ||
          (anchors.has(a) ? -1 : anchors.has(b) ? 1 : 0) ||
          a - b,
      );

    let cursor = 0;
    for (const index of order) {
      const clip = resolved[index];
      const dur = clipDuration(clip);
      const start = round3(Math.max(clip.position, cursor));
      clip.position = start;
      if (dur > EPS) cursor = start + dur;
    }
  }

  return resolved;
}

/**
 * Import an external media asset into a LayeredFilm (U-6 and U-10).
 * A video asset lands as TWO symmetrically linked clips (video plus its audio) so the pair can be
 * moved, trimmed, split and deleted as one unit until the user explicitly unlinks them.
 */
export function importMediaAssetToLayeredFilm(
  film: LayeredFilm,
  asset: MediaAssetInput,
  positionSec = 0,
  targetLayerId?: string,
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
  const dur = Math.max(MIN_CLIP_DURATION, round3(asset.duration));
  const pos = Math.max(0, round3(positionSec));

  /** Append a layer to the working copy and record the insert action for it. */
  const appendLayer = (layer: Layer, label: string) => {
    newLayers.push(layer);
    actions.push({
      type: "insert",
      path: ["layers", newLayers.length - 1],
      oldValue: null,
      newValue: layer,
      transactionId: txId,
      label,
      timestamp: Date.now(),
    });
  };

  /** Append a clip to the working copy and record the insert action for it. */
  const appendClip = (clip: Clip, label: string) => {
    newClips.push(clip);
    actions.push({
      type: "insert",
      path: ["clips", newClips.length - 1],
      oldValue: null,
      newValue: clip,
      transactionId: txId,
      label,
      timestamp: Date.now(),
    });
  };

  const explicitLayer = targetLayerId ? newLayers.find((l) => l.id === targetLayerId) : undefined;
  if (targetLayerId && explicitLayer?.locked) {
    throw new TimelineEditError(
      "layer-locked",
      `Import rejected: layer "${explicitLayer.label}" is locked. Unlock the layer to drop media on it.`,
    );
  }

  if (asset.type === "video") {
    let videoLayer =
      explicitLayer ?? newLayers.find((l) => l.id === "layer-video" || l.label.toLowerCase().includes("video"));
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
      appendLayer(videoLayer, "Create video layer");
    }

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
      appendLayer(audioLayer, "Create footage audio layer");
    }

    const videoClipId = `clip-video-${slug}-${generateUUID().slice(0, 4)}`;
    const audioClipId = `clip-audio-${slug}-${generateUUID().slice(0, 4)}`;

    const videoClip: Clip = {
      id: videoClipId,
      layerId: videoLayer.id,
      position: pos,
      start: 0,
      end: dur,
      sourceDuration: dur,
      kind: "video",
      payload: { src: asset.src, width: asset.width, height: asset.height },
      linkedClipId: audioClipId,
      opacity: 1,
      volume: 1,
    };

    const audioClip: Clip = {
      id: audioClipId,
      layerId: audioLayer.id,
      position: pos,
      start: 0,
      end: dur,
      sourceDuration: dur,
      kind: "audio",
      payload: { src: asset.src, channel: "external" },
      linkedClipId: videoClipId,
      opacity: 1,
      volume: 1,
    };

    appendClip(videoClip, `Import video clip ${videoClip.id}`);
    appendClip(audioClip, `Import audio clip ${audioClip.id}`);

    const videoIdx = newClips.findIndex((c) => c.id === videoClipId);
    const audioIdx = newClips.findIndex((c) => c.id === audioClipId);

    return {
      film: { ...film, layers: newLayers, clips: resolveLayerCollisions(newClips, [videoIdx, audioIdx]) },
      actions,
      transactionId: txId,
      videoClipId,
      audioClipId,
    };
  }

  if (asset.type === "audio") {
    const audioLayer =
      explicitLayer ?? newLayers.find((l) => l.number === 0 || l.id.includes("audio")) ?? newLayers[0];
    const audioClipId = `clip-audio-${slug}-${generateUUID().slice(0, 4)}`;
    const audioClip: Clip = {
      id: audioClipId,
      layerId: audioLayer.id,
      position: pos,
      start: 0,
      end: dur,
      sourceDuration: dur,
      kind: "audio",
      payload: { src: asset.src, channel: "external" },
      opacity: 1,
      volume: 1,
    };

    appendClip(audioClip, `Import audio clip ${audioClip.id}`);
    const idx = newClips.findIndex((c) => c.id === audioClipId);

    return {
      film: { ...film, layers: newLayers, clips: resolveLayerCollisions(newClips, idx) },
      actions,
      transactionId: txId,
      audioClipId,
    };
  }

  const imageLayer = explicitLayer ?? newLayers.find((l) => l.number > 0) ?? newLayers[0];
  const imageClipId = `clip-image-${slug}-${generateUUID().slice(0, 4)}`;
  const imageClip: Clip = {
    id: imageClipId,
    layerId: imageLayer.id,
    position: pos,
    start: 0,
    end: dur,
    kind: "image",
    payload: { src: asset.src, scale: 1 },
    opacity: 1,
    volume: 1,
  };

  appendClip(imageClip, `Import image clip ${imageClip.id}`);
  const imageIdx = newClips.findIndex((c) => c.id === imageClipId);

  return {
    film: { ...film, layers: newLayers, clips: resolveLayerCollisions(newClips, imageIdx) },
    actions,
    transactionId: txId,
    videoClipId: imageClipId,
  };
}

/**
 * Unlink a linked video/audio pair so they can be moved or edited independently (U-6).
 */
export function unlinkClips(
  film: LayeredFilm,
  clipId: string,
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = requireClipIndex(film, clipId);
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

  return { film: { ...film, clips: newClips }, actions, transactionId: txId };
}

/**
 * Move a clip to a new position and optionally to a new layer, carrying its linked partner.
 */
export function moveLayerClip(
  film: LayeredFilm,
  clipId: string,
  newPositionSec: number,
  targetLayerId?: string,
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = requireClipIndex(film, clipId);
  const sourceClip = film.clips[clipIndex];

  assertLayerEditable(film, sourceClip.layerId, "Move");
  if (targetLayerId && targetLayerId !== sourceClip.layerId) {
    assertLayerEditable(film, targetLayerId, "Move");
  }

  const fps = film.fps || 30;
  const clampedPos = Math.max(0, Math.round(newPositionSec * fps) / fps);
  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const targetClip = newClips[clipIndex];

  const oldPos = targetClip.position;
  const oldLayerId = targetClip.layerId;
  const nextLayerId =
    targetLayerId && film.layers.some((l) => l.id === targetLayerId) ? targetLayerId : oldLayerId;

  targetClip.position = round3(clampedPos);
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

  const anchors = [clipIndex];
  const linkedIdx = linkedPartnerIndex(newClips, targetClip);
  if (linkedIdx !== -1) {
    const linkedClip = newClips[linkedIdx];
    assertLayerEditable(film, linkedClip.layerId, "Move");
    const oldLinkedPos = linkedClip.position;
    linkedClip.position = targetClip.position;
    anchors.push(linkedIdx);
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

  return {
    film: { ...film, clips: resolveLayerCollisions(newClips, anchors) },
    actions,
    transactionId: txId,
  };
}

/**
 * Move multiple selected clips while preserving their exact relative offsets.
 * Linked partners of the selection ride along so a pair can never be torn apart by a group drag.
 */
export function moveMultipleLayerClips(
  film: LayeredFilm,
  clipIds: string[],
  deltaSec: number,
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  if (clipIds.length === 0) {
    return { film, actions: [], transactionId: generateUUID() };
  }

  const moveSet = new Set(clipIds);
  for (const id of clipIds) {
    const clip = film.clips.find((c) => c.id === id);
    if (clip?.linkedClipId) moveSet.add(clip.linkedClipId);
  }

  const targetClips = film.clips.filter((c) => moveSet.has(c.id));
  if (targetClips.length === 0) {
    return { film, actions: [], transactionId: generateUUID() };
  }

  for (const clip of targetClips) {
    assertLayerEditable(film, clip.layerId, "Move");
  }

  const fps = film.fps || 30;
  const frameDelta = Math.round(deltaSec * fps) / fps;
  const minPos = Math.min(...targetClips.map((c) => c.position));
  const effectiveDelta = Math.max(-minPos, frameDelta);

  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const txId = generateUUID();
  const actions: UpdateAction[] = [];
  const anchors: number[] = [];

  for (const clip of targetClips) {
    const idx = newClips.findIndex((c) => c.id === clip.id);
    if (idx === -1) continue;

    const oldPos = newClips[idx].position;
    const newPos = Math.max(0, round3(oldPos + effectiveDelta));
    newClips[idx].position = newPos;
    anchors.push(idx);

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

  return {
    film: { ...film, clips: resolveLayerCollisions(newClips, anchors) },
    actions,
    transactionId: txId,
  };
}

/**
 * Trim a clip's in-point (left edge) or out-point (right edge).
 * Right edge moves `end` alone; left edge moves `start` and `position` together so the frame
 * under the cursor stays put. Both edges clamp at the media bounds when the source length is
 * known, and a linked partner is trimmed identically so an A/V pair never drifts apart.
 */
export function trimLayerClipEdge(
  film: LayeredFilm,
  clipId: string,
  edge: "left" | "right",
  deltaSec: number,
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = requireClipIndex(film, clipId);
  assertLayerEditable(film, film.clips[clipIndex].layerId, "Trim");

  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const fps = film.fps || 30;
  const frameDelta = Math.round(deltaSec * fps) / fps;
  const txId = generateUUID();
  const actions: UpdateAction[] = [];
  const anchors: number[] = [clipIndex];

  const linkedIdx = linkedPartnerIndex(newClips, newClips[clipIndex]);
  if (linkedIdx !== -1) {
    assertLayerEditable(film, newClips[linkedIdx].layerId, "Trim");
    anchors.push(linkedIdx);
  }

  /** Apply the trim to one clip, validating bounds and recording its update actions. */
  const applyTrim = (index: number) => {
    const clip = newClips[index];
    const oldPos = clip.position;
    const oldStart = clip.start;
    const oldEnd = clip.end;

    if (edge === "right") {
      let proposedEnd = oldEnd + frameDelta;
      if (clip.sourceDuration !== undefined && proposedEnd > clip.sourceDuration + EPS) {
        proposedEnd = clip.sourceDuration;
      }
      if (proposedEnd - oldStart < MIN_CLIP_DURATION - EPS) {
        throw new TimelineEditError(
          "min-duration",
          `Trim rejected: clip duration cannot fall below minimum (${MIN_CLIP_DURATION}s)`,
        );
      }
      clip.end = round3(proposedEnd);
      actions.push({
        type: "update",
        path: ["clips", index, "end"],
        oldValue: oldEnd,
        newValue: clip.end,
        transactionId: txId,
        label: `Trim ${clip.id} right edge to ${clip.end.toFixed(2)}s`,
        timestamp: Date.now(),
      });
      return;
    }

    const proposedStart = oldStart + frameDelta;
    const proposedPos = oldPos + frameDelta;
    if (proposedPos < -EPS) {
      throw new TimelineEditError("negative-position", "Trim rejected: position cannot be negative");
    }
    if (proposedStart < -EPS) {
      throw new TimelineEditError(
        "media-bounds",
        `Trim rejected: in-point cannot move before the start of the source media`,
      );
    }
    if (oldEnd - proposedStart < MIN_CLIP_DURATION - EPS) {
      throw new TimelineEditError(
        "min-duration",
        `Trim rejected: clip duration cannot fall below minimum (${MIN_CLIP_DURATION}s)`,
      );
    }

    clip.start = round3(proposedStart);
    clip.position = round3(proposedPos);
    actions.push(
      {
        type: "update",
        path: ["clips", index, "start"],
        oldValue: oldStart,
        newValue: clip.start,
        transactionId: txId,
        label: `Trim ${clip.id} start to ${clip.start.toFixed(2)}s`,
        timestamp: Date.now(),
      },
      {
        type: "update",
        path: ["clips", index, "position"],
        oldValue: oldPos,
        newValue: clip.position,
        transactionId: txId,
        label: `Trim ${clip.id} position to ${clip.position.toFixed(2)}s`,
        timestamp: Date.now(),
      },
    );
  };

  applyTrim(clipIndex);
  if (linkedIdx !== -1) applyTrim(linkedIdx);

  return {
    film: { ...film, clips: resolveLayerCollisions(newClips, anchors) },
    actions,
    transactionId: txId,
  };
}

/**
 * Split a clip at an exact playhead timestamp into two distinct clips.
 * A linked partner is split at the same instant and the resulting halves are re-linked pairwise,
 * so the film never carries a link that points at a clip that no longer exists.
 */
export function splitLayerClipAtTime(
  film: LayeredFilm,
  clipId: string,
  playheadSec: number,
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = requireClipIndex(film, clipId);
  const clip = film.clips[clipIndex];
  assertLayerEditable(film, clip.layerId, "Split");

  const dur = clipDuration(clip);
  const clipEnd = clip.position + dur;
  if (playheadSec <= clip.position + EPS || playheadSec >= clipEnd - EPS) {
    throw new TimelineEditError(
      "out-of-range",
      `Playhead at ${playheadSec.toFixed(2)}s is outside clip interior [${clip.position}s..${clipEnd.toFixed(2)}s]`,
    );
  }

  const leftDur = round3(playheadSec - clip.position);
  const rightDur = round3(dur - leftDur);
  if (leftDur < MIN_CLIP_DURATION || rightDur < MIN_CLIP_DURATION) {
    throw new TimelineEditError(
      "min-duration",
      `Split rejected: resulting segment duration is under minimum ${MIN_CLIP_DURATION * 1000}ms`,
    );
  }

  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const partnerIdx = linkedPartnerIndex(newClips, newClips[clipIndex]);
  const partner = partnerIdx === -1 ? null : newClips[partnerIdx];
  const partnerSplittable =
    partner !== null &&
    playheadSec > partner.position + EPS &&
    playheadSec < partner.position + clipDuration(partner) - EPS;
  if (partner && partnerSplittable) {
    assertLayerEditable(film, partner.layerId, "Split");
  }

  const txId = generateUUID();
  const actions: UpdateAction[] = [];
  const suffix = generateUUID().slice(-4);

  /**
   * Cut one clip in two at the playhead, returning the halves with fresh unique ids.
   * An animation clip also needs a fresh shotId per half: the payload's shotId is what the Film
   * manifest keys a shot by, so cloning it would produce two shots with the same id.
   */
  const cut = (source: Clip): [Clip, Clip] => {
    const sourceLeftDur = round3(playheadSec - source.position);

    /** Build one half, re-keying the animation payload so shot ids stay unique. */
    const half = (half: "a" | "b", overrides: Partial<Clip>): Clip => {
      const clone = JSON.parse(JSON.stringify(source)) as Clip;
      const id = `${source.id}-${half}${suffix}`;
      if (clone.kind === "animation") {
        const payload = clone.payload as { shotId?: string };
        payload.shotId = `${payload.shotId ?? source.id}-${half}${suffix}`;
      }
      return { ...clone, ...overrides, id, linkedClipId: null };
    };

    const left = half("a", {
      position: source.position,
      start: source.start,
      end: round3(source.start + sourceLeftDur),
    });
    const right = half("b", {
      position: round3(playheadSec),
      start: round3(source.start + sourceLeftDur),
      end: source.end,
    });
    return [left, right];
  };

  const [leftClip, rightClip] = cut(newClips[clipIndex]);

  if (partner && partnerSplittable) {
    const [partnerLeft, partnerRight] = cut(partner);
    leftClip.linkedClipId = partnerLeft.id;
    partnerLeft.linkedClipId = leftClip.id;
    rightClip.linkedClipId = partnerRight.id;
    partnerRight.linkedClipId = rightClip.id;

    const higher = Math.max(clipIndex, partnerIdx);
    const lower = Math.min(clipIndex, partnerIdx);
    const higherPair = higher === clipIndex ? [leftClip, rightClip] : [partnerLeft, partnerRight];
    const lowerPair = lower === clipIndex ? [leftClip, rightClip] : [partnerLeft, partnerRight];

    actions.push(
      {
        type: "delete",
        path: ["clips", higher],
        oldValue: newClips[higher],
        newValue: null,
        transactionId: txId,
        label: `Split ${newClips[higher].id}`,
        timestamp: Date.now(),
      },
      {
        type: "delete",
        path: ["clips", lower],
        oldValue: newClips[lower],
        newValue: null,
        transactionId: txId,
        label: `Split ${newClips[lower].id}`,
        timestamp: Date.now(),
      },
    );

    newClips.splice(higher, 1, ...higherPair);
    newClips.splice(lower, 1, ...lowerPair);

    for (const inserted of [...lowerPair, ...higherPair]) {
      actions.push({
        type: "insert",
        path: ["clips", newClips.findIndex((c) => c.id === inserted.id)],
        oldValue: null,
        newValue: inserted,
        transactionId: txId,
        label: `Insert ${inserted.id}`,
        timestamp: Date.now(),
      });
    }
  } else {
    if (partner) {
      partner.linkedClipId = null;
      actions.push({
        type: "update",
        path: ["clips", partnerIdx, "linkedClipId"],
        oldValue: clip.id,
        newValue: null,
        transactionId: txId,
        label: `Unlink ${partner.id} because its partner was split`,
        timestamp: Date.now(),
      });
    }

    actions.push(
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
    );

    newClips.splice(clipIndex, 1, leftClip, rightClip);
  }

  return { film: { ...film, clips: newClips }, actions, transactionId: txId };
}

export interface DeleteLayerClipOptions {
  /** Delete the linked partner too. Defaults to true so an A/V pair is removed as one unit. */
  deleteLinked?: boolean;
}

/**
 * Delete a clip from the layered film, never leaving a dangling link behind.
 */
export function deleteLayerClip(
  film: LayeredFilm,
  clipId: string,
  options: DeleteLayerClipOptions = {},
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const deleteLinked = options.deleteLinked ?? true;
  const clipIndex = requireClipIndex(film, clipId);
  const deletedClip = film.clips[clipIndex];
  assertLayerEditable(film, deletedClip.layerId, "Delete");

  const partnerIndex = linkedPartnerIndex(film.clips, deletedClip);
  const removeIds = new Set<string>([clipId]);
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

  if (partnerIndex !== -1 && deleteLinked) {
    const partner = film.clips[partnerIndex];
    assertLayerEditable(film, partner.layerId, "Delete");
    removeIds.add(partner.id);
    actions.push({
      type: "delete",
      path: ["clips", partnerIndex],
      oldValue: partner,
      newValue: null,
      transactionId: txId,
      label: `Delete linked ${partner.id}`,
      timestamp: Date.now(),
    });
  }

  const newClips = (JSON.parse(JSON.stringify(film.clips)) as Clip[]).filter((c) => !removeIds.has(c.id));

  // Any surviving clip that pointed at a removed clip loses its link rather than dangling.
  for (let i = 0; i < newClips.length; i++) {
    if (newClips[i].linkedClipId && removeIds.has(newClips[i].linkedClipId as string)) {
      const oldValue = newClips[i].linkedClipId;
      newClips[i].linkedClipId = null;
      actions.push({
        type: "update",
        path: ["clips", i, "linkedClipId"],
        oldValue,
        newValue: null,
        transactionId: txId,
        label: `Unlink ${newClips[i].id} after its partner was deleted`,
        timestamp: Date.now(),
      });
    }
  }

  return { film: { ...film, clips: newClips }, actions, transactionId: txId };
}

/** Ripple trim a clip edge and shift subsequent clips on affected lanes by the duration delta. */
export function rippleTrimLayerClipEdge(
  film: LayeredFilm,
  clipId: string,
  edge: "left" | "right",
  deltaSec: number,
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = requireClipIndex(film, clipId);
  const targetClip = film.clips[clipIndex];
  assertLayerEditable(film, targetClip.layerId, "Ripple trim");

  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const fps = film.fps || 30;
  const frameDelta = Math.round(deltaSec * fps) / fps;
  const txId = generateUUID();
  const actions: UpdateAction[] = [];
  const affectedLaneIds = new Set<string>([targetClip.layerId]);

  const linkedIdx = linkedPartnerIndex(newClips, newClips[clipIndex]);
  if (linkedIdx !== -1) {
    assertLayerEditable(film, newClips[linkedIdx].layerId, "Ripple trim");
    affectedLaneIds.add(newClips[linkedIdx].layerId);
  }

  const origOldDur = targetClip.end - targetClip.start;
  const origPos = targetClip.position;
  let durationDelta = 0;

  // Applies the trim edge adjustment and in/out points to a single target clip.
  const applyTrim = (index: number) => {
    const clip = newClips[index];
    const oldStart = clip.start;
    const oldEnd = clip.end;
    const oldDur = oldEnd - oldStart;

    if (edge === "right") {
      let proposedEnd = oldEnd + frameDelta;
      if (clip.sourceDuration !== undefined && proposedEnd > clip.sourceDuration + EPS) {
        proposedEnd = clip.sourceDuration;
      }
      if (proposedEnd - oldStart < MIN_CLIP_DURATION - EPS) {
        throw new TimelineEditError(
          "min-duration",
          `Trim rejected: clip duration cannot fall below minimum (${MIN_CLIP_DURATION}s)`,
        );
      }
      clip.end = round3(proposedEnd);
      durationDelta = round3(clip.end - oldStart - oldDur);
      actions.push({
        type: "update",
        path: ["clips", index, "end"],
        oldValue: oldEnd,
        newValue: clip.end,
        transactionId: txId,
        label: `Ripple trim ${clip.id} right edge to ${clip.end.toFixed(2)}s`,
        timestamp: Date.now(),
      });
      return;
    }

    const proposedStart = oldStart + frameDelta;
    if (proposedStart < -EPS) {
      throw new TimelineEditError(
        "media-bounds",
        "Trim rejected: in-point cannot move before the start of the source media",
      );
    }
    if (oldEnd - proposedStart < MIN_CLIP_DURATION - EPS) {
      throw new TimelineEditError(
        "min-duration",
        `Trim rejected: clip duration cannot fall below minimum (${MIN_CLIP_DURATION}s)`,
      );
    }

    clip.start = round3(proposedStart);
    durationDelta = round3(oldEnd - clip.start - oldDur);
    actions.push({
      type: "update",
      path: ["clips", index, "start"],
      oldValue: oldStart,
      newValue: clip.start,
      transactionId: txId,
      label: `Ripple trim ${clip.id} start to ${clip.start.toFixed(2)}s`,
      timestamp: Date.now(),
    });
  };

  applyTrim(clipIndex);
  if (linkedIdx !== -1) applyTrim(linkedIdx);

  // Ripple shift all subsequent clips on affected lanes by durationDelta
  const anchorIndices = new Set<number>([clipIndex]);
  if (linkedIdx !== -1) anchorIndices.add(linkedIdx);

  for (let i = 0; i < newClips.length; i++) {
    if (anchorIndices.has(i)) continue;
    const clip = newClips[i];
    if (affectedLaneIds.has(clip.layerId) && clip.position >= origPos + origOldDur - EPS) {
      const oldPos = clip.position;
      clip.position = Math.max(0, round3(clip.position + durationDelta));
      actions.push({
        type: "update",
        path: ["clips", i, "position"],
        oldValue: oldPos,
        newValue: clip.position,
        transactionId: txId,
        label: `Ripple shift ${clip.id} by ${durationDelta > 0 ? "+" : ""}${durationDelta.toFixed(2)}s`,
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

/** Ripple delete a clip and its linked partner, shifting downstream clips leftward to close the gap. */
export function rippleDeleteLayerClip(
  film: LayeredFilm,
  clipId: string,
  options: DeleteLayerClipOptions = {},
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const deleteLinked = options.deleteLinked ?? true;
  const clipIndex = requireClipIndex(film, clipId);
  const deletedClip = film.clips[clipIndex];
  assertLayerEditable(film, deletedClip.layerId, "Ripple delete");

  const partnerIndex = linkedPartnerIndex(film.clips, deletedClip);
  const removeIds = new Set<string>([clipId]);
  if (deleteLinked && partnerIndex !== -1) {
    assertLayerEditable(film, film.clips[partnerIndex].layerId, "Ripple delete");
    removeIds.add(film.clips[partnerIndex].id);
  }

  const deletedDur = clipDuration(deletedClip);
  const deletedPos = deletedClip.position;
  const affectedLaneIds = new Set<string>([deletedClip.layerId]);
  if (deleteLinked && partnerIndex !== -1) {
    affectedLaneIds.add(film.clips[partnerIndex].layerId);
  }

  const txId = generateUUID();
  const actions: UpdateAction[] = [];

  for (const id of removeIds) {
    const idx = film.clips.findIndex((c) => c.id === id);
    if (idx !== -1) {
      actions.push({
        type: "delete",
        path: ["clips", idx],
        oldValue: film.clips[idx],
        newValue: null,
        transactionId: txId,
        label: `Ripple delete ${id}`,
        timestamp: Date.now(),
      });
    }
  }

  const newClips: Clip[] = [];
  for (let i = 0; i < film.clips.length; i++) {
    const clip = film.clips[i];
    if (removeIds.has(clip.id)) continue;
    const cloned = JSON.parse(JSON.stringify(clip)) as Clip;
    if (cloned.linkedClipId && removeIds.has(cloned.linkedClipId)) {
      cloned.linkedClipId = null;
    }

    // Shift subsequent clips on affected lanes
    if (affectedLaneIds.has(cloned.layerId) && cloned.position >= deletedPos + deletedDur - EPS) {
      const oldPos = cloned.position;
      cloned.position = Math.max(0, round3(cloned.position - deletedDur));
      actions.push({
        type: "update",
        path: ["clips", newClips.length, "position"],
        oldValue: oldPos,
        newValue: cloned.position,
        transactionId: txId,
        label: `Ripple shift ${cloned.id} left by ${deletedDur.toFixed(2)}s`,
        timestamp: Date.now(),
      });
    }

    newClips.push(cloned);
  }

  return { film: { ...film, clips: newClips }, actions, transactionId: txId };
}

