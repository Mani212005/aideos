/**
 * File Description: The film revision: a short content hash of a film's contents on disk, plus the
 * pure rule the studio save endpoint applies to decide whether a save was based on the film that
 * is now on disk. Every writer (the studio, an agent, a pipeline stage) produces a revision just
 * by writing film.json, so no writer has to cooperate to bump a counter.
 * Inputs and outputs: film.json contents or a Film, a base revision and the current revision -> a
 * revision string or a write/stale decision.
 * Used by: editor/vite.config.ts (save endpoint, file watcher), backend/agentBridge/traceBus.ts,
 * backend/pipeline/filmStore.ts, backend/filmRevision.test.ts. The editor treats a revision as an opaque string.
 */

/**
 * Hash the exact contents of a film.json into the revision every reader and writer agrees on.
 * A pure 53-bit string hash (cyrb53) with no Node import: this module is reached by the browser
 * bundle through the trace bus, and a revision only has to tell two versions apart, not resist attack.
 */
export function filmRevision(contents: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < contents.length; i++) {
    const ch = contents.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(16, "0");
}

/** The revision a film gets when it is written the standard way (two-space JSON, as writeFilm does). */
export function revisionOfFilm(film: unknown): string {
  return filmRevision(JSON.stringify(film, null, 2));
}

export type SaveDecision = "write" | "stale";

/**
 * Decide whether a save may overwrite what is on disk. A save that names no base revision (a
 * script or an older caller) and a save to a film that has no file yet are unconditional; a save
 * that names a base must match the current revision exactly, otherwise someone else wrote since.
 */
export function decideSave(baseRev: string | null | undefined, currentRev: string | null): SaveDecision {
  if (typeof baseRev !== "string" || baseRev === "") return "write";
  if (currentRev === null) return "write";
  return baseRev === currentRev ? "write" : "stale";
}
