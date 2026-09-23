/**
 * File Description: Audio-first timing for scene films.
 * Every frame number in a scene film comes from the measured narration: shot spans are cut from
 * the segment offsets, and cues are aimed at spoken words by name. A re-recorded take therefore
 * retimes the whole picture instead of drifting away from it, and a rewritten line that drops a
 * cued word fails the build instead of silently mis-timing the film.
 */

import { FPS } from "./stage";

/** Measured narration for a film: one segment per shot, with word-level offsets. */
export interface NarrationTiming {
  totalDurationSec: number;
  segments: Array<{
    shotId: string;
    text: string;
    startSec: number;
    durationSec: number;
    words: Array<{ word: string; startSec: number; endSec: number }>;
  }>;
}

/** Frame spans of every shot, derived from the measured narration and nothing else. */
export interface ShotFrames {
  spans: Map<string, { from: number; to: number }>;
  durationFrames: number;
}

/** Turns measured narration offsets into contiguous, gap-free shot frame spans. */
export function shotFrames(timing: NarrationTiming, fps: number = FPS): ShotFrames {
  const spans = new Map<string, { from: number; to: number }>();
  let cursor = 0;
  for (const segment of timing.segments) {
    const to = Math.round((segment.startSec + segment.durationSec) * fps);
    spans.set(segment.shotId, { from: cursor, to });
    cursor = to;
  }
  return { spans, durationFrames: cursor };
}

/** Frame lookups a timeline is authored with. */
export interface Cues {
  /** Frame at a fraction through a named shot. */
  at: (shotId: string, fraction?: number) => number;
  /** First frame of a named shot. */
  from: (shotId: string) => number;
  /** Frame one past the last frame of a named shot. */
  to: (shotId: string) => number;
  /** Frame a phrase is spoken at in a named shot; throws when the phrase is not in that shot. */
  word: (shotId: string, phrase: string, edge?: "start" | "end") => number;
  durationFrames: number;
}

// Builds the frame lookups for a film from its measured narration.
export function createCues(timing: NarrationTiming, fps: number = FPS): Cues {
  const { spans, durationFrames } = shotFrames(timing, fps);
  const at = (shotId: string, fraction = 0): number => {
    const span = spans.get(shotId);
    if (!span) throw new Error(`No shot "${shotId}" in the measured narration.`);
    return Math.round(span.from + (span.to - span.from) * fraction);
  };
  const bySegment = new Map(timing.segments.map((segment) => [segment.shotId, segment]));
  // Aiming a beat at a word rather than at a fraction of the shot keeps a cue on the thing being
  // said: the payoff word of a sentence is usually near its end, not its middle.
  const word = (shotId: string, phrase: string, edge: "start" | "end" = "start"): number => {
    const segment = bySegment.get(shotId);
    if (!segment) throw new Error(`No shot "${shotId}" in the measured narration.`);
    const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
    const wanted = phrase.split(/\s+/).map(normalize).filter(Boolean);
    for (let i = 0; i + wanted.length <= segment.words.length; i++) {
      if (wanted.every((w, k) => normalize(segment.words[i + k].word) === w)) {
        const hit = edge === "start" ? segment.words[i] : segment.words[i + wanted.length - 1];
        return Math.round((edge === "start" ? hit.startSec : hit.endSec) * fps);
      }
    }
    throw new Error(`"${phrase}" is not spoken in shot "${shotId}": ${segment.text}`);
  };
  return { at, from: (id) => at(id, 0), to: (id) => at(id, 1), word, durationFrames };
}
