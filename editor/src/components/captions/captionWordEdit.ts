/**
 * File Description: Pure helpers that edit one caption word of a film. The caption words are the subtitle clips on the Cut timeline (one clip per word), so a word is edited by selecting its clip. Text and frame range both write one caption cue per word, so every word keeps its own start and end when the track is read again.
 * Inputs and outputs: film, caption word index, text or frame range edit -> film with the new caption track, or an error message.
 * Used by: editor/src/components/shell/InspectorPanel.tsx, editor/src/components/ClipInspector.tsx.
 */

import type { Film } from "../../../../src/dl/schema";
import { captionWordsToVtt, generateWordsFromFilm } from "../../../../src/dl/captionsParser";

export interface CaptionWordEdit {
  text?: string;
  startFrame?: number;
  endFrame?: number;
}

export type CaptionWordEditResult = { ok: true; film: Film } | { ok: false; error: string };

/** Reads the caption word index from a derived subtitle clip id (`clip-sub-<index>-<word>`), or null for any other clip. */
export function captionWordIndex(clipId: string): number | null {
  const match = /^clip-sub-(\d+)-/.exec(clipId);
  return match ? Number(match[1]) : null;
}

/** Returns the film with caption word `index` edited, or an error message. An edit that changes nothing returns the same film object. */
export function editCaptionWord(film: Film, index: number, edit: CaptionWordEdit): CaptionWordEditResult {
  const words = generateWordsFromFilm(film as unknown as Record<string, unknown>);
  if (!Number.isInteger(index) || index < 0 || index >= words.length) return { ok: false, error: "That word is gone." };
  const word = words[index];

  const text = edit.text === undefined ? word.text : edit.text.trim();
  if (!text) return { ok: false, error: "Type a word." };
  if (/\s/.test(text)) return { ok: false, error: "Use one word." };

  const startFrame = edit.startFrame ?? word.startFrame;
  const endFrame = edit.endFrame ?? word.endFrame;
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame)) return { ok: false, error: "Use whole frames." };
  if (startFrame < 0) return { ok: false, error: "Start must be 0 or more." };
  if (endFrame <= startFrame) return { ok: false, error: "End must be after Start." };
  const earliest = index > 0 ? words[index - 1].startFrame : 0;
  const latest = index < words.length - 1 ? words[index + 1].endFrame : Infinity;
  if (startFrame < earliest || endFrame > latest) {
    return {
      ok: false,
      error: `Keep the word in order. Use frames ${earliest} to ${Number.isFinite(latest) ? latest : "the end"}.`,
    };
  }

  if (text === word.text && startFrame === word.startFrame && endFrame === word.endFrame) return { ok: true, film };
  const edited = words.map((w, i) => (i === index ? { text, startFrame, endFrame } : w));
  return { ok: true, film: { ...film, captions: captionWordsToVtt(edited, film.fps || 30, 1) } };
}
