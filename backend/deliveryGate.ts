/**
 * File Description: The delivery gate. Every delivered video carries music, sound effects and the call to action end card; this names what a film is missing in plain language and refuses delivery until it is complete.
 * Inputs and outputs: Film and delivery format -> a list of missing requirements, or a thrown DeliveryRefusedError naming each one and how to fix it.
 * Used by: backend/pipeline/run.ts, scripts/render_active.ts, backend/geminiReview/render.ts, editor/vite.config.ts, backend/cli.ts.
 */

import { deliveryTimeline, DELIVERY_CONFIG, type DeliveryConfig, type DeliveryFormat } from "../src/dl/delivery";
import { normalizeFilmSoundtrack, type Film } from "../src/dl/schema";

/** The three things no video ships without. */
export type DeliveryRequirement = "music" | "sound-effects" | "end-card";

/** One requirement a film does not meet in one format. */
export interface DeliveryGap {
  requirement: DeliveryRequirement;
  format: DeliveryFormat;
  message: string;
}

/** Thrown when a film would be delivered without music, sound effects or the end card. */
export class DeliveryRefusedError extends Error {
  readonly gaps: DeliveryGap[];

  constructor(filmId: string, gaps: DeliveryGap[]) {
    super(
      `Delivery refused for "${filmId}": every video needs music, sound effects and the end card, and this one is missing ` +
        `${[...new Set(gaps.map((gap) => gap.requirement))].join(", ")}.\n${gaps.map((gap) => `  - ${gap.message}`).join("\n")}`,
    );
    this.name = "DeliveryRefusedError";
    this.gaps = gaps;
  }
}

// Lists what one format of a film is missing among music, sound effects and the end card.
export function deliveryGaps(film: Film, format: DeliveryFormat, config: DeliveryConfig = DELIVERY_CONFIG): DeliveryGap[] {
  const soundtrack = normalizeFilmSoundtrack(film);
  const label = `"${film.id}" (${format})`;
  const gaps: DeliveryGap[] = [];
  if (soundtrack.sections.length === 0 && !film.audioClips?.some((clip) => clip.channel === "music")) {
    gaps.push({
      requirement: "music",
      format,
      message: `${label} has no music. Run "aideos design build ${film.id}" to give it the default score, or author a soundtrack in design/design.json. If the audio library is not cached yet, run "aideos audio fetch" first.`,
    });
  }
  if (soundtrack.sfx.length === 0 && !film.audioClips?.some((clip) => clip.channel === "sfx")) {
    gaps.push({
      requirement: "sound-effects",
      format,
      message: `${label} has no sound effects. Run "aideos design build ${film.id}" to place the default effects, or author them in the soundtrack of design/design.json. If the audio library is not cached yet, run "aideos audio fetch" first.`,
    });
  }
  if (!deliveryTimeline(film, format, { config }).card) {
    gaps.push({
      requirement: "end-card",
      format,
      message: `${label} would be delivered without the end card, which every video must end with. The end card is compulsory and cannot be switched off per film; check endCard.enabled and endCard.durationSec in aideos.config.json (currently ${config.endCard.enabled ? "on" : "off"}, ${config.endCard.durationSec[format]}s).`,
    });
  }
  return gaps;
}

// Throws a DeliveryRefusedError when any of the given film cuts is missing music, sound effects or the end card.
export function assertDeliverable(cuts: Array<{ film: Film; format: DeliveryFormat }>): void {
  const gaps = cuts.flatMap(({ film, format }) => deliveryGaps(film, format));
  if (gaps.length > 0) throw new DeliveryRefusedError(cuts[0].film.id, gaps);
}
