/**
 * File Description: Behavioural tests for the Cut inspector caption word edit: text and timing edits keep every caption word, including number words, through a save and reload.
 * Inputs and outputs: films with caption tracks and word edits -> assertions on the words read back with generateWordsFromFilm.
 * Used by: npm test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { captionWordsToVtt, generateWordsFromFilm } from "../src/dl/captionsParser";
import { editCaptionWord } from "../editor/src/components/captions/captionWordEdit";
import type { Film } from "../src/dl/schema";

const TEXTS = ["In", "2024", "we", "ship", "007", "bonds", "today"];

// Builds a film whose caption words each last six frames, packed five to a cue like a generated track.
function makeFilm(): Film {
  const words = TEXTS.map((text, i) => ({ text, startFrame: i * 6, endFrame: i * 6 + 6 }));
  return { fps: 30, captions: captionWordsToVtt(words, 30) } as unknown as Film;
}

// Reads the caption words of a film.
function wordsOf(film: Film) {
  return generateWordsFromFilm(film);
}

// Saves and reloads a film the way the project file does.
function reload(film: Film): Film {
  return JSON.parse(JSON.stringify(film)) as Film;
}

test("Caption word edit: the fixture reads back every word", () => {
  assert.deepEqual(wordsOf(makeFilm()).map((w) => w.text), TEXTS);
});

test("Caption word edit: a text edit keeps number words and all times after a reload", () => {
  const film = makeFilm();
  const before = wordsOf(film);
  const result = editCaptionWord(film, 2, { text: "us" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const after = wordsOf(reload(result.film));
  assert.deepEqual(after, before.map((w, i) => (i === 2 ? { ...w, text: "us" } : w)));
});

test("Caption word edit: a timing edit keeps number words and the new times after a reload", () => {
  const film = makeFilm();
  const before = wordsOf(film);
  const result = editCaptionWord(film, 3, { endFrame: 28 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const after = wordsOf(reload(result.film));
  assert.deepEqual(after, before.map((w, i) => (i === 3 ? { ...w, endFrame: 28 } : w)));
});

test("Caption word edit: a number word keeps its own timing after a reload, alone in its cue or not", () => {
  const film = makeFilm();
  const before = wordsOf(film);
  // "007" (index 4) gets a length no neighbour shares, so it must be written as a single-word cue made only of digits.
  const result = editCaptionWord(film, 4, { endFrame: 34 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const after = wordsOf(reload(result.film));
  assert.deepEqual(after, before.map((w, i) => (i === 4 ? { ...w, endFrame: 34 } : w)));
  // Retyping a word into a number is saved as well, whatever neighbours it has.
  const typed = editCaptionWord(film, 3, { text: "2026", endFrame: 23 });
  assert.equal(typed.ok, true);
  if (!typed.ok) return;
  assert.deepEqual(wordsOf(reload(typed.film)).map((w) => w.text), ["In", "2024", "we", "2026", "007", "bonds", "today"]);
});

test("Caption word edit: text with a space or no text is refused", () => {
  const film = makeFilm();
  const spaced = editCaptionWord(film, 2, { text: "two words" });
  assert.equal(spaced.ok, false);
  const empty = editCaptionWord(film, 2, { text: "   " });
  assert.equal(empty.ok, false);
});

test("Caption word edit: an edit that changes nothing returns the same film", () => {
  const film = makeFilm();
  const result = editCaptionWord(film, 2, { text: "we" });
  assert.equal(result.ok && result.film === film, true);
});

test("Caption word edit: a film with captions off is never given a caption track", () => {
  const film = { ...makeFilm(), captions: "off" } as unknown as Film;
  const result = editCaptionWord(film, 0, { text: "At" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /captions are off/i);
  assert.equal(film.captions, "off");
  const hidden = { ...makeFilm(), subtitles: false } as unknown as Film;
  assert.equal(editCaptionWord(hidden, 0, { text: "At" }).ok, false);
});

test("Caption word edit: an End past the next word start is kept as written after a reload", () => {
  const film = makeFilm();
  const result = editCaptionWord(film, 3, { endFrame: 28 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(wordsOf(reload(result.film))[3].endFrame, 28);
});
