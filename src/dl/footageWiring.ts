/**
 * File Description: The one footage wiring rule, shared by the pipeline, the studio server and the Look lens. It puts a
 * finished clip into a shot as a full-screen AnalogyInset: an existing inset is updated in place (so wiring twice never
 * stacks a second one), and a caption is cut to the schema's AnalogyInset limit. Pure data, no Node or React imports.
 * Inputs and outputs: a film or shot, a clip path relative to public/, a caption -> a new film or shot with the clip wired in.
 * Used by: backend/pipeline/filmStore.ts, backend/pipeline/run.ts, editor/vite.config.ts, editor/src/components/LookFootage.tsx.
 */

import type { Block, Film, Shot } from "./schema";

/** The longest AnalogyInset caption the film schema accepts. */
export const FOOTAGE_CAPTION_MAX = 80;

/** The caption a new inset gets when the caller has no text for it. */
const FOOTAGE_CAPTION_FALLBACK = "B-roll";

type AnalogyInset = Extract<Block, { c: "AnalogyInset" }>;

// Returns a copy of the shot with the clip wired in as its full-screen inset.
export function withShotFootage(shot: Shot, src: string, caption: string): Shot {
  const next = structuredClone(shot);
  const text = caption.trim().slice(0, FOOTAGE_CAPTION_MAX);
  next.needsFootage = true;
  const inset = next.blocks.find((b): b is AnalogyInset => b.c === "AnalogyInset");
  if (inset) {
    inset.src = src;
    inset.fullScreenHero = true;
    inset.caption = text || inset.caption;
    return next;
  }
  next.blocks = [{ c: "AnalogyInset", caption: text || FOOTAGE_CAPTION_FALLBACK, src, fullScreenHero: true }, ...next.blocks];
  return next;
}

// Returns a copy of the film with the clip wired into the named shot; throws when the film has no such shot.
export function withFootage(film: Film, shotId: string, src: string, caption: string): Film {
  if (!film.shots.some((s) => s.id === shotId)) throw new Error(`film "${film.id}" has no shot "${shotId}"`);
  return { ...film, shots: film.shots.map((s) => (s.id === shotId ? withShotFootage(s, src, caption) : s)) };
}
