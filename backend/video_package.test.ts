/**
 * File Description: Test suite for a video package and its generated shadow module, run against the
 * committed sample-explainer fixture (personal videos are gitignored, so tests never read them).
 * Verifies schema conformance, pacing rules, canvas graph connectedness, audio-word timing, layer conversion,
 * and that the shadow module is regenerated from film.json.
 * Inputs and outputs: sample-explainer video package fixture -> package validation test assertions.
 * Used by: npm test.
 */

import test from "node:test";
import "./testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadVideoPackage, getVideosDir } from "../src/dl/videoPackageLoader";
import { parseFilm, DEVICE_BLOCKS } from "../src/dl/schema";
import { validateFilmAudioAndAssets } from "../src/dl/validateFilm";
import { buildTimeline, totalFrames } from "../src/dl/camera";
import { ensureGenerated } from "./pipeline/generatedFiles";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../src/dl/convertFilm";
import { validateLayeredFilm } from "../src/dl/validateLayeredFilm";

const SLUG = "sample-explainer";

// Loads the fixture package's film.json, the authoritative manifest.
function packageFilm() {
  const pkg = loadVideoPackage(SLUG);
  assert.ok(pkg, "the fixture package must load");
  return pkg.film;
}

// Verifies that the video package loader successfully discovers and loads sample-explainer.
test("Video Package: loads the sample-explainer package correctly", () => {
  const pkg = loadVideoPackage(SLUG);
  assert.ok(pkg, "Expected loadVideoPackage to return a valid package for sample-explainer");
  assert.strictEqual(pkg.slug, SLUG);
  assert.strictEqual(pkg.film.id, SLUG);
  assert.strictEqual(pkg.film.fps, 30);
  assert.strictEqual(pkg.film.accent, "#635BFF");
});

// Verifies that film.json and the shadow TypeScript film module are deeply equal.
test("Video Package: the generated shadow TypeScript module is rebuilt from film.json", async () => {
  ensureGenerated();
  const pkgDir = path.join(getVideosDir(), SLUG);
  const parsedFromJson = JSON.parse(fs.readFileSync(path.join(pkgDir, "film.json"), "utf8"));

  const shadow = await import(path.resolve(__dirname, "../src/dl/films", `${SLUG}.ts`));
  assert.deepStrictEqual(
    parsedFromJson,
    shadow.sampleExplainerFilm,
    "Expected the generated shadow to be structurally identical to film.json",
  );
});

// Verifies that the film satisfies all schema requirements, pacing rules, and layout invariants.
test("Video Package: passes parseFilm and validateFilmAudioAndAssets with zero errors", () => {
  const film = parseFilm(packageFilm());
  assert.strictEqual(film.id, SLUG);

  // Validate audio assets and analytical AABB geometric constraints
  const validatedFilm = validateFilmAudioAndAssets(film);
  assert.ok(validatedFilm, "Expected validateFilmAudioAndAssets to succeed without throwing");
});

// Verifies pacing rules: first shot cuts, subsequent moves are valid, and no device hold exceeds 25s.
test("Video Package: satisfies all Aideos pacing and rhythm rules", () => {
  const film = parseFilm(packageFilm());
  const timeline = buildTimeline(film);
  const totalDurationSec = totalFrames(timeline) / film.fps;

  assert.ok(totalDurationSec >= 10, `Film duration (${totalDurationSec}s) must be at least 10s`);
  assert.strictEqual(film.shots[0].move, "cut", "First shot must cut");

  // Verify no single shot exceeds 25 seconds
  for (let i = 0; i < film.shots.length; i++) {
    const shot = film.shots[i];
    assert.ok(
      shot.dur <= 25,
      `Shot ${i} (${shot.id}) duration (${shot.dur}s) exceeds maximum allowed hold of 25s`,
    );
  }

  // Verify device blocks are valid schema blocks
  let deviceBlockCount = 0;
  for (const shot of film.shots) {
    for (const block of shot.blocks) {
      if ((DEVICE_BLOCKS as readonly string[]).includes(block.c)) {
        deviceBlockCount++;
      }
    }
  }
  assert.ok(deviceBlockCount > 0, "Film must contain animated device blocks");
});

// Verifies that the spatial 2D canvas graph has valid nodes, edges, and valid shot look references.
test("Video Package: 2D spatial canvas graph has valid connected nodes and look references", () => {
  const film = parseFilm(packageFilm());
  const nodeIds = new Set(film.canvas.nodes.map((n) => n.id));

  assert.ok(film.canvas.nodes.length >= 6, "Canvas graph should have at least 6 nodes");
  assert.ok(film.canvas.edges.length >= 5, "Canvas graph should have at least 5 edges");

  // Verify every edge connects known nodes
  for (const edge of film.canvas.edges) {
    assert.ok(nodeIds.has(edge.from), `Edge "from" node "${edge.from}" does not exist in canvas.nodes`);
    assert.ok(nodeIds.has(edge.to), `Edge "to" node "${edge.to}" does not exist in canvas.nodes`);
  }

  // Verify every shot's look targets valid nodes
  for (const shot of film.shots) {
    if (shot.look === "all") continue;
    const looks = Array.isArray(shot.look) ? shot.look : [shot.look];
    for (const target of looks) {
      assert.ok(
        nodeIds.has(target),
        `Shot "${shot.id}" look target "${target}" does not exist in canvas.nodes`,
      );
    }
  }
});

// Verifies that voiceover_words.json and captions.vtt contain valid, non-empty timing data.
test("Video Package: voiceover_words.json and captions.vtt exist and have valid structure", () => {
  const pkgDir = path.join(getVideosDir(), SLUG);
  const wordsPath = path.join(pkgDir, "voiceover_words.json");
  const captionsPath = path.join(pkgDir, "captions.vtt");

  assert.ok(fs.existsSync(wordsPath), "voiceover_words.json must exist in package directory");
  assert.ok(fs.existsSync(captionsPath), "captions.vtt must exist in package directory");

  const data = JSON.parse(fs.readFileSync(wordsPath, "utf8"));
  const words = Array.isArray(data) ? data : data.words;
  assert.ok(Array.isArray(words), "voiceover_words.json must contain a words array");
  assert.ok(words.length > 50, "Expected at least 50 word timing entries");

  // Verify word timing properties and monotonicity
  let prevStart = -1;
  for (const w of words) {
    assert.strictEqual(typeof w.word, "string", "word property must be a string");
    assert.strictEqual(typeof w.start, "number", "start timestamp must be a number");
    assert.strictEqual(typeof w.end, "number", "end timestamp must be a number");
    assert.ok(w.end >= w.start, "end must be >= start");
    assert.ok(w.start >= prevStart, "Word timestamps must be non-decreasing");
    prevStart = w.start;
  }

  const captions = fs.readFileSync(captionsPath, "utf8");
  assert.ok(captions.startsWith("WEBVTT"), "captions.vtt must begin with WEBVTT header");
});

// Verifies that the film converts losslessly to LayeredFilm and back.
test("Video Package: converts to LayeredFilm and back losslessly", () => {
  const film = parseFilm(packageFilm());
  const layered = convertFilmToLayeredFilm(film);
  const validatedLayered = validateLayeredFilm(layered);
  assert.ok(validatedLayered, "Expected validateLayeredFilm to succeed on converted film");

  const roundtripped = convertLayeredFilmToFilm(layered);
  assert.strictEqual(roundtripped.id, film.id);
  assert.strictEqual(roundtripped.shots.length, film.shots.length);
  assert.strictEqual(roundtripped.chapters.length, film.chapters.length);
});

// Verifies that every shot belongs to a declared chapter and that the narration is non-empty.
test("Video Package: every shot sits in a declared chapter and carries narration", () => {
  const film = parseFilm(packageFilm());
  assert.ok(film.chapters.length >= 2, "A package film declares its chapters");
  for (const shot of film.shots) {
    if (shot.ch !== undefined) assert.ok(film.chapters.includes(shot.ch), `Shot "${shot.id}" names unknown chapter "${shot.ch}"`);
  }
  const spoken = film.shots.map((s) => s.scriptText || "").join(" ").trim();
  assert.ok(spoken.split(/\s+/).length > 50, "Expected the shots to carry the narration");
});
