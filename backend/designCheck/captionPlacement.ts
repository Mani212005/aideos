/**
 * File Description: Format-aware owner caption collision and bounds checks over the rendered scene geometry.
 * Inputs and outputs: parsed film and optional scene -> caption-placement findings naming the art or inset.
 * Used by: checkFilmDesign and studio design reports.
 */
import type { Film } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import { buildTimeline } from "../../src/dl/camera";
import { buildCaptionPhrases, captionPhraseAtFrame } from "../../src/dl/captionPhrases";
import { captionWordsForFilm } from "../../src/dl/captionsParser";
import { measureCaptionWords } from "../review/captionMeasurements";
import {
  CAPTION_FRAMES,
  captionCardRect,
  captionRectsOverlap,
  resolveCaptionPlacement,
  resolveCaptionCardWidth,
  clampCaptionPlacement,
} from "../../src/dl/captionPlacement";
import { getInsetRegion } from "../../src/dl/fullScreenHeroLayout";
import { prepareSvgProjection } from "./insetRegion";
import type { DesignFinding } from "./designCheck";
// Reports unsafe explicit entries and stage art that occupies an owner's placed card.
export function checkCaptionPlacements(
  film: Film,
  scene?: Scene,
  sample?: { format: "long" | "reel"; shotId: string; frame: number },
): DesignFinding[] {
  const findings: DesignFinding[] = [];
  if (film.captions === "off" || film.subtitles === false) return findings;
  const timeline = buildTimeline(film, film.voiceover?.durationSec);
  const words = captionWordsForFilm(film);
  for (const format of ["long", "reel"] as const) {
    if (sample && sample.format !== format) continue;
    const { width, height } = CAPTION_FRAMES[format];
    for (const [where, entry] of [
      ["film", film.captionPlacement?.[format]],
      ...film.shots.map(
        (s) => [`shot ${s.id}`, s.captionPlacement?.[format]] as const,
      ),
    ] as const) {
      if (!entry) continue;
      const safe = clampCaptionPlacement(entry, format);
      if (
        Math.abs(safe.x - entry.x) +
          Math.abs(safe.y - entry.y) +
          Math.abs(safe.w - entry.w) >
        1e-6
      )
        findings.push({
          rule: "caption-placement",
          severity: "error",
          where: `${where} / ${format}`,
          message:
            "caption card is outside the format bounds or width limits; reset it or move and resize it inside the safe area.",
        });
    }
    const fontSize = Math.round(Math.min(width, height) * 0.042);
    const hasCustomWidth = timeline.some((t) => resolveCaptionCardWidth(resolveCaptionPlacement(film, format, t.shot.id), width).fixed);
    const wordWidths = hasCustomWidth
      ? measureCaptionWords(words.map((word) => word.text), fontSize)
      : {};
    const phrases = buildCaptionPhrases({
      words,
      fps: film.fps,
      width,
      fontSize,
      placementAt: (startFrame) => resolveCaptionPlacement(film, format, timeline.find((t) => startFrame >= t.from && startFrame < t.to)?.shot.id),
      measure: (text) => wordWidths[text],
    });
    let project: ReturnType<typeof prepareSvgProjection> | undefined;
    if (
      scene &&
      timeline.some(
        (t) =>
          resolveCaptionPlacement(film, format, t.shot.id).source !== "default",
      )
    ) {
      try {
        project = prepareSvgProjection(scene, width, height);
      } catch {
        /* Scene validity is reported by the scene rule. */
      }
    }
    const frames = sample
      ? [sample.frame]
      : timeline.flatMap((timed) =>
          Array.from(
            { length: Math.ceil((timed.to - timed.from) / 3) },
            (_, i) => timed.from + i * 3,
          ),
        );
    const reported = new Set<string>();
    for (const frame of frames) {
      const timed = timeline.find((t) => frame >= t.from && frame < t.to);
      if (!timed) continue;
      const phrase = captionPhraseAtFrame(phrases, frame);
      const placementShotId = phrase
        ? timeline.find((t) => phrase.startFrame >= t.from && phrase.startFrame < t.to)?.shot.id
        : sample?.shotId ?? timed.shot.id;
      const resolved = resolveCaptionPlacement(film, format, placementShotId);
      if (resolved.source === "default") continue;
      const placement = phrase?.placement ?? resolved;
      const rect = captionCardRect(format, width, height, placement, 2);
      const where = `shot ${placementShotId} / ${format}`;
      if (
        timed.shot.stage === "inset" &&
        captionRectsOverlap(rect, getInsetRegion(format, width, height))
      )
        findings.push({
          rule: "caption-placement",
          severity: "error",
          where,
          message: `caption card overlaps the device inset; move the ${placement.locked ? "art around the locked caption" : "card beside the inset"}.`,
        });
      if (project)
        for (const asset of project(frame))
          for (const part of asset.parts) {
            const b = part.bounds;
            if (
              captionRectsOverlap(rect, {
                x: b.x0,
                y: b.y0,
                w: b.x1 - b.x0,
                h: b.y1 - b.y0,
              }) &&
              !reported.has(`${phrase?.startFrame ?? frame}:${asset.id}`)
            ) {
              reported.add(`${phrase?.startFrame ?? frame}:${asset.id}`);
              findings.push({
                rule: "caption-placement",
                severity: "warning",
                where: `${where} / ${asset.id}`,
                message: `art ${asset.id}/${part.name} collides with the ${placement.locked ? "locked " : ""}caption card at frame ${frame}; move the art clear of the placed card.`,
              });
            }
          }
    }
  }
  return findings;
}
