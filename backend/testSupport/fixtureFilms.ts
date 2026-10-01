/**
 * File Description: Loads the small hand-trimmed film fixtures in test_fixtures/films. Tests use
 * these instead of anyone's real videos, which are gitignored and absent on a fresh clone.
 */

import fs from "node:fs";
import path from "node:path";
import type { Film } from "../../src/dl/schema";

const FILMS_DIR = path.resolve(__dirname, "../../test_fixtures/films");

/** Reads test_fixtures/films/<name>.json as a Film, unvalidated so a test sees exactly what is on disk. */
export function loadFixtureFilm(name: string): Film {
  return JSON.parse(fs.readFileSync(path.join(FILMS_DIR, `${name}.json`), "utf8")) as Film;
}
