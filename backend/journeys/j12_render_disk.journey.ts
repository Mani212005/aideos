/**
 * File Description: Journey J12 (disk guard, measured): on a real short render of the Iona film it samples real frames the way the production render stage does, renders the same window through the real Remotion CLI path while polling the temp dir for its peak, and asserts the estimate is at least the real peak (the guard is safe) and at most ten times it (the guard is useful, not the old 3 bytes per pixel blanket refusal). It also shows Remotion keeps every frame until it stitches them, which is what the frame term of the estimate assumes.
 * Inputs and outputs: the committed iona-receive look and design -> the sampled frame sizes, the estimate, the real peak temp bytes, and assertions comparing them.
 * Used by: npm run test:journeys (the CI journeys job).
 */

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { journey, sizeOf, tempEntries } from "./harness";
import { produceIona } from "./ionaFilm";
import { readFilm } from "../pipeline/filmStore";
import { setActiveFilm } from "../pipeline/generatedFiles";
import { renderFormat } from "../pipeline/render";
import { RenderDiskError, RENDER_RESERVE_BYTES, checkRenderDiskBudget } from "../pipeline/renderDiskBudget";

const SLUG = "journey-render-disk";
const WINDOW = 15;
const MIB = 1024 ** 2;

/** Bytes currently under the private temp dir, which holds only this process's render and its helpers. */
function tempBytes(): number {
  return sizeOf(os.tmpdir());
}

journey("J12 the measured disk estimate covers a real render's peak temp bytes and is not wildly above it", async (ctx) => {
  // Stop before the render stage: the guard runs on the assembled film, and the render below is driven by hand so its temp dir can be watched.
  const { contactFrame } = await produceIona(SLUG, { windowFrames: WINDOW, request: { formats: ["long"], stopAfter: "assemble" } });
  const film = readFilm(SLUG)!;
  setActiveFilm(SLUG);
  const range: [number, number] = [contactFrame - WINDOW, contactFrame + WINDOW];
  const browserExecutable = process.env.AIDEOS_BROWSER_EXECUTABLE || undefined;
  const enoughRoom = () => ({ bavail: 100 * 1024, bsize: MIB });

  const before = tempBytes();
  const estimate = await checkRenderDiskBudget({ film, format: "long", range, dirs: [os.tmpdir()], browserExecutable, statfs: enoughRoom });
  assert.deepEqual(tempEntries(["aideos-disk-sample-"]), [], "the sampler must release its bundle, stills and browser");
  assert.ok(Math.abs(tempBytes() - before) < 5 * MIB, "sampling leaves no temp behind");

  // Render the same window and watch the temp dir.
  let peak = 0;
  const poll = setInterval(() => {
    try {
      peak = Math.max(peak, tempBytes() - before);
    } catch {}
  }, 100);
  try {
    await renderFormat("long", path.join(ctx.workDir, "long.mp4"), { frames: range, browserExecutable, concurrency: 2 });
  } finally {
    clearInterval(poll);
  }

  const frames = range[1] - range[0] + 1;
  console.log(`# J12 ${frames} frames: real peak ${(peak / MIB).toFixed(1)} MiB, estimate ${(estimate.totalBytes / MIB).toFixed(1)} MiB (${(estimate.totalBytes / peak).toFixed(1)}x)`);
  assert.ok(peak > 0, "the poll never saw the render's temp files");
  assert.ok(estimate.totalBytes >= peak, `estimate ${(estimate.totalBytes / MIB).toFixed(1)} MiB must be at least the real peak ${(peak / MIB).toFixed(1)} MiB`);
  assert.ok(estimate.totalBytes <= peak * 10, `estimate ${(estimate.totalBytes / MIB).toFixed(1)} MiB must be within 10x of the real peak ${(peak / MIB).toFixed(1)} MiB for ${frames} frames`);

  // The same numbers refuse a render when the disk really is too small, naming the sample and the reserve.
  const tight = () => ({ bavail: Math.floor((RENDER_RESERVE_BYTES + estimate.totalBytes - 1) / MIB), bsize: MIB });
  await assert.rejects(
    checkRenderDiskBudget({ film, format: "long", range, dirs: [os.tmpdir()], browserExecutable, sampler: async () => ({ width: 1920, height: 1080, frames: [{ frame: contactFrame, bytes: Math.ceil(estimate.frameBytes / frames / 2) }] }), statfs: tight }),
    (err: unknown) => err instanceof RenderDiskError && /RENDER_DISK_LOW/.test(err.message) && /3 GiB reserve/.test(err.message),
  );
});
