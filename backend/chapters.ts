/**
 * File Description: Computes timestamped chapter headings from film shot data, with one start timestamp per chapter and a merge rule for chapters shorter than 10 seconds so chapter lists meet YouTube's chapter requirements. Pure and isomorphic (no Node imports).
 * Inputs and outputs: a Film's shots and chapter list -> ordered ChapterHeading array and formatted single-timestamp chapter lines.
 * Used by: future export bundle/YouTube publishing flow, backend/chapters.test.ts.
 */

import type { Film } from "../src/dl/schema";

/** Minimum duration for each chapter heading (seconds); shorter chapters merge into a neighbor. */
export const MIN_CHAPTER_DURATION_SEC = 10;

/** One computed chapter heading with a single start timestamp. */
export interface ChapterHeading {
  title: string;
  startSec: number;
  durationSec: number;
  timestamp: string;
}

/** Options controlling chapter computation from film shots. */
export interface ComputeChaptersOptions {
  /** Minimum chapter duration in seconds before merging (default 10). */
  minDurationSec?: number;
}

// Strips any leading timestamp range or single timestamp that leaked into a chapter title.
export function stripLeadingChapterTimestamp(title: string): string {
  const trimmed = title.trim();
  const withoutRange = trimmed.replace(
    /^\d{1,2}:\d{2}(?::\d{2})?\s*[-\u2013\u2014]\s*\d{1,2}:\d{2}(?::\d{2})?\s*[-\u2013\u2014:]?\s*/,
    "",
  );
  if (withoutRange !== trimmed) return withoutRange.trim() || trimmed;
  const withoutSingle = trimmed.replace(
    /^\d{1,2}:\d{2}(?::\d{2})?\s*[-\u2013\u2014:]\s*/,
    "",
  );
  return withoutSingle.trim() || trimmed;
}

// Formats a non-negative start time in seconds as one timestamp ("0:00", "2:29", or "1:02:05").
export function formatChapterTimestamp(totalSec: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(totalSec) ? totalSec : 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Computes ordered, single-timestamp chapter headings from film data, merging chapters under minDurationSec.
export function computeFilmChapters(
  film: Pick<Film, "shots" | "chapters">,
  options: ComputeChaptersOptions = {},
): ChapterHeading[] {
  const minDurationSec = options.minDurationSec ?? MIN_CHAPTER_DURATION_SEC;
  if (!Number.isFinite(minDurationSec) || minDurationSec < 0) {
    throw new Error(`Invalid minDurationSec (${minDurationSec}): expected a non-negative number`);
  }

  const raw: Array<{ title: string; startSec: number; durationSec: number }> = [];
  const defaultTitle = stripLeadingChapterTimestamp(film.chapters?.[0] ?? "") || "Intro";
  let clock = 0;

  for (const shot of film.shots) {
    const dur = Number.isFinite(shot.dur) && shot.dur > 0 ? shot.dur : 0;
    if (dur <= 0) continue;
    const rawLabel = typeof shot.ch === "string" ? stripLeadingChapterTimestamp(shot.ch) : "";
    const previous = raw[raw.length - 1];
    const title = rawLabel || previous?.title || defaultTitle;
    if (previous && previous.title === title) {
      previous.durationSec += dur;
    } else {
      raw.push({ title, startSec: clock, durationSec: dur });
    }
    clock += dur;
  }

  if (raw.length === 0) return [];

  // Merge any chapter shorter than minDurationSec into its previous neighbor (or into the next chapter when index 0).
  const merged = raw.map((entry) => ({ ...entry }));
  while (merged.length > 1) {
    const shortIdx = merged.findIndex((ch) => ch.durationSec < minDurationSec);
    if (shortIdx === -1) break;
    if (shortIdx > 0) {
      merged[shortIdx - 1].durationSec += merged[shortIdx].durationSec;
      merged.splice(shortIdx, 1);
    } else {
      merged[0].durationSec += merged[1].durationSec;
      merged.splice(1, 1);
    }
  }

  return merged.map((entry) => ({
    title: entry.title,
    startSec: Number(entry.startSec.toFixed(3)),
    durationSec: Number(entry.durationSec.toFixed(3)),
    timestamp: formatChapterTimestamp(entry.startSec),
  }));
}

// Formats chapter headings as one timestamp and title per line (e.g. "0:00 Intro").
export function formatFilmChapters(chapters: readonly ChapterHeading[]): string {
  return chapters.map((ch) => `${ch.timestamp} ${ch.title}`).join("\n");
}
