/**
 * File Description: Journey for Phase 2 step P2.6a of the native renderer: a scene film whose counter shot uses the `inset` stage (a StatCounter in the inset panel, the form AGENTS.md prescribes for a device in a scene film) is drawn natively instead of falling back to Remotion, and looks the same. The renderer choice in `auto` must pick native for test_fixtures/packages/inset-stage in both formats, and its native frames must match the Remotion frames on the stage at the SSIM bar of the native parity reports on every measured frame, none left out: the shot before, the counter shot as the count runs and after it lands, the shot after, and the end card.
 * Inputs and outputs: test_fixtures/packages/inset-stage, the release binary and Remotion -> pass, or a failure naming every format and frame under the bar with both frames saved under .ci-artifacts/.
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

const SLUG = "inset-stage";

/** The measured frames: the rack shot, the counter shot (counting, then landed), the shot after, and the end card. */
const FRAMES: Record<NativeFormat, number[]> = {
  long: [45, 90, 100, 110, 130, 150, 200, 255, 330, 420, 479],
  reel: [45, 90, 100, 110, 130, 150, 200, 255, 330, 375],
};

const problem = nativeJourneyProblem();
const skip = problem && !nativeJourneysRequired() ? problem : false;

journey("inset panel: a scene film's counter in the inset panel is drawn natively and matches Remotion on the stage at every measured frame", async (ctx) => {
  if (skip) return;
  const film = readFilm(SLUG);
  assert.ok(film, `the ${SLUG} fixture package is missing`);

  // The renderer choice: before P2.6a an inset panel sent the film to Remotion.
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
  assert.deepEqual(below, [], `native inset-panel frames below the stage bar ${STAGE_SSIM_MIN}:\n${below.join("\n")}`);
});
