/**
 * File Description: Exercises the public renderer adapter to preserve existing capture commands and pointer restoration.
 * Inputs and outputs: tiny fixture jobs with intercepted subprocess boundaries -> command, lifecycle and output assertions.
 * Used by: npm test.
 */

import "./testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRenderJob } from "./renderJob";
import { createRemotionRenderer } from "./remotionRenderer";
import {
  readActiveFilmSource,
  restoreActiveFilmSource,
  setActiveFilm,
  readFilm,
} from "./pipeline/filmStore";

for (const caller of ["pipeline", "studio", "review", "manual"] as const) {
  test(`${caller} uses the shared job while retaining its existing encode, GL and active-film behavior`, async (t) => {
    const previous = readActiveFilmSource();
    t.after(() => restoreActiveFilmSource(previous));
    setActiveFilm("still-talking");
    const selected = readActiveFilmSource();
    const oldGl = process.env.AIDEOS_GL;
    process.env.AIDEOS_GL = "swangle";
    t.after(() => {
      if (oldGl === undefined) delete process.env.AIDEOS_GL;
      else process.env.AIDEOS_GL = oldGl;
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-adapter-test-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const film = readFilm("hello-scene")!;
    const outPath = path.join(dir, "reel.mp4");
    let measured = 0;
    let rendered = 0;
    const backend = createRemotionRenderer(
      { caller },
      {
        checkDiskBudget: async (request) => {
          measured++;
          assert.equal(request.film.id, film.id);
          assert.equal(request.format, "reel");
          assert.deepEqual(request.range, [0, 2]);
          assert.equal(request.signal?.aborted, false);
          return {
            frameBytes: 1,
            outputBytes: 1,
            overheadBytes: 1,
            totalBytes: 3,
          };
        },
        run: async (command, output) => {
          rendered++;
          assert.equal(measured, 1, "disk preflight precedes capture");
          assert.equal(command.command, "npx");
          assert.notEqual(output, outPath, "capture writes to the private job artifact");
          assert.equal(path.basename(output), path.basename(outPath));
          const { args } = command;
          const encodeFlags = [
            "--codec=h264",
            "--image-format=png",
            "--crf=16",
            "--pixel-format=yuv420p",
            "--audio-codec=aac",
            "--audio-bitrate=320k",
          ];
          // Every caller builds the same encode arguments from the one shared constant.
          assert.deepEqual(
            args.filter((arg) => /^--(codec|image-format|crf|pixel-format|audio-codec|audio-bitrate)=/.test(arg)),
            encodeFlags,
          );
          if (caller === "pipeline") {
            assert.deepEqual(args.slice(0, 4), [
              "remotion",
              "render",
              "Reel",
              output,
            ]);
            assert.ok(args.includes("--gl=swangle"));
          } else {
            assert.deepEqual(args.slice(0, 5), [
              "remotion",
              "render",
              "src/index.ts",
              "Reel",
              output,
            ]);
            assert.equal(args.includes("--gl=angle"), caller !== "studio");
            assert.equal(args.includes("--gl=swangle"), false);
          }
          assert.ok(args.includes("--frames=0-2"));
          if (caller === "manual")
            assert.equal(readActiveFilmSource(), selected);
          else assert.match(readActiveFilmSource(), /films\/hello-scene/);
          fs.writeFileSync(output, "synthetic capture");
        },
      },
    );
    const job = createRenderJob(
      {
        film,
        format: "reel",
        outPath,
        frames: [0, 2],
        profile: caller === "review" ? "review" : "final",
      },
      backend,
      {
        services: {
          checkDeliverable: () => {},
          checkBroll: () => {},
          retimeAudio: () => {},
          master: () => ({ status: "skipped", reason: "synthetic audio" }),
          probe: (format, file) => ({
            format,
            path: file,
            width: 16,
            height: 16,
            fps: 30,
            durationSec: 0.1,
            sizeBytes: fs.statSync(file).size,
          }),
        },
      },
    );
    await job.run();
    assert.equal(job.state, "done");
    assert.equal(rendered, 1);
    assert.ok(fs.existsSync(outPath));
    assert.ok(fs.existsSync(`${outPath}.render.json`));
    if (caller === "review" || caller === "manual")
      assert.equal(readActiveFilmSource(), selected);
    else assert.match(readActiveFilmSource(), /films\/hello-scene/);
  });
}
