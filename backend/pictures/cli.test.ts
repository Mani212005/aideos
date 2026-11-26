/**
 * File Description: Behavioural test of `aideos pictures add` for the no-overwrite rule (follow-up to the PR 248 review, finding review-2): running add again for an unchanged prompt with a different image is refused unless `--replace` is given, and with it the previous original and record are kept under sha256-suffixed names so the pin can be restored. Runs on a copy of the pictures-stage fixture film inside the throwaway videos directory of the test process.
 * Inputs and outputs: a copy of the pictures-stage fixture package and two synthetic PNG files -> asserted CLI results, design.json pins and the files left in visuals/generated.
 * Used by: npm test (found by glob).
 */

import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getVideosDir } from "../videoPackageLoader";
import { addPicture } from "./cli";
import { archivedPictureFiles, pictureFingerprint, pictureFiles, requestFor, type DeclaredPictures } from "./cache";
import { encodePng, sha256Hex } from "./png";
import { chipPicture, orbPicture } from "../testSupport/pictureFixtures";

const FIXTURE = path.resolve(__dirname, "../../test_fixtures/packages/pictures-stage");

/** A fresh copy of the fixture film in the throwaway videos directory, with its generated pictures removed so the test starts empty. */
function film(t: test.TestContext): { id: string; pkg: string; designFile: string } {
  const id = `pictures-no-overwrite-${process.pid}-${Date.now()}`;
  const pkg = path.join(getVideosDir(), id);
  fs.cpSync(FIXTURE, pkg, { recursive: true });
  fs.rmSync(path.join(pkg, "visuals/generated"), { recursive: true, force: true });
  t.after(() => fs.rmSync(pkg, { recursive: true, force: true }));
  return { id, pkg, designFile: path.join(pkg, "design/design.json") };
}

/** Writes a PNG file outside the package, as the generator would hand it over. */
function pngFile(t: test.TestContext, draw: "orb" | "chip"): { file: string; sha256: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-picture-file-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bytes = encodePng(draw === "orb" ? orbPicture() : chipPicture());
  const file = path.join(dir, `${draw}.png`);
  fs.writeFileSync(file, bytes);
  return { file, sha256: sha256Hex(bytes) };
}

test("pictures add refuses a different image for an unchanged prompt without --replace, and with --replace keeps the previous original and record under sha256-suffixed names", (t) => {
  const { id, pkg, designFile } = film(t);
  const orb = pngFile(t, "orb");
  const chip = pngFile(t, "chip");
  const declared = (JSON.parse(fs.readFileSync(designFile, "utf8")) as { pictures: DeclaredPictures }).pictures;
  const item = declared.items.find((i) => i.id === "orb")!;
  const fingerprint = pictureFingerprint(requestFor(declared, item));
  const files = pictureFiles(fingerprint);

  addPicture(id, "orb", orb.file, { seconds: 1, pin: true });
  const pinnedDesign = fs.readFileSync(designFile, "utf8");
  assert.equal((JSON.parse(pinnedDesign) as { pictures: DeclaredPictures }).pictures.items.find((i) => i.id === "orb")!.sha256, orb.sha256);
  const recordBefore = fs.readFileSync(path.join(pkg, files.record));

  assert.throws(() => addPicture(id, "orb", chip.file, { seconds: 2, pin: true }), /already holds a different image.*--replace/s);
  assert.equal(sha256Hex(fs.readFileSync(path.join(pkg, files.png))), orb.sha256, "the approved original is still there");
  assert.deepEqual(fs.readFileSync(path.join(pkg, files.record)), recordBefore);
  assert.equal(fs.readFileSync(designFile, "utf8"), pinnedDesign, "a refused add does not touch the pin in design.json");

  const message = addPicture(id, "orb", chip.file, { seconds: 2, replace: true });
  assert.match(message, new RegExp(`kept the previous image \\(sha256 ${orb.sha256}\\)`));
  assert.equal(sha256Hex(fs.readFileSync(path.join(pkg, files.png))), chip.sha256, "the new image holds the fingerprint's name");
  const kept = archivedPictureFiles(fingerprint, orb.sha256);
  assert.equal(sha256Hex(fs.readFileSync(path.join(pkg, kept.png))), orb.sha256, "the previous original is kept");
  assert.deepEqual(fs.readFileSync(path.join(pkg, kept.record)), recordBefore, "and so is its record");
});
