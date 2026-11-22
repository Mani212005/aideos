/**
 * File Description: Tests for the one footage wiring rule (src/dl/footageWiring.ts): the 80-character AnalogyInset
 * caption cut, in-place update so wiring twice keeps a single inset, and the errors for a missing shot or film.
 * Inputs and outputs: a fixture film and clip paths -> wired films that still pass parseFilm, or thrown errors.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import "./testSupport/fixtureVideosDir";
import { FOOTAGE_CAPTION_MAX, withFootage, withShotFootage } from "../src/dl/footageWiring";
import { parseFilm, type Film } from "../src/dl/schema";
import { wireFootageIntoFilm } from "./pipeline/filmStore";

const FIXTURE_FILM = path.resolve(__dirname, "../test_fixtures/packages/sample-explainer/film.json");

// Loads the sample-explainer fixture film with its AnalogyInsets removed, so each test starts without one.
function loadFilmWithoutInsets(): Film {
  const film = parseFilm(JSON.parse(fs.readFileSync(FIXTURE_FILM, "utf8")));
  return {
    ...film,
    shots: film.shots.map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.c !== "AnalogyInset") })),
  };
}

// Returns the AnalogyInset blocks of a shot.
function insetsOf(shot: Film["shots"][number]) {
  return shot.blocks.filter((b): b is Extract<typeof b, { c: "AnalogyInset" }> => b.c === "AnalogyInset");
}

test("a caption longer than the limit is cut to exactly FOOTAGE_CAPTION_MAX for a new inset", () => {
  assert.equal(FOOTAGE_CAPTION_MAX, 80);
  const film = loadFilmWithoutInsets();
  const shotId = film.shots[0].id;
  const wired = withFootage(film, shotId, "videos/x/footage/a.mp4", "w".repeat(200));
  const [inset] = insetsOf(wired.shots[0]);
  assert.equal(inset.caption.length, FOOTAGE_CAPTION_MAX);
  assert.equal(inset.fullScreenHero, true);
  assert.doesNotThrow(() => parseFilm(wired));
});

test("a caption longer than the limit is cut to exactly FOOTAGE_CAPTION_MAX when updating an existing inset", () => {
  const film = loadFilmWithoutInsets();
  const first = withShotFootage(film.shots[0], "videos/x/footage/a.mp4", "short caption");
  const second = withShotFootage(first, "videos/x/footage/b.mp4", "z".repeat(200));
  const [inset] = insetsOf(second);
  assert.equal(inset.caption.length, FOOTAGE_CAPTION_MAX);
  assert.doesNotThrow(() => parseFilm({ ...film, shots: [second, ...film.shots.slice(1)] }));
});

test("an empty caption keeps an existing inset's caption and gives a new inset a non-empty one", () => {
  const film = loadFilmWithoutInsets();
  const fresh = withShotFootage(film.shots[0], "videos/x/footage/a.mp4", "   ");
  const [freshInset] = insetsOf(fresh);
  assert.ok(freshInset.caption.length > 0);

  const named = withShotFootage(film.shots[0], "videos/x/footage/a.mp4", "kept caption");
  const rewired = withShotFootage(named, "videos/x/footage/b.mp4", "");
  assert.equal(insetsOf(rewired)[0].caption, "kept caption");
  assert.doesNotThrow(() => parseFilm({ ...film, shots: [rewired, ...film.shots.slice(1)] }));
});

test("wiring the same shot twice keeps exactly one AnalogyInset, updated in place with the second src", () => {
  const film = loadFilmWithoutInsets();
  const shotId = film.shots[0].id;
  const once = withFootage(film, shotId, "videos/x/footage/a.mp4", "caption");
  const twice = withFootage(once, shotId, "videos/x/footage/b.mp4", "caption");
  const insets = insetsOf(twice.shots[0]);
  assert.equal(insets.length, 1);
  assert.equal(insets[0].src, "videos/x/footage/b.mp4");
  assert.equal(twice.shots[0].needsFootage, true);
  assert.equal(film.shots[0].blocks.some((b) => b.c === "AnalogyInset"), false, "the input film is not mutated");
});

test("withFootage throws for a shot id the film does not have", () => {
  const film = loadFilmWithoutInsets();
  assert.throws(() => withFootage(film, "no-such-shot", "videos/x/footage/a.mp4", "caption"), /no shot "no-such-shot"/);
});

test("wireFootageIntoFilm throws for a film slug that has no package", () => {
  assert.throws(() => wireFootageIntoFilm("no-such-package-footage-wiring", "s1", "videos/x/footage/a.mp4", "caption"), /no film found/);
});
