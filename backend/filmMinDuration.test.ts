/**
 * File Description: Boundary tests of the film minimum length scaled by the narration rate: the 10 s floor holds at 1.0x and becomes 8.3 s at the 1.2x house pace. Each case parses a real one-shot film whose narration comes from a script with a given word count, with the shot length measured by estimateNarrationSeconds at that rate, just above and just below the floor, through the real film schema.
 * Inputs and outputs: scripts of fixed word counts and a narration rate -> pass or fail of filmSchemaAtPace and the schema error message.
 * Used by: npm test (backend/**\/*.test.ts).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { filmSchema, filmSchemaAtPace, type Film } from "../src/dl/schema";
import { HOUSE_PACE, minFilmSecAt } from "./pacingProfile";
import { estimateNarrationSeconds } from "./scriptIntake";
import { newProjectFilmTheme } from "../src/projectTheme";

/** A narration of exactly `words` words. */
function script(words: number): string {
  return Array.from({ length: words }, () => "word").join(" ");
}

/** A valid one-shot film whose only shot is as long as `narration` takes to say at `rate`. */
function filmFor(narration: string, rate: number): Film {
  return {
    id: "min-duration",
    title: "Min duration",
    fps: 30,
    theme: newProjectFilmTheme(undefined, undefined),
    chapters: ["Min duration"],
    canvas: {
      nodes: [
        { id: "intro", label: "Min duration", x: -200, y: -100, w: 230, h: 70 },
        { id: "end", label: "End", x: 160, y: -100, w: 230, h: 70 },
      ],
      edges: [{ from: "intro", to: "end", dashed: false }],
    },
    shots: [
      {
        id: "shot-1",
        dur: estimateNarrationSeconds(narration, rate),
        look: "intro",
        move: "cut",
        stage: "frame",
        drift: false,
        zoom: 1,
        blocks: [{ c: "TextReveal", text: "Min duration", size: "headline" }],
      },
    ],
  } as Film;
}

/** The issue messages the schema gives a film at a narration rate. */
function messages(film: Film, rate: number): string[] {
  const result = filmSchemaAtPace(rate).safeParse(film);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

// Word counts measured with estimateNarrationSeconds: the largest count under each floor and the smallest at or over it.
const CASES = [
  { rate: 1, floor: 10, below: 23, above: 24 },
  { rate: 1.2, floor: 8.3, below: 22, above: 23 },
];

test("the floor is 10 s at 1.0x and 8.3 s at the 1.2x house pace", () => {
  assert.equal(minFilmSecAt(1), 10);
  assert.equal(minFilmSecAt(1.2), 8.3);
  assert.equal(HOUSE_PACE.minFilmSec, 8.3);
});

for (const { rate, floor, below, above } of CASES) {
  test(`at ${rate}x a script just above ${floor} s parses and a script just below fails with the scaled message`, () => {
    const aboveFilm = filmFor(script(above), rate);
    const belowFilm = filmFor(script(below), rate);
    assert.ok(aboveFilm.shots[0].dur >= floor, `above script is ${aboveFilm.shots[0].dur} s`);
    assert.ok(belowFilm.shots[0].dur < floor, `below script is ${belowFilm.shots[0].dur} s`);
    assert.deepEqual(messages(aboveFilm, rate), []);
    assert.deepEqual(messages(belowFilm, rate), [`film is under ${floor}s`]);
  });
}

test("the house schema applies the 1.2x floor: a 9 s film passes and an 8 s film fails", () => {
  const nineSeconds = filmFor(script(23), 1.2);
  nineSeconds.shots[0].dur = 9;
  assert.equal(filmSchema.safeParse(nineSeconds).success, true);
  nineSeconds.shots[0].dur = 8;
  const result = filmSchema.safeParse(nineSeconds);
  assert.equal(result.success, false);
  assert.match(result.success ? "" : result.error.message, /film is under 8\.3s/);
});
