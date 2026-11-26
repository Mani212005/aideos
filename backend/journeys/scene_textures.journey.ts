/**
 * File Description: Journey for Phase 2 step P2.4c of the native renderer: a vector scene film on a textured theme (the paper grain of `paper-white`, the `blueprint` grid) is drawn natively instead of falling back to Remotion, with its texture in the `aideos.render/7` underlay under the scene as Film.tsx draws it, and looks the same. For each fixture the renderer choice in `auto` must pick native in both formats, and the native frames must match the Remotion frames on the stage at the SSIM bar of the native parity reports on every measured frame, none left out: the shots around the inset counter, the counter counting and landed, and the end card, whose slow push scales the texture with the scene.
 * Inputs and outputs: test_fixtures/packages/scene-paper-white and scene-blueprint, the release binary and Remotion -> pass, or a failure naming every film, format and frame under the bar with both frames saved under .ci-artifacts/.
 * Used by: npm run test:journeys and the CI journeys job (which builds the binary first). Skips when the binary is not built unless CI or AIDEOS_NATIVE_TESTS_REQUIRED=1.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { journey } from "./harness";
import { STAGE_CROP, STAGE_SSIM_MIN, nativeJourneyProblem, nativeJourneysRequired, renderNativeFrame, ssim, stageNativePackage } from "./nativeFrames";
import { openFilm } from "./remotionFrames";
import { createSelectedRenderer } from "../rendererSelection";
import { createNativeRenderer } from "../nativeRenderer";
import { readFilm } from "../pipeline/filmStore";
import type { NativeFormat } from "../renderIr/emit";
import type { Renderer } from "../renderJob";

/** The measured frames per format, the same for each fixture (inset-stage on a textured theme): the rack shot, the inset counter (counting, then landed), the shot after, and the end card. */
const FRAMES: Record<NativeFormat, number[]> = {
  long: [45, 90, 100, 110, 130, 150, 200, 255, 330, 420, 479],
  reel: [45, 90, 100, 110, 130, 150, 200, 255, 330, 375],
};

/** The textured-theme scene fixtures: inset-stage on the paper grain and on the blueprint grid. */
const FIXTURES = ["scene-paper-white", "scene-blueprint"];

const problem = nativeJourneyProblem();
const skip = problem && !nativeJourneysRequired() ? problem : false;

journey("scene textures: vector scene films on the paper-white and blueprint themes are drawn natively and match Remotion on the stage at every measured frame", async (ctx) => {
  if (skip) return;
  const below: string[] = [];
  for (const slug of FIXTURES) {
    const film = readFilm(slug);
    assert.ok(film, `the ${slug} fixture package is missing`);

    // The renderer choice: before P2.4c a textured theme over a scene sent the film to Remotion.
    const messages: string[] = [];
    const remotion: Renderer = { name: "remotion", prepare: () => assert.fail("Remotion must not render a film the native renderer can draw"), checkDiskBudget: async () => {}, render: async () => {} };
    const never = new AbortController().signal;
    for (const format of ["long", "reel"] as const) {
      const renderer = createSelectedRenderer({ mode: "auto", remotion: () => remotion, native: () => createNativeRenderer(), onChoice: (_c, message) => messages.push(message) });
      const out = path.join(ctx.workDir, slug, "renders", `${format}.mp4`);
      await renderer.prepare!({ film, format, outPath: out, profile: "draft" }, { signal: never, forceSignal: never, onOutput: () => {} });
      await renderer.cleanup?.();
    }
    assert.deepEqual(messages, [`long: native renderer draws "${slug}"`, `reel: native renderer draws "${slug}"`]);

    // Every measured frame of both formats is compared; the failures are collected so one run names them all.
    const remotionFilm = await openFilm(slug);
    try {
      for (const format of ["long", "reel"] as const) {
        const staged = stageNativePackage(film, format, path.join(ctx.workDir, slug, `pkg-${format}`), { pictureOnly: true });
        for (const frame of FRAMES[format]) {
          const nativePng = path.join(ctx.workDir, slug, `native-${format}-${frame}.png`);
          const remotionPng = path.join(ctx.workDir, slug, `remotion-${format}-${frame}.png`);
          renderNativeFrame(staged, format, frame, nativePng);
          await remotionFilm.still(format === "long" ? "Long" : "Reel", frame, remotionPng);
          const score = ssim(nativePng, remotionPng, STAGE_CROP[format]);
          if (score < STAGE_SSIM_MIN) {
            ctx.keep(nativePng);
            ctx.keep(remotionPng);
            below.push(`${slug} ${format} frame ${frame}: SSIM ${score.toFixed(5)}`);
          }
        }
      }
    } finally {
      await remotionFilm.close();
    }
  }
  assert.deepEqual(below, [], `native scene-texture frames below the stage bar ${STAGE_SSIM_MIN}:\n${below.join("\n")}`);
});
