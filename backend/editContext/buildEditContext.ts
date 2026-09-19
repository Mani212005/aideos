/**
 * File Description: Assembles the compact EditContext an AI edit request will be planned against
 * (Phase 2): the transcript with word timings, filler and silence spans, the current timeline
 * state, and film metadata. Pure and synchronous so the planner prompt is built from one
 * fully-formed, testable object rather than re-deriving state ad hoc at request time.
 */

import type { LayeredFilm } from "../../src/dl/layeredSchema";
import type { ThemeConfig } from "../../src/dl/schema";
import type { TranscribedWord } from "../transcribe";
import type { FillerSpan } from "./detectFillers";
import type { SilenceWindow } from "./detectSilences";

export interface EditContextLaneSummary {
  id: string;
  label: string;
  number: number;
  hidden: boolean;
  muted: boolean;
  locked: boolean;
}

export interface EditContextClipSummary {
  id: string;
  kind: string;
  layerId: string;
  position: number;
  start: number;
  end: number;
}

export interface EditContextMeta {
  fps: number;
  format?: "long" | "reel";
  durationSec?: number;
  accent?: string;
  theme?: ThemeConfig;
}

export interface EditContext {
  /** Full transcript, one entry per spoken word with its absolute timing. */
  transcript: TranscribedWord[];
  fillers: FillerSpan[];
  silences: SilenceWindow[];
  lanes: EditContextLaneSummary[];
  clips: EditContextClipSummary[];
  meta: EditContextMeta;
}

/**
 * Builds the context object an edit planner reasons over: everything it needs to know about the
 * spoken transcript, the detected fillers and dead air, and the current timeline, in one place.
 */
export function buildEditContext(
  layeredFilm: LayeredFilm,
  transcript: TranscribedWord[],
  fillers: FillerSpan[],
  silences: SilenceWindow[],
  meta: EditContextMeta,
): EditContext {
  const lanes: EditContextLaneSummary[] = layeredFilm.layers.map((layer) => ({
    id: layer.id,
    label: layer.label,
    number: layer.number,
    hidden: layer.hidden,
    muted: layer.muted,
    locked: layer.locked,
  }));

  const clips: EditContextClipSummary[] = layeredFilm.clips.map((clip) => ({
    id: clip.id,
    kind: clip.kind,
    layerId: clip.layerId,
    position: clip.position,
    start: clip.start,
    end: clip.end,
  }));

  return { transcript, fillers, silences, lanes, clips, meta };
}
