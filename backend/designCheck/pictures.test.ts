/**
 * File Description: Behavioural tests of the design check's picture rules, encoding the captain's decision for the illustrated stage, phase 1 (option A of the mixed-media research), item 2: design checks updated for pictures, with a contrast rule for labels over a busy plate, an OCR rule that flags any generated text in a picture, and the palette check no longer bypassed (a raster hidden inside SVG artwork is refused, and a declared picture's own pixels are held to the film accent); plus the provenance record each picture keeps (item 3) and the prompt rules (item 4: abstract objects only, no people, no logos, no named brands or artists). The clean synthetic fixture film passes every rule.
 * Inputs and outputs: the pictures-stage fixture package built through buildDesign, with one picture or artwork swapped per case -> asserted design findings.
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
import { rasterSourceOf, storePicture, pictureFiles } from "../pictures/cache";
import { encodePng, decodePng } from "../pictures/png";
import { busyPlatePicture, offPalettePicture, orbPicture, PICTURES_STAGE, TEXT_PICTURE_FIXTURE } from "../testSupport/pictureFixtures";
import type { RgbaImage } from "../pictures/png";

const SLUG = "pictures-stage";

/** Builds the fixture film once through the real design build and returns a fresh copy of it. */
function builtFilm(): Film {
  const status = buildDesign(SLUG, "hand-built");
  assert.equal(status.state, "passed", JSON.stringify(status.errors.concat(status.findings.map((f) => f.message))));
  return structuredClone(readFilm(SLUG)!);
}

/** Stores `image` as a picture of the fixture package under `prompt` and points scene asset `assetId` at it. */
function swapPicture(film: Film, assetId: string, image: RgbaImage | Buffer, prompt: string): Film {
  const pkg = resolvePackageDir(SLUG);
  const png = Buffer.isBuffer(image) ? image : encodePng(image);
  const record = storePicture(pkg, { style: PICTURES_STAGE.style, prompt, aspect: "1:1", tool: PICTURES_STAGE.tool, cutout: "none" }, png, { seconds: 1 });
  const scene = film.scene as unknown as Scene;
  const asset = [scene.background, ...scene.props].find((a) => a.assetId === assetId)!;
  asset.raster = rasterSourceOf(`videos/${SLUG}`, { file: pictureFiles(record.fingerprint).png, record });
  return film;
}

/** The errors of one rule. */
const errors = (findings: DesignFinding[], rule: DesignFinding["rule"]) => findings.filter((f) => f.rule === rule && f.severity === "error");

test("the clean synthetic picture film passes every picture rule", () => {
  const report = checkFilmDesign(builtFilm());
  assert.ok(report.ok, JSON.stringify(report.findings.filter((f) => f.severity === "error")));
  for (const rule of ["palette", "picture-text", "contrast", "provenance", "static-art"] as const) assert.deepEqual(errors(report.findings, rule), [], rule);
});

test("a raster hidden inside SVG artwork is refused, so it cannot slip past the palette rule", (t) => {
  const film = builtFilm();
  const file = path.join(resolvePackageDir(SLUG), "visuals", "label.svg");
  const original = fs.readFileSync(file, "utf8");
  t.after(() => fs.writeFileSync(file, original));
  const dataUri = `data:image/png;base64,${encodePng(offPalettePicture()).toString("base64")}`;
  fs.writeFileSync(file, original.replace("</g>", `<image id="sneak" x="0" y="0" width="32" height="32" href="${dataUri}"/></g>`));
  const report = checkFilmDesign(film);
  assert.match(errors(report.findings, "static-art").map((f) => f.message).join("\n"), /embeds a raster image; a picture is allowed only as a declared picture asset/);
});

test("the palette rule reads a picture's pixels: strong colour off the film accent fails", () => {
  const film = swapPicture(builtFilm(), "orb", offPalettePicture(), "One smooth matte sphere in warm tones.");
  const found = errors(checkFilmDesign(film).findings, "palette");
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].where, "orb");
  assert.match(found[0].message, /strong colour off the film accent #635BFF/);
});

test("the OCR rule flags generated text in a picture", () => {
  const film = swapPicture(builtFilm(), "chip", fs.readFileSync(TEXT_PICTURE_FIXTURE), "One square matte panel with a lighter rim.");
  const found = errors(checkFilmDesign(film).findings, "picture-text");
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].where, "chip");
  assert.match(found[0].message, /picture shows text \("SIGNAL"\)/);
});

test("the contrast rule fails a label drawn over a busy plate", () => {
  const film = swapPicture(builtFilm(), "background", busyPlatePicture(), "A wide floor of hard black and white squares.");
  const found = errors(checkFilmDesign(film).findings, "contrast");
  assert.ok(found.length > 0, "a light label over a hard checkerboard loses its contrast");
  assert.match(found[0].where, /label \/ (orb-label|chip-label)/);
  assert.match(found[0].message, /contrast [0-9.]+:1 against the busiest tenth behind it/);
});

test("a picture keeps its provenance record, and a prompt that asks for a logo or a person fails", () => {
  const film = swapPicture(builtFilm(), "orb", orbPicture(), "A logo of a glowing sphere held by a person.");
  const found = errors(checkFilmDesign(film).findings, "provenance");
  assert.match(found.map((f) => f.message).join("\n"), /asks for "logo" \(no logos or brand marks\)/);
  assert.match(found.map((f) => f.message).join("\n"), /asks for "person" \(no people, faces, hands or characters\)/);
  const raster = ((film.scene as unknown as Scene).props.find((a) => a.assetId === "orb")!).raster!;
  fs.rmSync(path.join(resolvePackageDir(SLUG), raster.src.replace(`videos/${SLUG}/`, "").replace(/\.png$/, ".json")));
  assert.match(errors(checkFilmDesign(film).findings, "provenance").map((f) => f.message).join("\n"), /has no readable record beside it/);
  // The decoded picture is still the pinned file: only its record went missing.
  assert.equal(decodePng(fs.readFileSync(path.join(resolvePackageDir(SLUG), raster.src.replace(`videos/${SLUG}/`, "")))).width, 32);
});
