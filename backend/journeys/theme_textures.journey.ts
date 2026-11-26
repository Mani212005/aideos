/**
 * File Description: Journey for Phase 2 step P2.4a of the native renderer: a film on the `blueprint` or `dot-grid` theme (the `blueprint-grid` and `subtle-dots` textures `Film.tsx` draws under the canvas) is drawn natively instead of falling back to Remotion, with its texture in the `aideos.render/7` underlay, and looks the same. For each theme fixture the renderer choice in `auto` must pick native in both formats, and the native frames must match the Remotion frames on the stage at the SSIM bar of the native parity reports on every measured frame, none left out: a spread over the story, every shot's midpoint, and frames through the end card, whose slow push scales the texture (Chrome resamples the texture layer there rather than redrawing it).
 * Inputs and outputs: test_fixtures/packages/node-graph-blueprint and node-graph-dots, the release binary and Remotion -> pass, or a failure naming every film, format and frame under the bar with both frames saved under .ci-artifacts/.
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

/** The measured frames per format: a spread over the story, every shot's midpoint, and the end card from its start to its last frame. */
const FRAMES: Record<NativeFormat, number[]> = {
  long: [20, 45, 150, 255, 345, 435, 525, 570, 600, 660, 749],
  reel: [20, 45, 150, 255, 345, 435, 525, 570, 600, 645],
};

/** The theme fixtures: node-graph-flat on each lowered texture. */
const FIXTURES = ["node-graph-blueprint", "node-graph-dots"];

const problem = nativeJourneyProblem();
const skip = problem && !nativeJourneysRequired() ? problem : false;

journey("theme textures: blueprint and dot-grid films are drawn natively and match Remotion on the stage at every measured frame", async (ctx) => {
  if (skip) return;
  const below: string[] = [];
  for (const slug of FIXTURES) {
    const film = readFilm(slug);
    assert.ok(film, `the ${slug} fixture package is missing`);

    // The renderer choice: before P2.4a a textured theme sent the film to Remotion.
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
  assert.deepEqual(below, [], `native theme-texture frames below the stage bar ${STAGE_SSIM_MIN}:\n${below.join("\n")}`);
});
