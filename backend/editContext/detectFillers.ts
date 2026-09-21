/**
 * File Description: Pure filler-word detection over transcribed word timings. A fixed lexicon of
 * near-certain fillers ("um", "uh", ...) is always flagged; a second lexicon of words that are
 * only fillers in a mumbled aside ("like", "you know") is flagged only when the ASR backend's own
 * per-word confidence falls below a threshold, so an intentional "I like this" is never touched.
 */

import type { TranscribedWord } from "../transcribe";

export interface FillerSpan {
  /** Index into the source words array where the filler starts (inclusive). */
  startIndex: number;
  /** Index into the source words array where the filler ends (inclusive). Covers "you know". */
  endIndex: number;
  start: number;
  end: number;
  text: string;
}

export interface DetectFillersOptions {
  /** Below this confidence, a context-dependent word ("like", "you know") counts as filler. */
  confidenceThreshold?: number;
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

/** Always a filler, regardless of confidence. */
const STRONG_FILLERS = new Set(["um", "umm", "uh", "uhh", "er", "err", "ah", "hmm", "hm", "mhmm"]);

/** Only a filler when spoken with low confidence; otherwise a legitimate word. */
const WEAK_FILLERS = new Set(["like"]);
const WEAK_FILLER_BIGRAMS: ReadonlyArray<[string, string]> = [["you", "know"]];

/** Strips punctuation and case so lexicon matches are stable across transcript formatting. */
function normalize(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

/** Finds every filler word or phrase in a transcript, in source order. */
export function detectFillers(words: TranscribedWord[], options: DetectFillersOptions = {}): FillerSpan[] {
  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const spans: FillerSpan[] = [];
  let i = 0;

  while (i < words.length) {
    const word = words[i];
    const norm = normalize(word.word);
    const lowConfidence = word.confidence !== undefined && word.confidence < threshold;

    if (i + 1 < words.length) {
      const next = words[i + 1];
      const nextLowConfidence = next.confidence !== undefined && next.confidence < threshold;
      const isWeakBigram = WEAK_FILLER_BIGRAMS.some(([a, b]) => a === norm && b === normalize(next.word));
      if (isWeakBigram && lowConfidence && nextLowConfidence) {
        spans.push({ startIndex: i, endIndex: i + 1, start: word.start, end: next.end, text: `${word.word} ${next.word}` });
        i += 2;
        continue;
      }
    }

    if (STRONG_FILLERS.has(norm) || (WEAK_FILLERS.has(norm) && lowConfidence)) {
      spans.push({ startIndex: i, endIndex: i, start: word.start, end: word.end, text: word.word });
    }
    i += 1;
  }

  return spans;
}
