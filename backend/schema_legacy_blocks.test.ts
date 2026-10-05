/**
 * File Description: Tests that films made before the MetaphorViewer and CharacterBeat blocks were
 * retired still open: parsing drops those block kinds, keeps every other block in order, and turns a
 * shot that held nothing else into a bare-canvas shot, while new content can no longer name them.
 * Inputs and outputs: legacy film fixtures with retired blocks -> schema migration test assertions.
 * Used by: npm test.
 */

import test from "node:test";
import "./testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { blockSchema, filmSchema, LEGACY_BLOCK_KINDS, parseFilm, shotSchema } from "../src/dl/schema";
import { convertFilmToLayeredFilm } from "../src/dl/convertFilm";
import { validateLayeredFilm } from "../src/dl/validateLayeredFilm";
import { getVideosDir } from "../src/dl/videoPackageLoader";
import { ensureGenerated, FILMS_DIR } from "./pipeline/generatedFiles";
import { readFilm } from "./pipeline/filmStore";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";

// Lists the block kinds of every shot, so a test can compare whole films at a glance.
function blockKinds(film: { shots: Array<{ blocks?: Array<{ c: string }> }> }): string[][] {
  return film.shots.map((shot) => (shot.blocks ?? []).map((block) => block.c));
}

test("legacy blocks: a film that still names CharacterBeat parses with those blocks dropped", () => {
  const raw = loadFixtureFilm("fixture-canvas-a");
  const before = blockKinds(raw as unknown as { shots: Array<{ blocks?: Array<{ c: string }> }> });
  assert.ok(before.flat().includes("CharacterBeat"), "the fixture must carry a legacy block to test the drop");

  const film = parseFilm(raw);
  const expected = before.map((kinds) => kinds.filter((kind) => !(LEGACY_BLOCK_KINDS as readonly string[]).includes(kind)));
  assert.deepEqual(blockKinds(film), expected, "every other block survives, in order");
  assert.equal(film.shots.length, raw.shots.length);
});

test("legacy blocks: a shot whose only block was retired becomes a bare-canvas shot", () => {
  const shot = shotSchema.parse({
    id: "s1",
    dur: 4,
    stage: "anchor",
    look: "n1",
    move: "cut",
    blocks: [{ c: "MetaphorViewer", metaphorType: "liquid-bucket" }],
  });
  assert.equal(shot.stage, "none");
  assert.deepEqual(shot.blocks, []);
});

test("legacy blocks: a shot with a retired block next to a headline keeps its stage", () => {
  const shot = shotSchema.parse({
    id: "s1",
    dur: 4,
    stage: "frame",
    look: "n1",
    blocks: [{ c: "TextReveal", text: "Speed has a price" }, { c: "CharacterBeat", characterId: "astronaut", poses: [] }],
  });
  assert.equal(shot.stage, "frame");
  assert.deepEqual(blockKinds({ shots: [shot] }), [["TextReveal"]]);
});

test("legacy blocks: the studio's direct filmSchema parse opens an old film too", () => {
  const raw = loadFixtureFilm("fixture-canvas-b");
  const result = filmSchema.safeParse(raw);
  assert.ok(result.success, result.success ? "" : result.error.issues.map((issue) => issue.message).join("; "));
  assert.ok(!blockKinds(result.data).flat().includes("CharacterBeat"));
});

test("legacy blocks: the editor timeline opens an old film it received unparsed", () => {
  // GET /api/films/:id sends film.json as stored, so the timeline's layered model sees the raw blocks.
  const raw = loadFixtureFilm("fixture-canvas-c");
  const layered = convertFilmToLayeredFilm(raw);
  assert.doesNotThrow(() => validateLayeredFilm(layered));
});

test("legacy blocks: an old package reads and generates without its retired blocks", () => {
  // readFilm serves film.json unparsed (studio, MCP tools), and the shadow is typed as Film and
  // type-checked through activeFilm.ts, so both must hold only live blocks.
  const slug = "legacy-blocks-shadow";
  const pkgDir = path.join(getVideosDir(), slug);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "film.json"), JSON.stringify({ ...loadFixtureFilm("fixture-canvas-a"), id: slug }));
  try {
    const read = readFilm(slug);
    assert.ok(read, "the package must read");
    const kinds = blockKinds(read).flat();
    assert.ok(kinds.includes("TextReveal") && !kinds.some((kind) => (LEGACY_BLOCK_KINDS as readonly string[]).includes(kind)));

    ensureGenerated();
    const shadow = fs.readFileSync(path.join(FILMS_DIR, `${slug}.ts`), "utf8");
    assert.ok(shadow.includes('"TextReveal"'), "the shadow keeps the live blocks");
    for (const kind of LEGACY_BLOCK_KINDS) assert.ok(!shadow.includes(`"${kind}"`), `${kind} is dropped from the shadow`);
  } finally {
    fs.rmSync(pkgDir, { recursive: true, force: true });
    ensureGenerated();
  }
  assert.ok(!fs.existsSync(path.join(FILMS_DIR, `${slug}.ts`)), "the shadow is removed with its package");
});

test("legacy blocks: new content cannot name a retired block", () => {
  for (const kind of LEGACY_BLOCK_KINDS) {
    assert.equal(blockSchema.safeParse({ c: kind }).success, false, `${kind} is no longer a block`);
  }
});
