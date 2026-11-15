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
  return generateWordsFromFilm(film as unknown as Record<string, unknown>);
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

test("Caption word edit: an edit that cannot be read back returns an error and no film", () => {
  const film = makeFilm();
  const result = editCaptionWord(film, 4, { endFrame: 34 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /number word/i);
  assert.deepEqual(wordsOf(film).map((w) => w.text), TEXTS);
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
