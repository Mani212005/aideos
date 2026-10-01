/**
 * File Description: Glyph advance widths for the two typefaces scene films set display type in.
 * Geist advances were measured once in headless Chrome (canvas measureText, 1000px, weights 500 and
 * 800, printable ASCII) so word positions can be laid out in Node without a browser; JetBrains Mono is
 * fixed-pitch at 0.6em. Kerning is modelled for known words via wordWidths.json, falling back to per-glyph advances.
 */

import * as fs from "fs";
import * as path from "path";

/** Geist advance widths per 1000 units for ASCII 32..126, at weights 500 and 800. */
const GEIST: Record<500 | 800, number[]> = {
  500: [243,228,361,515,643,810,649,186,290,290,427,562,213,418,213,494,673,406,630,625,629,641,604,531,624,606,302,302,546,544,546,570,925,689,688,713,701,609,595,713,716,280,607,656,583,890,745,751,657,745,680,654,568,694,688,968,633,594,561,361,470,361,438,558,258,565,608,563,608,576,412,607,591,256,284,609,282,885,591,588,608,608,394,537,410,586,560,829,607,553,552,395,274,395,523],
  800: [221,272,405,626,683,833,734,212,339,339,419,574,248,417,248,536,703,470,665,662,670,686,638,551,684,643,315,315,552,556,552,602,981,750,710,745,723,628,609,751,724,310,637,705,592,927,753,788,679,781,706,695,615,708,751,1038,715,650,610,404,516,404,473,563,288,609,647,615,647,620,464,647,621,294,355,666,328,907,621,633,647,647,440,586,462,618,633,859,671,603,598,414,304,414,523],
};

/** JetBrains Mono advance per em. */
export const MONO_ADVANCE = 0.6;

/** Kerned width in em of whole words, measured in Chrome (measureWords.ts); words missing from it fall back to glyph advances. */
let WORDS: Record<string, Record<string, number>> | null = null;

// Loads the measured word table once; a missing file just means falling back to per-glyph advances.
function wordTable(): Record<string, Record<string, number>> {
  if (WORDS) return WORDS;
  try {
    WORDS = JSON.parse(fs.readFileSync(path.resolve(__dirname, "wordWidths.json"), "utf8")) as Record<string, Record<string, number>>;
  } catch {
    WORDS = {};
  }
  return WORDS;
}

/** Typeface choice for measuring. */
export type Face = "sans" | "mono";

// Returns one character's advance in em for the given face and weight.
export function advanceEm(ch: string, face: Face, weight: 500 | 800 = 800): number {
  if (face === "mono") return MONO_ADVANCE;
  const code = ch.charCodeAt(0);
  const table = GEIST[weight];
  if (code < 32 || code > 126) return 0.6;
  return table[code - 32] / 1000;
}

// Measures a string in pixels at a font size, including letter-spacing in em.
export function measureText(text: string, size: number, face: Face, weight: 500 | 800 = 800, trackingEm = 0): number {
  const known = face === "sans" ? wordTable()[String(weight)]?.[text] : undefined;
  if (known !== undefined) return (known + trackingEm * [...text].length) * size;
  let em = 0;
  for (const ch of text) em += advanceEm(ch, face, weight) + trackingEm;
  return em * size;
}

/**
 * Width of a display token in px: the word is measured whole (with the font's own kerning when the word
 * table has it) and any trailing punctuation is added glyph by glyph, since the table holds bare words.
 */
export function tokenWidth(token: string, size: number, face: Face, weight: 500 | 800, trackingEm: number): number {
  const punct = token.match(/[.,:;?!]+$/)?.[0] ?? "";
  const core = punct ? token.slice(0, -punct.length) : token;
  return measureText(core, size, face, weight, trackingEm) + (punct ? measureText(punct, size, face, weight, trackingEm) : 0);
}
