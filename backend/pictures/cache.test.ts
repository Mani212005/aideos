/**
 * File Description: Behavioural tests of the picture cache, encoding the captain's decision for the illustrated stage, phase 1 (option A of the mixed-media research), item 3: an image cache like the per-line voice cache whose fingerprint is the style paragraph, the object prompt, the aspect ratio, the tool label and the cut-out settings; each picture is stored as visuals/generated/<fingerprint>.png with a small record (prompt, date, seconds, sha256); the design pins each approved image by sha256; rebuilding with unchanged prompts makes no request; originals are kept byte for byte (provenance data included).
 * Inputs and outputs: synthetic pictures and a counting stand-in generator in a throwaway package directory -> asserted fingerprints, files, records, requests and build errors.
 * Used by: npm test (found by glob).
 */

import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensurePictures, pictureFingerprint, pictureFiles, resolvePinnedPictures, type DeclaredPictures, type PictureGenerator } from "./cache";
import { encodePng, sha256Hex } from "./png";
import { chipPicture, orbPicture } from "../testSupport/pictureFixtures";

/** A throwaway package directory. */
function pkg(t: test.TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-pictures-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A stand-in generator that answers each request with the next synthetic picture (plus a provenance chunk) and counts requests. */
function counting(): { generate: PictureGenerator; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    generate: async (request) => {
      prompts.push(request.prompt);
      const png = encodePng(prompts.length % 2 ? orbPicture() : chipPicture());
      // A generator's PNG carries metadata (C2PA, a tEXt note): the cache must keep it, never re-encode.
      const text = Buffer.from("tEXtSource\u0000synthetic-provenance", "latin1");
      const chunk = Buffer.concat([Buffer.from([0, 0, 0, text.length - 4]), text, Buffer.from([0, 0, 0, 0])]);
      return { png: Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]), seconds: 54.3 };
    },
  };
}

const PICTURES: DeclaredPictures = {
  style: "Quiet dark stage, soft violet glow from below, smooth matte surfaces.",
  tool: "codex-imagegen",
  items: [
    { id: "orb", prompt: "One smooth glass sphere glowing softly in violet.", aspect: "1:1", cutout: "generator-alpha" },
    { id: "chip", prompt: "One square matte processor die with a lighter rim.", aspect: "1:1", cutout: "generator-alpha" },
  ],
};

test("the fingerprint covers the style paragraph, the object prompt, the aspect ratio, the tool label and the cut-out settings", () => {
  const base = { style: PICTURES.style, prompt: PICTURES.items[0].prompt, aspect: "1:1" as const, tool: "codex-imagegen", cutout: "generator-alpha" };
  const fingerprint = pictureFingerprint(base);
  assert.equal(pictureFingerprint({ ...base }), fingerprint, "the same inputs give the same fingerprint");
  for (const change of [{ style: `${base.style} Brighter.` }, { prompt: `${base.prompt} Larger.` }, { aspect: "16:9" as const }, { tool: "other-tool" }, { cutout: "local-vision" }]) {
    assert.notEqual(pictureFingerprint({ ...base, ...change }), fingerprint, `changing ${Object.keys(change)[0]} changes the fingerprint`);
  }
});

test("each picture is stored as visuals/generated/<fingerprint>.png, byte for byte, with a record of prompt, date, seconds and sha256", async (t) => {
  const dir = pkg(t);
  const gen = counting();
  const pass = await ensurePictures(dir, PICTURES, gen.generate);
  assert.deepEqual(pass.generated, ["orb", "chip"]);
  for (const item of PICTURES.items) {
    const ready = pass.ready[item.id];
    const fingerprint = pictureFingerprint({ style: PICTURES.style, prompt: item.prompt, aspect: item.aspect, tool: PICTURES.tool, cutout: item.cutout });
    assert.equal(ready.file, `visuals/generated/${fingerprint}.png`);
    const bytes = fs.readFileSync(path.join(dir, ready.file));
    assert.ok(bytes.includes(Buffer.from("synthetic-provenance", "latin1")), "the generator's metadata is kept: the file is never re-encoded");
    const record = JSON.parse(fs.readFileSync(path.join(dir, pictureFiles(fingerprint).record), "utf8"));
    assert.equal(record.sha256, sha256Hex(bytes));
    assert.equal(record.seconds, 54.3);
    assert.ok(record.prompt.includes(PICTURES.style) && record.prompt.includes(item.prompt), "the record keeps the exact prompt, with the style paragraph pasted in");
    assert.ok(!Number.isNaN(Date.parse(record.createdAt)), "the record is dated");
  }
});

test("rebuilding with unchanged prompts makes no request, and changing one object's prompt regenerates only that object", async (t) => {
  const dir = pkg(t);
  const gen = counting();
  await ensurePictures(dir, PICTURES, gen.generate);
  assert.equal(gen.prompts.length, 2);
  const again = await ensurePictures(dir, PICTURES, gen.generate);
  assert.equal(gen.prompts.length, 2, "no request for unchanged prompts");
  assert.deepEqual(again.reused, ["orb", "chip"]);
  const edited: DeclaredPictures = { ...PICTURES, items: [PICTURES.items[0], { ...PICTURES.items[1], prompt: "One square matte processor die with a darker rim." }] };
  const third = await ensurePictures(dir, edited, gen.generate);
  assert.equal(gen.prompts.length, 3);
  assert.deepEqual(third.generated, ["chip"]);
  assert.equal(fs.readdirSync(path.join(dir, "visuals/generated")).filter((f) => f.endsWith(".png")).length, 3, "the earlier original is kept, never pruned");
});

test("the design pins each approved image by sha256: an unpinned, missing or changed picture fails the build with what to do", async (t) => {
  const dir = pkg(t);
  const none = resolvePinnedPictures(dir, PICTURES, "videos/probe");
  assert.match(none.errors.join("\n"), /picture "orb" has no image for its current prompt yet/);
  const pass = await ensurePictures(dir, PICTURES, counting().generate);
  const unpinned = resolvePinnedPictures(dir, PICTURES, "videos/probe");
  assert.match(unpinned.errors.join("\n"), /picture "orb" is not approved yet: .*pin it with "sha256": "[0-9a-f]{64}"/);
  const pinned: DeclaredPictures = { ...PICTURES, items: PICTURES.items.map((i) => ({ ...i, sha256: pass.ready[i.id].record.sha256 })) };
  const ok = resolvePinnedPictures(dir, pinned, "videos/probe");
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.sources.orb, { src: `videos/probe/${pass.ready.orb.file}`, width: 32, height: 32, sha256: pass.ready.orb.record.sha256 });
  const wrong: DeclaredPictures = { ...pinned, items: [{ ...pinned.items[0], sha256: "0".repeat(64) }, pinned.items[1]] };
  assert.match(resolvePinnedPictures(dir, wrong, "videos/probe").errors.join("\n"), /picture "orb" is pinned to 0{64} but its prompt now gives/);
});
