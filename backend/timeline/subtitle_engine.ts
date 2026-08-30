/**
 * File Description: Subtitles-as-Clips Engine for Aideos Timeline (Phase L-5).
 * Implements interactive subtitle cue operations:
 * - Retiming individual caption cues along the subtitle layer.
 * - Splitting and merging adjacent caption cues.
 * - In-place subtitle text editing with atomic UpdateAction undo tracking.
 * - Continuous speech coverage validation (eliminates O-2 sparse gap defect).
 */

import type { LayeredFilm, Clip } from "../../src/dl/layeredSchema";
import {
  type UpdateAction,
  generateUUID,
} from "./updates";

/**
 * Retime a single subtitle clip to a new start position.
 */
export function retimeSubtitleClip(
  film: LayeredFilm,
  clipId: string,
  newPositionSec: number
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = film.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) {
    throw new Error(`Subtitle clip "${clipId}" not found in film`);
  }

  const fps = film.fps || 30;
  const clampedPos = Math.max(0, Math.round(newPositionSec * fps) / fps);
  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const clip = newClips[clipIndex];

  if (clip.kind !== "subtitle") {
    throw new Error(`Clip "${clipId}" is of kind "${clip.kind}", not subtitle`);
  }

  const oldPos = clip.position;
  clip.position = Number(clampedPos.toFixed(3));

  // Also update startFrame/endFrame in payload if present
  if ((clip.payload as any)?.startFrame !== undefined) {
    const durFrames = ((clip.payload as any).endFrame ?? 0) - ((clip.payload as any).startFrame ?? 0);
    const newStartFrame = Math.round(clip.position * fps);
    (clip.payload as any).startFrame = newStartFrame;
    (clip.payload as any).endFrame = newStartFrame + durFrames;
  }

  const txId = generateUUID();
  const actions: UpdateAction[] = [
    {
      type: "update",
      path: ["clips", clipIndex, "position"],
      oldValue: oldPos,
      newValue: clip.position,
      transactionId: txId,
      label: `Retime subtitle ${clip.id} to ${clip.position.toFixed(2)}s`,
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
 * Split a subtitle cue into two separate cues covering the original range.
 */
export function splitSubtitleClip(
  film: LayeredFilm,
  clipId: string,
  splitPointSec: number,
  leftText?: string,
  rightText?: string
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = film.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) {
    throw new Error(`Subtitle clip "${clipId}" not found`);
  }

  const clip = film.clips[clipIndex];
  if (clip.kind !== "subtitle") {
    throw new Error(`Clip "${clipId}" is not a subtitle`);
  }

  const dur = clip.end - clip.start;
  const clipEnd = clip.position + dur;

  if (splitPointSec <= clip.position || splitPointSec >= clipEnd) {
    throw new Error(`Split point ${splitPointSec.toFixed(2)}s is outside subtitle range [${clip.position}s..${clipEnd.toFixed(2)}s]`);
  }

  const splitOffset = splitPointSec - clip.position;
  const leftDur = Number(splitOffset.toFixed(3));
  const rightDur = Number((dur - splitOffset).toFixed(3));

  const fullText = (clip.payload as any).text || "";
  const words = fullText.split(/\s+/).filter(Boolean);
  const midWordIdx = Math.max(1, Math.floor(words.length / 2));

  const text1 = leftText ?? (words.slice(0, midWordIdx).join(" ") || fullText);
  const text2 = rightText ?? (words.slice(midWordIdx).join(" ") || "...");

  const leftClip: Clip = {
    id: `${clip.id}-a`,
    layerId: clip.layerId,
    position: clip.position,
    start: 0,
    end: leftDur,
    kind: "subtitle",
    payload: {
      text: text1,
    },
    opacity: 1,
    volume: 1,
  };

  const rightClip: Clip = {
    id: `${clip.id}-b`,
    layerId: clip.layerId,
    position: Number(splitPointSec.toFixed(3)),
    start: 0,
    end: rightDur,
    kind: "subtitle",
    payload: {
      text: text2,
    },
    opacity: 1,
    volume: 1,
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
      label: `Split subtitle ${clip.id}`,
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
 * Merge two adjacent subtitle cues into a single continuous cue.
 */
export function mergeSubtitleClips(
  film: LayeredFilm,
  firstClipId: string,
  secondClipId: string
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const idx1 = film.clips.findIndex((c) => c.id === firstClipId);
  const idx2 = film.clips.findIndex((c) => c.id === secondClipId);

  if (idx1 === -1 || idx2 === -1) {
    throw new Error(`One or both subtitle clips not found ("${firstClipId}", "${secondClipId}")`);
  }

  const c1 = film.clips[idx1];
  const c2 = film.clips[idx2];
  const c2Dur = c2.end - c2.start;
  const mergedEnd = (c2.position + c2Dur) - c1.position;

  const text1 = (c1.payload as any).text || "";
  const text2 = (c2.payload as any).text || "";
  const mergedText = `${text1} ${text2}`.trim();

  const mergedClip: Clip = {
    id: `${c1.id}-merged`,
    layerId: c1.layerId,
    position: c1.position,
    start: 0,
    end: Number(mergedEnd.toFixed(3)),
    kind: "subtitle",
    payload: {
      text: mergedText,
    },
    opacity: 1,
    volume: 1,
  };

  const newClips = film.clips.filter((c) => c.id !== firstClipId && c.id !== secondClipId);
  newClips.splice(Math.min(idx1, idx2), 0, mergedClip);

  const txId = generateUUID();
  const actions: UpdateAction[] = [
    {
      type: "delete",
      path: ["clips", idx1],
      oldValue: c1,
      newValue: null,
      transactionId: txId,
      label: `Delete ${c1.id}`,
      timestamp: Date.now(),
    },
    {
      type: "delete",
      path: ["clips", idx2],
      oldValue: c2,
      newValue: null,
      transactionId: txId,
      label: `Delete ${c2.id}`,
      timestamp: Date.now(),
    },
    {
      type: "insert",
      path: ["clips", Math.min(idx1, idx2)],
      oldValue: null,
      newValue: mergedClip,
      transactionId: txId,
      label: `Merge into ${mergedClip.id}`,
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
 * Edit a subtitle cue's text in place.
 */
export function editSubtitleText(
  film: LayeredFilm,
  clipId: string,
  newText: string
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const clipIndex = film.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) {
    throw new Error(`Subtitle clip "${clipId}" not found`);
  }

  const newClips = JSON.parse(JSON.stringify(film.clips)) as Clip[];
  const clip = newClips[clipIndex];
  const oldText = (clip.payload as any).text;

  (clip.payload as any).text = newText;

  const txId = generateUUID();
  const actions: UpdateAction[] = [
    {
      type: "update",
      path: ["clips", clipIndex, "payload", "text"],
      oldValue: oldText,
      newValue: newText,
      transactionId: txId,
      label: `Edit subtitle ${clip.id} text`,
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
 * Validate that every speech timestamp in the voiceover has corresponding subtitle coverage (L5-1).
 */
export function validateSubtitleContinuousCoverage(
  film: LayeredFilm,
  speechIntervals: Array<{ startSec: number; endSec: number }>,
  toleranceSec = 0.5
): boolean {
  const subClips = film.clips.filter((c) => c.kind === "subtitle");

  for (const interval of speechIntervals) {
    // Check if there is at least one subtitle clip covering this interval
    const hasCoverage = subClips.some((c) => {
      const cEnd = c.position + (c.end - c.start);
      return c.position <= interval.startSec + toleranceSec && cEnd >= interval.endSec - toleranceSec;
    });

    if (!hasCoverage) {
      throw new Error(
        `L5-1 Coverage violation: speech interval [${interval.startSec.toFixed(2)}s..${interval.endSec.toFixed(2)}s] has no corresponding subtitle cue`
      );
    }
  }

  return true;
}
