/**
 * File Description: Journey for the illustrated stage, phase 1, encoding the captain's acceptance (option A of the mixed-media research): the synthetic picture fixture film (pictures-stage: a plate and two objects with alpha, pinned through the picture cache, SVG labels and captions over them) is built through the real design build, emitted as `aideos.render/3`, drawn by the release `aideos-render` binary and compared with its committed native golden frames under the strict golden tolerance; the same frames rendered by Remotion match the native frames on the stage (SSIM at least 0.995, the bar of the earlier native parity reports); and the latent fault the research measured is reproduced end to end and shown fixed: a PNG wrapped inside SVG artwork is refused by the design check, and when a render is asked for anyway the renderer choice falls back to Remotion visibly, naming the native loader's refusal, instead of failing.
 * Inputs and outputs: test_fixtures/packages/pictures-stage, the native golden frames, the release binary and Remotion -> pass, or a failure naming the film, format and frame with both frames and the difference saved under .ci-artifacts/.
 * Used by: npm run test:journeys and the CI journeys job (which builds the binary and installs tesseract first). Skips when the binary is not built unless CI or AIDEOS_NATIVE_TESTS_REQUIRED=1.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { decodeFrame, frameDiff, journey } from "./harness";
import { TOLERANCE } from "./goldenCompare";
import { boxAverage, nativeJourneyProblem, nativeJourneysRequired, renderNativeFrame, stageNativePackage } from "./nativeFrames";
import { openFilm } from "./remotionFrames";
import { buildDesign } from "../designSpec/build";
import { readFilm } from "../pipeline/filmStore";
import { reelForRender } from "../reelCut/store";
import { checkFilmDesign } from "../designCheck/designCheck";
import { createSelectedRenderer } from "../rendererSelection";
import { createNativeRenderer } from "../nativeRenderer";
import { encodePng } from "../pictures/png";
import { offPalettePicture } from "../testSupport/pictureFixtures";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import type { Renderer } from "../renderJob";
import type { NativeFormat } from "../renderIr/emit";
import type { Film } from "../../src/dl/schema";

const SLUG = "pictures-stage";
const GOLDEN_ROOT = path.resolve(__dirname, "../../native/aideos-render/fixtures/golden");
/** Native against Remotion on the stage (above the caption band): the bar of the native parity reports in docs/NATIVE_RENDERER.md. */
const STAGE_SSIM_MIN = 0.995;
/** The stage region compared per format: the frame above the caption band and the chapter rail. */
const STAGE_CROP: Record<NativeFormat, string> = { long: "crop=1920:780:0:0", reel: "crop=1080:1400:0:0" };

const problem = nativeJourneyProblem();
const skip = problem && !nativeJourneysRequired() ? problem : false;

/** Writes a silent 8 kHz WAV narration of `seconds` (the fixture package has no recording). */
function silentWav(file: string, seconds: number): void {
  const n = Math.round(8000 * seconds);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + n, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24); h.writeUInt32LE(8000, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34); h.write("data", 36); h.writeUInt32LE(n, 40);
  fs.writeFileSync(file, Buffer.concat([h, Buffer.alloc(n, 128)]));
}

/** Builds the fixture through the real design build (picture cache, pins and every picture rule) and returns its film per format. */
function buildFixture(): Record<NativeFormat, Film> {
  silentWav(path.join(resolvePackageDir(SLUG), "voiceover.wav"), 10);
  const built = buildDesign(SLUG, "hand-built");
  assert.equal(built.state, "passed", `the fixture builds: ${JSON.stringify(built.errors.concat(built.findings.filter((f) => f.severity === "error").map((f) => f.message)))}`);
  return { long: readFilm(SLUG)!, reel: reelForRender(SLUG)! };
}

/** The SSIM of two PNGs over one crop, measured by ffmpeg. */
function ssim(a: string, b: string, crop: string): number {
  const run = spawnSync("ffmpeg", ["-nostdin", "-i", a, "-i", b, "-lavfi", `[0]${crop}[x];[1]${crop}[y];[x][y]ssim`, "-f", "null", "-"], { encoding: "utf8" });
  const match = /All:([0-9.]+)/.exec(String(run.stderr));
  if (run.status !== 0 || !match) throw new Error(`ffmpeg could not measure the SSIM of ${path.basename(a)}: ${String(run.stderr).slice(-300)}`);
  return Number(match[1]);
}

/** The golden frames of one format of the fixture, from the committed cases. */
function goldenFrames(format: NativeFormat): number[] {
  const cases = JSON.parse(fs.readFileSync(path.join(GOLDEN_ROOT, "cases.json"), "utf8")) as Array<{ film: string; format: string; frames: number[] }>;
  const found = cases.find((c) => c.film === SLUG && c.format === format);
  assert.ok(found, `the native golden set holds ${SLUG} ${format}`);
  return found.frames;
}

journey("pictures stage: native frames match the native goldens and the Remotion frames on the stage", async (ctx) => {
  if (skip) return;
  const films = buildFixture();
  const film = await openFilm(SLUG);
  try {
    for (const format of ["long", "reel"] as const) {
      const staged = stageNativePackage(films[format], format, path.join(ctx.workDir, `pkg-${format}`), { pictureOnly: true });
      const ir = JSON.parse(fs.readFileSync(staged.irPath, "utf8")) as { schema: string; stage: Array<{ kind: string }> };
      assert.equal(ir.schema, "aideos.render/3", "a film with pictures is emitted as aideos.render/3");
      assert.equal(ir.stage.filter((n) => n.kind === "image").length, 3, "the plate and both objects are image nodes");
      for (const frame of goldenFrames(format)) {
        const nativePng = path.join(ctx.workDir, `native-${format}-${frame}.png`);
        const remotionPng = path.join(ctx.workDir, `remotion-${format}-${frame}.png`);
        renderNativeFrame(staged, format, frame, nativePng);
        ctx.keep(nativePng);
        const golden = path.join(GOLDEN_ROOT, "frames", SLUG, `${format}-${frame}.png`);
        const diff = frameDiff(boxAverage(decodeFrame(nativePng)), decodeFrame(golden));
        assert.ok(diff.meanAbs <= TOLERANCE.meanAbs && diff.changedShare <= TOLERANCE.changedShare, `${format} frame ${frame} differs from its native golden: mean ${diff.meanAbs.toFixed(4)}, changed ${(diff.changedShare * 100).toFixed(3)}%`);
        await film.still(format === "long" ? "Long" : "Reel", frame, remotionPng);
        ctx.keep(remotionPng);
        const score = ssim(nativePng, remotionPng, STAGE_CROP[format]);
        assert.ok(score >= STAGE_SSIM_MIN, `${format} frame ${frame}: the native stage matches Remotion at SSIM ${score.toFixed(5)}, below ${STAGE_SSIM_MIN}`);
      }
    }
  } finally {
    await film.close();
  }
});

journey("pictures stage: a PNG wrapped inside SVG fails the design check, and a render falls back to Remotion visibly instead of failing", async (ctx) => {
  if (skip) return;
  const films = buildFixture();
  const label = path.join(resolvePackageDir(SLUG), "visuals", "label.svg");
  const original = fs.readFileSync(label, "utf8");
  try {
    const dataUri = `data:image/png;base64,${encodePng(offPalettePicture()).toString("base64")}`;
    fs.writeFileSync(label, original.replace("</g>", `<image id="sneak" x="0" y="0" width="32" height="32" href="${dataUri}"/></g>`));
    const report = checkFilmDesign(films.long);
    assert.ok(report.findings.some((f) => f.rule === "static-art" && /embeds a raster image/.test(f.message)), "the design check refuses the hidden raster");
    // Asked to render anyway: the native loader refuses the staged film and `auto` hands it to Remotion, saying why.
    const out = path.join(ctx.workDir, "renders", "long.mp4");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const messages: string[] = [];
    let remotionPrepared = false;
    const remotion: Renderer = { name: "remotion", prepare: () => { remotionPrepared = true; }, checkDiskBudget: async () => {}, render: async () => {} };
    const renderer = createSelectedRenderer({ mode: "auto", remotion: () => remotion, native: () => createNativeRenderer(), onChoice: (_c, message) => messages.push(message) });
    const never = new AbortController().signal;
    await renderer.prepare!({ film: films.long, format: "long", outPath: out, profile: "draft" }, { signal: never, forceSignal: never, onOutput: () => {} });
    assert.ok(remotionPrepared, "Remotion renders the film");
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Remotion renders "pictures-stage"; the native renderer cannot: the native loader refused it: .*unsupported element <image>/);
    await renderer.cleanup?.();
  } finally {
    fs.writeFileSync(label, original);
  }
});
