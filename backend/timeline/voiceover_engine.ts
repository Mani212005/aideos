/**
 * File Description: Voiceover Editing & Close-Gap Dependency Shift Engine (Phase L-4).
 * Implements OpenShot-grade audio clip manipulations:
 * - Splitting and trimming voiceover audio clips.
 * - Deleting audio sections leaving silent gaps (U-8).
 * - Close-Gap action that ripples following audio clips AND shifts dependent visual/subtitle clips (U-9).
 * - Audio drift calculation between voiceover source duration and timeline duration.
 * This module stays free of Node-only imports so the editor bundle can use it in the browser;
 * PCM waveform extraction lives in ./waveform.ts because it shells out to ffmpeg.
 */

import type { LayeredFilm, Clip } from "../../src/dl/layeredSchema";
import {
  type UpdateAction,
  generateUUID,
} from "./updates";
import { resolveLayerCollisions } from "./layer_engine";

export interface SyncDriftReport {
  totalTimelineDurationSec: number;
  totalAudioDurationSec: number;
  driftSec: number;
  isSynchronized: boolean;
  statusLabel: string;
}

/**
 * Split an audio clip at an exact playhead timestamp.
 */
export function splitAudioClip(
  film: LayeredFilm,
  clipId: string,
  playheadSec: number
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = film.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) {
    throw new Error(`Audio clip "${clipId}" not found in film`);
  }

  const clip = film.clips[clipIndex];
  if (clip.kind !== "audio") {
    throw new Error(`Clip "${clipId}" is of kind "${clip.kind}", not audio`);
  }

  const clipDur = clip.end - clip.start;
  const clipEndPos = clip.position + clipDur;

  if (playheadSec <= clip.position || playheadSec >= clipEndPos) {
    throw new Error(`Playhead at ${playheadSec.toFixed(2)}s is outside clip range [${clip.position}s..${clipEndPos.toFixed(2)}s]`);
  }

  const splitOffset = playheadSec - clip.position;
  const leftDur = Number(splitOffset.toFixed(3));

  const leftClip: Clip = {
    ...JSON.parse(JSON.stringify(clip)),
    id: `${clip.id}-part1`,
    position: clip.position,
    start: clip.start,
    end: Number((clip.start + leftDur).toFixed(3)),
  };

  const rightClip: Clip = {
    ...JSON.parse(JSON.stringify(clip)),
    id: `${clip.id}-part2`,
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
      label: `Split audio ${clip.id}`,
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
 * Delete a voiceover section leaving a silent gap (U-8).
 * Subsequent clips remain at their exact stored positions.
 */
export function deleteAudioSection(
  film: LayeredFilm,
  clipId: string
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = film.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) {
    throw new Error(`Clip "${clipId}" not found`);
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
      label: `Delete audio clip ${clipId} (leaves gap)`,
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
 * Close an audio gap at gapStartSec of length gapLengthSec (U-9).
 * Shifts all following audio clips left by gapLengthSec AND shifts all dependent
 * animation, text, and subtitle clips positioned after gapStartSec left by the same amount.
 */
export function closeAudioGapWithDependencies(
  film: LayeredFilm,
  gapStartSec: number,
  gapLengthSec: number
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  if (gapLengthSec <= 0) {
    return { film, actions: [], transactionId: generateUUID() };
  }

  const gapEndSec = gapStartSec + gapLengthSec;
  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const txId = generateUUID();
  const actions: UpdateAction[] = [];

  for (let i = 0; i < newClips.length; i++) {
    const clip = newClips[i];
    const clipStart = clip.position;
    const clipDur = clip.end - clip.start;
    const clipEnd = clipStart + clipDur;

    // Case 1: Clip ends before the gap -> untouched
    if (clipEnd <= gapStartSec + 0.001) {
      continue;
    }

    // Case 2: Clip starts at or after gapStartSec -> shift left by gapLengthSec or snap to gapStartSec
    if (clipStart >= gapStartSec - 0.001) {
      const oldPos = clip.position;
      // If clip started inside the gap (between gapStart and gapEnd), it lands at gapStartSec
      // If clip started after the gap (>= gapEnd), it shifts left by gapLengthSec
      const newPos = clipStart < gapEndSec
        ? Number(gapStartSec.toFixed(3))
        : Number(Math.max(gapStartSec, oldPos - gapLengthSec).toFixed(3));

      clip.position = newPos;

      actions.push({
        type: "update",
        path: ["clips", i, "position"],
        oldValue: oldPos,
        newValue: newPos,
        transactionId: txId,
        label: `Shift ${clip.id} left to close gap`,
        timestamp: Date.now(),
      });
      continue;
    }

    // Case 3: Clip straddles across the gap -> trim its out-point to end at gap boundary
    const trimmedDur = Number((gapStartSec - clipStart).toFixed(3));
    if (trimmedDur > 0) {
      const oldEnd = clip.end;
      clip.end = Number((clip.start + trimmedDur).toFixed(3));
      actions.push({
        type: "update",
        path: ["clips", i, "end"],
        oldValue: oldEnd,
        newValue: clip.end,
        transactionId: txId,
        label: `Trim ${clip.id} to end at gap boundary ${gapStartSec.toFixed(2)}s`,
        timestamp: Date.now(),
      });
    }
  }

  // Resolve collisions once across every layer. The earliest clip on each layer anchors the pass
  // and everything after it ripples downstream, which is a single linear sweep per layer.
  const anchors: number[] = [];
  for (const layer of film.layers) {
    let earliest = -1;
    for (let i = 0; i < newClips.length; i++) {
      if (newClips[i].layerId !== layer.id) continue;
      if (earliest === -1 || newClips[i].position < newClips[earliest].position) earliest = i;
    }
    if (earliest !== -1) anchors.push(earliest);
  }

  const resolved = resolveLayerCollisions(newClips, anchors);
  for (let k = 0; k < newClips.length; k++) {
    if (newClips[k].position === resolved[k].position) continue;
    const oldP = newClips[k].position;
    newClips[k].position = resolved[k].position;
    const existingAction = actions.find(
      (a) => a.path[0] === "clips" && a.path[1] === k && a.path[2] === "position",
    );
    if (existingAction) {
      existingAction.newValue = newClips[k].position;
    } else {
      actions.push({
        type: "update",
        path: ["clips", k, "position"],
        oldValue: oldP,
        newValue: newClips[k].position,
        transactionId: txId,
        label: `Shift ${newClips[k].id} to resolve collision`,
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
 * Compute real-time narration drift between the narration track and the visual timeline length.
 * Only voiceover-channel audio counts: music and sound effects are free to run past or stop short
 * of the visuals, so including them reported drift on perfectly synchronised films.
 */
export function calculateSyncDrift(film: LayeredFilm): SyncDriftReport {
  let maxVisualEnd = 0;
  let totalAudioDur = 0;

  for (const clip of film.clips) {
    const dur = clip.end - clip.start;
    const clipEnd = clip.position + dur;

    if (clip.kind === "animation" || clip.kind === "video" || clip.kind === "text") {
      maxVisualEnd = Math.max(maxVisualEnd, clipEnd);
    }
    if (clip.kind === "audio") {
      const channel = (clip.payload as { channel?: string })?.channel ?? "voiceover";
      if (channel === "voiceover") totalAudioDur += dur;
    }
  }

  const driftSec = Number((maxVisualEnd - totalAudioDur).toFixed(3));
  const isSynchronized = Math.abs(driftSec) <= 0.05;

  const statusLabel = isSynchronized
    ? "In sync (within 0.05s)"
    : `Drifted ${driftSec > 0 ? "+" : ""}${driftSec.toFixed(1)}s`;

  return {
    totalTimelineDurationSec: maxVisualEnd,
    totalAudioDurationSec: totalAudioDur,
    driftSec,
    isSynchronized,
    statusLabel,
  };
}
