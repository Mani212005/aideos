/**
 * File Description: Journey for Phase 2 step P2.8b of the native renderer: a scene film whose devices are ScaleBars (the one device of an inset panel that opens on a camera move; and a headline over a ScaleBar on the frame stage, the column centred around its 260 px cap) is drawn natively, each bar an svg node in the Render IR `/8` overlay at its pixel-snapped box, instead of falling back to Remotion, and looks the same as its bar grows with the shot's sweep and its label rides the bar's end. The renderer choice in `auto` must pick native for test_fixtures/packages/scale-bars in both formats, and its native frames must match the Remotion frames on the stage at the SSIM bar of the native parity reports on every measured frame, none left out: the inset opening and its bar growing, the device card entering and its bar growing, the shots around them, and the end card.
 * Inputs and outputs: test_fixtures/packages/scale-bars, the release binary and Remotion -> pass, or a failure naming every format and frame under the bar with both frames saved under .ci-artifacts/.
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

const SLUG = "scale-bars";

/** The measured frames: the shot before, the inset (90 to 240: opening, its bar growing over the sweep, closing), the shot between, the device card (330 to 480: entering, its bar growing), the shot after, and the end card. */
const FRAMES: Record<NativeFormat, number[]> = {
  long: [45, 98, 108, 120, 136, 156, 180, 220, 239, 300, 334, 346, 358, 370, 390, 420, 479, 520, 600, 749],
  reel: [45, 98, 108, 120, 136, 156, 180, 220, 239, 300, 334, 346, 358, 370, 390, 420, 479, 520, 659],
};

const problem = nativeJourneyProblem();
const skip = problem && !nativeJourneysRequired() ? problem : false;

journey("scale bars: a ScaleBar in an inset panel and under a headline is drawn natively and matches Remotion on the stage at every measured frame as its bar grows", async (ctx) => {
  if (skip) return;
  const film = readFilm(SLUG);
  assert.ok(film, `the ${SLUG} fixture package is missing`);

  // The renderer choice: before P2.8b a ScaleBar sent the film to Remotion.
  const messages: string[] = [];
  const remotion: Renderer = { name: "remotion", prepare: () => assert.fail("Remotion must not render a film the native renderer can draw"), checkDiskBudget: async () => {}, render: async () => {} };
  const never = new AbortController().signal;
  for (const format of ["long", "reel"] as const) {
    const renderer = createSelectedRenderer({ mode: "auto", remotion: () => remotion, native: () => createNativeRenderer(), onChoice: (_c, message) => messages.push(message) });
    const out = path.join(ctx.workDir, "renders", `${format}.mp4`);
    await renderer.prepare!({ film, format, outPath: out, profile: "draft" }, { signal: never, forceSignal: never, onOutput: () => {} });
    await renderer.cleanup?.();
  }
  assert.deepEqual(messages, [`long: native renderer draws "${SLUG}"`, `reel: native renderer draws "${SLUG}"`]);

  // Every measured frame of both formats is compared; the failures are collected so one run names them all.
  const below: string[] = [];
  const remotionFilm = await openFilm(SLUG);
  try {
    for (const format of ["long", "reel"] as const) {
      const staged = stageNativePackage(film, format, path.join(ctx.workDir, `pkg-${format}`), { pictureOnly: true });
      for (const frame of FRAMES[format]) {
        const nativePng = path.join(ctx.workDir, `native-${format}-${frame}.png`);
        const remotionPng = path.join(ctx.workDir, `remotion-${format}-${frame}.png`);
        renderNativeFrame(staged, format, frame, nativePng);
        await remotionFilm.still(format === "long" ? "Long" : "Reel", frame, remotionPng);
        const score = ssim(nativePng, remotionPng, STAGE_CROP[format]);
        if (score < STAGE_SSIM_MIN) {
          ctx.keep(nativePng);
          ctx.keep(remotionPng);
          below.push(`${format} frame ${frame}: SSIM ${score.toFixed(5)}`);
        }
      }
    }
  } finally {
    await remotionFilm.close();
  }
  assert.deepEqual(below, [], `native scale-bar frames below the stage bar ${STAGE_SSIM_MIN}:\n${below.join("\n")}`);
});
