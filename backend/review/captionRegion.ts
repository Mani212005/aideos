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
// Resolves at phrase start so review follows captions across a cut instead of jumping with the shot.
export function prepareCaptionReview(
  film: Film,
  width: number,
  height: number,
) {
  if (!film.captionPlacement && !film.shots.some((s) => s.captionPlacement))
    return undefined;
  const format = width < height ? "reel" : "long";
  const timeline = buildTimeline(film, film.voiceover?.durationSec);
  const fontSize = Math.round(Math.min(width, height) * 0.042);
  const words = captionWordsForFilm(film);
  const variableWidth = timeline.some(
    (timed) =>
      resolveCaptionCardWidth(resolveCaptionPlacement(film, format, timed.shot.id), width).fixed,
  );
  const widths = variableWidth
    ? measureCaptionWords(
        words.map((word) => word.text),
        fontSize,
      )
    : {};
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
    return captionCardRect(format, width, height, placement);
  };
}
