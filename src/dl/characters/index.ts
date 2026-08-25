/**
 * File Description: Character registry and export barrel for all pure TypeScript vector rigs.
 * Provides lookup helpers and inventory of all registered character rigs.
 */

import { astronautRig } from "./astronaut";
import { developerRig } from "./developer";
import type { CharacterRig } from "./types";

export * from "./types";
export * from "./presets";
export { astronautRig } from "./astronaut";
export { developerRig } from "./developer";

/** Registry map of all available character vector rigs keyed by id. */
export const CHARACTER_RIGS: Record<string, CharacterRig> = {
  astronaut: astronautRig,
  developer: developerRig,
};

/** Returns a character rig by its identifier or null if not found. */
export const getCharacterRigById = (id: string): CharacterRig | null =>
  CHARACTER_RIGS[id] ?? null;

/** Returns a list of all registered character rigs. */
export const getAllCharacterRigs = (): CharacterRig[] => Object.values(CHARACTER_RIGS);
