/**
 * File Description: Journey for the native Three-stage goldens (P4.5): each character film of the native golden set (iona-receive, Pip, Marlo, the three-character J5 film and the dots-v1 J3 and J4 film) is built from its package through the real design build, emitted to Render IR by the production emitter, drawn by the release `aideos-render` binary, and compared with the committed native golden frames (`native/aideos-render/fixtures/golden/frames`) at the golden scale with the strict golden tolerance (native against native, never loosened). It reaches the goldens through the emitter, which the cargo golden test (committed IR) does not, and it states what the character pixel journeys compare once export is native: the native raster against the native reference.
 * Inputs and outputs: the committed iona-receive fixture package, the native golden cases and frames, and the release binary -> pass, or a failure naming the film, format and frame with the golden, the actual frame and the difference saved under .ci-artifacts/.
 * Used by: npm run test:journeys and the CI journeys job (which builds the binary first). Skips when the binary is not built unless CI or AIDEOS_NATIVE_TESTS_REQUIRED=1.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { decodeFrame, frameDiff, journey } from "./harness";
import { TOLERANCE } from "./goldenCompare";
import { boxAverage, nativeJourneyProblem, nativeJourneysRequired, renderNativeFrame, stageNativePackage } from "./nativeFrames";
import { buildDesign } from "../designSpec/build";
import { buildCharacterFilm, CHARACTER_FILM_SLUGS, type CharacterFilmSlug } from "../testSupport/characterFilms";
import { readFilm } from "../pipeline/filmStore";
import { reelForRender } from "../reelCut/store";
import type { NativeFormat } from "../renderIr/emit";
import type { Film } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";

const GOLDEN_ROOT = path.resolve(__dirname, "../../native/aideos-render/fixtures/golden");
/** The films this journey draws: the one-performer fixture and every character film of the native golden set. */
const FILMS = ["iona-receive", ...CHARACTER_FILM_SLUGS] as const;

/** One golden case of `cases.json`: a film, a format and the frames kept as goldens. */
interface GoldenCase {
  film: string;
  format: NativeFormat;
  frames: number[];
}

const problem = nativeJourneyProblem();
const skip = problem && !nativeJourneysRequired() ? problem : false;

/** Builds the package of one golden film through the real design build and returns its film. */
function buildFilm(slug: (typeof FILMS)[number]): Film {
  if (slug === "iona-receive") {
    const built = buildDesign(slug, "hand-built");
    if (built.state !== "passed") throw new Error(`cannot build ${slug}: ${JSON.stringify(built).slice(0, 500)}`);
    return readFilm(slug)!;
  }
  return buildCharacterFilm(slug as CharacterFilmSlug);
}

/** Writes a visual difference of two PNGs for the failure artifact (a courtesy: the failure message already says what differed). */
function writeDiff(a: string, b: string, out: string): void {
  try {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", a, "-i", b, "-filter_complex", "blend=all_mode=difference,eq=brightness=0.3", "-frames:v", "1", out]);
  } catch {
    // The picture is evidence only.
  }
}

test("native goldens: the golden set holds Pip, Marlo and the dots film, so the journey below is not vacuous", { skip }, () => {
  const cases = JSON.parse(fs.readFileSync(path.join(GOLDEN_ROOT, "cases.json"), "utf8")) as GoldenCase[];
  for (const film of FILMS) {
    for (const format of ["long", "reel"] as const) {
      const found = cases.find((c) => c.film === film && c.format === format);
      assert.ok(found && found.frames.length > 0, `the native golden set has no ${format} frames for ${film}`);
      for (const frame of found.frames) assert.ok(fs.existsSync(path.join(GOLDEN_ROOT, "frames", film, `${format}-${frame}.png`)), `${film} ${format} frame ${frame} has no committed golden`);
    }
  }
});

journey("native goldens: every character film, built and emitted from its package, draws the committed native golden frames within the strict tolerance", async (ctx) => {
  if (skip) return;
  const cases = JSON.parse(fs.readFileSync(path.join(GOLDEN_ROOT, "cases.json"), "utf8")) as GoldenCase[];
  const failures: string[] = [];
  const worst = { meanAbs: 0, changedShare: 0, frames: 0 };
  for (const slug of FILMS) {
    const base = buildFilm(slug);
    // The goldens must include the decisive contact frame, the frame the character pixel journeys compare (Pip and Marlo at contact).
    const contact = (base.scene as unknown as Scene).performances![0].decisive.frame;
    for (const format of ["long", "reel"] as const) {
      const golden = cases.find((c) => c.film === slug && c.format === format);
      assert.ok(golden, `${slug} ${format} is not in the native golden set`);
      assert.ok(golden.frames.includes(contact), `${slug} ${format}: the contact frame ${contact} is not among the golden frames ${golden.frames.join(", ")}`);
      const film = format === "reel" ? reelForRender(slug) : base;
      const staged = stageNativePackage(film, format, path.join(ctx.workDir, `${slug}-${format}`), { pictureOnly: true });
      const rendered: Array<{ frame: number; small: ReturnType<typeof boxAverage> }> = [];
      for (const frame of golden.frames) {
        const full = path.join(ctx.workDir, `${slug}-${format}-${frame}.png`);
        renderNativeFrame(staged, format, frame, full);
        const small = boxAverage(decodeFrame(full));
        rendered.push({ frame, small });
        const reference = path.join(GOLDEN_ROOT, "frames", slug, `${format}-${frame}.png`);
        const diff = frameDiff(decodeFrame(reference), small, 8);
        worst.meanAbs = Math.max(worst.meanAbs, diff.meanAbs);
        worst.changedShare = Math.max(worst.changedShare, diff.changedShare);
        worst.frames++;
        if (diff.meanAbs > TOLERANCE.meanAbs || diff.changedShare > TOLERANCE.changedShare) {
          const difference = path.join(ctx.workDir, `${slug}-${format}-${frame}-diff.png`);
          writeDiff(reference, full, difference);
          ctx.keep(full);
          ctx.keep(reference);
          ctx.keep(difference);
          failures.push(`${slug} ${format} frame ${frame}: ${(diff.changedShare * 100).toFixed(3)}% of pixels changed, mean difference ${diff.meanAbs.toFixed(3)}`);
        }
      }
      // The same tolerance must reject a different picture, or the comparison above proves nothing.
      const [first, second] = [rendered[0], rendered[1]];
      const other = frameDiff(decodeFrame(path.join(GOLDEN_ROOT, "frames", slug, `${format}-${first.frame}.png`)), second.small, 8);
      assert.ok(other.meanAbs > TOLERANCE.meanAbs || other.changedShare > TOLERANCE.changedShare, `${slug} ${format}: frame ${second.frame} passes as frame ${first.frame}, so the tolerance cannot tell frames apart`);
    }
  }
  console.log(`native goldens: ${worst.frames} frames compared, worst mean difference ${worst.meanAbs.toFixed(4)} (bar ${TOLERANCE.meanAbs}), worst changed share ${(worst.changedShare * 100).toFixed(4)}% (bar ${TOLERANCE.changedShare * 100}%)`);
  assert.deepEqual(failures, [], "the native renderer no longer draws the committed native goldens (re-baseline with the documented golden update only after the picture change is reviewed)");
});
