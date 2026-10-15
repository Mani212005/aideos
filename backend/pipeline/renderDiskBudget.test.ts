/**
 * File Description: Unit tests for the render disk guard: the estimate scales with frames, size and the heaviest sampled frame, the sample picks the densest shot and the tightest zoom, and the guard refuses or admits a render against injected free space with a fake sampler, never touching Remotion or the real disk.
 * Inputs and outputs: fixture films, fake frame samples and fake statfs results -> assertions about estimates, picks and RENDER_DISK_LOW.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";
import {
  RENDER_FIXED_OVERHEAD_BYTES,
  RENDER_FRAME_SAFETY_FACTOR,
  RENDER_RESERVE_BYTES,
  RenderDiskError,
  assertRenderDiskBudget,
  checkRenderDiskBudget,
  estimateRenderTempBytes,
  pickSampleFrames,
  type RenderSample,
} from "./renderDiskBudget";
import { buildTimeline } from "../../src/dl/camera";
import type { Film } from "../../src/dl/schema";
import { renderFormat } from "./render";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const free = (bytes: number) => () => ({ bavail: bytes, bsize: 1 });
const sampleOf = (...sizes: number[]): RenderSample => ({ width: 1920, height: 1080, frames: sizes.map((bytes, i) => ({ frame: i * 100, bytes })) });

test("the estimate scales with frames, with output size and with the heaviest sampled frame", () => {
  const base = { frames: 1000, maxFrameBytes: 200_000 };
  const one = estimateRenderTempBytes(base);
  assert.equal(one.frameBytes, 1000 * 200_000 * RENDER_FRAME_SAFETY_FACTOR);
  assert.equal(one.overheadBytes, RENDER_FIXED_OVERHEAD_BYTES);
  assert.equal(one.totalBytes, one.frameBytes + one.outputBytes + one.overheadBytes);

  const doubled = estimateRenderTempBytes({ ...base, frames: 2000 });
  assert.equal(doubled.frameBytes, one.frameBytes * 2, "twice the frames, twice the frame bytes");
  assert.equal(doubled.outputBytes, one.outputBytes * 2, "encoded output scales with measured frame bytes");

  const heavy = estimateRenderTempBytes({ ...base, maxFrameBytes: 1_000_000 });
  assert.ok(heavy.totalBytes > one.totalBytes * 3, "a heavy sampled frame raises the estimate");
});

test("the guard uses the largest sampled frame, not the average", () => {
  const light = assertRenderDiskBudget({ frames: 1000, sample: sampleOf(100_000, 100_000, 100_000), statfs: free(100 * GIB) });
  const oneHeavy = assertRenderDiskBudget({ frames: 1000, sample: sampleOf(100_000, 100_000, 900_000), statfs: free(100 * GIB) });
  assert.equal(oneHeavy.frameBytes, 1000 * 900_000 * RENDER_FRAME_SAFETY_FACTOR);
  assert.ok(oneHeavy.frameBytes > light.frameBytes * 8);
  assert.throws(() => assertRenderDiskBudget({ frames: 1000, sample: sampleOf() }), /RENDER_SAMPLE_FAILED/, "no sample means no measurement and no render");
});

test("a real-sized film fits on a small disk that the old 3 bytes per pixel worst case refused", () => {
  // The captain's case: a 54 s 1080p film (1620 frames) on 7.2 GiB free. Measured frames are about 0.1 to 0.3 MB.
  const sample = sampleOf(120_000, 180_000, 300_000);
  const estimate = assertRenderDiskBudget({ frames: 1620, sample, dirs: ["/tmp"], statfs: free(7.2 * GIB) });
  assert.ok(estimate.totalBytes < 1.5 * GIB, `54 s at 0.3 MB a frame needs about 1 GiB, got ${(estimate.totalBytes / GIB).toFixed(2)}`);
  // The old guard estimated 1620 * 1920 * 1080 * 3 = 10.1 GiB plus the 3 GiB reserve here.
  assert.ok(1620 * 1920 * 1080 * 3 + RENDER_RESERVE_BYTES > 7.2 * GIB);
  // A three-minute film is a few GiB, not 30.
  assert.doesNotThrow(() => assertRenderDiskBudget({ frames: 5400, sample, dirs: ["/tmp"], statfs: free(7.2 * GIB) }));
});

test("the guard refuses when the estimate plus the 3 GiB reserve exceeds free space and admits when it fits, naming every number", () => {
  const sample = sampleOf(2 * MIB, 3 * MIB);
  const frames = 1000;
  const need = estimateRenderTempBytes({ frames, maxFrameBytes: 3 * MIB }).totalBytes;
  assert.ok(need > 7.3 * GIB && need < 7.6 * GIB, `1000 frames of 3 MiB with the safety factor is about 7.4 GiB, got ${(need / GIB).toFixed(2)}`);

  assert.throws(
    () => assertRenderDiskBudget({ frames, sample, dirs: ["/tmp"], statfs: free(need + RENDER_RESERVE_BYTES - 1) }),
    (err: unknown) =>
      err instanceof RenderDiskError &&
      /RENDER_DISK_LOW: rendering 1000 frames under \/tmp needs about \d+\.\d+ GiB \(heaviest of 2 sampled frames 3\.00 MiB .* plus a 3 GiB reserve, but only \d+\.\d+ GiB is free/.test(err.message) &&
      err.maxFrameBytes === 3 * MIB,
    "one byte short of the estimate plus the reserve is refused",
  );
  assert.doesNotThrow(() => assertRenderDiskBudget({ frames, sample, dirs: ["/tmp"], statfs: free(need + RENDER_RESERVE_BYTES) }), "exactly enough is admitted");
  // The renders folder does not exist before the first render; the disk it will live on is what counts.
  assert.throws(() => assertRenderDiskBudget({ frames, sample, dirs: ["/tmp/aideos-not-created-yet/renders"], statfs: free(1 * GIB) }), RenderDiskError);
  // Every directory is checked: a roomy temp disk does not excuse a full output disk.
  const disks = (p: string) => ({ bavail: p.startsWith("/tmp") ? 100 * GIB : 1 * GIB, bsize: 1 });
  assert.throws(() => assertRenderDiskBudget({ frames, sample, dirs: ["/tmp", "/"], statfs: disks }), (err: unknown) => err instanceof RenderDiskError && err.dir === "/");
});

test("pickSampleFrames spreads across the range and adds the densest shot and the tightest zoom", () => {
  const film = structuredClone(loadFixtureFilm("fixture-canvas-a")) as Film;
  film.fps = 30;
  const timeline = buildTimeline(film);
  const total = timeline[timeline.length - 1].to;
  const spread = pickSampleFrames(film, [0, total - 1]);
  assert.ok(spread.length >= 5 && spread.every((f) => f >= 0 && f < total), JSON.stringify(spread));
  assert.deepEqual(spread, [...new Set(spread)].sort((a, b) => a - b), "sorted and unique");

  // Make shot 3 the densest and shot 2 the tightest, and both must be sampled at their middle.
  film.shots[2].blocks = [...film.shots[2].blocks, ...film.shots[2].blocks, ...film.shots[2].blocks];
  film.shots[1].zoom = 2.2;
  const mid = (i: number) => Math.round((timeline[i].from + timeline[i].to) / 2);
  const picks = pickSampleFrames(film, [0, total - 1]);
  assert.ok(picks.includes(mid(2)), `densest shot middle ${mid(2)} missing from ${JSON.stringify(picks)}`);
  assert.ok(picks.includes(mid(1)), `tightest shot middle ${mid(1)} missing from ${JSON.stringify(picks)}`);

  // A scene camera keyframe decides the tightest zoom when there is one.
  const withCamera = { ...film, scene: { camera: { keyframes: [{ frame: 10, center: { x: 0, y: 0 }, zoom: 1 }, { frame: 77, center: { x: 0, y: 0 }, zoom: 3 }] } } } as unknown as Film;
  assert.ok(pickSampleFrames(withCamera, [0, total - 1]).includes(77));

  // Every pick stays inside a partial range.
  const partial = pickSampleFrames(film, [20, 50]);
  assert.ok(partial.every((f) => f >= 20 && f <= 50), JSON.stringify(partial));
});

test("checkRenderDiskBudget samples the picked frames of the film through the injected sampler", async () => {
  const film = loadFixtureFilm("fixture-canvas-a");
  const total = buildTimeline(film).slice(-1)[0].to;
  let asked: number[] = [];
  const sampler = async (format: string, frames: number[]) => {
    assert.equal(format, "long");
    asked = frames;
    return sampleOf(...frames.map(() => 250_000));
  };
  const estimate = await checkRenderDiskBudget({ film, format: "long", range: [0, total - 1], dirs: ["/tmp"], sampler, statfs: free(10 * GIB) });
  assert.deepEqual(asked, pickSampleFrames(film, [0, total - 1]));
  assert.equal(estimate.frameBytes, total * 250_000 * RENDER_FRAME_SAFETY_FACTOR);
  await assert.rejects(checkRenderDiskBudget({ film, format: "long", range: [0, total - 1], dirs: ["/tmp"], sampler, statfs: free(3 * GIB) }), RenderDiskError);
});

test("footage samples span the range at about two-second intervals and cap at 40 frames", () => {
  const film = structuredClone(loadFixtureFilm("fixture-canvas-a")) as Film;
  film.videoClips = [{ id: "footage", src: "footage.mp4", position: 0, start: 0, end: 120 }];
  const picks = pickSampleFrames(film, [0, 2399]);
  assert.ok(picks.length <= 40);
  assert.equal(picks[0], 0);
  assert.equal(picks.at(-1), 2340);
  assert.ok(picks.every((frame, i) => i === 0 || frame - picks[i - 1] === 60));
  assert.equal(pickSampleFrames(film, [0, 10_000]).length, 40);
});

test("the in-flight watchdog stops rendering below reserve and removes its temp directory", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-render-watchdog-test-"));
  let renderTempDir = "";
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: (signal: string) => boolean };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal: string) => {
    assert.equal(signal, "SIGTERM");
    setImmediate(() => child.emit("close", 143));
    return true;
  };
  try {
    await assert.rejects(
      renderFormat("long", path.join(parent, "out.mp4"), {}, {
        spawn: ((_command: string, _args: string[], spawnOptions: { env: NodeJS.ProcessEnv }) => {
          renderTempDir = spawnOptions.env.TMPDIR ?? "";
          return child as never;
        }) as never,
        statfs: () => ({ bavail: 1, bsize: 1 }),
        pollIntervalMs: 5,
      }),
      /RENDER_DISK_LOW/,
    );
    assert.ok(renderTempDir);
    assert.equal(fs.existsSync(renderTempDir), false, "only the render-owned temp directory is removed");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("the in-flight watchdog stops rendering and rejects when a free-space check fails", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-render-watchdog-error-test-"));
  let renderTempDir = "";
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: (signal: string) => boolean };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal: string) => {
    assert.equal(signal, "SIGTERM");
    setImmediate(() => child.emit("close", 143));
    return true;
  };
  try {
    await assert.rejects(
      renderFormat("long", path.join(parent, "out.mp4"), {}, {
        spawn: ((_command: string, _args: string[], spawnOptions: { env: NodeJS.ProcessEnv }) => {
          renderTempDir = spawnOptions.env.TMPDIR ?? "";
          return child as never;
        }) as never,
        statfs: () => {
          throw new Error("statfs denied");
        },
        pollIntervalMs: 5,
      }),
      /RENDER_DISK_CHECK_FAILED: could not check free space during render: statfs denied/,
    );
    assert.ok(renderTempDir);
    assert.equal(fs.existsSync(renderTempDir), false, "the render-owned temp directory is removed");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
