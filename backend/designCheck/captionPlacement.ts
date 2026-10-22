/**
 * File Description: Format-aware owner caption collision and bounds checks over the rendered scene geometry.
 * Inputs and outputs: parsed film and optional scene -> caption-placement findings naming the art or inset.
 * Used by: checkFilmDesign and studio design reports.
 */
import type { Film } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import { buildTimeline } from "../../src/dl/camera";
import {
  CAPTION_FRAMES,
  captionCardRect,
  captionRectsOverlap,
  resolveCaptionPlacement,
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
    for (const timed of timeline) {
      if (sample && sample.shotId !== timed.shot.id) continue;
      const placement = resolveCaptionPlacement(film, format, timed.shot.id);
      if (placement.source === "default") continue;
      const rect = captionCardRect(format, width, height, placement, 2);
      const where = `shot ${timed.shot.id} / ${format}`;
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
      const reported = new Set<string>();
      for (
        let frame = sample?.frame ?? timed.from;
        project && frame < (sample ? sample.frame + 1 : timed.to);
        frame += 3
      ) {
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
              !reported.has(asset.id)
            ) {
              reported.add(asset.id);
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
  }
  return findings;
}
