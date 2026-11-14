/**
 * File Description: Narrows a look plan to the shots a cut reel keeps, so the look contract is judged against the reel it describes.
 * Inputs and outputs: a look plan and the ids of the shots the cut drops -> a look plan without those shots' cast changes, camera poses and shot rows.
 * Used by: backend/reelCut/build.ts.
 */
import { cueShot } from "../designSpec/cues";
import type { LookPlan } from "../lookPlan/schema";

// Drops the planned states, camera poses and shot rows that belong to dropped shots; a cut that drops nothing returns the plan itself.
export function lookPlanForKeptShots(look: LookPlan, dropped: ReadonlySet<string>): LookPlan {
  if (!dropped.size) return look;
  const kept = <T extends { at: string }>(items: T[], shotOf: (at: string) => string | undefined): T[] =>
    items.filter((item) => { const shot = shotOf(item.at); return shot === undefined || !dropped.has(shot); });
  return {
    ...look,
    shots: look.shots.filter((shot) => !dropped.has(shot.id)),
    film: {
      ...look.film,
      cast: look.film.cast.map((item) => ({ ...item, changes: kept(item.changes, (at) => at) })),
      camera: kept(look.film.camera, cueShot),
    },
  } as LookPlan;
}
