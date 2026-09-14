/**
 * File Description: Regression tests for the "Still Talking" video package.
 * Checks the shipped artefacts rather than the builder that made them: that the manifest parses,
 * that its scene passes the scene engine's node-side validation against the committed SVG assets,
 * that the artwork is genuinely static, that the film renders identically twice, that the narration
 * recorded in the manifest is the narration that was measured, and that the three files which are
 * only ever written together (film.json, its generated shadow, and the bundled SVG source map)
 * have not drifted apart.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseFilm } from "../src/dl/schema";
import type { Scene } from "../src/dl/scene/types";
import { validateSceneWithNodeAssets } from "../src/dl/scene/validateSceneNode";
import { compileScene } from "../src/dl/scene/compile";
import { parseSvgDocument, collectSvgElementIds } from "../src/dl/scene/svgDocument";
import { loadSceneAssets } from "./scene/loadSceneAssets";
import { renderFrameSvgMarkup } from "./scene/renderStill";
import { collectSvgSources, renderModule, generatedModulePath } from "./scene/buildSvgSources";
import { BEATS } from "./stillTalking/beats";

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_DIR = path.join(ROOT, "videos/still-talking");

/** Reads the shipped manifest, which is the authoritative description of the film. */
function readFilm() {
  return parseFilm(JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "film.json"), "utf8")));
}

test("still-talking: the manifest parses and its runsheet holds", () => {
  const film = readFilm();
  assert.equal(film.id, "still-talking");
  assert.equal(film.shots.length, BEATS.length);
  assert.ok(film.scene, "The film's canvas is a scene, so the manifest must carry one");

  // Every shot's spoken text is the beat sheet's narration, which is what the voiceover was
  // synthesized from. If these drift, the picture is cut to words nobody ever said.
  film.shots.forEach((shot, i) => {
    assert.equal(shot.id, BEATS[i].id);
    assert.equal(shot.scriptText, BEATS[i].narration);
  });

  // Shot durations are derived from the measured take, so they must add up to the voiceover.
  const totalSec = film.shots.reduce((sum, shot) => sum + shot.dur, 0);
  assert.ok(
    Math.abs(totalSec - (film.voiceover?.durationSec ?? 0)) < 0.05,
    `Shots run ${totalSec.toFixed(2)}s against a ${film.voiceover?.durationSec}s voiceover`,
  );
});

test("still-talking: the scene validates against its committed artwork", () => {
  const scene = readFilm().scene as unknown as Scene;
  const result = validateSceneWithNodeAssets(scene);
  assert.equal(
    result.isValid,
    true,
    result.errors.map((e) => `[Rule ${e.rule}] ${e.message}`).join("; "),
  );

  // Compiling with the assets' real element ids is what proves no clip drives a missing element.
  const assets = loadSceneAssets(scene);
  const compiled = compileScene(scene, { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });
  assert.equal(compiled.durationFrames, scene.durationFrames);
  assert.equal(compiled.frames.length, scene.durationFrames);
});

test("still-talking: every animation is declarative, and the artwork itself never moves", () => {
  const visuals = path.join(PACKAGE_DIR, "visuals");
  const files = fs.readdirSync(visuals).filter((f) => f.endsWith(".svg"));
  assert.ok(files.length >= 10, "The film is drawn from its own asset library");

  for (const file of files) {
    const source = fs.readFileSync(path.join(visuals, file), "utf8");

    // A self-animating asset would make the render depend on a wall clock instead of the frame.
    assert.ok(!/<animate/i.test(source), `${file} animates itself`);
    assert.ok(!/\btransition\s*:/i.test(source), `${file} carries a CSS transition`);
    assert.ok(!/@keyframes/i.test(source), `${file} carries a CSS animation`);
    // Nothing may reach outside the document: a remote reference is a render that can fail.
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/i.test(source), `${file} references a remote resource`);
    assert.ok(!/<image\b/i.test(source), `${file} embeds a raster image`);

    const doc = parseSvgDocument(source);
    const ids = collectSvgElementIds(doc);
    assert.deepEqual(
      ids.filter((id, i) => ids.indexOf(id) !== i),
      [],
      `${file} declares duplicate element ids`,
    );
  }
});

test("still-talking: the same frame renders identically twice", () => {
  const scene = readFilm().scene as unknown as Scene;
  const assets = loadSceneAssets(scene);
  const options = { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 };

  const first = compileScene(scene, options);
  const second = compileScene(scene, options);
  assert.deepEqual(first.frames[1200], second.frames[1200]);

  // Byte for byte at the renderer, not just at the compiler: this is the determinism contract.
  const markupOf = (compiled: typeof first, frame: number) =>
    renderFrameSvgMarkup(compiled.frames[frame], {
      width: 1920,
      height: 1920,
      sceneSize: scene.sceneSize,
      svgSources: assets.svgSources,
    });
  for (const frame of [0, 900, 2500, 4200]) {
    assert.equal(markupOf(first, frame), markupOf(second, frame), `Frame ${frame} is not reproducible`);
  }
});

test("still-talking: manifest, generated shadow and bundled artwork stay in step", () => {
  const filmJson = fs.readFileSync(path.join(PACKAGE_DIR, "film.json"), "utf8");
  const shadow = fs.readFileSync(path.join(ROOT, "src/dl/films/still-talking.ts"), "utf8");
  const shadowJson = shadow.match(/=\s*(\{[\s\S]*\})\s*;/);
  assert.ok(shadowJson, "The generated shadow module must hold the film as plain JSON");
  assert.deepEqual(
    JSON.parse(shadowJson[1]),
    JSON.parse(filmJson),
    "src/dl/films/still-talking.ts has drifted from videos/still-talking/film.json",
  );

  // The browser bundle draws from the generated source map, so a stale map is a stale film.
  assert.equal(
    fs.readFileSync(generatedModulePath(), "utf8"),
    renderModule(collectSvgSources()),
    "src/dl/scene/assets/svgSources.generated.ts is stale: npx tsx backend/scene/buildSvgSources.ts",
  );
});
