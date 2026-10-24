/**
 * File Description: Combines caption collision checks for the studio placement preview.
 * Inputs and outputs: draft film, scene, format and active frame -> caption collision findings.
 * Used by: the studio caption placement check endpoint.
 */
import type { Film } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import type { DesignFinding } from "./designCheck";
import { checkCaptionPlacementsAsync } from "./captionPlacement";
import { checkThreeStage } from "./threeStage";

// Returns scene and posed-character collisions for the active caption frame.
export async function checkCaptionPlacementDraftAsync(
  film: Film,
  scene: Scene | undefined,
  sample: { format: "long" | "reel"; shotId: string; frame: number },
  timingFilm: Film = film,
): Promise<DesignFinding[]> {
  const findings = await checkCaptionPlacementsAsync(film, scene, sample, timingFilm);
  if (scene?.renderer !== "three") return findings;
  const formatSegment = `/ ${sample.format} /`;
  const suffix = `/ frame ${sample.frame}`;
  const characterFindings = checkThreeStage(film, scene, {}, {
    format: sample.format,
    frame: sample.frame,
  }).filter(
    (finding) =>
      finding.rule === "caption-placement" &&
      finding.where.includes(formatSegment) &&
      finding.where.endsWith(suffix),
  );
  return [
    ...findings,
    ...characterFindings.map((finding) => ({ ...finding, severity: "warning" as const })),
  ];
}
