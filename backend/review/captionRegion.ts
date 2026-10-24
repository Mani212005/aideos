/**
 * File Description: Prepares declared caption review rectangles from film words and output format.
 * Inputs and outputs: film and output size -> sample-time card rectangle lookup, absent for legacy films.
 * Used by: measured review and Gemini deterministic OCR facts.
 */
import type { Film } from "../../src/dl/schema";
import { captionWordsForFilm } from "../../src/dl/captionsParser";
import { buildCaptionPhrases, captionPhraseAtFrame } from "../../src/dl/captionPhrases";
import { buildTimeline, shotAt } from "../../src/dl/camera";
import {
  captionCardRect,
  resolveCaptionPlacement,
  resolveCaptionCardWidth,
} from "../../src/dl/captionPlacement";
import { measureCaptionWords } from "./captionMeasurements";
export type CaptionReviewRegion =
  | ((t: number) => ReturnType<typeof captionCardRect> | undefined)
  | { unavailable: string }
  | null
  | undefined;
// Checks whether a film or one of its shots declares placement for the rendered format.
export function hasCaptionPlacementForFormat(
  film: Film,
  format: "long" | "reel",
): boolean {
  return Boolean(
    film.captionPlacement?.[format] ||
      film.shots.some((shot) => shot.captionPlacement?.[format]),
  );
}
// Resolves at phrase start so review follows captions across a cut instead of jumping with the shot.
export function prepareCaptionReview(
  film: Film,
  width: number,
  height: number,
  measureWords = measureCaptionWords,
): CaptionReviewRegion {
  if (film.captions === "off" || film.subtitles === false) return null;
  const format = width < height ? "reel" : "long";
  if (!hasCaptionPlacementForFormat(film, format)) return undefined;
  const timeline = buildTimeline(film, film.voiceover?.durationSec);
  const fontSize = Math.round(Math.min(width, height) * 0.042);
  const words = captionWordsForFilm(film);
  const variableWidth = timeline.some(
    (timed) =>
      resolveCaptionCardWidth(resolveCaptionPlacement(film, format, timed.shot.id), width).fixed,
  );
  let widths: Record<string, number>;
  try {
    widths = variableWidth
      ? measureWords(
        words.map((word) => word.text),
        fontSize,
      )
      : {};
  } catch (error) {
    return {
      unavailable: error instanceof Error ? error.message : String(error),
    };
  }
  const phrases = buildCaptionPhrases({
    words,
    fps: film.fps,
    width,
    fontSize,
    placementAt: (frame) =>
      resolveCaptionPlacement(film, format, shotAt(timeline, frame)?.shot.id),
    measure: (text) => widths[text],
  });
  // Returns the declared region for a sampled time; gaps use the shot's ghost card.
  return (t: number) => {
    const frame = Math.round(t * film.fps);
    const phrase = captionPhraseAtFrame(phrases, frame);
    const placement =
      phrase?.placement ??
      resolveCaptionPlacement(film, format, shotAt(timeline, frame)?.shot.id);
    return placement.source === "default"
      ? undefined
      : captionCardRect(format, width, height, placement);
  };
}
