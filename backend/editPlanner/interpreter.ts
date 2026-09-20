/**
 * File Description: Pure Transactional Interpreter for Video Edit Programs (Phase 2).
 * Interprets closed EditOp programs by dispatching to timeline, voiceover, and layer engines.
 * Implements atomic execution with full rollback on validation or runtime failure,
 * adhering to Axiom 1 (pure data) and the single-commit undo contract.
 */

import type { LayeredFilm, Clip, Layer } from "../../src/dl/layeredSchema";
import type { EditContext } from "../editContext/buildEditContext";
import type { EditOp } from "./schema";
import { CONVERTED_LAYER_IDS } from "../../src/dl/convertFilm";
import {
  clipDuration,
  moveLayerClip,
  splitLayerClipAtTime,
} from "../timeline/layer_engine";
import {
  setLayerProperty,
} from "../timeline/layer_manager";
import { closeAudioGapWithDependencies } from "../timeline/voiceover_engine";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";

export interface EditProgramResult {
  film: LayeredFilm;
  applied: EditOp[];
  rejected: Array<{ op: EditOp; reason: string }>;
  warnings: string[];
}

/** Round to millisecond precision to prevent floating point inaccuracies. */
function round3(val: number): number {
  return Number(val.toFixed(3));
}

/** Generates a short random ID suffix. */
function shortId(): string {
  return Math.random().toString(36).slice(2, 7);
}

/**
 * Ensures a specific layer exists in the film, creating it if absent.
 */
function ensureLayerExists(
  film: LayeredFilm,
  layerId: string,
  defaultLabel: string,
  defaultNumber: number,
): LayeredFilm {
  if (film.layers.some((l) => l.id === layerId)) {
    return film;
  }
  const existingNumbers = new Set(film.layers.map((l) => l.number));
  let num = defaultNumber;
  while (existingNumbers.has(num) && num < 100) num++;
  while (existingNumbers.has(num) && num > 0) num--;

  const newLayer: Layer = {
    id: layerId,
    label: defaultLabel,
    number: num,
    locked: false,
    hidden: false,
    muted: false,
    height: 48,
  };
  return {
    ...film,
    layers: [...film.layers, newLayer],
  };
}

/**
 * Splits any clip crossing a timestamp into two parts at that timestamp.
 */
function splitAllClipsCrossingTime(film: LayeredFilm, atSec: number): LayeredFilm {
  let current = film;
  const eps = 0.005;
  // Repeat check until no clips cross the cut boundary
  let foundCrosser = true;
  while (foundCrosser) {
    foundCrosser = false;
    for (const clip of current.clips) {
      const dur = clipDuration(clip);
      const end = clip.position + dur;
      if (atSec > clip.position + eps && atSec < end - eps) {
        try {
          const splitResult = splitLayerClipAtTime(current, clip.id, atSec);
          current = splitResult.film;
          foundCrosser = true;
          break; // Break and restart scan with new clips list
        } catch {
          // If split is rejected (e.g. min duration), continue with next clip
          continue;
        }
      }
    }
  }
  return current;
}

/**
 * Cuts a time span [cutStart, cutEnd] across all active base clips and shifts all downstream clips left.
 */
function cutAndRippleSpan(film: LayeredFilm, cutStart: number, cutEnd: number): LayeredFilm {
  const gap = round3(cutEnd - cutStart);
  if (gap <= 0.005) return film;

  // 1. Split clips crossing start and end boundaries
  let working = splitAllClipsCrossingTime(film, cutStart);
  working = splitAllClipsCrossingTime(working, cutEnd);

  // 2. Remove clips that are entirely within the cut window [cutStart, cutEnd]
  const eps = 0.005;
  const filteredClips: Clip[] = [];
  const removedIds = new Set<string>();

  for (const clip of working.clips) {
    const dur = clipDuration(clip);
    const end = clip.position + dur;
    const isInsideCut = clip.position >= cutStart - eps && end <= cutEnd + eps;
    if (isInsideCut) {
      removedIds.add(clip.id);
    } else {
      filteredClips.push(clip);
    }
  }

  // Clear broken link references
  for (const clip of filteredClips) {
    if (clip.linkedClipId && removedIds.has(clip.linkedClipId)) {
      clip.linkedClipId = null;
    }
  }

  working = { ...working, clips: filteredClips };

  // 3. Close the gap and shift all subsequent clips left across all lanes
  const closed = closeAudioGapWithDependencies(working, cutStart, gap);
  return closed.film;
}

/**
 * Applies a single EditOp to a working copy of LayeredFilm.
 */
function applySingleOp(
  film: LayeredFilm,
  op: EditOp,
  context?: EditContext,
): { film: LayeredFilm; warnings: string[] } {
  const warnings: string[] = [];
  let working = film;

  switch (op.op) {
    case "add_text_overlay": {
      const dur = round3(op.endSec - op.startSec);
      if (dur <= 0) throw new Error(`Invalid text overlay duration: start=${op.startSec}, end=${op.endSec}`);
      const layerId = op.laneHint || CONVERTED_LAYER_IDS.text;
      working = ensureLayerExists(working, layerId, "Text Overlays", 30);

      const clipId = `clip-text-${Date.now().toString(36)}-${shortId()}`;
      const newClip: Clip = {
        id: clipId,
        layerId,
        position: round3(op.startSec),
        start: 0,
        end: dur,
        kind: "text",
        payload: {
          text: op.text,
          size: (op.size || "headline") as "headline" | "body" | "kicker" | "caption",
          accentWord: op.accentWord,
        },
        opacity: 1,
        volume: 1,
      };

      working = {
        ...working,
        clips: [...working.clips, newClip],
      };
      break;
    }

    case "add_slide": {
      const dur = round3(op.endSec - op.startSec);
      if (dur <= 0) throw new Error(`Invalid slide duration: start=${op.startSec}, end=${op.endSec}`);
      const layerId = "layer-slide-overlay";
      working = ensureLayerExists(working, layerId, "Slide Overlays", 12);

      const clipId = `clip-slide-${Date.now().toString(36)}-${shortId()}`;
      const newClip: Clip = {
        id: clipId,
        layerId,
        position: round3(op.startSec),
        start: 0,
        end: dur,
        kind: "animation",
        payload: {
          shotId: `shot-slide-${shortId()}`,
          stage: "anchor",
          look: "n1",
          move: "cut",
          drift: false,
          zoom: 1,
          visualDirection: op.visualDirection || "Slide graphic",
          blocks: [],
          ...(op.sceneSpec ? { sceneSpec: op.sceneSpec } : {}),
        } as any,
        opacity: 1,
        volume: 1,
      };

      working = {
        ...working,
        clips: [...working.clips, newClip],
      };
      break;
    }

    case "add_caption_track": {
      const layerId = CONVERTED_LAYER_IDS.subtitles;
      working = ensureLayerExists(working, layerId, "Subtitles", 20);

      if (context && context.transcript && context.transcript.length > 0) {
        const fromSec = op.fromSec ?? 0;
        const toSec = op.toSec ?? Infinity;
        const relevantWords = context.transcript.filter(
          (w) => w.start >= fromSec - 0.01 && w.end <= toSec + 0.01,
        );

        const newSubtitleClips: Clip[] = relevantWords.map((w, i) => {
          const cueDur = Math.max(0.05, round3(w.end - w.start));
          return {
            id: `clip-sub-ai-${i}-${shortId()}`,
            layerId,
            position: round3(w.start),
            start: 0,
            end: cueDur,
            kind: "subtitle",
            payload: {
              text: w.punctuated_word || w.word,
              startFrame: Math.round(w.start * (working.fps || 30)),
              endFrame: Math.round(w.end * (working.fps || 30)),
            },
            opacity: 1,
            volume: 1,
          };
        });

        // Filter out existing subtitles in the target range to avoid overlaps
        const nonConflictingClips = working.clips.filter(
          (c) => c.layerId !== layerId || c.position < fromSec - 0.005 || c.position > toSec + 0.005,
        );

        working = {
          ...working,
          clips: [...nonConflictingClips, ...newSubtitleClips],
        };
      } else {
        warnings.push("add_caption_track: no transcript available in context to generate subtitles");
      }
      break;
    }

    case "remove_fillers": {
      let candidateSpans = context?.fillers || [];

      // Filter by confidence threshold if specified
      if (op.confidenceMin !== undefined) {
        candidateSpans = candidateSpans.filter((s) => {
          const words = context?.transcript.slice(s.startIndex, s.endIndex + 1) || [];
          return words.every((w) => (w.confidence ?? 1) <= (op.confidenceMin ?? 1));
        });
      }

      // Filter by scope
      if (op.scope && typeof op.scope === "object" && !Array.isArray(op.scope)) {
        const { fromSec, toSec } = op.scope;
        candidateSpans = candidateSpans.filter(
          (s) => s.start >= fromSec - 0.01 && s.end <= toSec + 0.01,
        );
      } else if (Array.isArray(op.scope)) {
        const allowed = new Set(op.scope.map((w) => w.toLowerCase()));
        candidateSpans = candidateSpans.filter((s) => allowed.has(s.text.toLowerCase()));
      }

      if (candidateSpans.length === 0) {
        warnings.push("remove_fillers: no matching filler spans found to remove");
        break;
      }

      // Process spans from right to left (descending order of start time)
      const sortedSpans = [...candidateSpans].sort((a, b) => b.start - a.start);
      for (const span of sortedSpans) {
        working = cutAndRippleSpan(working, span.start, span.end);
      }
      break;
    }

    case "remove_dead_air": {
      const minSilence = op.minSilenceSec ?? 0.6;
      const targetGap = op.targetGapSec ?? 0.1;
      let candidateSilences = context?.silences || [];

      // Filter by range if specified
      if (op.range) {
        const { fromSec, toSec } = op.range;
        candidateSilences = candidateSilences.filter(
          (s) => s.start >= fromSec - 0.01 && s.end <= toSec + 0.01,
        );
      }

      // Filter by minSilence duration
      candidateSilences = candidateSilences.filter((s) => s.end - s.start >= minSilence);

      if (candidateSilences.length === 0) {
        warnings.push("remove_dead_air: no qualifying silence windows found");
        break;
      }

      // Process windows from right to left
      const sortedWindows = [...candidateSilences].sort((a, b) => b.start - a.start);
      for (const win of sortedWindows) {
        const winDur = win.end - win.start;
        if (winDur > targetGap) {
          const cutStart = round3(win.start + targetGap);
          const cutEnd = round3(win.end);
          if (cutEnd > cutStart + 0.005) {
            working = cutAndRippleSpan(working, cutStart, cutEnd);
          }
        }
      }
      break;
    }

    case "trim_range": {
      if (op.toSec <= op.fromSec) {
        throw new Error(`Invalid trim_range: fromSec=${op.fromSec} >= toSec=${op.toSec}`);
      }
      working = cutAndRippleSpan(working, op.fromSec, op.toSec);
      break;
    }

    case "split_at": {
      if (op.clipId) {
        working = splitLayerClipAtTime(working, op.clipId, op.atSec).film;
      } else {
        working = splitAllClipsCrossingTime(working, op.atSec);
      }
      break;
    }

    case "move_clip": {
      working = moveLayerClip(working, op.clipId, op.toSec, op.laneHint).film;
      break;
    }

    case "set_clip_speed": {
      if (op.clipId === "base") {
        const baseLayerIds: Set<string> = new Set<string>([
          CONVERTED_LAYER_IDS.video,
          CONVERTED_LAYER_IDS.footage,
          CONVERTED_LAYER_IDS.voiceover,
        ]);
        const updatedClips: Clip[] = working.clips.map((c) => {
          if (baseLayerIds.has(c.layerId)) {
            const currentDur = c.end - c.start;
            const newEnd = round3(c.start + currentDur / op.factor);
            return {
              ...c,
              end: newEnd,
              payload: {
                ...(c.payload as Record<string, unknown>),
                speed: op.factor,
              } as any,
            };
          }
          return c;
        });
        working = { ...working, clips: updatedClips };
      } else {
        const clipIdx = working.clips.findIndex((c) => c.id === op.clipId);
        if (clipIdx === -1) throw new Error(`Clip "${op.clipId}" not found for set_clip_speed`);
        const target = working.clips[clipIdx];
        const currentDur = target.end - target.start;
        const newEnd = round3(target.start + currentDur / op.factor);
        const updatedClips: Clip[] = [...working.clips];
        updatedClips[clipIdx] = {
          ...target,
          end: newEnd,
          payload: {
            ...(target.payload as Record<string, unknown>),
            speed: op.factor,
          } as any,
        };
        working = { ...working, clips: updatedClips };
      }
      break;
    }

    case "set_volume": {
      const vol = Math.max(0, Math.min(1, op.volume));
      if (op.clipId) {
        const clipIdx = working.clips.findIndex((c) => c.id === op.clipId);
        if (clipIdx === -1) throw new Error(`Clip "${op.clipId}" not found for set_volume`);
        const updatedClips = [...working.clips];
        updatedClips[clipIdx] = { ...working.clips[clipIdx], volume: vol };
        working = { ...working, clips: updatedClips };
      } else if (op.laneId) {
        const updatedClips = working.clips.map((c) =>
          c.layerId === op.laneId ? { ...c, volume: vol } : c,
        );
        working = { ...working, clips: updatedClips };
      } else {
        throw new Error("set_volume requires either clipId or laneId");
      }
      break;
    }

    case "mute_lane": {
      working = setLayerProperty(working, op.laneId, { muted: op.muted ?? true }).film;
      break;
    }

    case "hide_lane": {
      working = setLayerProperty(working, op.laneId, { hidden: op.hidden ?? true }).film;
      break;
    }

    case "set_accent": {
      working = { ...working, accent: op.hex };
      break;
    }

    case "set_theme": {
      working = {
        ...working,
        theme: {
          ...(working.theme || {}),
          ...(op.partialTheme as any),
        },
      };
      break;
    }

    case "reorder_segments": {
      const segmentClips = op.order
        .map((id) => working.clips.find((c) => c.id === id))
        .filter((c): c is Clip => c !== undefined);

      if (segmentClips.length !== op.order.length) {
        throw new Error("One or more clip IDs in reorder_segments order list were not found");
      }

      // Anchor start time at the earliest clip's position
      let cursor = Math.min(...segmentClips.map((c) => c.position));
      const newClips = [...working.clips];

      for (const clip of segmentClips) {
        const idx = newClips.findIndex((c) => c.id === clip.id);
        const dur = clipDuration(clip);
        newClips[idx] = {
          ...clip,
          position: round3(cursor),
        };
        cursor += dur;
      }

      working = { ...working, clips: newClips };
      break;
    }

    default: {
      throw new Error(`Unknown operation: ${(op as any).op}`);
    }
  }

  return { film: working, warnings };
}

/**
 * Applies an entire edit program to a LayeredFilm atomically with rollback.
 * If any op fails or if the resulting film fails validation, rolls back to the initial state.
 */
export function applyEditProgram(
  film: LayeredFilm,
  ops: EditOp[],
  context?: EditContext,
): EditProgramResult {
  const originalFilm: LayeredFilm = JSON.parse(JSON.stringify(film));
  let workingFilm: LayeredFilm = JSON.parse(JSON.stringify(film));
  const applied: EditOp[] = [];
  const rejected: Array<{ op: EditOp; reason: string }> = [];
  const warnings: string[] = [];

  for (const op of ops) {
    try {
      const result = applySingleOp(workingFilm, op, context);
      workingFilm = result.film;
      applied.push(op);
      warnings.push(...result.warnings);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      rejected.push({ op, reason: errorMsg });

      // Rollback transaction immediately on single op failure
      return {
        film: originalFilm,
        applied: [],
        rejected: [
          ...rejected,
          ...applied.map((a) => ({
            op: a,
            reason: `Transaction rolled back due to error in "${op.op}": ${errorMsg}`,
          })),
        ],
        warnings,
      };
    }
  }

  // Post-apply validation gate (Rules 1-7, overlap check)
  try {
    validateLayeredFilm(workingFilm);
  } catch (err: unknown) {
    const valErrorMsg = err instanceof Error ? err.message : String(err);
    return {
      film: originalFilm,
      applied: [],
      rejected: [
        ...rejected,
        ...applied.map((a) => ({
          op: a,
          reason: `Transaction rolled back due to post-apply validation failure: ${valErrorMsg}`,
        })),
      ],
      warnings,
    };
  }

  return {
    film: workingFilm,
    applied,
    rejected,
    warnings: Array.from(new Set(warnings)),
  };
}
