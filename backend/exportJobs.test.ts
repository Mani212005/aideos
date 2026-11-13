/**
 * File Description: Behavioural tests for studio export jobs, using a fake renderer process in place of a
 * full Remotion render. Pins the captain's export decisions: progress follows the renderer's real frame
 * lines, cancel mid-render stops the whole process tree and deletes the partial video, and a finished
 * job only offers a download URL.
 * Inputs and outputs: fake renderer scripts and job calls -> assertions on snapshots, files and live pids.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExportJobs, parseRenderProgress, progressFraction } from "./exportJobs";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";
import { runRenderCommand, type RenderProcessDeps } from "./renderProcess";
import type { ExportJobInput } from "./exportJobs";

/** A renderer stand-in: writes a partial video, spawns a grandchild, reports frames, then waits for a release file. */
const FAKE_RENDERER = `
const fs = require("fs");
const { spawn } = require("child_process");
const [out, dir, mode, rendered, total] = process.argv.slice(2);
fs.writeFileSync(out, "partial");
fs.writeFileSync(dir + "/attempt-output", out);
const grandchild = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "inherit" });
fs.writeFileSync(dir + "/pids.json", JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));
if (mode === "stubborn") process.on("SIGTERM", () => {});
if (mode === "fail") { console.log("Rendered 1/" + total); process.exit(3); }
for (let i = 0; i <= Number(rendered); i++) console.log("Rendered " + i + "/" + total + ", time remaining: 9s");
const wait = setInterval(() => {
  if (fs.existsSync(dir + "/release")) {
    clearInterval(wait);
    fs.writeFileSync(out, "final video");
    console.log("Encoded " + total + "/" + total);
    grandchild.kill();
    process.exit(0);
  }
}, 20);
`;

/** Sets up a scratch directory and a job input that runs the fake renderer. */
function fixture(mode: "run" | "stubborn" | "fail" = "run", rendered = 4, total = 10) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-export-test-"));
  const script = path.join(dir, "renderer.cjs");
  fs.writeFileSync(script, FAKE_RENDERER);
  const outPath = path.join(dir, "renders", "aideos_demo_long_1.mp4");
  let cleanedUp = 0;
  const input: ExportJobInput = {
    film: loadFixtureFilm("fixture-canvas-a"),
    filmId: "demo",
    format: "long",
    filmTitle: "Demo",
    fps: 30,
    durationInFrames: 10,
    filename: "aideos_demo_long_1.mp4",
    outPath,
    downloadUrl: "/api/downloads/aideos_demo_long_1.mp4",
    cleanup: () => {
      cleanedUp += 1;
    },
  };
  // Exercises the actual cancellable process boundary while replacing film/media work with tiny fixture services.
  const jobs = (deps: RenderProcessDeps = {}) => createExportJobs({
    ...deps,
    renderer: () => ({
      checkDiskBudget: async () => {},
      render: async (request, context) => runRenderCommand({
        command: process.execPath,
        args: [script, request.outPath, dir, mode, String(rendered), String(total)],
        cwd: dir,
      }, request.outPath, { signal: context.signal, forceSignal: context.forceSignal, onOutput: context.onOutput }, deps),
    }),
    services: {
      checkDeliverable: () => {}, checkBroll: () => {}, retimeAudio: () => {},
      master: () => ({ status: "skipped", reason: "fixture has no audio" }),
      probe: (format, file) => ({ format, path: file, width: 1920, height: 1080, fps: 30, durationSec: 1, sizeBytes: fs.statSync(file).size }),
    },
  });
  return { dir, input, outPath, jobs, cleanups: () => cleanedUp, attemptPath: () => fs.readFileSync(path.join(dir, "attempt-output"), "utf8"), pids: () => JSON.parse(fs.readFileSync(path.join(dir, "pids.json"), "utf8")) as { child: number; grandchild: number } };
}

/** Polls until the condition holds or fails the test after a few seconds. */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** True while a process with this pid exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("parseRenderProgress reads Remotion's own frame lines and ignores everything else", () => {
  assert.deepEqual(parseRenderProgress("Rendered 12/60, time remaining: 4s\nRendered 13/60, time remaining: 4s"), { rendered: 13, total: 60 });
  assert.deepEqual(parseRenderProgress("Encoded 30/60"), { encoded: 30, total: 60 });
  assert.deepEqual(parseRenderProgress("Concurrency 2x\nComposition Long"), {});
  assert.equal(progressFraction(30, 0, 60), 0.25);
  assert.equal(progressFraction(60, 60, 60), 0.99);
  assert.equal(progressFraction(0, 0, 0), 0);
});

test("export progress follows the renderer's reported frames, not elapsed time", async () => {
  const f = fixture("run", 4, 10);
  const jobs = f.jobs();
  const { job } = jobs.start(f.input);
  try {
    await until(() => jobs.get(job.id)!.renderedFrames === 4, "the renderer's fourth frame");
    const early = jobs.get(job.id)!;
    assert.equal(early.status, "rendering");
    assert.equal(early.totalFrames, 10);
    assert.equal(early.progress, 0.2, "4 of 10 frames rendered, none encoded: a fifth of the work");
    // Time passes with no new frame: a time estimate would move, the real progress must not.
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(jobs.get(job.id)!.progress, 0.2);
    assert.equal(jobs.get(job.id)!.downloadUrl, undefined, "nothing to download before the render finishes");

    fs.writeFileSync(path.join(f.dir, "release"), "");
    await until(() => jobs.get(job.id)!.status === "done", "the render to finish");
    const done = jobs.get(job.id)!;
    assert.equal(done.progress, 1);
    assert.equal(done.downloadUrl, f.input.downloadUrl);
    assert.equal(fs.readFileSync(f.outPath, "utf8"), "final video");
    assert.equal(f.cleanups(), 1);
  } finally {
    await jobs.cancel(job.id);
    jobs.killAll();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("cancel mid-render deletes the partial video and leaves no orphan process", async () => {
  const f = fixture("run", 4, 10);
  const jobs = f.jobs();
  const { job } = jobs.start(f.input);
  try {
    await until(() => jobs.get(job.id)!.renderedFrames === 4 && fs.existsSync(f.attemptPath()), "a partial video on disk");
    const { child, grandchild } = f.pids();
    assert.ok(alive(child) && alive(grandchild), "the render tree is running before the cancel");

    const cancelled = await jobs.cancel(job.id);

    assert.equal(cancelled!.status, "cancelled");
    assert.equal(cancelled!.downloadUrl, undefined);
    assert.equal(fs.existsSync(f.outPath), false, "the partial video is deleted");
    await until(() => !alive(child) && !alive(grandchild), "the whole process tree to exit");
    assert.equal(jobs.current(), undefined, "no job is left in flight");
    assert.equal(f.cleanups(), 1);
  } finally {
    jobs.killAll();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("cancel still ends a renderer that ignores SIGTERM, and removes its partial video", async () => {
  const f = fixture("stubborn", 2, 10);
  const jobs = f.jobs({ killGraceMs: 150 });
  const { job } = jobs.start(f.input);
  try {
    await until(() => jobs.get(job.id)!.renderedFrames === 2 && fs.existsSync(f.attemptPath()), "the stubborn renderer to start");
    const { child, grandchild } = f.pids();
    const cancelled = await jobs.cancel(job.id);
    assert.equal(cancelled!.status, "cancelled");
    assert.equal(fs.existsSync(f.attemptPath()), false);
    await until(() => !alive(child) && !alive(grandchild), "SIGKILL to take the tree down");
  } finally {
    jobs.killAll();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("shutdown force-kills a renderer tree without waiting for graceful escalation", async () => {
  const f = fixture("stubborn", 2, 10);
  const jobs = f.jobs({ killGraceMs: 5000 });
  const { job } = jobs.start(f.input);
  try {
    await until(() => jobs.get(job.id)!.renderedFrames === 2 && fs.existsSync(f.attemptPath()), "the stubborn renderer to start");
    const { child, grandchild } = f.pids();
    jobs.killAll();
    await until(() => !alive(child) && !alive(grandchild), "immediate shutdown of the renderer tree");
    await until(() => jobs.get(job.id)!.status === "cancelled", "the job cancellation state");
    assert.equal(fs.existsSync(f.attemptPath()), false);
    assert.equal(fs.existsSync(f.outPath), false);
  } finally {
    jobs.killAll();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a render that exits with an error fails the job, reports the output and deletes the partial video", async () => {
  const f = fixture("fail", 0, 10);
  const jobs = f.jobs();
  const { job } = jobs.start(f.input);
  try {
    await until(() => jobs.get(job.id)!.status === "failed", "the failure");
    const failed = jobs.get(job.id)!;
    assert.match(failed.error ?? "", /exited with code 3/);
    assert.equal(failed.downloadUrl, undefined);
    assert.equal(fs.existsSync(f.outPath), false);
  } finally {
    jobs.killAll();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("only one export runs at a time, and cancel works before the render has started", async () => {
  const f = fixture("run");
  let release: () => void = () => {};
  const slow: ExportJobInput = {
    ...f.input,
    prepare: () => new Promise((resolve) => {
      release = () => resolve(f.input.film);
    }),
  };
  const jobs = f.jobs();
  const first = jobs.start(slow);
  try {
    assert.equal(first.job.status, "preparing");
    const second = jobs.start(f.input);
    assert.equal(second.busy, true);
    assert.equal(second.job.id, first.job.id);

    const cancelling = jobs.cancel(first.job.id);
    release();
    assert.equal((await cancelling)!.status, "cancelled");
    assert.equal(fs.existsSync(f.outPath), false, "nothing was ever rendered");
    const next = jobs.start(f.input);
    assert.equal(next.busy, false, "the next export may start once the first is cancelled");
    await jobs.cancel(next.job.id);
  } finally {
    jobs.killAll();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
