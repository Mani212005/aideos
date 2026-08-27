/**
 * ==============================================================================
 * AIDEOS 2.0: CAPTION & SCRIPT VTT PARSER
 * ==============================================================================
 * Synchronizes speech audio (.wav) and script (.vtt) with Remotion frame rates.
 * Generates word-level timestamps and kinetic display phrases.
 * ==============================================================================
 */

import type { CaptionWord } from "./KineticSubtitles";

/** Parse timestamp "00:01:23.456" or "01:23.456" into seconds */
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

/** Parse raw WebVTT content into structured cues */
export function parseVtt(vttContent: string): VttCue[] {
  const cues: VttCue[] = [];
  const lines = vttContent.split(/\r?\n/);
  let currentStart = 0;
  let currentEnd = 0;
  let textAccum = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes("-->")) {
      if (textAccum && currentEnd > currentStart) {
        cues.push({
          startSec: currentStart,
          endSec: currentEnd,
          text: textAccum.trim(),
        });
        textAccum = "";
      }
      const [startStr, endStr] = line.split("-->");
      currentStart = timeToSeconds(startStr);
      currentEnd = timeToSeconds(endStr);
    } else if (line && !line.startsWith("WEBVTT") && !/^\d+$/.test(line)) {
      textAccum += (textAccum ? " " : "") + line;
    }
  }

  if (textAccum && currentEnd > currentStart) {
    cues.push({
      startSec: currentStart,
      endSec: currentEnd,
      text: textAccum.trim(),
    });
  }

  return cues;
}

/** Convert VTT cues into word-by-word timestamped array aligned with Remotion FPS */
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

/** Dynamically extracts and computes word-level frame timestamps across all shots in a film */
export function generateWordsFromFilm(film: Record<string, unknown>): CaptionWord[] {
  const fps = (film?.fps as number) || 30;

  if (film?.captions && typeof film.captions === "string") {
    if (film.captions.includes("-->")) {
      const cues = parseVtt(film.captions);
      if (cues.length > 0) {
        return vttToCaptionWords(cues, fps);
      }
    }
  }

  const words: CaptionWord[] = [];
  let currentStartSec = 0;

  if (film?.shots && Array.isArray(film.shots)) {
    for (const shot of film.shots) {
      const shotDurationSec = (shot.dur as number) || (shot.duration as number) || 3;
      let shotText = ((shot.scriptText as string) || "").trim();
      if (!shotText && shot.blocks && Array.isArray(shot.blocks)) {
        const textBlock = shot.blocks.find((b: any) => b.c === "TextReveal");
        if (textBlock && textBlock.text) {
          shotText = textBlock.text;
        }
      }

      const rawWords = shotText.split(/\s+/).filter(Boolean);
      if (rawWords.length > 0) {
        const wordDur = shotDurationSec / rawWords.length;
        rawWords.forEach((w: string, idx: number) => {
          const wStart = currentStartSec + idx * wordDur;
          const wEnd = wStart + wordDur;
          words.push({
            text: w,
            startFrame: Math.round(wStart * fps),
            endFrame: Math.round(wEnd * fps),
          });
        });
      }
      currentStartSec += shotDurationSec;
    }
  }

  if (words.length > 0) {
    return words;
  }

  return [];
}
