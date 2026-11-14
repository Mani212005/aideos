/**
 * File Description: Renders the same three-frame synthetic reel through the studio Export adapter and the pipeline adapter and probes both real mp4s.
 * Inputs and outputs: hello-scene fixture film, real Remotion capture per caller -> asserted pixel format and colour range tag of each file, studio equal to pipeline.
 * Used by: npm test (renders run sequentially; they rewrite the generated active-film module).
 */

import "./testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRenderJob } from "./renderJob";
import { createRemotionRenderer } from "./remotionRenderer";
import { readActiveFilmSource, readFilm, restoreActiveFilmSource } from "./pipeline/filmStore";

/** Renders frames 0-2 of the hello-scene reel through one caller's adapter and returns the mp4's video pix_fmt and color_range. */
async function renderAndProbe(caller: "studio" | "pipeline", dir: string): Promise<{ pixFmt: string; range: string }> {
  const outPath = path.join(dir, `${caller}.mp4`);
  const job = createRenderJob(
    { film: readFilm("hello-scene")!, format: "reel", outPath, frames: [0, 2], profile: "final" },
    createRemotionRenderer(
      { caller },
      { checkDiskBudget: async () => ({ frameBytes: 1, outputBytes: 1, overheadBytes: 1, totalBytes: 3 }) },
    ),
    {
      services: {
        checkDeliverable: () => {},
        checkBroll: () => {},
        retimeAudio: () => {},
        master: () => ({ status: "skipped", reason: "synthetic audio" }),
        probe: (format, file) => ({ format, path: file, width: 1080, height: 1920, fps: 30, durationSec: 0.1, sizeBytes: fs.statSync(file).size }),
      },
    },
  );
  await job.run();
  assert.equal(job.state, "done");
  const [pixFmt, range] = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,color_range", "-of", "csv=p=0", outPath],
    { encoding: "utf8" },
  )
    .trim()
    .split(",");
  return { pixFmt, range };
}

test("studio Export encodes yuv420p with the pipeline's exact colour range tag", async (t) => {
  const previous = readActiveFilmSource();
  t.after(() => restoreActiveFilmSource(previous));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-export-encode-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pipeline = await renderAndProbe("pipeline", dir);
  const studio = await renderAndProbe("studio", dir);
  assert.deepEqual(pipeline, { pixFmt: "yuv420p", range: "unknown" }, "the pipeline's final settings: yuv420p, no full range tag");
  assert.deepEqual(studio, pipeline, "studio Export tags the same pixel format and colour range as the pipeline");
});
