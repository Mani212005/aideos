/**
 * File Description: Browser-backed dot stability, real occlusion, independent workers, facial contrast and H.264 held-pose shimmer checks.
 * Inputs and outputs: Iona/Pip/Marlo specs and actual browser PNG sequences -> deterministic raster and encoded-frame assertions.
 * Used by: npm test. Uses installed Chrome; leaves all failure images in .ci-artifacts through the journey harness.
 */
import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { journey, decodeFrame, frameDiff } from "../journeys/harness";
import { loadSpec } from "../testSupport/characters";
import { fitReceiveSpan } from "../performance/bindReceive";
import { rigFromCharacter } from "../../src/dl/characters/rig";
import { chromeAvailable, evaluatePage } from "./browser";
import type { DotsPixelRequest, DotsPixelResult } from "./dotsPage";

// Writes a data URL from a browser capture to its exact PNG bytes.
function writePng(file: string, data: string): void { fs.writeFileSync(file, Buffer.from(data.slice(data.indexOf(",") + 1), "base64")); }

const name = "dots raster: no hidden-surface leaks, reverse seek/worker equality, phone features and encoded held-pose shimmer";
if (!chromeAvailable() && process.env.AIDEOS_BROWSER_TESTS_REQUIRED !== "1") test(name, { skip: "no installed Chrome" }, () => undefined);
else journey("dots raster: no hidden-surface leaks, reverse seek/worker equality, phone features and encoded held-pose shimmer", async (ctx) => {
  await build({ entryPoints: [path.join(__dirname, "dotsPage.ts")], outfile: path.join(ctx.workDir, "dots.js"), bundle: true, format: "iife", platform: "browser", logLevel: "silent" });
  const requests: DotsPixelRequest[] = [];
  for (const id of ["iona", "pip", "marlo"] as const) {
    const spec = loadSpec(id);
    const request: DotsPixelRequest = { spec, action: fitReceiveSpan(69, 0, 160, 30, [0, 0, 0], { rig: rigFromCharacter(spec), policy: "clamp" }).action };
    requests.push(request);
  }
  const html = path.join(ctx.workDir, "dots.html");
  fs.writeFileSync(html, `<script>window.__dotsRequest=${JSON.stringify(requests)}</script><script src="dots.js"></script>`);
  const result = await evaluatePage<DotsPixelResult[]>(html, "window.__dotsResult");
  assert.deepEqual(result.errors, []);
  for (const [index, id] of (["iona", "pip", "marlo"] as const).entries()) {
    const pixels = result.value[index];
    assert.notEqual(pixels.dots, pixels.cel, `${id} treatment must change actual pixels`);
    assert.ok(pixels.dotPixels > 100, `${id} no visible pixels attributable to the dot layer`);
    for (const treatment of ["cel", "dots"] as const) { const file = path.join(ctx.workDir, `${id}-${treatment}-phone.png`); writePng(file, pixels[treatment]); ctx.keep(file); }
    assert.equal(pixels.repeatDifferent, 0, `${id} reverse/repeat seek`);
    assert.ok(pixels.motionDifferent > 100, `${id} pose change must move actual pixels`);
    assert.equal(pixels.occludedDifferent, 0, `${id} hidden dots leak through opaque foreground`);
    assert.ok(pixels.visibleDifferent > 100, `${id} rear plane must not hide the character`);
    for (const face of pixels.face) assert.ok(face.dark >= 2 && face.light >= 2, `${id} 360px ${face.feature}: ${JSON.stringify(face)}`);
    assert.equal(new Set(pixels.held).size, 1, `${id} held pose changed between absolute frames`);
    if (id === "iona") {
      assert.ok(pixels.noseLuma !== null && pixels.noseLuma > 180, `Iona nose became a dark block: ${pixels.noseLuma}`);
      const independent = await evaluatePage<DotsPixelResult[]>(html, "window.__dotsResult");
      assert.deepEqual(independent.errors, []); assert.equal(independent.value[index].dots, pixels.dots, "independent browser worker differs");
      const shimmer: Record<string, number> = {};
      for (const [label, frames] of [["dots", pixels.held], ["cel", pixels.heldCel]] as const) {
        assert.equal(new Set(frames).size, 1, `${label} held pose must be static`);
        for (const [i, png] of frames.entries()) writePng(path.join(ctx.workDir, `${label}-held-${String(i).padStart(2, "0")}.png`), png);
        const mp4 = path.join(ctx.workDir, `${label}-held.mp4`); ctx.keep(mp4);
        execFileSync("ffmpeg", ["-v", "error", "-framerate", "30", "-i", path.join(ctx.workDir, `${label}-held-%02d.png`), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", mp4]);
        const reference = decodeFrame(mp4, { frame: 0 });
        shimmer[label] = 0;
        for (let frame = 1; frame < 12; frame++) shimmer[label] = Math.max(shimmer[label], frameDiff(reference, decodeFrame(mp4, { frame }), 2).meanAbs);
        assert.ok(shimmer[label] < .1, `${label} H.264 held shimmer: ${shimmer[label]}`);
      }
      console.log(`encoded held-pose maximum mean channel difference (0-255): ${JSON.stringify(shimmer)}`);
    }
  }
});
