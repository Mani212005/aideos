/**
 * File Description: Model Sheet registry and lookup helpers for all character cast members.
 * Canonical records establish default heights, standard scales, reference poses, and facings (D2).
 */

import type { ModelSheet } from "./types";

/** Registry map of canonical ModelSheets for the 8 character archetypes. */
export const MODEL_SHEETS: Record<string, ModelSheet> = {
  astronaut: {
    rigId: "astronaut",
    canonicalHeight: 420,
    canonicalScale: 1.0,
    referencePose: "idle",
    defaultFacing: "right",
  },
  developer: {
    rigId: "developer",
    canonicalHeight: 400,
    canonicalScale: 1.0,
    referencePose: "idle",
    defaultFacing: "right",
  },
  robot: {
    rigId: "robot",
    canonicalHeight: 320,
    canonicalScale: 0.8,
    referencePose: "floating",
    defaultFacing: "right",
  },
  scientist: {
    rigId: "scientist",
    canonicalHeight: 410,
    canonicalScale: 1.0,
    referencePose: "explaining",
    defaultFacing: "right",
  },
  executive: {
    rigId: "executive",
    canonicalHeight: 420,
    canonicalScale: 1.0,
    referencePose: "presenting",
    defaultFacing: "right",
  },
  "data-engineer": {
    rigId: "data-engineer",
    canonicalHeight: 400,
    canonicalScale: 1.0,
    referencePose: "typing",
    defaultFacing: "right",
  },
  educator: {
    rigId: "educator",
    canonicalHeight: 390,
    canonicalScale: 1.0,
    referencePose: "teaching",
    defaultFacing: "right",
  },
  mascot: {
    rigId: "mascot",
    canonicalHeight: 250,
    canonicalScale: 0.6,
    referencePose: "bouncing",
    defaultFacing: "right",
  },
};

/** Returns the ModelSheet for a given rig ID or null if not registered. */
export function getModelSheet(rigId: string): ModelSheet | null {
  return MODEL_SHEETS[rigId] ?? null;
}
