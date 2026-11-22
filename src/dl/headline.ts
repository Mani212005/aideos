/**
 * File Description: Splits a headline into animatable words with their accent flags: `*marked*` spans and the
 * accent word are accented, and the markers never reach the screen. Pure: no React or Remotion imports.
 * Inputs and outputs: headline text and optional accent word -> ordered words with an accent flag each.
 * Used by: src/dl/primitives.tsx (TextReveal headline), backend/renderIr/emit.ts (render IR headline text).
 */

/** One word of a headline and whether it is drawn in the accent colour. */
export interface HeadlineWord {
  word: string;
  accent: boolean;
}

// Lower-cases a word and drops its punctuation, for comparing it with the accent word.
const stripPunct = (w: string): string => w.replace(/[^\p{L}\p{N}-]/gu, "").toLowerCase();

/**
 * Split a headline into animatable words.
 *
 * Two things this has to get right. First, the animation unit is the *word*,
 * not the markup chunk - splitting on markers orphans full stops onto their own
 * line, where they fade up as a floating dot. Second, `*marked*` spans are
 * stripped from the output: leaving the asterisks in is how a marker convention
 * ends up printed on screen at 134px.
 *
 * A span may cover several words (`*weighted sums*`), so the markers are
 * resolved against character offsets in the cleaned string rather than
 * per-token.
 */
export function parseHeadline(text: string, accentWord?: string): HeadlineWord[] {
  const spans: [number, number][] = [];
  let clean = "";
  let open: number | null = null;

  for (const ch of text) {
    if (ch === "*") {
      if (open === null) open = clean.length;
      else {
        spans.push([open, clean.length]);
        open = null;
      }
      continue;
    }
    clean += ch;
  }
  // An unclosed marker means the author meant a literal asterisk. Keep it.
  if (open !== null) clean = text.replace(/\*/g, (_m, i) => (i === open ? "*" : ""));

  const target = accentWord ? stripPunct(accentWord) : null;
  const out: HeadlineWord[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean)) !== null) {
    const at = match.index;
    const inSpan = spans.some(([a, b]) => at >= a && at < b);
    out.push({
      word: match[0],
      accent: inSpan || (target !== null && stripPunct(match[0]) === target),
    });
  }
  return out;
}
