/**
 * File Description: Speech pacing facts of a reference for `aideos study`: first speech time, speech share, the pause map and loudness from the audio
 * energy (two methods: ffmpeg silencedetect at a fixed noise floor, and 20 ms RMS windows against an adaptive floor), and words per minute only
 * when word timings are supplied. There is no offline transcription in this repo,
 * so without a word list wpm is reported as not measured rather than guessed.
 * Inputs and outputs: a video file, its duration and optional word timings -> audio metrics, the pause map and the list of what was not measured.
 * Used by: backend/study/study.ts.
 */

import { measureLoudness, detectSilences, type Silence } from "../review/media";
import { loadNarration, wordsPerMinute } from "../review/speech";
import { notPixelMetric, resolveMetric } from "./agreement";
import { decodeAudioMono16k } from "./decode";
import { round, STUDY, type Metric, type NotMeasured } from "./types";

/** Pause facts derived from a list of silences. */
export interface PauseFacts {
  firstSpeechSec: number;
  speechShare: number;
  pauses: Silence[];
  pauseTotalSec: number;
  longestPauseSec: number;
}

// Splits silences into the leading silence, the trailing silence and the pauses between, and derives the pause facts.
export function pauseFacts(silences: Silence[], durationSec: number): PauseFacts {
  const edge = 0.05;
  const long = silences.filter((s) => s.end - s.start >= STUDY.audio.pauseMinSec - 1e-9);
  const lead = long.find((s) => s.start <= edge);
  const trail = long.find((s) => s.end >= durationSec - edge && s !== lead);
  const pauses = long.filter((s) => s !== lead && s !== trail);
  const silent = long.reduce((sum, s) => sum + (s.end - s.start), 0);
  const pauseTotalSec = pauses.reduce((sum, s) => sum + (s.end - s.start), 0);
  return {
    firstSpeechSec: lead ? lead.end : 0,
    speechShare: durationSec > 0 ? Math.max(0, 1 - silent / durationSec) : 0,
    pauses,
    pauseTotalSec,
    longestPauseSec: pauses.reduce((m, s) => Math.max(m, s.end - s.start), 0),
  };
}

// Method B: silences from 20 ms RMS windows against a floor that sits silenceBelowPeakDb under the 95th percentile window level (never above -70 dB).
export function silencesFromEnergy(samples: Float32Array, sampleRate: number): Silence[] {
  const win = Math.max(1, Math.round(sampleRate * STUDY.audio.windowSec));
  const count = Math.floor(samples.length / win);
  if (count === 0) return [];
  const levels = new Float64Array(count);
  for (let w = 0; w < count; w++) {
    let sum = 0;
    for (let i = w * win; i < (w + 1) * win; i++) sum += samples[i] * samples[i];
    levels[w] = 10 * Math.log10(Math.max(sum / win, 1e-14));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const peak = sorted[Math.min(count - 1, Math.floor(count * 0.95))];
  const floor = Math.max(peak - STUDY.audio.silenceBelowPeakDb, -70);
  const out: Silence[] = [];
  let start = -1;
  for (let w = 0; w <= count; w++) {
    const silent = w < count && levels[w] < floor;
    if (silent && start < 0) start = w;
    if (!silent && start >= 0) {
      const s = { start: (start * win) / sampleRate, end: (w * win) / sampleRate };
      if (s.end - s.start >= STUDY.audio.pauseMinSec - 1e-9) out.push(s);
      start = -1;
    }
  }
  return out;
}

/** The audio result of one reference. */
export interface AudioAnalysis {
  metrics: Metric[];
  pauseMap: Silence[];
  notMeasured: NotMeasured[];
}

// Measures pacing from the audio energy, loudness, and wpm when `wordsFile` gives word timings.
export function analyzeAudio(file: string, durationSec: number, hasAudio: boolean, wordsFile?: string): AudioAnalysis {
  const notMeasured: NotMeasured[] = [];
  if (!hasAudio) {
    notMeasured.push({ what: "speech pacing, pause map and loudness", why: "the file has no audio track" });
    return { metrics: [], pauseMap: [], notMeasured };
  }
  const metrics: Metric[] = [];
  const nameA = `ffmpeg silencedetect at ${STUDY.audio.silenceNoiseDb} dB, silences of at least ${STUDY.audio.pauseMinSec} s`;
  const nameB = `20 ms RMS windows, silent below the 95th percentile level minus ${STUDY.audio.silenceBelowPeakDb} dB (floor -70 dB), silences of at least ${STUDY.audio.pauseMinSec} s`;
  const factsA = pauseFacts(detectSilences(file, durationSec, STUDY.audio.silenceNoiseDb, STUDY.audio.pauseMinSec), durationSec);
  const samples = decodeAudioMono16k(file);
  const factsB = samples ? pauseFacts(silencesFromEnergy(samples, 16000), durationSec) : null;
  const tol = STUDY.audio.tolerance;
  const both = (id: string, label: string, unit: string, pick: (f: PauseFacts) => number, tolerance: { abs?: number; rel?: number }) =>
    resolveMetric({ id, label, unit, a: { method: nameA, value: pick(factsA) }, b: { method: nameB, value: factsB ? pick(factsB) : null, ...(factsB ? {} : { note: "audio could not be decoded" }) }, tolerance });
  metrics.push(
    both("audio.firstSpeechSec", "First sound after leading silence", "s", (f) => f.firstSpeechSec, { abs: 0.1 }),
    both("audio.speechShare", "Share of the file that is not a pause or edge silence", "share", (f) => f.speechShare, { abs: tol.speechShareAbs }),
    both("audio.pauseCount", `Pauses of at least ${STUDY.audio.pauseMinSec} s between sounds`, "pauses", (f) => f.pauses.length, { abs: tol.pauseCountAbs }),
    both("audio.pauseTotalSec", "Total pause time between sounds", "s", (f) => f.pauseTotalSec, { abs: tol.pauseTotalAbsSec, rel: tol.pauseTotalRel }),
    both("audio.longestPauseSec", "Longest pause between sounds", "s", (f) => f.longestPauseSec, { abs: tol.pauseTotalAbsSec, rel: tol.pauseTotalRel }),
  );
  const loud = measureLoudness(file);
  if (loud) {
    metrics.push(notPixelMetric({ id: "audio.loudnessLufs", label: "Integrated loudness", unit: "LUFS", reading: { method: "ffmpeg ebur128 (one method; an audio level, not a pixel measurement)", value: loud.integratedLufs } }));
  }
  const pauseMap = factsA.pauses.map((p) => ({ start: round(p.start, 3), end: round(p.end, 3) }));
  if (wordsFile) {
    const narration = loadNarration(wordsFile);
    const wpm = narration.timed ? wordsPerMinute(narration.words) : null;
    if (wpm !== null) {
      metrics.push(notPixelMetric({ id: "audio.wpm", label: "Speech rate", unit: "words/min", reading: { method: "word timings from the supplied word list, first word start to last word end (one method; not a pixel measurement)", value: wpm } }));
    } else notMeasured.push({ what: "speech rate (words per minute)", why: `${wordsFile} has no timed words` });
  } else {
    notMeasured.push({ what: "speech rate (words per minute)", why: "no offline transcription exists in this repo; pass --words <word list with start and end per word> or put <name>.words.json next to the reference. Pauses above come from the audio energy, not from words" });
  }
  notMeasured.push({ what: "what is said", why: "a study measures craft, never a script: no words or text of the reference are kept" });
  return { metrics, pauseMap, notMeasured };
}
