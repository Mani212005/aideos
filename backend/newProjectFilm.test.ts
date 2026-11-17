/**
 * File Description: Tests of the first film of a new project (the Start box): a story under 10 s keeps a title-only film with no invented content, a story that fits compiles, and a story that breaks another schema limit (more than 12 sections, more than 24 canvas nodes) throws the Invalid film error as before.
 * Inputs and outputs: tagged story scripts -> assertions on the film or the thrown error.
 * Used by: npm test (backend/**\/*.test.ts).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseFilm } from "../src/dl/schema";
import { newProjectFilmTheme } from "../src/projectTheme";
import { buildNewProjectFilm } from "./newProjectFilm";

const SENTENCE = "A load balancer shares incoming requests across several servers so that no single machine is overwhelmed by the traffic that arrives every second.";

/** A tagged story with `sections` sections of `sentences` narrated sentences each. */
function story(sections: number, sentences: number): string {
  return Array.from({ length: sections }, (_, i) =>
    [`## ${i}:00 - Part ${i + 1}`, `[NARRATION] ${Array.from({ length: sentences }, () => SENTENCE).join(" ")}`, "[VISUAL] A row of servers"].join("\n"),
  ).join("\n");
}

/** The input for a story with fixed id, title and theme. */
function input(storyScript: string) {
  return { id: "start-test", title: "Start test", accent: "#635BFF", theme: newProjectFilmTheme(undefined, undefined), storyScript, autoCompile: true };
}

test("a story under 10 s keeps a film of one title shot with no invented content", () => {
  const film = buildNewProjectFilm(input("## 0:00 - Idea\n[NARRATION] A cache keeps recent answers close.\n[VISUAL] A cache"));
  assert.equal(film.shots.length, 1);
  assert.deepEqual(film.shots[0].blocks, [{ c: "TextReveal", text: "Start test", size: "headline" }]);
  assert.doesNotThrow(() => parseFilm(film));
});

test("a story with one long section gets an end node and compiles", () => {
  const film = buildNewProjectFilm(input(story(1, 3)));
  assert.equal(film.canvas.nodes.length, 2);
  assert.ok(film.shots.length >= 1);
  assert.doesNotThrow(() => parseFilm(film));
});

test("a story with more than 12 sections throws the Invalid film error", () => {
  assert.throws(() => buildNewProjectFilm(input(story(13, 2))), /Invalid film:[\s\S]*chapters/);
});

test("a story with more than 24 canvas nodes throws the Invalid film error", () => {
  assert.throws(() => buildNewProjectFilm(input(story(25, 2))), /Invalid film:[\s\S]*canvas\.nodes/);
});
