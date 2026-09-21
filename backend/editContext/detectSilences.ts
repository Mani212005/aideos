/**
 * File Description: Pure dead-air detection over transcribed word timings. Any inter-word gap
 * past a minimum duration is a silence window, inset by a keep margin on both sides so trimming
 * it can never clip the words that bound it.
 */

import type { TranscribedWord } from "../transcribe";

export interface SilenceWindow {
  start: number;
  end: number;
}

export interface DetectSilencesOptions {
  /** Minimum gap between two words to count as dead air. */
  minSilenceSec?: number;
  /** Margin kept on both sides of the window so speech is never clipped. */
  keepMarginSec?: number;
}

const DEFAULT_MIN_SILENCE_SEC = 0.6;
const DEFAULT_KEEP_MARGIN_SEC = 0.15;

/** Finds every inter-word gap long enough to count as dead air, in source order. */
export function detectSilences(words: TranscribedWord[], options: DetectSilencesOptions = {}): SilenceWindow[] {
  const minSilenceSec = options.minSilenceSec ?? DEFAULT_MIN_SILENCE_SEC;
  const keepMarginSec = options.keepMarginSec ?? DEFAULT_KEEP_MARGIN_SEC;
  const windows: SilenceWindow[] = [];

  for (let i = 0; i + 1 < words.length; i++) {
    const gapStart = words[i].end;
    const gapEnd = words[i + 1].start;
    if (gapEnd - gapStart < minSilenceSec) continue;

    const start = Number((gapStart + keepMarginSec).toFixed(3));
    const end = Number((gapEnd - keepMarginSec).toFixed(3));
    if (end > start) windows.push({ start, end });
  }

  return windows;
}
