/**
 * File Description: Shared optional stage shading contract and absolute-frame treatment resolution.
 * Inputs and outputs: film default, cast default and nonoverlapping shot spans -> cel-v1 or dots-v1.
 * Used by: look/design schemas, compiler, ThreeStage, facts and character sheet CLI.
 */
import { z } from "zod";

export const stageTreatmentSchema = z.enum(["cel-v1", "dots-v1"]);
export type StageTreatment = z.infer<typeof stageTreatmentSchema>;
export const treatmentSpanSchema = z.strictObject({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(), treatment: stageTreatmentSchema });
export type TreatmentSpan = z.infer<typeof treatmentSpanSchema>;

// Resolves an absolute frame without retaining playback or seek history.
export function stageTreatmentAt(scene: { treatment?: StageTreatment; treatments?: TreatmentSpan[] }, frame: number, castTreatment: StageTreatment = "cel-v1"): StageTreatment {
  return scene.treatments?.find((span) => frame >= span.startFrame && frame < span.endFrame)?.treatment ?? scene.treatment ?? castTreatment;
}
