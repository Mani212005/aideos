/**
 * File Description: Behavioural tests of the design check's rules for SVG composed with pictures, encoding the owner's request of 2026-11-22 (feedback item 3: use SVG and pictures together, a picture as the hero with SVG labels, arrows and callouts drawn on and around it, or an SVG diagram that transitions into the picture it explains). The worked example film `picture-callouts` (an SVG plan of a lens that becomes the lens picture under the same callouts) passes; a callout whose anchor leaves the picture's alpha-trimmed box, a picture layered above its callouts, a leader that loses contrast over the picture, and a callout that names no picture or no anchor each fail with the rule and the part named.
 * Inputs and outputs: the picture-callouts fixture package built through buildDesign, with one artwork file or scene value changed per case -> asserted design findings.
 * Used by: npm test (found by glob).
 */

import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildDesign } from "../designSpec/build";
import { readFilm } from "../pipeline/filmStore";
import { resolvePackageDir } from "../videoPackageLoader";
import type { Film } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import { checkFilmDesign, type DesignFinding } from "./designCheck";

const SLUG = "picture-callouts";

/** Builds the example film once through the real design build and returns a fresh copy of it. */
function builtFilm(): Film {
  const status = buildDesign(SLUG, "hand-built");
  assert.equal(status.state, "passed", JSON.stringify(status.errors.concat(status.findings.map((f) => f.message))));
  return structuredClone(readFilm(SLUG)!);
}

/** The errors of one rule. */
const errors = (findings: DesignFinding[], rule: DesignFinding["rule"]) => findings.filter((f) => f.rule === rule && f.severity === "error");

/** Rewrites the example's callout artwork for one test, restoring it afterwards. */
function editCallouts(t: test.TestContext, edit: (svg: string) => string): void {
  const file = path.join(resolvePackageDir(SLUG), "visuals", "callouts.svg");
  const original = fs.readFileSync(file, "utf8");
  t.after(() => fs.writeFileSync(file, original));
  const next = edit(original);
  assert.notEqual(next, original, "the edit must change the artwork");
  fs.writeFileSync(file, next);
}

/** A prop of the built film's scene by asset id. */
const prop = (film: Film, id: string) => (film.scene as unknown as Scene).props.find((a) => a.assetId === id)!;

test("the worked example (SVG plan becomes the lens picture under anchored callouts) passes every composition rule", () => {
  const report = checkFilmDesign(builtFilm());
  assert.ok(report.ok, JSON.stringify(report.findings.filter((f) => f.severity === "error")));
  for (const rule of ["callout-anchor", "picture-cover", "contrast"] as const) assert.deepEqual(errors(report.findings, rule), [], rule);
});

test("a callout anchor placed beside the picture, off its alpha-trimmed box, fails", (t) => {
  const film = builtFilm();
  // The ring's dot moves left of the lens's visible box (211 scene units either side of its centre).
  editCallouts(t, (svg) => svg.replace('cx="-136" cy="-136" r="9"', 'cx="-230" cy="-100" r="9"'));
  const found = errors(checkFilmDesign(film).findings, "callout-anchor");
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].where, "callouts / ring-callout");
  assert.match(found[0].message, /callout anchor sits at \(730, 780\), off picture "lens" whose visible box spans/);
});

test("callouts left behind when the picture moves fail", () => {
  const film = builtFilm();
  prop(film, "lens").position.x += 400;
  const found = errors(checkFilmDesign(film).findings, "callout-anchor");
  assert.deepEqual(found.map((f) => f.where).sort(), ["callouts / core-callout", "callouts / glass-callout", "callouts / ring-callout"]);
});

test("a picture layered above its callouts hides them and fails", () => {
  const film = builtFilm();
  prop(film, "callouts").layer = 1;
  const found = errors(checkFilmDesign(film).findings, "picture-cover");
  assert.ok(found.length > 0, "the lens covers the dots and leaders drawn on it");
  for (const f of found) assert.match(f.where, /^callouts \/ (ring|glass|core)-(dot|leader)$/);
  assert.match(found[0].message, /picture "lens" is drawn above this callout (anchor|leader) and hides \d+% of it/);
  // The labels sit beside the lens, so the picture never hides them.
  assert.ok(!found.some((f) => /label/.test(f.where)), JSON.stringify(found));
});

test("a leader that loses contrast over the picture fails, measured along its drawn length", (t) => {
  const film = builtFilm();
  editCallouts(t, (svg) => svg.replace(/(polyline id="(?:ring|glass|core)-leader"[^>]*)stroke="#F5F5F5"/g, '$1stroke="#8A8A8E"'));
  const found = errors(checkFilmDesign(film).findings, "contrast");
  assert.ok(found.length > 0, "a grey leader over the steel ring and the glowing core is lost");
  assert.ok(found.every((f) => /\/ callouts \/ (ring|glass|core)-leader$/.test(f.where)), JSON.stringify(found));
  assert.match(found[0].message, /callout leader over picture "background, lens" has contrast [0-9.]+:1 .* \(needs 3:1\)/);
});

test("a callout must name a picture of the scene and mark exactly one anchor", (t) => {
  const film = builtFilm();
  editCallouts(t, (svg) => svg.replace('id="glass-callout" data-callout="lens"', 'id="glass-callout" data-callout="lenz"').replace(/(id="core-dot") data-anchor="true"/, "$1"));
  const found = errors(checkFilmDesign(film).findings, "callout-anchor");
  assert.match(found.find((f) => f.where === "callouts / glass-callout")?.message ?? "", /points at "lenz", which is not a picture of this scene/);
  assert.match(found.find((f) => f.where === "callouts / core-callout")?.message ?? "", /marks 0 anchors; mark exactly one element data-anchor="true"/);
});
