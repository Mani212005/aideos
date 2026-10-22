/**
 * File Description: Regression tests for caption visibility parity and real two-line card geometry.
 * Inputs and outputs: sample films and output sizes -> caption words and card extent assertions.
 * Used by: npm test.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { captionWordsForFilm } from "../src/dl/captionsParser";
import { parseFilm } from "../src/dl/schema";
import { subtitleCardBottom } from "../src/dl/fullScreenHeroLayout";
import fs from "node:fs";
const film = parseFilm(
  JSON.parse(fs.readFileSync("examples/hello-scene/film.json", "utf8")),
);
// Matches hidden captions between the editor and export without changing enabled words.
test("preview and export share enabled words and both disable captions", () => {
  assert.ok(captionWordsForFilm(film).length > 0);
  assert.deepEqual(captionWordsForFilm({ ...film, subtitles: false }), []);
  assert.deepEqual(captionWordsForFilm({ ...film, captions: "off" }), []);
});
// Accounts for the two borders and the four inline word margins on two lines.
test("two-line card extent includes all rendered vertical space", () => {
  assert.equal(
    subtitleCardBottom(1920, 1080),
    1080 * 0.78 + 24 + (45 * 1.35 + 8) * 2 + 2,
  );
});
