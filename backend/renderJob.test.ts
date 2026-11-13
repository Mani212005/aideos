/**
 * File Description: Behavioral tests of the renderer-neutral job lifecycle and output provenance using short synthetic encoders.
 * Inputs and outputs: public job calls, injected backend failures and small fixture films -> states, files and failure assertions.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createRenderJob,
  renderFilmHash,
  RENDER_PROFILES,
  transitionRenderJob,
  type Renderer,
  type RenderServices,
  type RenderState,
} from "./renderJob";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";

/** Provides a tiny encoder and observable domain services without rendering a real film. */
function fixture(t: test.TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-job-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const film = loadFixtureFilm("fixture-canvas-a");
  const outPath = path.join(dir, "result.mp4");
  const calls: string[] = [];
  const renderer: Renderer = {
    prepare: () => {
      calls.push("backend-prepare");
    },
    checkDiskBudget: async () => {
      calls.push("disk");
    },
    render: async (request) => {
      calls.push("encode");
      fs.writeFileSync(request.outPath, "encoded");
    },
    cleanup: () => {
      calls.push("cleanup");
    },
  };
  const services: RenderServices = {
    checkDeliverable: () => {
      calls.push("deliverable");
    },
    checkBroll: () => {
      calls.push("broll");
    },
    retimeAudio: () => {
      calls.push("retime");
    },
    master: (file) => {
      calls.push("master");
      fs.appendFileSync(file, " mastered");
      return { status: "skipped", reason: "synthetic audio" };
    },
    probe: (format, file) => {
      calls.push("probe");
      return {
        format,
        path: file,
        width: 16,
        height: 16,
        fps: 30,
        durationSec: 0.1,
        sizeBytes: fs.statSync(file).size,
      };
    },
  };
  return { film, outPath, calls, renderer, services };
}

test("one execution visits every phase, masters before probe and records the prepared film snapshot", async (t) => {
  const f = fixture(t);
  const states: RenderState[] = [];
  const original = structuredClone(f.film);
  const job = createRenderJob(
    { film: f.film, format: "long", outPath: f.outPath, profile: "final" },
    f.renderer,
    {
      services: f.services,
      onState: (state) => {
        states.push(state);
      },
      prepareFilm: async (film) => ({ ...film, title: "Prepared title" }),
    },
  );
  assert.equal(job.state, "queued");
  f.film.title = "Changed after queueing";
  const first = job.run();
  assert.equal(first, job.run(), "repeated starts share one execution");
  const result = await first;
  assert.deepEqual(states, [
    "preparing",
    "rendering",
    "mastering",
    "probed",
    "done",
  ]);
  assert.deepEqual(f.calls, [
    "deliverable",
    "broll",
    "retime",
    "backend-prepare",
    "disk",
    "encode",
    "master",
    "probe",
    "cleanup",
  ]);
  assert.equal(fs.readFileSync(f.outPath, "utf8"), "encoded mastered");
  const sidecar = JSON.parse(
    fs.readFileSync(`${f.outPath}.render.json`, "utf8"),
  );
  assert.equal(
    sidecar.filmHash,
    renderFilmHash({ ...original, title: "Prepared title" }),
  );
  assert.equal(sidecar.filmHash, result.filmHash);
  assert.equal(sidecar.profile, "final");
  assert.deepEqual(sidecar.profilePolicy, RENDER_PROFILES.final);
  assert.equal(sidecar.output.sizeBytes, Buffer.byteLength("encoded mastered"));
  await job.cancel();
  assert.equal(
    job.state,
    "done",
    "a finished output cannot be cancelled retroactively",
  );
  assert.ok(fs.existsSync(f.outPath));
});

test("profile policy is backend-neutral and canonical hashing ignores property order", (t) => {
  const f = fixture(t);
  for (const profile of ["draft", "review", "final"] as const) {
    assert.deepEqual(RENDER_PROFILES[profile], {
      intermediate: "lossless",
      codec: "h264",
      crf: 16,
      pixelFormat: "yuv420p",
      range: "limited",
      audioCodec: "aac",
      audioBitrate: 320_000,
    });
  }
  const reordered = Object.fromEntries(
    Object.entries(f.film).reverse(),
  ) as typeof f.film;
  assert.equal(renderFilmHash(f.film), renderFilmHash(reordered));
  assert.notEqual(
    renderFilmHash(f.film),
    renderFilmHash({ ...f.film, title: "changed" }),
  );
});

for (const state of [
  "queued",
  "preparing",
  "rendering",
  "mastering",
  "probed",
] as const) {
  test(`cancel from ${state} is terminal, cleans once and removes partial output`, async (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.outPath, "partial");
    fs.writeFileSync(`${f.outPath}.master.json`, "stale");
    let job: ReturnType<typeof createRenderJob>;
    job = createRenderJob(
      { film: f.film, format: "reel", outPath: f.outPath, profile: "review" },
      f.renderer,
      {
        services: f.services,
        onState: (seen) => {
          if (seen === state) void job.cancel();
        },
      },
    );
    if (state === "queued") await job.cancel();
    await assert.rejects(job.run(), /Render cancelled/);
    assert.equal(job.state, "cancelled");
    await job.cancel();
    assert.equal(f.calls.filter((call) => call === "cleanup").length, 1);
    for (const file of [
      f.outPath,
      `${f.outPath}.render.json`,
      `${f.outPath}.master.json`,
    ])
      assert.equal(fs.existsSync(file), false);
  });
}

for (const phase of [
  "deliverable",
  "broll",
  "retime",
  "backend-prepare",
  "disk",
  "encode",
  "master",
  "probe",
  "cleanup",
] as const) {
  test(`failure in ${phase} prevents delivery and leaves one failed job`, async (t) => {
    const f = fixture(t);
    /** Supplies a concrete boundary failure through the public backend or domain-service contract. */
    const fail = () => {
      throw new Error(`${phase} failed`);
    };
    if (phase === "backend-prepare") f.renderer.prepare = fail;
    else if (phase === "disk") f.renderer.checkDiskBudget = async () => fail();
    else if (phase === "encode")
      f.renderer.render = async () => {
        fs.writeFileSync(f.outPath, "partial");
        fail();
      };
    else if (phase === "cleanup") f.renderer.cleanup = fail;
    else if (phase === "deliverable") f.services.checkDeliverable = fail;
    else if (phase === "broll") f.services.checkBroll = fail;
    else if (phase === "retime") f.services.retimeAudio = fail;
    else if (phase === "master") f.services.master = fail;
    else f.services.probe = fail;
    const job = createRenderJob(
      { film: f.film, format: "long", outPath: f.outPath, profile: "draft" },
      f.renderer,
      { services: f.services },
    );
    await assert.rejects(job.run(), new RegExp(`${phase} failed`));
    assert.equal(job.state, "failed");
    await job.cancel();
    assert.equal(job.state, "failed");
    assert.equal(fs.existsSync(f.outPath), false);
    assert.equal(fs.existsSync(`${f.outPath}.render.json`), false);
  });
}

test("missing output, pending footage and low disk are refused through the executable job interface", async (t) => {
  const f = fixture(t);
  f.renderer.render = async () => {};
  let job = createRenderJob(
    { film: f.film, format: "long", outPath: f.outPath, profile: "final" },
    f.renderer,
    { services: f.services },
  );
  await assert.rejects(job.run(), /Render failed to create output/);
  f.film.shots[0].needsFootage = true;
  const { checkBroll: _stub, ...services } = f.services;
  job = createRenderJob(
    { film: f.film, format: "long", outPath: f.outPath, profile: "final" },
    f.renderer,
    { services },
  );
  await assert.rejects(job.run(), /GPU B-Roll footage is still pending/);
  assert.equal(f.calls.includes("encode"), false);
  f.renderer.checkDiskBudget = async () => {
    throw new Error("RENDER_DISK_LOW: synthetic full disk");
  };
  job = createRenderJob(
    { film: f.film, format: "long", outPath: f.outPath, profile: "final" },
    f.renderer,
    { services: f.services },
  );
  await assert.rejects(job.run(), /RENDER_DISK_LOW/);
  assert.equal(job.state, "failed");
  assert.equal(f.calls.includes("master"), false);
});

test("impossible phase jumps and transitions out of terminal states are rejected", () => {
  assert.throws(
    () => transitionRenderJob("queued", "done"),
    /Invalid RenderJob transition/,
  );
  assert.throws(
    () => transitionRenderJob("rendering", "preparing"),
    /Invalid RenderJob transition/,
  );
  for (const terminal of ["done", "failed", "cancelled"] as const)
    assert.throws(
      () => transitionRenderJob(terminal, "rendering"),
      /Invalid RenderJob transition/,
    );
  for (const state of [
    "queued",
    "preparing",
    "rendering",
    "mastering",
    "probed",
  ] as const) {
    assert.equal(transitionRenderJob(state, "failed"), "failed");
    assert.equal(transitionRenderJob(state, "cancelled"), "cancelled");
  }
});
