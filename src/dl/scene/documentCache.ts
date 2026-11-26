/**
 * File Description: Bounded least-recently-used cache for parsed scene SVG documents.
 * Inputs and outputs: SVG source and parser -> cached document or null.
 * Used by: src/dl/scene/SceneView.tsx.
 */

import type { SvgDocument } from "./svgDocument";

/** Creates a bounded cache that retains recently used parsed documents, including failures. */
export function createDocumentCache(parse: (source: string) => SvgDocument | null, capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Cache capacity must be a positive integer");
  const entries = new Map<string, SvgDocument | null>();
  // Returns a cached parse or parses and stores the source, evicting the least recently used entry.
  return (source: string): SvgDocument | null => {
    if (entries.has(source)) {
      const cached = entries.get(source) ?? null;
      entries.delete(source);
      entries.set(source, cached);
      return cached;
    }
    const document = parse(source);
    entries.set(source, document);
    if (entries.size > capacity) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    return document;
  };
}
