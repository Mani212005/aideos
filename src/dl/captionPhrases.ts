/**
 * File Description: Deterministic phrase splitting with placement fixed at the first spoken word.
 * Inputs and outputs: caption words, placement lookup and measured word widths -> timed two-line phrases.
 * Used by: KineticSubtitles and caption placement tests.
 */
import type { CaptionWord } from "./KineticSubtitles";
import type { CaptionPlacement } from "./schema";
export type CaptionPhrase = {
  startIndex: number;
  endIndex: number;
  startFrame: number;
  endFrame: number;
  words: CaptionWord[];
  placement: CaptionPlacement & { source?: "shot" | "film" | "default" };
  lineBreaks: number[];
};
// Finds the phrase displayed at a frame using the render's phrase boundaries.
export function captionPhraseAtFrame(
  phrases: CaptionPhrase[],
  frame: number,
): CaptionPhrase | undefined {
  return phrases.find((phrase) => frame >= phrase.startFrame && frame <= phrase.endFrame);
}
// Fits words into at most two rows without changing the font size.
export function captionWordRows(
  words: CaptionWord[],
  innerWidth: number,
  measure: (text: string) => number,
): number[] {
  const breaks: number[] = [];
  let used = 0;
  words.forEach((word, i) => {
    const size = measure(word.text) + 12;
    if (used > 0 && used + size > innerWidth) {
      breaks.push(i);
      used = 0;
    }
    used += size;
  });
  return breaks;
}
// Keeps the legacy seven-word split at default width and measures narrower cards before displaying them.
export function buildCaptionPhrases({
  words,
  fps,
  width,
  placementAt,
  measure,
}: {
  words: CaptionWord[];
  fps: number;
  fontSize: number;
  width: number;
  placementAt: (frame: number) => CaptionPlacement & { source?: "shot" | "film" | "default" };
  measure: (text: string) => number;
}): CaptionPhrase[] {
  const phrases: CaptionPhrase[] = [];
  let start = 0;
  while (start < words.length) {
    const placement = placementAt(words[start].startFrame);
    const customWidth = Math.abs(placement.w - 0.86) > 0.000001;
    const inner = width * placement.w - 58;
    let end = start;
    while (end + 1 < words.length && end - start < 6) {
      const word = words[end];
      if (
        /[.,!?;:]$/.test(word.text) ||
        words[end + 1].startFrame - word.endFrame > fps * 0.4
      )
        break;
      if (
        customWidth &&
        captionWordRows(words.slice(start, end + 2), inner, measure).length > 1
      )
        break;
      end++;
    }
    const chunk = words.slice(start, end + 1);
    phrases.push({
      startIndex: start,
      endIndex: end,
      startFrame: chunk[0].startFrame,
      endFrame: chunk[chunk.length - 1].endFrame + Math.round(fps * 0.25),
      words: chunk,
      placement,
      lineBreaks: customWidth ? captionWordRows(chunk, inner, measure) : [],
    });
    start = end + 1;
  }
  return phrases;
}
