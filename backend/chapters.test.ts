/**
 * File Description: Tests for W9 single-timestamp chapter computation from film data, including the 10-second minimum duration merge rule and real fixture film verification.
 * Inputs and outputs: synthetic shot lists and fixture films -> assertions on chapter timestamps, durations, and titles.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Film } from "../src/dl/schema";
import { getVideosDir } from "../src/dl/videoPackageLoader";
import {
  computeFilmChapters,
  formatChapterTimestamp,
  formatFilmChapters,
  MIN_CHAPTER_DURATION_SEC,
  stripLeadingChapterTimestamp,
} from "./chapters";

// Builds a minimal film shape with the given (chapter, duration) shots.
function filmWithShots(shots: Array<{ ch?: string; dur: number }>, chapters: string[] = ["Intro"]): Pick<Film, "shots" | "chapters"> {
  return {
    chapters,
    shots: shots.map((s, i) => ({
      id: `s${i + 1}`,
      dur: s.dur,
      ch: s.ch,
      look: "a",
      move: "cut",
      stage: "none",
      zoom: 1,
      drift: false,
      blocks: [],
    })) as Film["shots"],
  };
}

test("W9 chapters: formats single timestamps and strips leaked timestamp prefixes", () => {
  assert.equal(formatChapterTimestamp(0), "0:00");
  assert.equal(formatChapterTimestamp(65.9), "1:05");
  assert.equal(formatChapterTimestamp(3725), "1:02:05");
  assert.equal(stripLeadingChapterTimestamp("0:30 - The Problem"), "The Problem");
  assert.equal(stripLeadingChapterTimestamp("0:00-0:20 - Opening"), "Opening");
  assert.equal(stripLeadingChapterTimestamp("Plain Title"), "Plain Title");
});

test("W9 chapters: merges chapters under 10 seconds cleanly into neighbors", () => {
  const film = filmWithShots([
    { ch: "Opening Hook", dur: 6 },
    { ch: "The Problem", dur: 18 },
    { ch: "Quick Bridge", dur: 4 },
    { ch: "The Fix", dur: 14 },
    { ch: "Tiny Outro", dur: 5 },
  ]);

  const chapters = computeFilmChapters(film);
  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters, [
    { title: "Opening Hook", startSec: 0, durationSec: 28, timestamp: "0:00" },
    { title: "The Fix", startSec: 28, durationSec: 19, timestamp: "0:28" },
  ]);
  assert.equal(formatFilmChapters(chapters), "0:00 Opening Hook\n0:28 The Fix");
  for (const ch of chapters) {
    assert.ok(ch.durationSec >= MIN_CHAPTER_DURATION_SEC);
  }
});

test("W9 chapters: computes valid single-timestamp chapters on the speculative-decoding-designed fixture film", () => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(getVideosDir(), "speculative-decoding-designed", "film.json"), "utf8"),
  ) as Film;
  const chapters = computeFilmChapters(raw);
  assert.ok(chapters.length >= 3, `expected at least 3 chapters, got ${chapters.length}`);
  assert.equal(chapters[0].timestamp, "0:00");
  for (let i = 0; i < chapters.length; i++) {
    assert.ok(chapters[i].durationSec >= MIN_CHAPTER_DURATION_SEC, `chapter "${chapters[i].title}" must be >= 10 s`);
    if (i > 0) {
      assert.ok(chapters[i].startSec - chapters[i - 1].startSec >= MIN_CHAPTER_DURATION_SEC);
    }
  }
});
