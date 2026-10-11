/**
 * File Description: Tests for the inset stage: the SVG geometry the inset rule measures with, the film schema's
 * `stage: "inset"` rules, and the guarantee that the editor preview and the Remotion export share one render tree.
 * Inputs and outputs: SVG snippets, film fixtures and source files -> inset stage assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "./testSupport/fixtureVideosDir";
import { parseFilm } from "../src/dl/schema";
import { parseSvgDocument } from "../src/dl/scene/svgDocument";
import { apply, leafBounds, parseTransform } from "./designCheck/svgBounds";

const ROOT = path.resolve(__dirname, "..");

// Parses one SVG element out of a snippet and returns its local bounding box.
function boundsOf(markup: string) {
  const doc = parseSvgDocument(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`);
  return leafBounds(doc.children[0]);
}

test("svg bounds: shapes are measured from their attributes, stroke included", () => {
  assert.deepEqual(boundsOf(`<rect x="10" y="20" width="30" height="40"/>`), { x0: 10, y0: 20, x1: 40, y1: 60 });
  assert.deepEqual(boundsOf(`<circle cx="0" cy="0" r="10" stroke="#F5F5F5" stroke-width="4"/>`), { x0: -12, y0: -12, x1: 12, y1: 12 });
  assert.deepEqual(boundsOf(`<line x1="5" y1="9" x2="-5" y2="1"/>`), { x0: -5, y0: 1, x1: 5, y1: 9 });
});

test("svg bounds: a path is bounded by its endpoints and control points, relative commands included", () => {
  const b = boundsOf(`<path d="M10 10 L20 10 l0 30 h-10 C0 50 0 60 5 70 z"/>`)!;
  assert.deepEqual(b, { x0: 0, y0: 10, x1: 20, y1: 70 });
});

test("svg bounds: text is bounded by its anchor, size and length", () => {
  const b = boundsOf(`<text x="100" y="50" font-size="10" text-anchor="middle">ABCD</text>`)!;
  assert.ok(b.x0 < 100 && b.x1 > 100 && Math.abs(100 - b.x0 - (b.x1 - 100)) < 1e-9, "centred on x");
  assert.ok(b.y0 < 50 && b.y1 > 50);
});

test("svg bounds: transform lists compose left to right", () => {
  const m = parseTransform("translate(10 20) scale(2) rotate(90)");
  const [x, y] = apply(m, 1, 0);
  assert.ok(Math.abs(x - 10) < 1e-9 && Math.abs(y - 22) < 1e-9, `${x},${y}`);
  assert.deepEqual(apply(parseTransform(undefined), 3, 4), [3, 4]);
});

test("film schema: a scene film accepts a one-device inset, and stage still defaults to anchor", () => {
  const film = JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "inset-stage/film.json"), "utf8"));
  assert.equal(parseFilm(film).shots[1].stage, "inset");
  delete film.shots[1].stage;
  film.shots[1].look = "rack";
  assert.equal(parseFilm(film).shots[1].stage, "anchor");
});

test("render tree: the editor preview and the export both render FilmView, and FilmView draws the inset", () => {
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  assert.match(read("src/dl/Video.tsx"), /import \{ FilmView \} from "\.\/Film"/);
  assert.match(read("editor/src/screens/EditStage.tsx"), /import \{ FilmView \} from "\.\.\/\.\.\/\.\.\/src\/dl\/Film"/);
  assert.match(read("editor/src/components/DescribeMotion.tsx"), /import \{ FilmView \} from "\.\.\/\.\.\/\.\.\/src\/dl\/Film"/);
  const film = read("src/dl/Film.tsx");
  assert.match(film, /getInsetRegion\(/);
  assert.match(film, /shot\.stage === "inset"/);
});
