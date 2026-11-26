/**
 * File Description: Breaks a paragraph of body copy into lines exactly as Chrome lays out `text-wrap: pretty` for plain,
 * unhyphenated Latin text: Blink's greedy line breaker first, then, only when Blink would (a paragraph of 2 lines or more whose
 * last line is a single word narrower than a third of the line), its score line breaker (`ScoreLineBreaker`: squared slack per
 * line, a free last line, a per-line penalty, an orphan penalty on the last break), kept only when it finds as many lines as
 * the greedy pass. Positions are the paragraph's shaped advances as Chrome measures them; widths and scores are computed in
 * single precision as Blink does; a paragraph longer than four lines is re-broken over its last four only. Pure: no I/O.
 * Inputs and outputs: the words, each break's positions (the paragraph's width up to the word's end, and up to the start of the
 * next word), the available width and the font size -> the lines, as the index of each line's first word.
 * Used by: backend/renderIr/emit.ts (the Body block of a text card).
 */

/** Blink's `kMaxLinesForOptimal`: `text-wrap: pretty` optimises paragraphs of at most this many lines. */
const MAX_LINES_FOR_OPTIMAL = 4;
/** Blink's `kShortLineDenominator`: the last line is short when narrower than the line over this. */
const SHORT_LINE_DENOMINATOR = 3;
/** Blink's `kMinCandidates`: fewer real break opportunities than this (with the two sentinels) is not optimised. */
const MIN_CANDIDATES = 3;
/** Blink's `kOrphansPenalty` at zoom 1, added to the last break opportunity. */
const ORPHANS_PENALTY = 10000;
/** Blink's `kScoreOverfull`: the width score of a line that does not fit. */
const SCORE_OVERFULL = 1e12;
/** Blink's `kLastLinePenaltyMultiplier`. */
const LAST_LINE_PENALTY_MULTIPLIER = 4;
/** One `LayoutUnit` (1/64 px): Blink's `AddEpsilon` on the available width. */
const LAYOUT_EPSILON = 1 / 64;

/** Where the paragraph is after each word: `end` excludes the space after it (`pos_if_break`), `next` includes it (`pos_no_break`). */
export interface WordPosition {
  end: number;
  next: number;
}

/** Single-precision rounding, as Blink's float arithmetic. */
const f32 = Math.fround;

/** A width as Blink's `LayoutUnit` holds it: whole 1/64 px, truncated toward zero. */
function layoutUnit(width: number): number {
  return Math.trunc(f32(width) * 64) / 64;
}

/**
 * Blink's greedy line breaker: each line takes words while the line (from its first word to the word's end, trailing space
 * excluded) fits the available width; a word wider than the line takes a line of its own. Returns each line's first word.
 */
export function greedyLines(positions: WordPosition[], available: number): number[] {
  const fit = layoutUnit(available) + LAYOUT_EPSILON;
  const starts = [0];
  let lineStart = 0;
  for (let i = 1; i < positions.length; i++) {
    if (f32(positions[i].end - lineStart) > fit) {
      starts.push(i);
      lineStart = positions[i - 1].next;
    }
  }
  return starts;
}

/** Blink's `ShouldOptimize` for `pretty` with no hyphenation: the last line is one word, narrower than a third of the line. */
function shouldOptimize(positions: WordPosition[], starts: number[], available: number): boolean {
  const last = starts[starts.length - 1];
  if (last !== positions.length - 1) return false;
  const lineStart = last === 0 ? 0 : positions[last - 1].next;
  return layoutUnit(positions[last].end - lineStart) < layoutUnit(available) / SHORT_LINE_DENOMINATOR;
}

/**
 * Blink's `ScoreLineBreaker::Optimize` and `ComputeScores` for a left-aligned paragraph at zoom 1, over the lines from word
 * `first` to the end: each of those lines' first word, or null to keep the greedy lines.
 */
function optimalLines(positions: WordPosition[], first: number, available: number, fontSize: number, greedyCount: number): number[] | null {
  // The candidates: the start sentinel, a break after every word but the last, and the paragraph's end.
  const origin = first === 0 ? 0 : positions[first - 1].next;
  const candidates = [{ noBreak: origin, ifBreak: origin, penalty: 0 }];
  for (let i = first; i < positions.length; i++) {
    const p = positions[i];
    candidates.push(i === positions.length - 1 ? { noBreak: p.end, ifBreak: p.end, penalty: 0 } : { noBreak: p.next, ifBreak: p.end, penalty: 0 });
  }
  if (candidates.length < MIN_CANDIDATES + 2) return null;
  if (candidates.length >= 4) candidates[candidates.length - 2].penalty = f32(candidates[candidates.length - 2].penalty + ORPHANS_PENALTY);
  const width = layoutUnit(available);
  const linePenalty = f32(f32(f32(width * fontSize) * 2) * 2);
  const fit = width + LAYOUT_EPSILON;
  const scores = [{ score: 0, prev: 0, line: 0 }];
  let active = 0;
  for (let end = 1; end < candidates.length; end++) {
    const endCandidate = candidates[end];
    const isLast = end === candidates.length - 1;
    let best = Number.MAX_VALUE;
    let bestPrev = 0;
    const startEdge = f32(endCandidate.ifBreak - fit);
    let bestHope = 0;
    for (let start = active; start < end; start++) {
      const startScore = scores[start].score;
      if (f32(startScore + bestHope) >= best) continue;
      const startCandidate = candidates[start];
      const delta = f32(startCandidate.noBreak - startEdge);
      let widthScore = 0;
      let additional = 0;
      if (delta < 0) widthScore = SCORE_OVERFULL;
      else if (isLast) additional = f32(LAST_LINE_PENALTY_MULTIPLIER * startCandidate.penalty);
      else widthScore = f32(delta * delta);
      if (delta < 0) active = start + 1;
      else bestHope = widthScore;
      const score = f32(f32(startScore + widthScore) + additional);
      if (score <= best) {
        best = score;
        bestPrev = start;
      }
    }
    scores.push({ score: f32(f32(best + endCandidate.penalty) + linePenalty), prev: bestPrev, line: scores[bestPrev].line + 1 });
  }
  // Walk back from the end; candidate i ends the window's word i - 1, so the next line starts at word `first + i`.
  const breaks: number[] = [];
  for (let i = scores.length - 1; i > 0; i = scores[i].prev) breaks.push(i);
  breaks.reverse();
  if (breaks.length !== greedyCount) return null;
  return [first, ...breaks.slice(0, -1).map((i) => first + i)];
}

/**
 * Each line's first word of a `text-wrap: pretty` paragraph, as Chrome breaks it. Blink keeps at most four lines ahead of
 * layout and optimises them once the paragraph's end is among them, so a longer paragraph keeps its greedy lines up to its
 * last four and only those are re-broken.
 */
export function prettyLines(positions: WordPosition[], available: number, fontSize: number): number[] {
  if (positions.length === 0) return [];
  const greedy = greedyLines(positions, available);
  if (greedy.length <= 1) return greedy;
  if (!shouldOptimize(positions, greedy, available)) return greedy;
  const kept = greedy.slice(0, Math.max(0, greedy.length - MAX_LINES_FOR_OPTIMAL));
  const window = greedy.slice(kept.length);
  const optimal = optimalLines(positions, window[0], available, fontSize, window.length);
  return optimal ? [...kept, ...optimal] : greedy;
}
