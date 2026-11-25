/**
 * File Description: Synchronizes speech audio (.wav) and script (.vtt) with Remotion frame rates, generating word-level timestamps and kinetic display phrases.
 * Inputs and outputs: WebVTT caption string and FPS -> parsed CaptionWord list with frame-level timing.
 * Used by: src/dl/Film.tsx, backend/captionsParser.test.ts.
 */

import { DEFAULT_FPS } from "./defaults";

import type { Film } from "./schema";
import type { CaptionWord } from "./KineticSubtitles";

// Parses timestamp format "00:01:23.456" or "01:23.456" into total fractional seconds.
function timeToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
  } else if (parts.length === 2) {
    const [m, s] = parts;
    return parseFloat(m) * 60 + parseFloat(s);
  }
  return 0;
}

export interface VttCue {
  startSec: number;
  endSec: number;
  text: string;
}

// Parses raw WebVTT content into structured cues with start and end times.
// A timing line ("a --> b") opens a cue and the lines below it, up to the next blank line, are its text.
// That includes a line of digits such as a narrated year or count: only a line outside any cue (the
// header, a NOTE block or a cue identifier above a timing line) is dropped.
export function parseVtt(vttContent: string): VttCue[] {
  const cues: VttCue[] = [];
  let open: { startSec: number; endSec: number; lines: string[] } | null = null;

  // Closes the open cue, keeping it only when it has text and a positive length.
  const flush = () => {
    if (open && open.lines.length > 0 && open.endSec > open.startSec) {
      cues.push({ startSec: open.startSec, endSec: open.endSec, text: open.lines.join(" ") });
    }
    open = null;
  };

  for (const raw of vttContent.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.includes("-->")) {
      flush();
      const [startStr, endStr] = line.split("-->");
      // Anything after the end time on the timing line is a cue setting such as "align:start".
      open = { startSec: timeToSeconds(startStr), endSec: timeToSeconds(endStr.trim().split(/\s+/)[0]), lines: [] };
    } else if (line === "") {
      flush();
    } else if (open) {
      open.lines.push(line);
    }
  }
  flush();
  return cues;
}

// Converts VTT cues into word-by-word timestamped array aligned with video frame rate.
export function vttToCaptionWords(cues: VttCue[], fps = 30): CaptionWord[] {
  const words: CaptionWord[] = [];

  for (const cue of cues) {
    const rawWords = cue.text.split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) continue;

    const cueDuration = Math.max(0.1, cue.endSec - cue.startSec);
    const wordDuration = cueDuration / rawWords.length;

    rawWords.forEach((word, idx) => {
      const wStart = cue.startSec + idx * wordDuration;
      const wEnd = idx === rawWords.length - 1 ? cue.endSec : wStart + wordDuration;
      words.push({
        text: word,
        startFrame: Math.round(wStart * fps),
        endFrame: Math.round(wEnd * fps),
      });
    });
  }

  return words;
}

/** The parts of a film the caption reader looks at. Every field is optional: a bare caption track (`{ fps, captions }`) and a film still being authored are both valid input. */
export interface CaptionSourceFilm {
  fps?: number;
  captions?: string;
  shots?: ReadonlyArray<{
    position?: number;
    startSec?: number;
    dur?: number;
    scriptText?: string;
    blocks?: ReadonlyArray<{ c: string; text?: unknown }>;
  }>;
}

// Dynamically extracts and computes word-level frame timestamps across all shots in a film.
export function generateWordsFromFilm(film: CaptionSourceFilm): CaptionWord[] {
  const fps = film.fps || DEFAULT_FPS;

  if (film.captions?.includes("-->")) {
    const cues = parseVtt(film.captions);
    if (cues.length > 0) return vttToCaptionWords(cues, fps);
  }

  const words: CaptionWord[] = [];
  let currentStartSec = 0;

  for (const shot of film.shots ?? []) {
    const shotStartSec = shot.position ?? shot.startSec ?? currentStartSec;
    const shotDurationSec = shot.dur || 3;
    let shotText = (shot.scriptText ?? "").trim();
    if (!shotText) {
      const textBlock = shot.blocks?.find((b) => b.c === "TextReveal");
      if (typeof textBlock?.text === "string") shotText = textBlock.text;
    }

    const rawWords = shotText.split(/\s+/).filter(Boolean);
    const wordDur = shotDurationSec / Math.max(1, rawWords.length);
    rawWords.forEach((w, idx) => {
      const wStart = shotStartSec + idx * wordDur;
      words.push({
        text: w,
        startFrame: Math.round(wStart * fps),
        endFrame: Math.round((wStart + wordDur) * fps),
      });
    });
    currentStartSec = shotStartSec + shotDurationSec;
  }

  return words;
}

// Returns the shared enabled caption track for preview and export.
export function captionWordsForFilm(film: Film): CaptionWord[] {
  return film.subtitles === false || film.captions === "off" ? [] : generateWordsFromFilm(film);
}

// Formats numeric seconds into standard HH:MM:SS.mmm WebVTT timecode string.
function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// Converts structured CaptionWord array into standard WebVTT cue string.
export function captionWordsToVtt(words: CaptionWord[], fps = 30, wordsPerCue = 5): string {
  if (!Number.isInteger(wordsPerCue) || wordsPerCue < 1) throw new Error("Caption cue word count must be a positive integer");
  if (!words || words.length === 0) return "";
  let vtt = "WEBVTT\n\n";
  const chunkSize = wordsPerCue;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    const startSec = (chunk[0].startFrame ?? 0) / fps;
    const endSec = (chunk[chunk.length - 1].endFrame ?? (chunk[0].startFrame + 30)) / fps;
    const text = chunk.map((w) => w.text).join(" ");
    vtt += `${formatVttTime(startSec)} --> ${formatVttTime(endSec)}\n${text}\n\n`;
  }
  return vtt.trim();
}
