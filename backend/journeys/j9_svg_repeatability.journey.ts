/**
 * File Description: Regression for the cold SVG paint race that made Still Talking's legacy golden vary between identical renders.
 * Inputs and outputs: the committed still-talking fixture at Long frame 2773 -> independently rendered PNGs whose decoded pixels must match exactly.
 * Used by: npm run test:journeys and the journeys CI job.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { decodeFrame, frameDiff, journey } from "./harness";
import { openFilm } from "./remotionFrames";

journey("J9 Still Talking frame 2773 reproduces exactly across cold SVG renders", async (ctx) => {
  let reference: ReturnType<typeof decodeFrame> | undefined;
  // Independent bundles and browsers reproduce the two passes of the update-goldens workflow.
  for (let pass = 0; pass < 4; pass++) {
    const film = await openFilm("still-talking");
    try {
      const png = path.join(ctx.workDir, `long-2773-${pass}.png`);
      ctx.keep(png);
      await film.still("Long", 2773, png, 0.25);
      const actual = decodeFrame(png);
      if (!reference) reference = actual;
      else assert.equal(frameDiff(reference, actual, 0).changedShare, 0, `still-talking/long-2773.png changed on cold render ${pass + 1}`);
    } finally {
      await film.close();
    }
  }
});
