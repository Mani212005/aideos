/**
 * File Description: Expect test of the film store's on-disk film JSON: a fixture film written through the real writeFilm (validation, soundtrack preparation, caption carry-over) is compared byte for byte with the reviewed film.json in test_fixtures/expect/film-json/, and readFilm must read back the same film. A schema default, field order or soundtrack change that alters what lands on disk shows up as a diff line.
 * Inputs and outputs: test_fixtures/films/fixture-canvas-a.json and a throwaway package in the fixture videos dir -> equality of the written film.json with test_fixtures/expect/film-json/fixture-canvas-a.film.json.
 * Used by: npm test (found by glob), the CI unit job.
 */

import "../testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { expectFile } from "../testSupport/expectFile";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";
import { readFilm, writeFilm } from "./filmStore";
import { FILMS_DIR } from "./generatedFiles";

const SLUG = "expect-film-json-probe";

test("writeFilm writes the reviewed film.json for a fixture film and readFilm reads the same film back", () => {
  const film = { ...loadFixtureFilm("fixture-canvas-a"), id: SLUG };
  try {
    const written = writeFilm(SLUG, film, { owner: true });
    const onDisk = fs.readFileSync(path.join(getVideosDir(), SLUG, "film.json"), "utf8");
    expectFile(`${onDisk}\n`, "film-json/fixture-canvas-a.film.json");
    assert.deepEqual(readFilm(SLUG), written, "readFilm returns exactly what writeFilm returned");
    assert.equal(onDisk, JSON.stringify(written, null, 2), "film.json is the validated film, two-space JSON");
  } finally {
    fs.rmSync(path.join(getVideosDir(), SLUG), { recursive: true, force: true });
    fs.rmSync(path.join(FILMS_DIR, `${SLUG}.ts`), { force: true });
  }
});
