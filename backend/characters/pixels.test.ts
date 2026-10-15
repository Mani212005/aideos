/**
 * File Description: Browser pixel tests: spec-built Iona equals the frozen legacy art, every character draws in both crops, Pip and Marlo match committed stage stills, and the sheet command works end to end.
 * Inputs and outputs: committed specs, legacy stage performances and PNG evidence -> headless Chrome (software GL) pixel comparisons and sheet files.
 * Used by: npm test. Skips when no Chrome is installed unless AIDEOS_BROWSER_TESTS_REQUIRED=1.
 */
import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { createReceiveAction } from "../../src/dl/performance/receive";
import { readPngDimensions } from "../scene/renderStill";
import { CHARACTER_FILES, characterPin, loadSpec } from "../testSupport/characters";
import { chromeAvailable, evaluatePage } from "./browser";
import { renderCharacterSheet } from "./sheet";
import type { PixelRequest, PixelResult } from "./pixelPage";
import { parseFilm } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import type { StageCast } from "../../src/dl/scene/stageContract";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { buildDesign } from "../designSpec/build";
import { readFilm } from "../pipeline/filmStore";
import { holdActiveFilm } from "../journeys/harness";
import { openFilm } from "../journeys/remotionFrames";

const GOLDEN = path.join(__dirname, "../../test_fixtures/characters/golden/iona-contact.png");
const STAGE_STILLS = path.join(__dirname, "../../test_fixtures/characters/stage-stills");
const required = process.env.AIDEOS_BROWSER_TESTS_REQUIRED === "1";
const skip = !chromeAvailable() && !required ? "no Chrome or Chromium installed (set AIDEOS_CHROME_PATH, or AIDEOS_BROWSER_TESTS_REQUIRED=1 to fail instead)" : false;
let stageFixtureSerial = 0;

// Builds the receive package with one selected character and returns its isolated slug.
function packageWithCharacter(character: "pip" | "marlo"): string {
  const slug = `pixels-stage-${character}-${++stageFixtureSerial}`;
  const source = path.join(TEST_VIDEOS_DIR, "iona-receive"), directory = path.join(TEST_VIDEOS_DIR, slug);
  fs.cpSync(source, directory, { recursive: true });
  for (const file of ["film.json", "design/base-film.json"]) {
    const target = path.join(directory, file);
    if (fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify({ ...JSON.parse(fs.readFileSync(target, "utf8")), id: slug }, null, 2));
  }
  fs.mkdirSync(path.join(directory, "characters"), { recursive: true });
  fs.copyFileSync(CHARACTER_FILES[character], path.join(directory, "characters", `${character}.character.json`));
  const designFile = path.join(directory, "design/design.json"), lookFile = path.join(directory, "design/look.json");
  const design = JSON.parse(fs.readFileSync(designFile, "utf8")) as { assets: Array<Record<string, unknown>>; performances: Array<Record<string, unknown>> };
  const look = JSON.parse(fs.readFileSync(lookFile, "utf8")) as { film: { cast: Array<Record<string, unknown>>; performances?: Array<Record<string, unknown>> } };
  const asset = design.assets.find((item) => item.kind === "character"), cast = look.film.cast.find((item) => item.id === "iona");
  if (!asset || !cast) throw new Error("iona-receive fixture is missing its character asset or look cast entry");
  asset.character = character;
  cast.character = character;
  for (const performance of look.film.performances ?? []) if (performance.actor === "iona") performance.character = characterPin(character);
  if (character === "pip") {
    design.performances[0].limits = "clamp";
    asset.unitsToStage = 110;
  } else {
    asset.unitsToStage = 70;
    asset.position = [960, 1220];
  }
  fs.writeFileSync(designFile, JSON.stringify(design, null, 2));
  fs.writeFileSync(lookFile, JSON.stringify(look, null, 2));
  return slug;
}

// Renders each compiled character performance at contact through the production Remotion stage.
async function productionCharacterStills(outDir: string): Promise<Array<PixelRequest["cast"][number]>> {
  const results: Array<PixelRequest["cast"][number]> = [];
  for (const character of ["pip", "marlo"] as const) {
    const slug = packageWithCharacter(character);
    const built = buildDesign(slug, "hand-built");
    assert.equal(built.state, "passed", `${character}: ${JSON.stringify({ errors: built.errors, findings: built.findings })}`);
    const scene = readFilm(slug)!.scene as Scene;
    const frame = scene.performances![0].decisive.frame;
    const stills: PixelRequest["cast"][number]["stills"] = [];
    const opened = await openFilm(slug);
    try {
      for (const [format, composition] of [["wide", "Long"], ["reel", "Reel"]] as const) {
        const file = path.join(outDir, `${character}-${format}.png`);
        await opened.still(composition, frame, file);
        const reference = path.join(STAGE_STILLS, `${character}-${format}.png`);
        stills.push({ format, rendered: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`, reference: `data:image/png;base64,${fs.readFileSync(reference).toString("base64")}` });
      }
    } finally {
      await opened.close();
    }
    results.push({ id: character, stills });
  }
  return results;
}

// Bundles the pixel page with a request and returns its results from headless Chrome.
async function runPixelPage(request: PixelRequest): Promise<PixelResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-pixels-"));
  try {
    await build({ entryPoints: [path.join(__dirname, "pixelPage.ts")], outfile: path.join(dir, "pixel.js"), bundle: true, format: "iife", platform: "browser", logLevel: "silent" });
    fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><script>window.__pixelRequest=${JSON.stringify(request).replace(/</g, "\\u003c")};</script><script src="pixel.js"></script>`);
    const { value, errors } = await evaluatePage<PixelResult>(path.join(dir, "index.html"), "window.__pixels");
    assert.deepEqual(errors, []);
    return value;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("pixels: spec-built Iona matches legacy pixels and compiled Pip and Marlo stage stills in both crops", { skip }, async () => {
  const restoreActiveFilm = holdActiveFilm();
  const renderDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-production-character-stills-"));
  try {
  const iona = loadSpec("iona");
  const cast = await productionCharacterStills(renderDir);
  const update = process.env.AIDEOS_UPDATE_GOLDENS === "1";
  const legacyFilm = parseFilm(JSON.parse(fs.readFileSync(path.join(__dirname, "../../test_fixtures/packages/legacy-iona-p0/film.json"), "utf8")));
  const legacyScene = legacyFilm.scene as Scene;
  const legacyActor = legacyScene.cast!.find((item): item is Extract<StageCast, { kind: "character" }> => item.id === "iona" && item.kind === "character")!;
  const legacyPerformance = legacyScene.performances![0];
  const result = await runPixelPage({
    iona: { spec: iona, action: createReceiveAction(69), frames: [0, 40, 60, 69, 100, 111] },
    golden: { frame: 69, dataUrl: !update && fs.existsSync(GOLDEN) ? `data:image/png;base64,${fs.readFileSync(GOLDEN).toString("base64")}` : null },
    cast,
    legacyAlias: { cast: legacyActor, action: legacyPerformance.data, frame: legacyPerformance.data.contact.frame },
  });
  for (const frame of result.ab) assert.equal(frame.differing, 0, `frame ${frame.frame}: ${frame.differing} pixels differ (max ${frame.maxDelta})`);
  if (update) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, Buffer.from(result.goldenPng.split(",")[1], "base64"));
  } else {
    assert.ok(result.golden, `missing golden ${GOLDEN}; create it with AIDEOS_UPDATE_GOLDENS=1`);
    // Software GL keeps machines close; the tolerance absorbs driver rounding, not a changed character.
    assert.ok(result.golden!.differing < 0.005 && result.golden!.meanDelta < 1, `golden drift: ${(result.golden!.differing * 100).toFixed(3)}% of pixels, mean delta ${result.golden!.meanDelta.toFixed(3)}`);
    assert.ok(result.golden!.otherFrameDiffering > 0.02, "the golden tolerance must reject a different pose");
    assert.ok(result.legacyGolden && result.legacyGolden.differing < 0.005 && result.legacyGolden.meanDelta < 1, "the compiled legacy performance must match the contact golden");
  }
  for (const entry of result.cast) {
    assert.ok(entry.coverage > 0.004, `${entry.id} ${entry.format}: only ${(entry.coverage * 100).toFixed(2)}% drawn`);
    if (entry.id === "pip" || entry.id === "marlo") {
      const file = path.join(STAGE_STILLS, `${entry.id}-${entry.format}.png`);
      if (process.env.AIDEOS_UPDATE_CHARACTER_STAGE_STILLS === "1") {
        fs.mkdirSync(STAGE_STILLS, { recursive: true });
        fs.writeFileSync(file, Buffer.from(entry.png.split(",")[1], "base64"));
      } else {
        assert.ok(fs.existsSync(file), `missing ${entry.id} ${entry.format} stage still ${file}; create with AIDEOS_UPDATE_CHARACTER_STAGE_STILLS=1`);
        assert.ok(entry.stillDifference !== null && entry.stillDifference < 0.005, `${entry.id} ${entry.format} still drift ${(100 * (entry.stillDifference ?? 1)).toFixed(3)}%`);
      }
    }
  }
  } finally {
    restoreActiveFilm();
    fs.rmSync(renderDir, { recursive: true, force: true });
  }
});

test("sheet: aideos character sheet writes model, expression and receive stills at the expected sizes", { skip }, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-sheet-"));
  try {
    const result = await renderCharacterSheet(CHARACTER_FILES.pip, { outDir: out, policy: "clamp" });
    assert.match(result.hashStatus, /verified/);
    assert.equal(result.retarget.ok, true);
    const names = result.files.map((f) => path.basename(f)).sort();
    assert.deepEqual(names, ["expression-sheet.png", "model-sheet.png", "receive-reel.png", "receive-strip.png", "receive-wide.png"]);
    assert.deepEqual(readPngDimensions(path.join(out, "receive-wide.png")), { width: 1920, height: 1080 });
    assert.deepEqual(readPngDimensions(path.join(out, "receive-reel.png")), { width: 1080, height: 1920 });
    const refused = await renderCharacterSheet(CHARACTER_FILES.pip, { outDir: out, policy: "fail" });
    assert.match(refused.retarget.error ?? "", /limits\.rotation\.spine/);
    assert.equal(refused.files.length, 2, "a character that cannot perform still gets its model and expression sheets");
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
