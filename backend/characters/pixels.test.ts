/**
 * File Description: Browser pixel tests: spec-built Iona equals the frozen legacy art in the same run, matches the committed golden, and every character draws in both crops; plus the sheet command end to end.
 * Inputs and outputs: committed specs, legacy stage performances and the golden PNG -> headless Chrome (software GL) pixel comparisons and sheet files.
 * Used by: npm test. Skips when no Chrome is installed unless AIDEOS_BROWSER_TESTS_REQUIRED=1.
 */
import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { rigFromCharacter } from "../../src/dl/characters/rig";
import { createReceiveAction } from "../../src/dl/performance/receive";
import { readPngDimensions } from "../scene/renderStill";
import { fitReceiveSpan } from "../performance/bindReceive";
import { CHARACTER_FILES, loadSpec } from "../testSupport/characters";
import { chromeAvailable, evaluatePage } from "./browser";
import { renderCharacterSheet } from "./sheet";
import type { PixelRequest, PixelResult } from "./pixelPage";
import { parseFilm } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import type { StageCast } from "../../src/dl/scene/stageContract";

const GOLDEN = path.join(__dirname, "../../test_fixtures/characters/golden/iona-contact.png");
const required = process.env.AIDEOS_BROWSER_TESTS_REQUIRED === "1";
const skip = !chromeAvailable() && !required ? "no Chrome or Chromium installed (set AIDEOS_CHROME_PATH, or AIDEOS_BROWSER_TESTS_REQUIRED=1 to fail instead)" : false;

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

test("pixels: spec-built Iona is pixel-identical to the frozen legacy art, matches the golden, and every character draws in both crops", { skip }, async () => {
  const iona = loadSpec("iona");
  const cast = (["iona", "pip", "marlo"] as const).map((name) => {
    const spec = loadSpec(name);
    return { spec, action: fitReceiveSpan(69, 0, 160, 30, [0, 0, 0], { rig: rigFromCharacter(spec), policy: "clamp" }).action };
  });
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
  for (const entry of result.cast) assert.ok(entry.coverage > 0.004, `${entry.id} ${entry.format}: only ${(entry.coverage * 100).toFixed(2)}% drawn`);
  const signatures = new Set(result.cast.filter((c) => c.format === "wide").map((c) => c.signature));
  assert.equal(signatures.size, 3, "each character draws different pixels");
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
