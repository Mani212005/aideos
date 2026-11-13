/**
 * File Description: The one voice activity state machine (speech, pause, gap) that defines when the narrator is speaking.
 * Inputs and outputs: Active speech runs or per-frame narration levels -> a timeline of named states, per-time state queries and per-window speech flags.
 * Used by: src/dl/audio/ducking.ts, src/dl/audio/sectionMixer.ts, src/dl/Soundtrack.tsx, backend/soundtrack.ts, backend/review/music.ts.
 */

// Narration level at or below which a 10 ms frame is silent; the single speech floor for the mixer and the checker.
export const SPEECH_FLOOR_DB = -40;
// Length of one narration activity frame in seconds.
export const ACTIVITY_FRAME_SEC = 0.01;
// Silence shorter than this is a pause inside a phrase (music stays down); silence this long or longer is a gap (music may rise).
export const HOLD_SEC = 0.6;
// Share of a checker window that must be active speech for the window to count as speech.
export const MIN_WINDOW_SPEECH_COVERAGE = 0.5;

export type VoiceState = "speech" | "pause" | "gap";
export type VoiceEvent = "active" | "quiet" | "hold-expired";

export interface VoiceInterval {
  startSec: number;
  endSec: number;
}

export interface VoiceSegment extends VoiceInterval {
  state: "speech" | "pause";
}

export interface VoiceTimeline {
  /** Speech and pause segments in time order; everything outside them is a gap. */
  segments: VoiceSegment[];
  /** Phrases: runs of speech joined across pauses, with the gaps between them. */
  phrases: VoiceInterval[];
}

export interface VoiceContext {
  state: VoiceState;
  /** End of the last phrase that finished before the time, or -Infinity. */
  previousEndSec: number;
  /** Start of the first phrase that begins after the time, or Infinity. */
  nextStartSec: number;
}

/** Raised when an event arrives in a state that cannot receive it. */
export class VoiceActivityError extends Error {
  // Names the impossible transition so a caller sees which state and event disagreed.
  constructor(state: VoiceState, event: VoiceEvent) {
    super(`Impossible voice activity transition: "${event}" while in "${state}"`);
    this.name = "VoiceActivityError";
  }
}

// Applies one event to a voice state; the table is the whole machine and an event with no row throws.
export function transitionVoiceState(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (state) {
    case "gap":
      if (event === "active") return "speech";
      if (event === "quiet") return "gap";
      break;
    case "speech":
      if (event === "active") return "speech";
      if (event === "quiet") return "pause";
      break;
    case "pause":
      if (event === "active") return "speech";
      if (event === "quiet") return "pause";
      return "gap";
  }
  throw new VoiceActivityError(state, event);
}

// Reports whether a narration level is audible speech under the shared floor.
export function isActiveLevel(levelDb: number): boolean {
  return Number.isFinite(levelDb) && levelDb > SPEECH_FLOOR_DB;
}

// Sorts active runs, drops empty ones and joins runs that overlap or touch.
function normalizeRuns(runs: VoiceInterval[]): VoiceInterval[] {
  const merged: VoiceInterval[] = [];
  for (const run of [...runs].sort((a, b) => a.startSec - b.startSec)) {
    if (!(run.endSec > run.startSec)) continue;
    const previous = merged[merged.length - 1];
    if (previous && run.startSec <= previous.endSec) previous.endSec = Math.max(previous.endSec, run.endSec);
    else merged.push({ startSec: run.startSec, endSec: run.endSec });
  }
  return merged;
}

// Runs the state machine over active speech runs and records the speech, pause and phrase spans it visits.
export function buildVoiceTimeline(runs: VoiceInterval[], holdSec: number = HOLD_SEC): VoiceTimeline {
  const active = normalizeRuns(runs);
  const segments: VoiceSegment[] = [];
  const phrases: VoiceInterval[] = [];
  let state: VoiceState = "gap";
  active.forEach((run, index) => {
    const previous = active[index - 1];
    if (previous) {
      if (run.startSec - previous.endSec < holdSec - 1e-9) {
        segments.push({ state: "pause", startSec: previous.endSec, endSec: run.startSec });
        phrases[phrases.length - 1].endSec = run.endSec;
      } else {
        state = transitionVoiceState(state, "hold-expired");
        phrases.push({ startSec: run.startSec, endSec: run.endSec });
      }
    } else {
      phrases.push({ startSec: run.startSec, endSec: run.endSec });
    }
    state = transitionVoiceState(state, "active");
    segments.push({ state: "speech", startSec: run.startSec, endSec: run.endSec });
    state = transitionVoiceState(state, "quiet");
  });
  if (active.length) transitionVoiceState(state, "hold-expired");
  return { segments, phrases };
}

// Joins active runs into phrases: silence under the hold stays inside a phrase, longer silence ends it.
export function mergeVoicePhrases(runs: VoiceInterval[], holdSec: number = HOLD_SEC): VoiceInterval[] {
  return buildVoiceTimeline(runs, holdSec).phrases;
}

// Finds the index of the last interval that starts at or before a time, or -1.
function lastStartingAtOrBefore(intervals: VoiceInterval[], timeSec: number): number {
  let low = 0;
  let high = intervals.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (intervals[mid].startSec <= timeSec) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

// Reads the voice state at a time (speech is inclusive of its edges) with the neighbouring phrase edges.
export function voiceContextAt(timeline: VoiceTimeline, timeSec: number): VoiceContext {
  const { phrases, segments } = timeline;
  const phraseIndex = lastStartingAtOrBefore(phrases, timeSec);
  const phrase = phraseIndex >= 0 ? phrases[phraseIndex] : undefined;
  if (phrase && timeSec <= phrase.endSec) {
    const segmentIndex = lastStartingAtOrBefore(segments, timeSec);
    const inSpeech = segmentIndex >= 0 && segments[segmentIndex].state === "speech" && timeSec <= segments[segmentIndex].endSec;
    const previousSpeech = segmentIndex > 0 ? segments[segmentIndex - 1] : undefined;
    const onSpeechEdge = previousSpeech?.state === "speech" && timeSec <= previousSpeech.endSec;
    return {
      state: inSpeech || onSpeechEdge ? "speech" : "pause",
      previousEndSec: phraseIndex > 0 ? phrases[phraseIndex - 1].endSec : -Infinity,
      nextStartSec: phraseIndex + 1 < phrases.length ? phrases[phraseIndex + 1].startSec : Infinity,
    };
  }
  return {
    state: "gap",
    previousEndSec: phrase ? phrase.endSec : -Infinity,
    nextStartSec: phraseIndex + 1 < phrases.length ? phrases[phraseIndex + 1].startSec : Infinity,
  };
}

// Reads just the voice state at a time.
export function voiceStateAt(timeline: VoiceTimeline, timeSec: number): VoiceState {
  return voiceContextAt(timeline, timeSec).state;
}

// Turns per-frame narration levels into the active speech runs the machine consumes.
export function activeRunsFromLevels(levelsDb: number[], frameSec: number = ACTIVITY_FRAME_SEC): VoiceInterval[] {
  const runs: VoiceInterval[] = [];
  levelsDb.forEach((level, index) => {
    if (!isActiveLevel(level)) return;
    const startSec = index * frameSec;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.endSec - startSec) < 1e-9) last.endSec = startSec + frameSec;
    else runs.push({ startSec, endSec: startSec + frameSec });
  });
  return runs;
}

// Combines equal-length frame levels into one RMS level per window by averaging energy.
export function rollupLevels(frameDb: number[], framesPerWindow: number): number[] {
  const windows: number[] = [];
  for (let start = 0; start < frameDb.length; start += framesPerWindow) {
    const frames = frameDb.slice(start, start + framesPerWindow);
    const energy = frames.reduce((sum, db) => sum + (Number.isFinite(db) ? 10 ** (db / 10) : 0), 0) / frames.length;
    windows.push(energy > 0 ? 10 * Math.log10(energy) : -Infinity);
  }
  return windows;
}

// Flags each fixed window as speech when the timeline's speech state covers enough of it; pauses and gaps never count.
export function speechWindowFlags(
  timeline: VoiceTimeline,
  windowSec: number,
  windowCount: number,
  minCoverage: number = MIN_WINDOW_SPEECH_COVERAGE,
): boolean[] {
  const speech = timeline.segments.filter((segment) => segment.state === "speech");
  const flags: boolean[] = [];
  let first = 0;
  for (let i = 0; i < windowCount; i++) {
    const start = i * windowSec;
    const end = start + windowSec;
    while (first < speech.length && speech[first].endSec <= start) first++;
    let covered = 0;
    for (let j = first; j < speech.length && speech[j].startSec < end; j++) {
      covered += Math.min(end, speech[j].endSec) - Math.max(start, speech[j].startSec);
    }
    flags.push(covered >= windowSec * minCoverage - 1e-9);
  }
  return flags;
}
