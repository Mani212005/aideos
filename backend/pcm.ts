/**
 * File Description: Pure sample-domain helpers for the narration pipeline - silence trimming,
 * pitch-preserving time-stretch (WSOLA),
 * boundary fades, peak normalization, exact-offset concatenation, word-timing distribution (and the
 * shared TimedWord type every word-timing reader uses) and 16-bit PCM WAV encode/decode. Everything here is deterministic and dependency-free so the
 * voiceover regression tests can assert on sample counts and boundary amplitudes directly,
 * which is the only way to prove there is no click, gap or drift at a stitch point.
 * Inputs and outputs: raw Float32 PCM samples and WAV buffers -> trimmed, re-paced, normalized, concatenated audio samples and WAV files.
 * Used by: backend/audio.ts, backend/tts.ts, backend/pipeline/design.ts, editor/vite.config.ts; TimedWord by the design compile, review, reel cut and end card modules.
 */

import { HOUSE_PACE } from "../src/dl/pacingProfile";
import {
  compactInternalPauses,
  DEFAULT_MAX_CLAUSE_PAUSE_MS,
  DEFAULT_MAX_MID_CLAUSE_PAUSE_MS,
  DEFAULT_MID_CLAUSE_TRIGGER_MS,
} from "./narrationFlow";

/** One synthesized piece of narration and the text it speaks. */
export interface PcmChunk {
  text: string;
  samples: Float32Array;
}

/** Exact placement of one synthesized sentence/chunk inside an assembled segment. */
export interface AssembledChunk {
  text: string;
  startSample: number;
  lengthSamples: number;
  startSec: number;
  durationSec: number;
}

/** Where one assembled segment landed on the concatenated timeline, in samples and seconds. */
export interface AssembledSegment {
  text: string;
  startSample: number;
  lengthSamples: number;
  startSec: number;
  durationSec: number;
  /** Per-chunk (sentence) placements inside this segment when known. */
  chunks?: AssembledChunk[];
}

/** The concatenated narration plus the exact placement of every segment inside it. */
export interface AssembledAudio {
  samples: Float32Array;
  sampleRate: number;
  segments: AssembledSegment[];
  totalSec: number;
}

/**
 * One narrated word with its offsets in seconds, as voiceover_words.json stores it. The single definition every
 * producer and reader of word timings shares (narration, design compile, review, reel cut, end card).
 */
export interface TimedWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
}

/** A word as distributeWordTimings produces it: it always carries its punctuated spelling. */
export type PunctuatedWord = Required<TimedWord>;

/** One stretch of the transcript a narration segment speaks. */
export interface UtteranceInfo {
  start: number;
  end: number;
  transcript: string;
}

/** A narration segment as narration.json records it, with word timings relative to the segment start. */
export interface SegmentAudioInfo {
  text: string;
  duration: number;
  startOffset: number;
  words: TimedWord[];
  utterances: UtteranceInfo[];
}

/**
 * Trims leading and trailing silence samples (below amplitude threshold) from raw Float32Array audio.
 * Neural TTS pads most utterances with 100-400ms of near-silence; leaving it in is what pushed the
 * spoken words late against the visuals they describe.
 */
export function trimSilence(samples: Float32Array, threshold = 0.005): Float32Array {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) <= threshold) {
    start++;
  }
  if (start >= samples.length) {
    return new Float32Array(0);
  }
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) <= threshold) {
    end--;
  }
  return samples.subarray(start, end + 1);
}

/**
 * Ramps the first and last few milliseconds to zero.
 *
 * Trimming cuts mid-waveform, so a trimmed chunk almost always starts and ends on a non-zero
 * sample. Butting two of those together produces a step discontinuity, which is exactly the
 * click that reads as a stutter at every segment boundary. A short ramp removes the step
 * without being audible as a fade.
 */
export function applyEdgeFades(samples: Float32Array, sampleRate: number, fadeMs = 6): Float32Array {
  const out = Float32Array.from(samples);
  const fade = Math.min(Math.floor((fadeMs / 1000) * sampleRate), Math.floor(out.length / 2));
  if (fade <= 0) return out;
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

/** WSOLA analysis frame: 30 ms holds two to four pitch periods of a speaking voice. */
const STRETCH_FRAME_MS = 30;
/** How far WSOLA may slide a frame from its nominal position to find the best waveform match. */
const STRETCH_TOLERANCE_MS = 10;

// Periodic Hann window: at 50% overlap consecutive windows sum to exactly 1.
function periodicHann(length: number): Float32Array {
  const w = new Float32Array(length);
  for (let i = 0; i < length; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
  return w;
}

// Normalized cross-correlation of `a` from `ai` and `b` from `bi` over `length` samples.
function similarity(a: Float32Array, ai: number, b: Float32Array, bi: number, length: number): number {
  let dot = 0;
  let energy = 0;
  for (let i = 0; i < length; i++) {
    const x = a[ai + i];
    dot += x * b[bi + i];
    energy += x * x;
  }
  return energy > 1e-12 ? dot / Math.sqrt(energy) : 0;
}

/**
 * Changes the speed of speech without changing its pitch (rate 1.2 plays 1.2x faster, rate 0.9 slower),
 * by waveform-similarity overlap-add (WSOLA). Output frames are laid down at a fixed hop; each one is read
 * from near where the faster (or slower) timeline says it should come from, slid by up to 10 ms to the
 * position whose waveform best continues the frame before it. Overlapping in phase is what keeps the voice
 * free of the warble and doubled-pitch artefacts a plain overlap-add or a resample would leave.
 * Deterministic and pure; the output length is round(input length / rate).
 */
export function timeStretch(samples: Float32Array, rate: number, sampleRate: number): Float32Array {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`timeStretch: rate must be a positive number, got ${rate}`);
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error(`timeStretch: invalid sample rate ${sampleRate}`);
  if (Math.abs(rate - 1) < 1e-6) return Float32Array.from(samples);
  const frame = 2 * Math.round((STRETCH_FRAME_MS / 1000) * sampleRate / 2);
  const hop = frame / 2;
  const tolerance = Math.round((STRETCH_TOLERANCE_MS / 1000) * sampleRate);
  const outLength = Math.round(samples.length / rate);
  // Too short to hold one frame: nothing is spoken here that a resample would hurt.
  if (samples.length < frame * 2) return resampleNearest(samples, outLength);

  const window = periodicHann(frame);
  const out = new Float32Array(outLength + frame);
  const weight = new Float32Array(outLength + frame);
  const lastStart = samples.length - frame;
  let previous = 0;
  for (let k = 0; k * hop < outLength; k++) {
    const nominal = Math.min(lastStart, Math.round(k * hop * rate));
    let start = nominal;
    if (k > 0) {
      // The samples that would naturally follow the previous frame are the template to match.
      const template = Math.min(lastStart, previous + hop);
      const lo = Math.max(0, nominal - tolerance);
      const hi = Math.min(lastStart, nominal + tolerance);
      let best = -Infinity;
      // Coarse search every second sample, then refine around the winner.
      for (let s = lo; s <= hi; s += 2) {
        const score = similarity(samples, s, samples, template, hop);
        if (score > best) { best = score; start = s; }
      }
      const coarse = start;
      for (let s = Math.max(lo, coarse - 1); s <= Math.min(hi, coarse + 1); s++) {
        const score = similarity(samples, s, samples, template, hop);
        if (score > best) { best = score; start = s; }
      }
    }
    const at = k * hop;
    for (let i = 0; i < frame; i++) {
      // Nothing overlaps the first frame's rising half, so it is taken at full weight rather than faded in.
      const w = k === 0 && i < hop ? 1 : window[i];
      out[at + i] += samples[start + i] * w;
      weight[at + i] += w;
    }
    previous = start;
  }
  const result = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) result[i] = weight[i] > 1e-6 ? out[i] / weight[i] : 0;
  return result;
}

// Nearest-sample length change for clips too short to stretch frame by frame.
function resampleNearest(samples: Float32Array, length: number): Float32Array {
  const out = new Float32Array(length);
  if (samples.length === 0) return out;
  const step = samples.length / Math.max(1, length);
  for (let i = 0; i < length; i++) out[i] = samples[Math.min(samples.length - 1, Math.floor(i * step))];
  return out;
}

/** Scales the buffer so its loudest sample sits at targetPeak, leaving headroom below clipping. */
export function normalizePeak(samples: Float32Array, targetPeak = 0.89): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak === 0) return Float32Array.from(samples);
  const gain = targetPeak / peak;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] * gain;
  }
  return out;
}

/** Options controlling how synthesized chunks are joined into one narration track. */
export interface AssembleOptions {
  sampleRate: number;
  /** Silence inserted between two segments (two different shots). */
  segmentGapMs: number;
  /** Silence inserted before a segment that opens a new chapter (decision D4). */
  chapterGapMs?: number;
  /** Boolean flags indicating which segments open a new chapter. */
  isChapterStart?: boolean[];
  /** Silence inserted between chunks (sentences) that belong to the same segment. */
  chunkGapMs: number;
  /** Length of the ramp applied to each chunk's head and tail. */
  fadeMs: number;
  /** Amplitude below which a sample counts as silence for trimming. */
  silenceThreshold: number;
  /** When true, compacts unwanted engine-inserted internal silences inside each sentence chunk. */
  compactInternalPauses?: boolean;
  /** Mid-clause silence duration (ms) above which internal pause compaction triggers. */
  midClauseTriggerMs?: number;
  /** Target pause length (ms) kept when compacting a mid-clause stall inside a sentence. */
  maxMidClausePauseMs?: number;
  /** Maximum pause length (ms) kept at a clause boundary inside a sentence. */
  maxClausePauseMs?: number;
}

// Decision D4: narration breath at chapter cuts so music changes can land in a pause instead of under speech,
// shortened with every other timeline silence by the 2026-11-21 house pace (src/dl/pacingProfile.ts).
export const CHAPTER_BREATH_GAP_MS = HOUSE_PACE.chapterGapMs;

/** The defaults the production pipeline runs with: the house pace's silences between lines and chunks. */
export const DEFAULT_ASSEMBLE_OPTIONS: Omit<AssembleOptions, "sampleRate"> = {
  segmentGapMs: HOUSE_PACE.segmentGapMs,
  chapterGapMs: CHAPTER_BREATH_GAP_MS,
  chunkGapMs: HOUSE_PACE.chunkGapMs,
  fadeMs: 6,
  silenceThreshold: 0.005,
  compactInternalPauses: true,
  midClauseTriggerMs: DEFAULT_MID_CLAUSE_TRIGGER_MS,
  maxMidClausePauseMs: DEFAULT_MAX_MID_CLAUSE_PAUSE_MS,
  maxClausePauseMs: DEFAULT_MAX_CLAUSE_PAUSE_MS,
};

/**
 * Concatenates per-segment chunk lists into one narration buffer.
 *
 * Every offset is computed in whole samples and the output length is the sum of the pieces, so
 * the reported segment boundaries are exact rather than measured back off an encoded file.
 * That exactness is what lets the film timeline line up with the narration to the frame.
 */
export function assembleSegments(
  segmentChunks: PcmChunk[][],
  options: AssembleOptions,
): AssembledAudio {
  const {
    sampleRate,
    segmentGapMs,
    chapterGapMs,
    isChapterStart,
    chunkGapMs,
    fadeMs,
    silenceThreshold,
    compactInternalPauses: shouldCompact = false,
    midClauseTriggerMs,
    maxMidClausePauseMs,
    maxClausePauseMs,
  } = options;
  const standardGap = Math.round((segmentGapMs / 1000) * sampleRate);
  const chapterGap = Math.round(((chapterGapMs ?? segmentGapMs) / 1000) * sampleRate);
  const chunkGap = Math.round((chunkGapMs / 1000) * sampleRate);

  const getGapForSegment = (segIdx: number): number => {
    if (segIdx <= 0) return 0;
    if (!isChapterStart) return standardGap;
    return isChapterStart[segIdx] ? chapterGap : standardGap;
  };

  const prepared: Array<Array<{ text: string; buf: Float32Array }>> = segmentChunks.map((chunks) =>
    chunks
      .map((chunk) => {
        const trimmed = trimSilence(chunk.samples, silenceThreshold);
        const compacted =
          shouldCompact && trimmed.length > 0
            ? compactInternalPauses(trimmed, sampleRate, {
                sentenceText: chunk.text,
                midClauseTriggerMs,
                maxMidClausePauseMs,
                maxClausePauseMs,
                fadeMs,
              })
            : trimmed;
        return { text: chunk.text, buf: applyEdgeFades(compacted, sampleRate, fadeMs) };
      })
      .filter((item) => item.buf.length > 0),
  );

  let total = 0;
  prepared.forEach((chunks, segIdx) => {
    if (segIdx > 0) total += getGapForSegment(segIdx);
    chunks.forEach((item, chunkIdx) => {
      if (chunkIdx > 0) total += chunkGap;
      total += item.buf.length;
    });
  });

  const samples = new Float32Array(total);
  const segments: AssembledSegment[] = [];
  let cursor = 0;

  prepared.forEach((chunks, segIdx) => {
    if (segIdx > 0) cursor += getGapForSegment(segIdx);
    const startSample = cursor;
    const placedChunks: AssembledChunk[] = [];
    chunks.forEach((item, chunkIdx) => {
      if (chunkIdx > 0) cursor += chunkGap;
      const chunkStart = cursor;
      samples.set(item.buf, cursor);
      cursor += item.buf.length;
      placedChunks.push({
        text: item.text,
        startSample: chunkStart,
        lengthSamples: item.buf.length,
        startSec: chunkStart / sampleRate,
        durationSec: item.buf.length / sampleRate,
      });
    });
    segments.push({
      text: segmentChunks[segIdx].map((c) => c.text).join(" "),
      startSample,
      lengthSamples: cursor - startSample,
      startSec: startSample / sampleRate,
      durationSec: (cursor - startSample) / sampleRate,
      chunks: placedChunks,
    });
  });

  return { samples, sampleRate, segments, totalSec: total / sampleRate };
}

/**
 * Turns assembled segment placements into shot durations that tile the timeline exactly.
 *
 * Each shot runs from where its own narration starts to where the next one's does, so the
 * inter-segment gap lands at the tail of the shot that just finished speaking rather than
 * delaying the next shot's visuals. Summing the result reproduces the audio length exactly,
 * which is the invariant the film timeline is locked to.
 */
export function deriveShotDurations(segments: AssembledSegment[], totalSec: number): number[] {
  return segments.map((seg, i) => {
    const next = segments[i + 1];
    return (next ? next.startSec : totalSec) - seg.startSec;
  });
}

/**
 * Rounds shot durations to whole milliseconds without letting the rounding accumulate.
 *
 * Rounding each duration on its own adds up to half a millisecond of error per shot, so a film of
 * twenty shots runs a millisecond behind its voice and the first word of a later shot is counted
 * in the shot before it. Here every shot starts on its own narration offset rounded to the
 * millisecond (the grid word timings are written on) and lasts until the next one starts, and the
 * last shot ends where the narration does, so the durations summed up to any shot land exactly on
 * that shot's narrated start. The offsets, not the durations, are the source: a narration whose
 * stored durations were already rounded one by one still tiles onto its own offsets.
 */
export function shotDurationsOnMillisecondGrid(startOffsets: number[], shotDurations: number[]): number[] {
  if (startOffsets.length !== shotDurations.length) {
    throw new Error(`${startOffsets.length} narration offset(s) do not match ${shotDurations.length} shot duration(s)`);
  }
  if (startOffsets.length === 0) return [];
  const toMs = (sec: number) => Number(sec.toFixed(3));
  const starts = startOffsets.map(toMs);
  const lastIdx = startOffsets.length - 1;
  const end = toMs(startOffsets[lastIdx] + shotDurations[lastIdx]);
  return starts.map((start, i) => toMs((i < lastIdx ? starts[i + 1] : end) - start));
}

/** Rough syllable count, used to weight how long a word occupies the narration timeline. */
function syllableCount(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!w) {
    // Non-Latin scripts (for example Devanagari Hindi): weight proportionally by base letters.
    const letters = word.replace(/[^\p{L}\p{N}]/gu, "");
    return Math.max(1, Math.ceil(letters.length / 2));
  }
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  // A trailing silent "e" ("shape", "table") is written but not spoken.
  if (n > 1 && /[^aeiouy]e$/.test(w)) n -= 1;
  return Math.max(1, n);
}

/** Extra weight for the pause a closing punctuation mark buys the word it follows. */
function punctuationWeight(word: string): number {
  if (/[.!?।]["')\]]?$/.test(word)) return 1.1;
  if (/[,;:]["')\]]?$/.test(word)) return 0.55;
  return 0;
}

/**
 * Spreads a measured segment duration across its words.
 *
 * Dividing the duration evenly (what the pipeline used to do) puts "a" and "understanding" on
 * the same clock, so word-level captions slide progressively out of step inside every sentence.
 * Weighting by syllables plus the pause each punctuation mark buys tracks real speech closely
 * enough that caption highlighting lands on the word being spoken.
 */
export function distributeWordTimings(
  text: string,
  durationSec: number,
  startSec = 0,
): PunctuatedWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || durationSec <= 0) return [];

  const weights = tokens.map((t) => syllableCount(t) + punctuationWeight(t));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || tokens.length;

  const words: PunctuatedWord[] = [];
  let cursor = 0;
  tokens.forEach((token, i) => {
    const span = (weights[i] / totalWeight) * durationSec;
    const start = cursor;
    // The last word closes exactly on the segment end, so rounding never leaves a sliver.
    const end = i === tokens.length - 1 ? durationSec : cursor + span;
    words.push({
      word: token.toLowerCase().replace(/[^\p{L}\p{N}\p{M}']/gu, ""),
      punctuated_word: token,
      start: Number((startSec + start).toFixed(3)),
      end: Number((startSec + end).toFixed(3)),
    });
    cursor = end;
  });

  return words;
}

/**
 * Times every assembled segment's words: absolute offsets on the narration timeline (voiceover_words.json and the
 * captions) plus the per-segment records with segment-relative words (narration.json). The CLI pipeline and the
 * Studio voiceover route both write these files, so they share this one derivation.
 */
export function narrationWordTimings(segments: AssembledSegment[]): { words: PunctuatedWord[]; segments: SegmentAudioInfo[] } {
  const words: PunctuatedWord[] = [];
  const records = segments.map((seg): SegmentAudioInfo => {
    let relativeWords: PunctuatedWord[];
    if (seg.chunks && seg.chunks.length > 1) {
      relativeWords = [];
      for (const chunk of seg.chunks) {
        const relStart = chunk.startSec - seg.startSec;
        relativeWords.push(...distributeWordTimings(chunk.text, chunk.durationSec, relStart));
      }
    } else {
      relativeWords = distributeWordTimings(seg.text, seg.durationSec);
    }
    for (const w of relativeWords) {
      words.push({
        word: w.word,
        punctuated_word: w.punctuated_word,
        start: Number((seg.startSec + w.start).toFixed(3)),
        end: Number((seg.startSec + w.end).toFixed(3)),
      });
    }
    return {
      text: seg.text,
      duration: seg.durationSec,
      startOffset: seg.startSec,
      words: relativeWords,
      utterances: [{ start: 0, end: seg.durationSec, transcript: seg.text }],
    };
  });
  return { words, segments: records };
}

/** Encodes mono Float32 samples as a 16-bit PCM WAV file buffer. */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20); // format = PCM
  buffer.writeUInt16LE(1, 22); // channels = mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * bytesPerSample);
  }
  return buffer;
}

/** Decoded contents of a 16-bit PCM WAV file. */
export interface DecodedWav {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
}

/** Decodes a 16-bit PCM WAV buffer, walking the chunk list rather than assuming a 44-byte header. */
export function decodeWav(buffer: Buffer): DecodedWav {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataStart = body;
      dataLength = Math.min(size, buffer.length - body);
    }
    offset = body + size + (size % 2);
  }

  if (dataStart < 0) throw new Error("WAV file has no data chunk");
  if (bitsPerSample !== 16) throw new Error(`expected 16-bit PCM, got ${bitsPerSample}-bit`);

  const count = Math.floor(dataLength / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = buffer.readInt16LE(dataStart + i * 2) / 32768;
  }
  return { samples, sampleRate, channels };
}

/** Largest absolute jump between consecutive samples, the direct measure of a boundary click. */
export function maxSampleStep(samples: Float32Array): number {
  let worst = 0;
  for (let i = 1; i < samples.length; i++) {
    const step = Math.abs(samples[i] - samples[i - 1]);
    if (step > worst) worst = step;
  }
  return worst;
}

/** Longest run of consecutive near-silent samples, in seconds. Catches accidental dead air. */
export function longestSilenceSec(samples: Float32Array, sampleRate: number, threshold = 0.005): number {
  let worst = 0;
  let run = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) <= threshold) {
      run++;
      if (run > worst) worst = run;
    } else {
      run = 0;
    }
  }
  return worst / sampleRate;
}
