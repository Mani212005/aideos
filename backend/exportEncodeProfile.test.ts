/**
 * File Description: Renders a three-frame synthetic reel through the studio Export adapter and probes the real mp4.
 * Inputs and outputs: hello-scene fixture film, real Remotion capture -> asserted pixel format and colour range of the file.
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

test("studio Export produces yuv420p limited range, not yuvj420p full range", async (t) => {
  const previous = readActiveFilmSource();
  t.after(() => restoreActiveFilmSource(previous));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-export-encode-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outPath = path.join(dir, "reel.mp4");
  const job = createRenderJob(
    { film: readFilm("hello-scene")!, format: "reel", outPath, frames: [0, 2], profile: "final" },
    createRemotionRenderer(
      { caller: "studio" },
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
  assert.equal(pixFmt, "yuv420p");
  assert.notEqual(range, "pc", "full range tagging is the defect");
});
