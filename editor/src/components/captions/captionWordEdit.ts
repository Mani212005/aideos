/**
 * File Description: Pure helpers that edit one caption word of a film. The caption words are the subtitle clips on the Cut timeline (one clip per word), so a word is edited by selecting its clip.
 * Inputs and outputs: film, caption word index, new text -> film with the new caption track (or null when nothing changes).
 * Used by: editor/src/components/shell/InspectorPanel.tsx, editor/src/components/ClipInspector.tsx.
 */

import type { Film } from "../../../../src/dl/schema";
import { captionWordsToVtt, generateWordsFromFilm } from "../../../../src/dl/captionsParser";

/** Reads the caption word index from a derived subtitle clip id (`clip-sub-<index>-<word>`), or null for any other clip. */
export function captionWordIndex(clipId: string): number | null {
  const match = /^clip-sub-(\d+)-/.exec(clipId);
  return match ? Number(match[1]) : null;
}

/** Returns the film with caption word `index` set to `text`, or null when the index is out of range, the text is empty or nothing changes. */
export function editCaptionWord(film: Film, index: number, text: string): Film | null {
  const next = text.trim();
  if (!next) return null;
  const words = generateWordsFromFilm(film as unknown as Record<string, unknown>);
  if (!Number.isInteger(index) || index < 0 || index >= words.length) return null;
  if (words[index].text === next) return null;
  const edited = words.map((word, i) => (i === index ? { ...word, text: next } : word));
  return { ...film, captions: captionWordsToVtt(edited, film.fps || 30) };
}
