/**
 * File Description: Pure tempo-grid planner for the film "RAG, in four steps". Given the measured raw
 * narration (one segment per line, with Whisper word times) it decides, for a chosen tempo, which
 * beat each line starts on and how much each line is gently time-stretched so it fills a whole number
 * of beats. The result is a fitted shot spine: every line's first word lands on a beat and every later
 * word keeps its place inside the line. It does no I/O, so the planning is unit tested on plain data.
 */

import type { VoiceoverTiming } from "./produceVoiceover";

/** Tempo of the beat track, in beats per minute. */
export const BEAT_BPM = 104;

/** Beats in one bar (4/4). */
export const BEATS_PER_BAR = 4;

/** How much a line may be sped up or slowed down to fit its beats (1 = untouched). */
export const MIN_TEMPO_FACTOR = 0.93;
export const MAX_TEMPO_FACTOR = 1.07;

/** Breath left between the end of a line and the next downbeat, in seconds. */
export const LINE_GAP_SEC = 0.2;

/** Silence kept before the first word of a line, so its consonant attack sits on the beat, in seconds. */
export const ONSET_LEAD_SEC = 0.012;

/** What the planner needs to know about one raw line. */
export interface RawLine {
  /** Seconds of audio, from the first sound to the end of the last word. */
  speechSec: number;
}

/** Where one line goes on the grid and how it is stretched to get there. */
export interface LinePlan {
  /** Beat index (0 = first beat of the film) the line's first word lands on. */
  startBeat: number;
  /** Whole beats the line owns, including its trailing breath. */
  beats: number;
  /** ffmpeg atempo factor: above 1 speeds the line up. */
  tempo: number;
  /** Start of the line on the grid, in seconds. */
  startSec: number;
  /** Seconds of stretched speech. */
  speechSec: number;
}

/** Seconds in one beat at a tempo. */
export function beatSeconds(bpm: number = BEAT_BPM): number {
  return 60 / bpm;
}

/**
 * Lays raw lines out on the beat grid: each line starts on the beat after the previous line's slot, and
 * gets the number of whole beats that needs the smallest tempo change, within the allowed range.
 */
export function planBeatGrid(lines: RawLine[], bpm: number = BEAT_BPM): LinePlan[] {
  const beat = beatSeconds(bpm);
  const plans: LinePlan[] = [];
  let cursorBeat = 0;
  for (const line of lines) {
    if (!(line.speechSec > 0)) throw new Error("A line has no measurable speech to put on the beat.");
    const naturalBeats = (line.speechSec + LINE_GAP_SEC) / beat;
    // Candidate whole-beat slots around the natural length; keep the one closest to untouched speed.
    let best: { beats: number; tempo: number } | null = null;
    for (let beats = Math.max(1, Math.floor(naturalBeats) - 1); beats <= Math.ceil(naturalBeats) + 1; beats++) {
      const speech = beats * beat - LINE_GAP_SEC;
      if (speech <= 0) continue;
      const tempo = line.speechSec / speech;
      if (tempo < MIN_TEMPO_FACTOR || tempo > MAX_TEMPO_FACTOR) continue;
      if (!best || Math.abs(Math.log(tempo)) < Math.abs(Math.log(best.tempo))) best = { beats, tempo };
    }
    // No whole-beat slot is in range: take the shortest slot reachable with the speed-up cap and slow the
    // line no further than the floor, so the rest of the slot is silence rather than a dragging voice.
    if (!best) {
      const beats = Math.ceil((line.speechSec / MAX_TEMPO_FACTOR + LINE_GAP_SEC) / beat);
      best = { beats, tempo: Math.max(MIN_TEMPO_FACTOR, line.speechSec / (beats * beat - LINE_GAP_SEC)) };
    }
    plans.push({
      startBeat: cursorBeat,
      beats: best.beats,
      tempo: best.tempo,
      startSec: cursorBeat * beat,
      speechSec: line.speechSec / best.tempo,
    });
    cursorBeat += best.beats;
  }
  return plans;
}

/** One line of the raw spine, with the moment its first sound begins inside its own audio. */
export interface RawSegment {
  shotId: string;
  text: string;
  startSec: number;
  durationSec: number;
  words: Array<{ word: string; startSec: number; endSec: number }>;
  /** Seconds from the segment's start to its first audible sound. */
  onsetSec: number;
  /** Seconds from the segment's start to the end of its last word. */
  endSec: number;
}

/**
 * Re-times a raw spine onto the grid: each segment begins on its beat and its words are scaled by the
 * line's tempo factor around the first sound. The film's tail handle is kept after the last slot.
 */
export function fitSpine(
  raw: VoiceoverTiming,
  segments: RawSegment[],
  plans: LinePlan[],
  tailSec: number,
  bpm: number = BEAT_BPM,
): VoiceoverTiming {
  if (segments.length !== plans.length) throw new Error("Every raw line needs exactly one grid plan.");
  const beat = beatSeconds(bpm);
  const lastPlan = plans[plans.length - 1];
  const totalSec = (lastPlan.startBeat + lastPlan.beats) * beat + tailSec;
  const fitted = segments.map((segment, idx) => {
    const plan = plans[idx];
    const nextStart = idx + 1 < plans.length ? plans[idx + 1].startSec : totalSec;
    let prevEnd = plan.startSec;
    const words = segment.words.map((w) => {
      // Raw offsets are measured from the first sound; whisper can pull a first word slightly early.
      const from = Math.max(prevEnd, plan.startSec + Math.max(0, w.startSec - segment.startSec - segment.onsetSec) / plan.tempo);
      const to = Math.max(from + 0.06, plan.startSec + Math.max(0, w.endSec - segment.startSec - segment.onsetSec) / plan.tempo);
      prevEnd = from;
      return { word: w.word, startSec: Number(from.toFixed(3)), endSec: Number(to.toFixed(3)) };
    });
    return {
      shotId: segment.shotId,
      text: segment.text,
      startSec: Number(plan.startSec.toFixed(3)),
      durationSec: Number((nextStart - plan.startSec).toFixed(3)),
      words,
    };
  });
  return { totalDurationSec: Number(totalSec.toFixed(3)), ttsBackend: raw.ttsBackend, segments: fitted };
}
