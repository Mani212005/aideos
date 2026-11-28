/**
 * File Description: Pure sentence-whole segmentation, internal pause compaction and measured in-sentence
 * silence-gap detection for natural narration flow. Splits narration segments into whole sentences (breaking
 * long sentences only at clause ends before word fallback), compacts engine-inserted mid-sentence dead air
 * in the sample domain with smooth edge ramps, and checks joined narration audio or timed words plus
 * detected silences for unwanted pauses inside a sentence.
 * Inputs and outputs: narration text, PCM samples, timed words and silence intervals -> sentence chunks,
 * compacted PCM samples, and NarrationFlowReport pass/fail results.
 * Used by: backend/audio.ts, backend/pcm.ts, backend/review/speech.ts, backend/review/thresholds.ts,
 * backend/narrationFlow.test.ts.
 */

import { ACTIVITY_FRAME_SEC, SPEECH_FLOOR_DB, activeRunsFromLevels } from "../src/dl/audio/voiceActivity";

/** Default maximum allowed silence strictly inside a sentence before the flow gate fails, in seconds. */
export const DEFAULT_MAX_IN_SENTENCE_GAP_SEC = 0.35;

/** Default internal silence inside a sentence (away from clause punctuation) above which compaction triggers, in ms. */
export const DEFAULT_MID_CLAUSE_TRIGGER_MS = 180;

/** Default target duration when compacting an unwanted mid-clause silence inside a sentence, in ms. */
export const DEFAULT_MAX_MID_CLAUSE_PAUSE_MS = 80;

/** Default maximum duration for a silence near a clause boundary (comma, semicolon, colon) inside a sentence, in ms. */
export const DEFAULT_MAX_CLAUSE_PAUSE_MS = 220;

/** Default edge ramp applied around a compacted internal pause so the splice never clicks, in ms. */
const DEFAULT_COMPACT_FADE_MS = 6;

/** Relative window around a clause punctuation mark inside which an internal pause counts as a clause pause. */
const CLAUSE_WINDOW_FRACTION = 0.16;

/** Margin inset from sentence edges when matching acoustic silence spans so inter-sentence gaps are excluded, in seconds. */
const SENTENCE_EDGE_MARGIN_SEC = 0.04;

/** Abbreviations whose trailing period does not end a sentence. */
const NON_SENTENCE_ABBREVIATIONS = new Set([
  "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "vs.", "etc.", "fig.", "no.", "inc.", "co.", "ltd.", "e.g.", "i.e.", "a.m.", "p.m.",
]);

/** Minimal timed word shape needed to derive sentence spans and check in-sentence gaps. */
export interface FlowWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
}

/** One acoustic silence interval in seconds. */
export interface SilenceSpan {
  start: number;
  end: number;
}

/** One sentence's placement on the narration timeline. */
export interface SentenceSpan {
  text: string;
  startSec: number;
  endSec: number;
  segmentIndex: number;
  sentenceIndex: number;
}

/** One unwanted silence gap detected strictly inside a sentence. */
export interface InSentenceGap {
  sentenceIndex: number;
  sentenceText: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  source: "audio" | "words" | "silence";
}

/** Measured result of the standing in-sentence flow gate. */
export interface NarrationFlowReport {
  passed: boolean;
  maxGapSec: number;
  sentencesChecked: number;
  gaps: InSentenceGap[];
  summary: string;
}

/** Options controlling sample-domain compaction of engine-inserted internal silences inside a sentence. */
export interface CompactPauseOptions {
  /** Spoken sentence text, used to preserve brief pauses near clause boundaries while removing mid-clause stalls. */
  sentenceText?: string;
  /** Mid-clause silences longer than this (ms) are shortened to maxMidClausePauseMs. */
  midClauseTriggerMs?: number;
  /** Target silence (ms) kept when compacting an unwanted mid-clause pause. */
  maxMidClausePauseMs?: number;
  /** Clause-boundary silences longer than this (ms) are capped to this duration. */
  maxClausePauseMs?: number;
  /** Ramp length (ms) at splice boundaries so compaction leaves no click. */
  fadeMs?: number;
  /** RMS floor (dB) below which a 10 ms frame counts as silent (defaults to shared SPEECH_FLOOR_DB). */
  speechFloorDb?: number;
}

/** Error raised when the standing narration flow gate finds unwanted silences inside a sentence. */
export class NarrationFlowError extends Error {
  report: NarrationFlowReport;

  // Attaches the structured flow report to the thrown error so callers can inspect the exact gaps.
  constructor(report: NarrationFlowReport) {
    super(report.summary);
    this.name = "NarrationFlowError";
    this.report = report;
  }
}

// Rounds a number to `digits` decimal places for clean reports and deterministic assertions.
function round(n: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

// True when a word ends a sentence (. ! ? or Devanagari danda, with optional closing quotes/brackets), excluding abbreviations.
export function isSentenceEndingWord(word: string): boolean {
  const trimmed = word.trim();
  if (!/[.!?।]["'\u2019\u201d)\]]*$/.test(trimmed)) return false;
  const bare = trimmed.replace(/["'\u2019\u201d)\]]+$/g, "");
  if (/^(?:[A-Za-z]\.){2,}$/.test(bare)) return false;
  if (NON_SENTENCE_ABBREVIATIONS.has(bare.toLowerCase())) return false;
  return true;
}

// Splits one paragraph into whole sentences while keeping decimals, abbreviations and dotted identifiers intact.
export function splitIntoSentences(text: string): string[] {
  const paragraphs = text.split(/\r?\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const paragraph of paragraphs) {
    const tokens = paragraph.split(/\s+/).filter(Boolean);
    let current: string[] = [];
    for (const token of tokens) {
      current.push(token);
      if (isSentenceEndingWord(token)) {
        out.push(current.join(" "));
        current = [];
      }
    }
    if (current.length > 0) out.push(current.join(" "));
  }
  return out;
}

// Splits an over-long single sentence at clause boundaries (, ; : -) before ever falling back to word boundaries.
export function splitSentenceAtClauses(sentence: string, maxChars: number): string[] {
  const trimmed = sentence.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // Break into clause units that retain their trailing clause punctuation.
  const clauses = trimmed
    .split(/(?<=[,;:])\s+|(?<=\s-)\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  const pushWords = (clause: string) => {
    const words = clause.split(/\s+/).filter(Boolean);
    let piece = "";
    for (const w of words) {
      if (!piece) {
        piece = w;
      } else if (`${piece} ${w}`.length <= maxChars) {
        piece = `${piece} ${w}`;
      } else {
        chunks.push(piece);
        piece = w;
      }
    }
    if (piece) chunks.push(piece);
  };

  for (const clause of clauses) {
    if (clause.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      pushWords(clause);
    } else if (!current) {
      current = clause;
    } else if (`${current} ${clause}`.length <= maxChars) {
      current = `${current} ${clause}`;
    } else {
      chunks.push(current);
      current = clause;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Splits a narration segment into whole-sentence TTS chunks, breaking only at clause ends when a single sentence exceeds maxChars.
export function splitSentencesForTTS(text: string, maxChars = 800): string[] {
  const sentences = splitIntoSentences(text);
  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence);
    } else {
      chunks.push(...splitSentenceAtClauses(sentence, maxChars));
    }
  }
  return chunks.filter(Boolean);
}

// Computes approximate relative positions (0..1) of internal clause punctuation marks within a sentence.
export function clauseBoundaryFractions(sentence: string): number[] {
  const tokens = sentence.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [];
  const weights = tokens.map((tok) => Math.max(1, tok.replace(/[^a-z0-9]/gi, "").length));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const fractions: number[] = [];
  let acc = 0;
  for (let i = 0; i < tokens.length - 1; i++) {
    acc += weights[i];
    const tok = tokens[i];
    if (/[,;:]["'\u2019\u201d)\]]*$/.test(tok) || tok === "-") {
      fractions.push(acc / total);
    }
  }
  return fractions;
}

// Computes fixed-length RMS frame levels in dB across mono PCM samples using the shared voice-activity frame length.
export function frameLevelsDb(
  samples: Float32Array,
  sampleRate: number,
  frameSec: number = ACTIVITY_FRAME_SEC,
): number[] {
  const frameSamples = Math.max(1, Math.round(sampleRate * frameSec));
  const count = Math.floor(samples.length / frameSamples);
  const levels: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * frameSamples;
    let sumSq = 0;
    for (let j = 0; j < frameSamples; j++) {
      const s = samples[start + j];
      sumSq += s * s;
    }
    const rmsSq = sumSq / frameSamples;
    levels.push(rmsSq > 0 ? 10 * Math.log10(rmsSq) : -Infinity);
  }
  return levels;
}

// Finds active speech runs from PCM samples using a configurable dB floor (defaulting to shared SPEECH_FLOOR_DB).
function activeRunsFromSamples(
  samples: Float32Array,
  sampleRate: number,
  speechFloorDb: number = SPEECH_FLOOR_DB,
): Array<{ startSec: number; endSec: number }> {
  const levels = frameLevelsDb(samples, sampleRate, ACTIVITY_FRAME_SEC);
  if (speechFloorDb === SPEECH_FLOOR_DB) return activeRunsFromLevels(levels, ACTIVITY_FRAME_SEC);
  // Shift levels relative to the shared floor so activeRunsFromLevels applies the requested floor.
  const delta = SPEECH_FLOOR_DB - speechFloorDb;
  return activeRunsFromLevels(levels.map((db) => (Number.isFinite(db) ? db + delta : db)), ACTIVITY_FRAME_SEC);
}

// Applies a short fade-out on the tail of a segment and a fade-in on the head of the next segment around a splice.
function applySpliceFadeOut(buf: Float32Array, fadeSamples: number): Float32Array {
  const out = Float32Array.from(buf);
  const fade = Math.min(fadeSamples, out.length);
  for (let i = 0; i < fade; i++) {
    out[out.length - 1 - i] *= i / fade;
  }
  return out;
}

// Applies a short linear fade-in on the head of a segment after a compacted silence.
function applySpliceFadeIn(buf: Float32Array, fadeSamples: number): Float32Array {
  const out = Float32Array.from(buf);
  const fade = Math.min(fadeSamples, out.length);
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
  }
  return out;
}

// Compacts unwanted engine-inserted internal silences inside one synthesized sentence chunk without introducing clicks.
export function compactInternalPauses(
  samples: Float32Array,
  sampleRate: number,
  options: CompactPauseOptions = {},
): Float32Array {
  if (samples.length === 0) return samples;
  const midClauseTriggerSec = (options.midClauseTriggerMs ?? DEFAULT_MID_CLAUSE_TRIGGER_MS) / 1000;
  const maxMidClausePauseSec = (options.maxMidClausePauseMs ?? DEFAULT_MAX_MID_CLAUSE_PAUSE_MS) / 1000;
  const maxClausePauseSec = (options.maxClausePauseMs ?? DEFAULT_MAX_CLAUSE_PAUSE_MS) / 1000;
  const fadeSamples = Math.max(1, Math.round(((options.fadeMs ?? DEFAULT_COMPACT_FADE_MS) / 1000) * sampleRate));
  const floorDb = options.speechFloorDb ?? SPEECH_FLOOR_DB;

  const runs = activeRunsFromSamples(samples, sampleRate, floorDb);
  if (runs.length < 2) return samples;

  const speechStart = runs[0].startSec;
  const speechEnd = runs[runs.length - 1].endSec;
  const speechSpan = Math.max(1e-6, speechEnd - speechStart);
  const clauseFractions = options.sentenceText ? clauseBoundaryFractions(options.sentenceText) : [];

  interface CutRange {
    startSample: number;
    endSample: number;
    keepSamples: number;
  }
  const cuts: CutRange[] = [];

  for (let i = 1; i < runs.length; i++) {
    const gapStartSec = runs[i - 1].endSec;
    const gapEndSec = runs[i].startSec;
    const gapSec = gapEndSec - gapStartSec;
    const midpointRel = ((gapStartSec + gapEndSec) / 2 - speechStart) / speechSpan;
    const nearClause = clauseFractions.some((frac) => Math.abs(frac - midpointRel) <= CLAUSE_WINDOW_FRACTION);

    const trigger = nearClause ? maxClausePauseSec : midClauseTriggerSec;
    if (gapSec <= trigger) continue;

    const targetSec = nearClause ? maxClausePauseSec : maxMidClausePauseSec;
    const startSample = Math.max(0, Math.min(samples.length, Math.round(gapStartSec * sampleRate)));
    const endSample = Math.max(startSample, Math.min(samples.length, Math.round(gapEndSec * sampleRate)));
    const keepSamples = Math.min(endSample - startSample, Math.max(0, Math.round(targetSec * sampleRate)));
    if (endSample - startSample > keepSamples) {
      cuts.push({ startSample, endSample, keepSamples });
    }
  }

  if (cuts.length === 0) return samples;

  const pieces: Float32Array[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    const left = samples.subarray(cursor, cut.startSample);
    pieces.push(applySpliceFadeOut(left, fadeSamples));
    if (cut.keepSamples > 0) pieces.push(new Float32Array(cut.keepSamples));
    cursor = cut.endSample;
  }
  const tail = samples.subarray(cursor);
  pieces.push(applySpliceFadeIn(tail, fadeSamples));

  // Ensure every intermediate speech piece after the first cut also fades in cleanly after the kept silence.
  for (let p = 2; p < pieces.length - 1; p++) {
    const prevWasSilence = cuts.some((c) => c.keepSamples > 0 && pieces[p - 1].length === c.keepSamples);
    if (prevWasSilence && pieces[p].length > 0) {
      pieces[p] = applySpliceFadeIn(pieces[p], fadeSamples);
    }
  }

  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.length;
  }
  return out;
}

// Groups timed narration words into sentence spans using sentence-ending punctuation; returns empty when words have no sentence punctuation.
export function sentenceSpansFromWords(words: readonly FlowWord[]): SentenceSpan[] {
  if (words.length === 0) return [];
  const hasSentencePunct = words.some((w) => isSentenceEndingWord(w.punctuated_word ?? w.word));
  if (!hasSentencePunct) return [];

  const spans: SentenceSpan[] = [];
  let startIdx = 0;
  for (let i = 0; i < words.length; i++) {
    const token = words[i].punctuated_word ?? words[i].word;
    const isLast = i === words.length - 1;
    if (isSentenceEndingWord(token) || isLast) {
      const slice = words.slice(startIdx, i + 1);
      spans.push({
        text: slice.map((w) => w.punctuated_word ?? w.word).join(" "),
        startSec: slice[0].start,
        endSec: slice[slice.length - 1].end,
        segmentIndex: 0,
        sentenceIndex: spans.length,
      });
      startIdx = i + 1;
    }
  }
  return spans;
}

// Finds silence gaps exceeding maxGapSec strictly inside each sentence span directly from PCM narration samples.
export function detectInSentenceAudioGaps(
  samples: Float32Array,
  sampleRate: number,
  sentences: readonly SentenceSpan[],
  maxGapSec: number = DEFAULT_MAX_IN_SENTENCE_GAP_SEC,
  speechFloorDb: number = SPEECH_FLOOR_DB,
): InSentenceGap[] {
  const gaps: InSentenceGap[] = [];
  for (const sentence of sentences) {
    const startSample = Math.max(0, Math.floor(sentence.startSec * sampleRate));
    const endSample = Math.min(samples.length, Math.ceil(sentence.endSec * sampleRate));
    if (endSample <= startSample) continue;
    const slice = samples.subarray(startSample, endSample);
    const runs = activeRunsFromSamples(slice, sampleRate, speechFloorDb);
    for (let i = 1; i < runs.length; i++) {
      const gapStart = sentence.startSec + runs[i - 1].endSec;
      const gapEnd = sentence.startSec + runs[i].startSec;
      const durationSec = gapEnd - gapStart;
      if (durationSec > maxGapSec) {
        gaps.push({
          sentenceIndex: sentence.sentenceIndex,
          sentenceText: sentence.text,
          startSec: round(gapStart),
          endSec: round(gapEnd),
          durationSec: round(durationSec),
          source: "audio",
        });
      }
    }
  }
  return gaps;
}

// Finds word-timing gaps exceeding maxGapSec between two consecutive words inside the same sentence.
export function detectInSentenceWordGaps(
  words: readonly FlowWord[],
  maxGapSec: number = DEFAULT_MAX_IN_SENTENCE_GAP_SEC,
): InSentenceGap[] {
  if (words.length < 2) return [];
  const hasSentencePunct = words.some((w) => isSentenceEndingWord(w.punctuated_word ?? w.word));
  if (!hasSentencePunct) return [];

  const spans = sentenceSpansFromWords(words);
  const gaps: InSentenceGap[] = [];
  let sentenceIdx = 0;

  for (let i = 1; i < words.length; i++) {
    const prevWord = words[i - 1].punctuated_word ?? words[i - 1].word;
    if (isSentenceEndingWord(prevWord)) {
      sentenceIdx = Math.min(spans.length - 1, sentenceIdx + 1);
      continue;
    }
    const gap = words[i].start - words[i - 1].end;
    if (gap > maxGapSec) {
      gaps.push({
        sentenceIndex: sentenceIdx,
        sentenceText: spans[sentenceIdx]?.text ?? `${prevWord} ${words[i].punctuated_word ?? words[i].word}`,
        startSec: round(words[i - 1].end),
        endSec: round(words[i].start),
        durationSec: round(gap),
        source: "words",
      });
    }
  }
  return gaps;
}

// Finds acoustic silence intervals (such as ffmpeg silencedetect) falling strictly inside a timed sentence span.
export function detectInSentenceSilences(
  words: readonly FlowWord[],
  silences: readonly SilenceSpan[],
  maxGapSec: number = DEFAULT_MAX_IN_SENTENCE_GAP_SEC,
): InSentenceGap[] {
  const sentences = sentenceSpansFromWords(words);
  if (sentences.length === 0 || silences.length === 0) return [];

  const gaps: InSentenceGap[] = [];
  for (const silence of silences) {
    const durationSec = silence.end - silence.start;
    if (durationSec <= maxGapSec) continue;
    for (const sentence of sentences) {
      if (
        silence.start >= sentence.startSec + SENTENCE_EDGE_MARGIN_SEC &&
        silence.end <= sentence.endSec - SENTENCE_EDGE_MARGIN_SEC
      ) {
        gaps.push({
          sentenceIndex: sentence.sentenceIndex,
          sentenceText: sentence.text,
          startSec: round(silence.start),
          endSec: round(silence.end),
          durationSec: round(durationSec),
          source: "silence",
        });
        break;
      }
    }
  }
  return gaps;
}

// Evaluates the standing in-sentence flow gate on joined PCM narration and its sentence spans.
export function checkNarrationFlow(
  samples: Float32Array,
  sampleRate: number,
  sentences: readonly SentenceSpan[],
  options: { maxGapSec?: number; speechFloorDb?: number } = {},
): NarrationFlowReport {
  const maxGapSec = options.maxGapSec ?? DEFAULT_MAX_IN_SENTENCE_GAP_SEC;
  const gaps = detectInSentenceAudioGaps(samples, sampleRate, sentences, maxGapSec, options.speechFloorDb);
  const passed = gaps.length === 0;
  const summary = passed
    ? `all ${sentences.length} sentence(s) flow with no internal silence over ${maxGapSec} s`
    : `${gaps.length} unwanted silence gap(s) over ${maxGapSec} s inside a sentence: ${gaps
        .slice(0, 4)
        .map((g) => `${g.durationSec.toFixed(2)} s at ${g.startSec.toFixed(2)} s in "${g.sentenceText.slice(0, 60)}"`)
        .join("; ")}`;
  return {
    passed,
    maxGapSec,
    sentencesChecked: sentences.length,
    gaps,
    summary,
  };
}
