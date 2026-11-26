/**
 * File Description: Journey for Phase 2 step P2.2c of the native renderer: a node-graph film (no scene, the flat camera) is drawn natively instead of falling back to Remotion, and looks the same. For each node-graph fixture the renderer choice in `auto` must pick native in both formats, and its native frames must match the Remotion frames on the stage at the SSIM bar of the native parity reports on every measured frame, none left out. node-graph-flat: the frames 20, 60, 100, 150, 250, 330, 420 and 520, every shot's midpoint (45, 255, 345, 435, 525) and one end-card frame. node-graph-cases (the cases node-graph-flat does not reach: a bright accent, small nodes at a zoom above 9, cards close together, a StatCounter over the canvas): every shot's midpoint, the frames that measured lowest in a sweep of every 15th frame, and one end-card frame.
 * Inputs and outputs: test_fixtures/packages/node-graph-flat and node-graph-cases, the release binary and Remotion -> pass, or a failure naming every film, format and frame under the bar with both frames saved under .ci-artifacts/.
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

/** Each fixture and its measured frames per format. */
const FIXTURES: Array<{ slug: string; frames: Record<NativeFormat, number[]> }> = [
  // A fixed spread over the story, every shot's midpoint, and one frame of the end card.
  { slug: "node-graph-flat", frames: { long: [20, 45, 60, 100, 150, 250, 255, 330, 345, 420, 435, 520, 525, 700], reel: [20, 45, 60, 100, 150, 250, 255, 330, 345, 420, 435, 520, 525, 640] } },
  // Every shot's midpoint (45, 135, 225, 315, 405, 495), the lowest frames of the sweep, and one frame of the end card.
  { slug: "node-graph-cases", frames: { long: [20, 45, 120, 135, 225, 285, 315, 330, 345, 405, 495, 690], reel: [20, 45, 120, 135, 225, 285, 315, 330, 345, 405, 495, 600] } },
];

const problem = nativeJourneyProblem();
const skip = problem && !nativeJourneysRequired() ? problem : false;

journey("node-graph films: the flat canvas is drawn natively and matches Remotion on the stage at every measured frame", async (ctx) => {
  if (skip) return;
  const below: string[] = [];
  for (const { slug, frames } of FIXTURES) {
    const film = readFilm(slug);
    assert.ok(film, `the ${slug} fixture package is missing`);

    // The renderer choice: before P2.2c every node-graph film went to Remotion.
    const messages: string[] = [];
    const remotion: Renderer = { name: "remotion", prepare: () => assert.fail("Remotion must not render a node-graph film the native renderer can draw"), checkDiskBudget: async () => {}, render: async () => {} };
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
        for (const frame of frames[format]) {
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
  assert.deepEqual(below, [], `native node-graph frames below the stage bar ${STAGE_SSIM_MIN}:\n${below.join("\n")}`);
});
