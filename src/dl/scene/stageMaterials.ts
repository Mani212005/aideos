/**
 * File Description: Finite material declarations: each character's own spec palette plus its prop's colours.
 * Inputs and outputs: character spec or cast reference and prop asset -> allowed authored base and outline colours.
 * Used by: stage facts and the Three stage design gates; shading and antialiasing do not enlarge a declaration.
 */
import type { CharacterSpec } from "../characters/schema";
import { resolveCharacterSpec, type CharacterReference } from "../characters/resolve";
import type { PropAsset } from "./props/paperGlider";

/** Authored colours of each prop the stage can build. */
export const PROP_MATERIAL_PALETTES: Readonly<Record<PropAsset, readonly string[]>> = {
  "paper-glider-v1": ["#f2e8d0", "#b5532f"],
};

/** White is the colour of the textured head material, whose painted face is checked through the spec's own colours. */
const FACE_TEXTURE_BASE = "#ffffff";

// Declares every colour one performer may draw: its spec palette, the face texture base and its prop's colours.
export function declaredMaterialPalette(source: CharacterSpec | CharacterReference, prop: PropAsset): string[] {
  const character = "kind" in source ? resolveCharacterSpec(source) : source;
  if (!character) throw new Error("material palette requires a resolved character spec");
  return [...new Set([...Object.values(character.palette).map((c) => c.toLowerCase()), FACE_TEXTURE_BASE, ...PROP_MATERIAL_PALETTES[prop]])];
}
