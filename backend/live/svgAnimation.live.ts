/**
 * File Description: Opt-in custom SVG animation frame strip for visual review.
 * Inputs and outputs: demo SVG animation -> rendered PNG strip and dimension assertions
 * Used by: npm run test:live (opt-in, excluded from CI).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compileScene } from "../../src/dl/scene/compile";
import { loadSceneAssets } from "../scene/loadSceneAssets";
import { renderFrameStill, readPngDimensions } from "../scene/renderStill";
import { makeDemoScene } from "../testSupport/svgAnimation";

const OUT_STRIP_DIR = path.resolve("out/svg_movie");

// A-14: Visual review: render a frame strip of the animated scene for human inspection.
test("A-14 / Visual Review: render a custom SVG animation frame strip to out/svg_movie/", (t) => {
  if (process.env.RUN_VISUAL_TESTS !== "1") {
    t.skip("Visual review test: run with npm run test:live");
    return;
  }

  fs.mkdirSync(OUT_STRIP_DIR, { recursive: true });

  const scene = makeDemoScene();
  const assets = loadSceneAssets(scene);
  const compiled = compileScene(scene, { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });

  const sampleFrames = [0, 12, 30, 48, 66, 84, 102, 119];
  for (const f of sampleFrames) {
    const outPng = path.join(OUT_STRIP_DIR, `strip_${String(f).padStart(3, "0")}.png`);
    renderFrameStill(compiled.frames[f], outPng, {
      svgSources: assets.svgSources,
      width: 960,
      height: 540,
      sceneSize: scene.sceneSize,
    });
    const dims = readPngDimensions(outPng);
    assert.deepEqual(dims, { width: 960, height: 540 }, `Strip frame ${f} must be a true 960x540 raster`);
  }

  console.log(`✓ A-14 Complete: Rendered ${sampleFrames.length} animation strip frames to ${OUT_STRIP_DIR}`);
});
