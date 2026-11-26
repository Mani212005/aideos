/**
 * File Description: Journey for the first slice of Phase 2 of the native renderer: SVG artwork with a filter (the glow and drop shadow the node-graph canvas draws) is drawn natively instead of falling back to Remotion, and looks the same. A fresh copy of the synthetic picture fixture gets, in its label artwork, the node-graph edge's neon glow (two Gaussian blurs merged under the source, as `CanvasGraph.tsx` defines it) on a curve and a drop shadow (blurred alpha, offset, flooded and composited) under a card; the renderer choice in `auto` must pick native for it (the loader refused `filter` before), and the native frames must match the Remotion frames on the stage at the SSIM bar of the native parity reports.
 * Inputs and outputs: test_fixtures/packages/pictures-stage copied to a new package, the release binary and Remotion -> pass, or a failure naming the format and frame with both frames saved under .ci-artifacts/.
 * Used by: npm run test:journeys and the CI journeys job (which builds the binary first). Skips when the binary is not built unless CI or AIDEOS_NATIVE_TESTS_REQUIRED=1.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { journey } from "./harness";
import { STAGE_CROP, STAGE_SSIM_MIN, nativeJourneyProblem, nativeJourneysRequired, renderNativeFrame, ssim, stageNativePackage } from "./nativeFrames";
import { openFilm } from "./remotionFrames";
import { createSelectedRenderer } from "../rendererSelection";
import { createNativeRenderer } from "../nativeRenderer";
import { picturePackage, silentWav } from "../testSupport/pictureReelCut";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import type { Renderer } from "../renderJob";

const SLUG = "pictures-stage-glow";

const problem = nativeJourneyProblem();
const skip = problem && !nativeJourneysRequired() ? problem : false;

/** The filters and the filtered shapes added to the label artwork, in its own coordinates: a glowing edge arching from above the orb's label to above the chip's, with a shadowed card under the arch, between the orb and the chip and clear of the caption band. */
const FILTERED_ART = `
  <defs>
    <filter id="neonGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="4" result="blur1"/>
      <feGaussianBlur stdDeviation="8" result="blur2"/>
      <feMerge><feMergeNode in="blur2"/><feMergeNode in="blur1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="drop" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="0" dy="8" result="offset"/>
      <feFlood flood-color="#000000" flood-opacity="0.6"/>
      <feComposite in2="offset" operator="in" result="shadow"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path id="glow-edge" d="M -150 -40 C -110 -250, 110 -250, 150 -40" fill="none" stroke="#635BFF" stroke-width="6" filter="url(#neonGlow)"/>
  <rect id="glow-card" x="-80" y="-190" width="160" height="70" rx="14" fill="#2A3150" stroke="#635BFF" stroke-width="1.5" filter="url(#drop)"/>
`;

journey("svg filters: artwork with the node-graph glow and a drop shadow is drawn natively and matches Remotion on the stage", async (ctx) => {
  if (skip) return;
  const { pkg, long } = picturePackage(SLUG);
  // The copy keeps the fixture's narration path, and the fixture package has no recording: a render job stages one.
  silentWav(path.join(resolvePackageDir("pictures-stage"), "voiceover.wav"), 10);
  const label = path.join(pkg, "visuals", "label.svg");
  fs.writeFileSync(label, fs.readFileSync(label, "utf8").replace("</svg>", `${FILTERED_ART}</svg>`));

  // The renderer choice asks the native loader while the job prepares; before the filter subset it refused `filter` and sent the film to Remotion.
  const messages: string[] = [];
  const remotion: Renderer = { name: "remotion", prepare: () => assert.fail("Remotion must not render a film the native renderer can draw"), checkDiskBudget: async () => {}, render: async () => {} };
  const renderer = createSelectedRenderer({ mode: "auto", remotion: () => remotion, native: () => createNativeRenderer(), onChoice: (_c, message) => messages.push(message) });
  const never = new AbortController().signal;
  const out = path.join(ctx.workDir, "renders", "long.mp4");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await renderer.prepare!({ film: long, format: "long", outPath: out, profile: "draft" }, { signal: never, forceSignal: never, onOutput: () => {} });
  assert.deepEqual(messages, [`long: native renderer draws "${SLUG}"`]);
  await renderer.cleanup?.();

  const film = await openFilm(SLUG);
  try {
    // The card and the glowing edge are on the stage from the first frame; the camera has pushed in by 135 and settled by 285.
    for (const [format, frame] of [["long", 135], ["long", 285], ["reel", 285]] as const) {
      const staged = stageNativePackage(long, format, path.join(ctx.workDir, `pkg-${format}`), { pictureOnly: true });
      const nativePng = path.join(ctx.workDir, `native-${format}-${frame}.png`);
      const remotionPng = path.join(ctx.workDir, `remotion-${format}-${frame}.png`);
      renderNativeFrame(staged, format, frame, nativePng);
      ctx.keep(nativePng);
      await film.still(format === "long" ? "Long" : "Reel", frame, remotionPng);
      ctx.keep(remotionPng);
      const score = ssim(nativePng, remotionPng, STAGE_CROP[format]);
      assert.ok(score >= STAGE_SSIM_MIN, `${format} frame ${frame}: the native stage with filters matches Remotion at SSIM ${score.toFixed(5)}, below ${STAGE_SSIM_MIN}`);
    }
  } finally {
    await film.close();
  }
});
