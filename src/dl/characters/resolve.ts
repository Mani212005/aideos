/**
 * File Description: Resolves compiled stage character references to browser-safe character specs.
 * Inputs and outputs: embedded character or legacy Iona cast reference -> CharacterSpec or undefined.
 * Used by: Three stage rendering, validation, stage facts and material checks.
 */
import ionaCharacter from "../../../characters/iona.character.json";
import { characterSpecSchema, type CharacterSpec } from "./schema";
import type { StageCast } from "../scene/stageContract";

export const IONA_CHARACTER_SPEC = characterSpecSchema.parse(ionaCharacter) as CharacterSpec;

export interface CharacterReference {
  kind: "character";
  id: string;
  character?: CharacterSpec;
  asset?: string;
  rig?: string;
}

/** Carries a character cast's placement together with the verified spec used to render it. */
export type ResolvedStageCharacter = {
  cast: Extract<StageCast, { kind: "character" }> & { position: [number, number]; unitsToStage: number; depth: number };
  spec: CharacterSpec;
};

// Identifies the exact P0 cast record that remains renderable as Iona.
export function isLegacyIonaReference(cast: CharacterReference): boolean {
  return cast.id === "iona" && cast.asset === "iona-art-v1" && cast.rig === "iona-v1" && !cast.character;
}

// Uses embedded data for current films and the stamped library spec for the narrow P0 Iona alias.
export function resolveCharacterSpec(cast: CharacterReference): CharacterSpec | undefined {
  if (cast.character) return cast.character;
  // This alias preserves only the original Iona P0 actor contract.
  if (isLegacyIonaReference(cast)) return IONA_CHARACTER_SPEC;
  return undefined;
}

/** Resolves a stage cast while preserving its shared placement fields across current and legacy forms. */
export function resolveStageCharacter(cast: Extract<StageCast, { kind: "character" }>): ResolvedStageCharacter | undefined {
  const spec = resolveCharacterSpec(cast);
  if (!spec) return undefined;
  return { cast: cast as ResolvedStageCharacter["cast"], spec };
}
