/**
 * File Description: Covers soundtrack timing schema and layered volume validation.
 * Inputs and outputs: Film soundtrack data -> validation assertions.
 * Used by: Targeted soundtrack validation checks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";
import { parseFilm } from "../src/dl/schema";
import { convertFilmToLayeredFilm } from "../src/dl/convertFilm";
import { validateLayeredFilm } from "../src/dl/validateLayeredFilm";

// Accepts a valid soundtrack volume through the layered model.
test("soundtrack volume 1.5 passes layered validation", () => {
  const base = loadFixtureFilm("fixture-canvas-a");
  const film = parseFilm({
    ...base,
    soundtrack: { sections: [{ item: "music", from: 0, to: 3, volume: 1.5 }] },
  });

  assert.doesNotThrow(() => validateLayeredFilm(convertFilmToLayeredFilm(film)));
});

// Rejects soundtrack sections whose end does not follow their start.
test("soundtrack schema rejects reversed section ranges", () => {
  const base = loadFixtureFilm("fixture-canvas-a");

  assert.throws(() => parseFilm({
    ...base,
    soundtrack: { sections: [{ item: "music", from: 5, to: 3 }] },
  }), /to must be greater than from/);
});

// Rejects speech intervals whose end does not follow their start.
test("soundtrack schema rejects reversed speech intervals", () => {
  const base = loadFixtureFilm("fixture-canvas-a");

  assert.throws(() => parseFilm({
    ...base,
    soundtrack: { speech: [{ startSec: 10, endSec: 5 }] },
  }), /endSec must be greater than startSec/);
});
