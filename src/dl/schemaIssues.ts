/**
 * File Description: Turns a Zod error into short field-named issues. A union that fails normally reports one root-level "Invalid input"; this picks the branch the author meant (by the discriminator keys and by how few issues it has) and says which field is wrong and what was expected, in plain words.
 * Inputs and outputs: a Zod error plus the raw input it rejected -> a list of { path, message } where path reads like performances[0].limits.
 * Used by: backend/designSpec/build.ts, backend/lookPlan/check.ts, src/dl/characters/validate.ts. Pure and browser-safe (no Node imports).
 */

import type { z } from "zod";

/** One problem in an authored file: the field path and what is wrong with it. */
export interface FieldIssue {
  path: string;
  message: string;
}

type Issue = z.core.$ZodIssue;
type Path = ReadonlyArray<PropertyKey>;

/** Keys that choose between the shapes of a union; a branch that disagrees on one is for a different kind of file. */
const DISCRIMINATOR_KEYS = new Set(["schema", "renderer", "kind", "type"]);
/** Formats a path as a field reference such as parts[3].joint, or "(root)" when empty. */
export function formatFieldPath(path: Path): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join("") || "(root)";
}

/** Reads the value the input holds at a path, or undefined when the path leaves the input. */
function valueAt(input: unknown, path: Path): unknown {
  let cur = input;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key as string];
  }
  return cur;
}

/** Shows an offending value briefly, so "got" never dumps a whole object into an error line. */
function brief(value: unknown): string {
  if (value === undefined) return "nothing";
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}...` : value);
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (value !== null && typeof value === "object") return "an object";
  return String(value);
}

/** Lists accepted values the way an author would type them. */
function listValues(values: readonly unknown[]): string {
  return values.map((v) => (typeof v === "string" ? JSON.stringify(v) : String(v))).join(", ");
}

/** Rewrites one non-union issue as a short plain-words message; `at` is where it sits in the input. */
function describe(issue: Issue, at: Path, input: unknown): FieldIssue[] {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({ path: formatFieldPath([...at, key]), message: "is not a known field; remove it or check the spelling" }));
  }
  const got = valueAt(input, at);
  const path = formatFieldPath(at);
  if (issue.code === "invalid_type") {
    const type = String((issue as { expected?: unknown }).expected ?? "a different type");
    const expected = type === "tuple" ? "array" : type;
    return [{ path, message: got === undefined ? `is required (expected ${expected})` : `expected ${expected}, got ${brief(got)}` }];
  }
  if (issue.code === "invalid_value") {
    const values = (issue as { values: unknown[] }).values;
    const wanted = values.length === 1 ? `must be ${listValues(values)}` : `must be one of ${listValues(values)}`;
    return [{ path, message: got === undefined ? `is required (${wanted})` : `${wanted}, got ${brief(got)}` }];
  }
  if (issue.code === "invalid_union") {
    const options = (issue as { options?: unknown[] }).options;
    return [{ path, message: options ? `must be one of ${listValues(options)}, got ${brief(got)}` : issue.message }];
  }
  return [{ path, message: issue.message.replace(/^Invalid input: /, "") }];
}

/** An issue flattened out of its unions, with how strongly it says "this branch is the wrong kind of object". */
interface Flat {
  issue: FieldIssue;
  mismatch: boolean;
  /** Set for a discriminator mismatch: the values that would have been accepted here. */
  accepts?: unknown[];
}

/** Expands every issue, recursing into the union branch that best fits the input. */
function flatten(issues: readonly Issue[], base: Path, input: unknown): Flat[] {
  return issues.flatMap((issue) => {
    const at = [...base, ...issue.path];
    if (issue.code === "invalid_union" && "errors" in issue && (issue.errors as Issue[][]).length > 0) return pickBranch(issue.errors as Issue[][], at, input);
    // Only a tag sitting directly on the union's own object says which kind of object it is.
    const last = issue.path.length === 1 ? issue.path[0] : undefined;
    const keyed = typeof last === "string" && DISCRIMINATOR_KEYS.has(last);
    const wrongValue = issue.code === "invalid_value" && keyed;
    // A branch requiring a missing tag cannot explain an untagged alternative such as a mirror group.
    const wrongTag = issue.code === "invalid_union" && keyed && valueAt(input, at) === undefined;
    const accepts = issue.code === "invalid_value" ? (issue as { values: unknown[] }).values : issue.code === "invalid_union" ? (issue as { options?: unknown[] }).options : undefined;
    return describe(issue, at, input).map((d) => ({ issue: d, mismatch: wrongValue || wrongTag, accepts }));
  });
}

/** Chooses the union branch the author meant: no discriminator mismatch first, then the fewest issues. */
function pickBranch(branches: Issue[][], base: Path, input: unknown): Flat[] {
  const scored = branches.map((b) => {
    const flat = flatten(b, base, input);
    return { flat, mismatches: flat.filter((f) => f.mismatch).length };
  });
  const best = scored.reduce((a, b) => (b.mismatches < a.mismatches || (b.mismatches === a.mismatches && b.flat.length < a.flat.length) ? b : a));
  if (best.mismatches === 0) return best.flat;
  // Every branch disagrees on a tag: report each tag all of them disagree on once, listing everything any branch would accept.
  const tags = new Map<string, { accepts: unknown[]; branches: Set<number> }>();
  scored.forEach((s, index) => {
    for (const f of s.flat.filter((x) => x.mismatch)) {
      const known = tags.get(f.issue.path) ?? { accepts: [], branches: new Set<number>() };
      known.accepts.push(...(f.accepts ?? []).filter((v) => !known.accepts.includes(v)));
      known.branches.add(index);
      tags.set(f.issue.path, known);
    }
  });
  const merged = [...tags.entries()]
    .filter(([, { branches }]) => branches.size === scored.length)
    .map(([path, { accepts }]) => {
      const got = valueAt(input, parsePath(path));
      return { issue: { path, message: `must be one of ${listValues(accepts)}${got === undefined ? "" : `, got ${brief(got)}`}` }, mismatch: false };
    });
  // Branches that disagree on different tags share nothing to merge: fall back to the closest branch rather than say nothing.
  return merged.length > 0 ? merged : best.flat;
}

/** Reads a formatted path back into keys so the offending value can be shown. */
function parsePath(path: string): Path {
  if (path === "(root)") return [];
  return [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]));
}

/** Turns a Zod error into field-named issues, picking the union branch the input was written for. */
export function fieldIssues(error: { issues: readonly Issue[] }, input?: unknown): FieldIssue[] {
  const seen = new Set<string>();
  return flatten(error.issues, [], input)
    .map((f) => f.issue)
    .filter((i) => {
      const key = `${i.path}\u0000${i.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
