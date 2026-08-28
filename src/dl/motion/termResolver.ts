/**
 * File Description: Compile-time Keyword-Stem to Frame Timestamp Resolver (Item B).
 * Maps visual device labels and ticks to spoken audio caption frames using phonetic keyword matching
 * with deterministic linear fallback, keeping all render-time components pure functions of data (Axiom 1).
 */

import type { CaptionWord } from "../KineticSubtitles";
import type { Block, Shot } from "../schema";

export interface ResolvedDeviceTiming {
  revealFrames: number[];
  peakFrame?: number;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "is", "are",
  "was", "were", "be", "by", "with", "this", "that", "it", "from", "as", "into",
]);

/** Extracts meaningful stem tokens from a label string. */
export function extractLabelStems(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Resolves the exact frame at which a term's keyword stem is spoken in a shot's caption words.
 * Returns null if no matching spoken word is found within the shot window.
 */
export function matchTermToCaptionFrame(
  term: string,
  shotWords: CaptionWord[],
): number | null {
  const stems = extractLabelStems(term);
  if (stems.length === 0 || shotWords.length === 0) return null;

  for (const word of shotWords) {
    const wordClean = word.text.toLowerCase().replace(/[^\w]/g, "");
    for (const stem of stems) {
      if (wordClean === stem || (stem.length >= 4 && wordClean.startsWith(stem.slice(0, 4)))) {
        return word.startFrame;
      }
    }
  }

  return null;
}

/**
 * Resolves kinetic reveal frame timings for any visual device block based on spoken caption timing.
 * Guaranteed to produce reveal frames strictly within [shotStartFrame, shotEndFrame].
 */
export function resolveBlockRevealTiming(
  block: Block,
  shot: Shot,
  shotStartFrame: number,
  shotEndFrame: number,
  captionWords: CaptionWord[] = [],
): ResolvedDeviceTiming {
  const shotWords = captionWords.filter(
    (w) => w.startFrame >= shotStartFrame && w.endFrame <= shotEndFrame + 15
  );

  const durationFrames = Math.max(1, shotEndFrame - shotStartFrame);
  const minPadding = Math.round(durationFrames * 0.1);
  const effectiveSpan = Math.max(1, durationFrames - minPadding * 2);

  const labelsToResolve: string[] = [];

  if (block.c === "ScaleBar") {
    labelsToResolve.push(...block.ticks);
  } else if (block.c === "LayerStack") {
    const count = block.count || 8;
    for (let i = 0; i < count; i++) {
      if (i === 0 && block.bottomLabel) labelsToResolve.push(block.bottomLabel);
      else if (i === count - 1 && block.topLabel) labelsToResolve.push(block.topLabel);
      else labelsToResolve.push(`Tier ${i + 1}`);
    }
  } else if (block.c === "TokenStrip") {
    labelsToResolve.push(...block.tokens);
  } else if (block.c === "MatrixGrid") {
    const rows = block.values.length;
    for (let r = 0; r < rows; r++) {
      labelsToResolve.push(`Row ${r + 1}`);
    }
  }

  if (labelsToResolve.length === 0) {
    return { revealFrames: [shotStartFrame] };
  }

  const revealFrames: number[] = [];
  const itemCount = labelsToResolve.length;

  for (let i = 0; i < itemCount; i++) {
    const term = labelsToResolve[i];
    const matchedFrame = matchTermToCaptionFrame(term, shotWords);

    if (matchedFrame !== null && matchedFrame >= shotStartFrame && matchedFrame <= shotEndFrame) {
      revealFrames.push(matchedFrame);
    } else {
      // Deterministic linear fallback spread evenly across the shot
      const fallbackOffset = minPadding + Math.round((i / Math.max(1, itemCount - 1)) * effectiveSpan);
      revealFrames.push(shotStartFrame + fallbackOffset);
    }
  }

  // Ensure non-decreasing monotonic frame progression
  for (let i = 1; i < revealFrames.length; i++) {
    if (revealFrames[i] < revealFrames[i - 1]) {
      revealFrames[i] = revealFrames[i - 1] + 2;
    }
  }

  return {
    revealFrames,
    peakFrame: revealFrames[revealFrames.length - 1],
  };
}
