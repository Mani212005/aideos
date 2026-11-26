/**
 * File Description: Seeded property test for generated film values surviving validation and a JSON serialize/parse cycle.
 * Inputs and outputs: generated variants of a valid fixture film -> schema round trips preserve the parsed Film exactly.
 * Used by: npm test (found by glob), the CI unit job.
 */

import "./testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import test from "node:test";
import { parseFilm, type Film } from "../src/dl/schema";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";
import { forAll, pick, randInt } from "./testSupport/propertyTest";

const BASE_FILM = loadFixtureFilm("fixture-canvas-a");
const FPS_VALUES: readonly Film["fps"][] = [24, 30, 60];

// Builds a schema-valid film with generated identity, frame rate, chapter text, canvas positions, and voiceover volume.
function generatedFilm(rand: () => number): Film {
  const chapterIndex = randInt(rand, 0, BASE_FILM.chapters.length - 1);
  const chapters = [...BASE_FILM.chapters];
  chapters[chapterIndex] = `${chapters[chapterIndex]} ${randInt(rand, 1, 999)}`;
  return {
    ...BASE_FILM,
    id: `generated-film-${randInt(rand, 1, 1_000_000)}`,
    title: `Generated film ${randInt(rand, 1, 1_000_000)}`,
    fps: pick(rand, FPS_VALUES),
    chapters,
    canvas: {
      nodes: BASE_FILM.canvas.nodes.map((node) => ({
        ...node,
        x: node.x + randInt(rand, -1000, 1000),
        y: node.y + randInt(rand, -1000, 1000),
      })),
      edges: BASE_FILM.canvas.edges.map((edge) => ({ ...edge })),
    },
    voiceover: BASE_FILM.voiceover ? { ...BASE_FILM.voiceover, volume: randInt(rand, 0, 200) / 100 } : undefined,
  };
}

// Ensures generated schema values remain stable after the actual JSON persistence boundary.
test("generated films round trip through validation and JSON without changing parsed values", () => {
  forAll("film schema JSON round trip", generatedFilm, (generated) => {
    const parsed = parseFilm(generated);
    const serialized = JSON.stringify(parsed);
    const roundTripped = parseFilm(JSON.parse(serialized));
    assert.deepEqual(roundTripped, parsed);
  });
});
