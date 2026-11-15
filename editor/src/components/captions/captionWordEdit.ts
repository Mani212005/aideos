/**
 * File Description: Pure helpers that edit one caption word of a film. The caption words are the subtitle clips on the Cut timeline (one clip per word), so a word is edited by selecting its clip. Every edit writes the whole caption track through one helper that packs words into cues only when the cue reads back with the exact start and end of each word, and refuses the edit when it cannot.
 * Inputs and outputs: film, caption word index, text or frame range edit -> film with the new caption track, or an error message.
 * Used by: editor/src/components/shell/InspectorPanel.tsx, editor/src/components/ClipInspector.tsx.
 */

import type { Film } from "../../../../src/dl/schema";
import type { CaptionWord } from "../../../../src/dl/KineticSubtitles";
import { captionWordsToVtt, generateWordsFromFilm } from "../../../../src/dl/captionsParser";

const MAX_WORDS_PER_CUE = 5;
const VTT_HEADER = "WEBVTT\n\n";

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

/** True when two caption word lists have the same text, start frame and end frame for every word. */
function sameWords(a: CaptionWord[], b: CaptionWord[]): boolean {
  return a.length === b.length && a.every((w, i) => w.text === b[i].text && w.startFrame === b[i].startFrame && w.endFrame === b[i].endFrame);
}

/** Reads a caption track back the way the film does, so the write is checked against the real reader. */
function readTrack(vtt: string, fps: number): CaptionWord[] {
  return generateWordsFromFilm({ fps, captions: vtt });
}

/** Writes words as one VTT track, or returns null when some word would not read back with its exact text, start and end. */
function writeCaptionTrack(words: CaptionWord[], fps: number): string | null {
  const cueOf = (from: number, size: number): string | null => {
    const group = words.slice(from, from + size);
    const cue = captionWordsToVtt(group, fps, size).slice(VTT_HEADER.length);
    return sameWords(readTrack(VTT_HEADER + cue, fps), group) ? cue : null;
  };
  const sizeAt: number[] = new Array(words.length + 1).fill(0);
  for (let i = words.length - 1; i >= 0; i--) {
    for (let size = Math.min(MAX_WORDS_PER_CUE, words.length - i); size >= 1; size--) {
      if ((i + size === words.length || sizeAt[i + size] > 0) && cueOf(i, size) !== null) {
        sizeAt[i] = size;
        break;
      }
    }
    if (sizeAt[i] === 0) return null;
  }
  const cues: string[] = [];
  for (let i = 0; i < words.length; i += sizeAt[i]) cues.push(cueOf(i, sizeAt[i]) as string);
  const vtt = VTT_HEADER + cues.join("\n\n");
  return sameWords(readTrack(vtt, fps), words) ? vtt : null;
}

/** Returns the film with caption word `index` edited, or an error message. An edit that changes nothing returns the same film object. */
export function editCaptionWord(film: Film, index: number, edit: CaptionWordEdit): CaptionWordEditResult {
  if (film.captions === "off" || film.subtitles === false) return { ok: false, error: "Captions are off. Turn them on first." };
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
  const vtt = writeCaptionTrack(edited, film.fps || 30);
  if (vtt === null) {
    const hasNumber = edited.some((w) => /^\d+$/.test(w.text));
    return {
      ok: false,
      error: hasNumber
        ? "A number word needs a neighbour word of the same length. Change its Start or End first."
        : "This word cannot be saved. Use another word.",
    };
  }
  return { ok: true, film: { ...film, captions: vtt } };
}
