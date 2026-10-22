/**
 * File Description: Verifies review renders select the requested film and restore the active film.
 * Inputs and outputs: fixture films and intercepted render commands -> runtime film and duration assertions.
 * Used by: npm test.
 */

import "../testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readActiveFilmSource, restoreActiveFilmSource, setActiveFilm, ROOT } from "../pipeline/filmStore";
import { renderVideoForSlug } from "./render";

const execFileSync = childProcess.execFileSync;

// Measures the real composition runtime in a fresh process, avoiding cached active-film imports.
function measureRuntime(): { id: string; frames: number; fps: number } {
  const output = execFileSync(process.execPath, [
    "--import", "tsx", "-e",
    'const { FILM, TOTAL_FRAMES, FPS } = require("./src/dl/runtime.ts"); console.log(JSON.stringify({ id: FILM.id, frames: TOTAL_FRAMES, fps: FPS }));',
  ], { cwd: ROOT, encoding: "utf8" });
  return JSON.parse(output);
}

for (const outcome of ["success", "failure", "missing-output"] as const) {
  test(`review render selects the requested film and restores active source after ${outcome}`, async (t) => {
    const original = readActiveFilmSource();
    t.after(() => restoreActiveFilmSource(original));
    setActiveFilm("still-talking");
    const previous = readActiveFilmSource();
    const before = measureRuntime();
    assert.equal(before.id, "still-talking");
    let calls = 0;
    t.mock.method(childProcess, "execFileSync", (command: string, args: string[]) => {
      calls++;
      assert.equal(command, "npx");
      assert.deepEqual(args.slice(0, 4), ["remotion", "render", "src/index.ts", "Reel"]);
      const selected = measureRuntime();
      assert.equal(selected.id, "hello-scene");
      assert.equal(selected.frames / selected.fps, 10);
      assert.equal(args.some((arg) => arg.startsWith("--props=")), false);
      assert.notEqual(selected.frames, before.frames);
      if (outcome === "failure") throw new Error("render subprocess failed");
      if (outcome === "success") fs.writeFileSync(args[4], "render output");
      return Buffer.alloc(0);
    });
    // Keep output isolated from the committed example package.
    const { resolvePackageDir, getVideosDir } = await import("../../src/dl/videoPackageLoader");
    const target = path.join(getVideosDir(), "hello-scene");
    fs.cpSync(resolvePackageDir("hello-scene"), target, { recursive: true });
    t.after(() => fs.rmSync(target, { recursive: true, force: true }));
    if (outcome === "success") {
      assert.equal(await renderVideoForSlug("hello-scene", "reel"), path.join(target, "renders/reel.mp4"));
    } else {
      await assert.rejects(renderVideoForSlug("hello-scene", "reel"), outcome === "failure" ? /render subprocess failed/ : /Render failed to create output/);
    }
    assert.equal(calls, 1);
    assert.equal(readActiveFilmSource(), previous);
    assert.deepEqual(measureRuntime(), before);
  });
}
