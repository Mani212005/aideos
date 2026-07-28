import type React from "react";
import type { SubjectId } from "../../schema";

/**
 * Every 3D subject receives the same three values, and nothing else.
 *
 * That narrow interface is the point: it is what lets an episode swap `leaf` for
 * `tokenStream` by changing one string. A subject that needed to know it was in
 * the leaves episode would not be reusable.
 */
export type SubjectProps = {
  /** The subject's morph state, 0..1. Meaning is the subject's own. */
  state: number;
  /** Slow rotation, radians. Shared so all subjects drift at a consistent rate. */
  sway: number;
  /** A -1..1 oscillator for secondary motion. */
  breathe: number;
};

export type SubjectComponent = React.FC<SubjectProps>;

/**
 * Populated in `./index.ts` to avoid a cycle: subjects import `SubjectProps`
 * from this module, so this module cannot import the subjects.
 */
export type SubjectRegistry = Record<SubjectId, SubjectComponent>;
