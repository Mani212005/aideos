import { LeafSubject } from "./leaf";
import { CardShelfSubject } from "./cardShelf";
import type { SubjectRegistry } from "./registry";

/**
 * The subject registry.
 *
 * Adding a subject is two steps: implement it against `SubjectProps`, then add it
 * here and to `subjectSchema` in `src/schema.ts`. The schema being a closed enum
 * means an episode cannot name a subject that has no implementation.
 */
export const SUBJECTS: SubjectRegistry = {
  leaf: LeafSubject,
  cardShelf: CardShelfSubject,
};

export type { SubjectProps, SubjectComponent } from "./registry";
