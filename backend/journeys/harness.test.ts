/**
 * File Description: Unit tests for the journey harness itself (disk guard, temp accounting, pixel statistics, failure artifacts) and for the render helpers it leans on (GL flag, staged public dir), so a broken guard cannot silently turn every journey into a pass.
 * Inputs and outputs: synthetic buffers, temp folders and fake statfs results -> assertions about the harness behaviour.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DiskHeadroomError, assertDiskHeadroom, frameDiff, frameStats, freeGiB, saveArtifacts, sizeOf, tempEntries, ARTIFACT_DIR, type Rgb } from "./harness";
import { retargetShotIds } from "./ionaFilm";
import { RenderDiskError, assertRenderDiskBudget, estimateRenderTempBytes, glFlag, stagePublicDir } from "../pipeline/render";

/** A flat RGB frame of one colour. */
function solid(width: number, height: number, rgb: [number, number, number]): Rgb {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) data.set(rgb, i * 3);
  return { width, height, data };
}

test("assertDiskHeadroom refuses to start below the floor, naming the directory and both numbers", () => {
  const gib = 1024 ** 3;
  const low = () => ({ bavail: 2 * gib, bsize: 1 });
  assert.equal(freeGiB("/x", low), 2);
  assert.throws(() => assertDiskHeadroom(["/data"], 3, low), (err: unknown) => err instanceof DiskHeadroomError && /DISK_HEADROOM: only 2\.0 GiB free under \/data, need 3 GiB/.test(err.message));
  assert.doesNotThrow(() => assertDiskHeadroom(["/data"], 1, low));
});

test("frameStats tells a flat frame from a drawn one, and frameDiff measures how much changed", () => {
  const flat = solid(8, 8, [10, 10, 10]);
  assert.ok(frameStats(flat).stddev < 0.001);
  const drawn = solid(8, 8, [10, 10, 10]);
  drawn.data.fill(250, 0, 8 * 4 * 3);
  assert.ok(frameStats(drawn).stddev > 50);
  const same = frameDiff(flat, solid(8, 8, [10, 10, 10]), 0);
  assert.deepEqual(same, { meanAbs: 0, changedShare: 0 });
  assert.equal(frameDiff(flat, drawn, 0).changedShare, 0.5);
  assert.throws(() => frameDiff(flat, solid(4, 4, [0, 0, 0])), /cannot compare 8x8 with 4x4/);
});

test("tempEntries sees only prefixed entries, so a leaked render folder shows up in a before/after diff", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-harness-test-"));
  try {
    fs.mkdirSync(path.join(dir, "remotion-webpack-bundle-abc"));
    fs.mkdirSync(path.join(dir, "unrelated"));
    assert.deepEqual(tempEntries(["remotion-"], dir), ["remotion-webpack-bundle-abc"]);
    assert.equal(sizeOf(path.join(dir, "missing")), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saveArtifacts copies kept evidence under .ci-artifacts/<journey> for CI to upload", () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-harness-test-"));
  const name = `harness-selftest-${process.pid}`;
  try {
    fs.writeFileSync(path.join(src, "frame.png"), "not really a png");
    saveArtifacts(name, [path.join(src, "frame.png"), path.join(src, "absent.png")]);
    const saved = path.join(ARTIFACT_DIR, name, "frame.png");
    assert.equal(fs.readFileSync(saved, "utf8"), "not really a png");
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(path.join(ARTIFACT_DIR, name), { recursive: true, force: true });
  }
});

test("retargetShotIds rewrites fixture shot ids at any depth and leaves other strings alone", () => {
  const out = retargetShotIds({ start: "approach", decisive: { shotId: "catch", phrase: "catches" }, carries: ["approach", "receipt", "iona"] });
  assert.deepEqual(out, { start: "beat-01", decisive: { shotId: "beat-02", phrase: "catches" }, carries: ["beat-01", "beat-03", "iona"] });
});

test("glFlag defaults to angle, honours AIDEOS_GL, and rejects anything that is not a plain renderer name", () => {
  assert.equal(glFlag({}), "--gl=angle");
  assert.equal(glFlag({ AIDEOS_GL: "swangle" }), "--gl=swangle");
  assert.throws(() => glFlag({ AIDEOS_GL: "angle; rm -rf /" }), /AIDEOS_GL must be/);
});

test("stagePublicDir serves moved packages through symlinks and its cleanup never touches the real folders", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-harness-test-"));
  try {
    const videos = path.join(root, "moved-videos");
    const examples = path.join(root, "examples");
    const repoPublic = path.join(root, "public");
    for (const [pool, slug] of [[videos, "mine"], [examples, "shipped"], [videos, "shipped"]] as const) {
      fs.mkdirSync(path.join(pool, slug), { recursive: true });
      fs.writeFileSync(path.join(pool, slug, "film.json"), `{"from":"${path.basename(pool)}"}`);
    }
    fs.mkdirSync(repoPublic);
    fs.writeFileSync(path.join(repoPublic, "favicon.png"), "x");
    const staged = stagePublicDir(videos, examples, repoPublic);
    assert.ok(staged);
    assert.ok(fs.existsSync(path.join(staged.dir, "favicon.png")), "other public files must be served too");
    assert.equal(fs.readFileSync(path.join(staged.dir, "videos/mine/film.json"), "utf8"), '{"from":"moved-videos"}');
    assert.equal(fs.readFileSync(path.join(staged.dir, "videos/shipped/film.json"), "utf8"), '{"from":"moved-videos"}', "a moved package wins over a shipped example");
    staged.cleanup();
    assert.ok(!fs.existsSync(staged.dir), "the staged dir must be removed");
    assert.ok(fs.existsSync(path.join(videos, "mine/film.json")) && fs.existsSync(path.join(examples, "shipped/film.json")) && fs.existsSync(path.join(repoPublic, "favicon.png")), "cleanup must never delete the real packages");
    assert.equal(stagePublicDir(path.join(process.cwd(), "videos"), examples, repoPublic), null, "the default layout needs no staging");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("assertRenderDiskBudget uses the PNG worst case and refuses a render that could fill the disk, naming folder and numbers", () => {
  const gib = 1024 ** 3;
  const free = (g: number) => () => ({ bavail: g, bsize: gib });
  // A three-minute 1080p film is 5400 frames; at 3 bytes per pixel that is about 31 GiB of temp PNGs.
  const need = estimateRenderTempBytes(5400, 1920, 1080);
  assert.ok(need > 30 * gib && need < 33 * gib, `worst case for 5400 frames of 1080p should be about 31 GiB, got ${(need / gib).toFixed(1)}`);
  assert.throws(() => assertRenderDiskBudget(5400, 1920, 1080, ["/tmp"], free(20)), (err: unknown) => err instanceof RenderDiskError && /RENDER_DISK_LOW: .* under \/tmp .* only 20\.0 GiB is free/.test(err.message));
  assert.throws(() => assertRenderDiskBudget(5400, 1920, 1080, ["/tmp"], free(33)), RenderDiskError, "free space under the need plus the 3 GiB reserve is refused");
  assert.doesNotThrow(() => assertRenderDiskBudget(5400, 1920, 1080, ["/tmp"], free(40)));
  assert.doesNotThrow(() => assertRenderDiskBudget(31, 1920, 1080, ["/tmp"], free(4)), "a one-second clip fits in a small headroom");
  // The renders folder does not exist before the first render; the disk it will live on is what counts.
  assert.doesNotThrow(() => assertRenderDiskBudget(31, 1920, 1080, ["/tmp/aideos-not-created-yet/renders"], free(4)));
});
