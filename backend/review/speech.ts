/**
 * File Description: Pure facts about the narration for `aideos review`.
 * Loads word timings (an aideos voiceover_words.json, a plain `{words}` list or a bare array) or a
 * plain narration text, and derives pace, dead air, which moments are narrated, whether a cut lands
 * inside a spoken word, how far cues sit from word starts compared with chance, and whether caption
 * text matches what is said. No I/O besides reading the file named by the caller.
 */

import fs from "node:fs";
import type { ReviewWord } from "./types";

/** Narration as the review got it: timed words, or only text. */
export interface Narration {
  /** Timed words in order; empty when only text was given. */
  words: ReviewWord[];
  /** The narration as plain text (always present). */
  text: string;
  timed: boolean;
}

// Lowercases and strips everything but letters and digits so spoken and written forms compare equal.
export function normalizeWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Reads narration from a JSON word list (several shapes accepted) or a plain text file.
export function loadNarration(file: string): Narration {
  const raw = fs.readFileSync(file, "utf8");
  if (/\.json$/i.test(file)) {
    const data = JSON.parse(raw) as unknown;
    // A script with scenes ({scenes: [{text}]}, text may carry {written|spoken} pronunciations) is narration without timings.
    const scenes = (data as { scenes?: Array<{ text?: unknown }> }).scenes;
    if (!Array.isArray(data) && Array.isArray(scenes)) {
      return { words: [], text: scenes.map((sc) => String(sc.text ?? "")).join(" ").replace(/\{([^|}]*)\|([^}]*)\}/g, "$1 $2"), timed: false };
    }
    const list = Array.isArray(data) ? data : (data as { words?: unknown }).words;
    if (!Array.isArray(list)) throw new Error(`${file}: expected a word list ({"words": [...]}) with word, start and end per entry`);
    const words: ReviewWord[] = list.map((w, i) => {
      const e = w as { word?: string; punctuated_word?: string; start?: number; end?: number; startSec?: number; endSec?: number };
      const start = e.start ?? e.startSec;
      const end = e.end ?? e.endSec;
      const word = e.punctuated_word ?? e.word;
      if (typeof word !== "string" || typeof start !== "number" || typeof end !== "number") throw new Error(`${file}: word ${i} needs word, start and end`);
      return { word, start, end };
    });
    return { words, text: words.map((w) => w.word).join(" "), timed: true };
  }
  return { words: [], text: raw, timed: false };
}

// Words per minute over the span from the first word's start to the last word's end.
export function wordsPerMinute(words: ReviewWord[]): number | null {
  if (words.length < 2) return null;
  const span = words[words.length - 1].end - words[0].start;
  return span > 0 ? (words.length / span) * 60 : null;
}

/** A pause between two spoken words. */
export interface Gap {
  start: number;
  end: number;
}

// Pauses between consecutive words longer than `minSec`.
export function pauses(words: ReviewWord[], minSec: number): Gap[] {
  const out: Gap[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap > minSec) out.push({ start: words[i - 1].end, end: words[i].start });
  }
  return out;
}

// Lists the times that cut through a spoken word by more than `tolSec` on both sides.
export function cutsThroughWords(words: ReviewWord[], times: number[], tolSec: number): Array<{ t: number; word: string }> {
  const out: Array<{ t: number; word: string }> = [];
  for (const t of times) {
    const w = words.find((x) => t > x.start + tolSec && t < x.end - tolSec);
    if (w) out.push({ t, word: w.word });
  }
  return out;
}

// Share of the given times that sit within `tolSec` of a word's start (where a cue aimed at a word lands).
export function shareNearWordStarts(words: ReviewWord[], times: number[], tolSec: number): number {
  if (times.length === 0) return 0;
  const near = (t: number) => words.some((w) => Math.abs(w.start - t) <= tolSec);
  return times.filter(near).length / times.length;
}

// The share of evenly spaced moments across the narration that sit near a word start by chance alone.
export function chanceNearWordStarts(words: ReviewWord[], tolSec: number): number {
  if (words.length < 2) return 0;
  const from = words[0].start;
  const to = words[words.length - 1].end;
  const n = 2000;
  const times = Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 0.5)) / n);
  return shareNearWordStarts(words, times, tolSec);
}

// Share of caption tokens found among the narration's words (within `windowSec` of `t` when timed).
export function captionMatch(caption: string, narration: Narration, t: number, windowSec = 4): number | null {
  const tokens = caption.split(/\s+/).map(normalizeWord).filter((w) => w.length > 1);
  if (tokens.length === 0) return null;
  const pool = narration.timed
    ? narration.words.filter((w) => w.end >= t - windowSec && w.start <= t + windowSec).map((w) => normalizeWord(w.word))
    : narration.text.split(/\s+/).map(normalizeWord);
  const have = new Set(pool);
  return tokens.filter((tok) => have.has(tok)).length / tokens.length;
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

// Every number in a piece of narration, written as digits or spoken ("seven hundred sixty eight" -> 768, "a hundred million" -> 1e8).
export function spokenNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(Number(m[0].replace(/,/g, "")));
  const tokens = text.toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let inNumber = false;
  const flush = () => {
    if (inNumber) out.push(total + current);
    total = 0;
    current = 0;
    inNumber = false;
  };
  tokens.forEach((tok, i) => {
    if (tok in UNITS) {
      current += UNITS[tok];
      inNumber = true;
    } else if (tok in TENS) {
      current += TENS[tok];
      inNumber = true;
    } else if (tok === "hundred") {
      current = (current || 1) * 100;
      inNumber = true;
    } else if (tok in SCALES) {
      total += (current || 1) * SCALES[tok];
      current = 0;
      inNumber = true;
    } else if (tok === "and" && inNumber && tokens[i + 1] && (tokens[i + 1] in UNITS || tokens[i + 1] in TENS)) {
      // "a hundred and twelve": the connector continues the number.
    } else if (tok === "a" && !inNumber && (tokens[i + 1] === "hundred" || tokens[i + 1] === "thousand" || tokens[i + 1] === "million" || tokens[i + 1] === "billion")) {
      // "a hundred million": the article stands for one.
    } else flush();
  });
  flush();
  return out;
}
