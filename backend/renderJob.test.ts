/**
 * File Description: Behavioral tests of the renderer-neutral job lifecycle and output provenance using short synthetic encoders.
 * Inputs and outputs: public job calls, injected backend failures and small fixture films -> states, files and failure assertions.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  let attemptOutput: string | undefined;
  const renderer: Renderer = {
    prepare: () => {
      calls.push("backend-prepare");
    },
    checkDiskBudget: async () => {
      calls.push("disk");
    },
    render: async (request) => {
      calls.push("encode");
      attemptOutput = request.outPath;
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
      fs.writeFileSync(`${file}.master.json`, "attempt master report");
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
  return { film, outPath, calls, renderer, services, attemptOutput: () => attemptOutput };
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

test("sidecar distinguishes requested profile from probed output and unapplied settings", async (t) => {
  const f = fixture(t);
  const renderer: Renderer = {
    ...f.renderer,
    profileSettingsApplied: {
      intermediate: false,
      codec: false,
      crf: false,
      pixelFormat: false,
      range: false,
      audioCodec: false,
      audioBitrate: false,
    },
  };
  const job = createRenderJob(
    { film: f.film, format: "long", outPath: f.outPath, profile: "final" },
    renderer,
    {
      services: {
        ...f.services,
        probe: (format, file) => ({
          format,
          path: file,
          width: 16,
          height: 16,
          fps: 30,
          durationSec: 0.1,
          sizeBytes: fs.statSync(file).size,
          videoStream: {
            codec: "h264",
            pixelFormat: "yuvj420p",
            colorRange: "full",
          },
        }),
      },
    },
  );

  await job.run();

  const sidecar = JSON.parse(fs.readFileSync(`${f.outPath}.render.json`, "utf8"));
  assert.deepEqual(sidecar.profilePolicy, RENDER_PROFILES.final);
  assert.deepEqual(sidecar.profileSettingsApplied, {
    intermediate: false,
    codec: false,
    crf: false,
    pixelFormat: false,
    range: false,
    audioCodec: false,
    audioBitrate: false,
  });
  assert.deepEqual(sidecar.output.videoStream, {
    codec: "h264",
    pixelFormat: "yuvj420p",
    colorRange: "full",
  });
});

test("sidecar marks profile settings applied when the renderer reports applying them", async (t) => {
  const f = fixture(t);
  const applied = {
    intermediate: true,
    codec: true,
    crf: true,
    pixelFormat: true,
    range: true,
    audioCodec: true,
    audioBitrate: true,
  };
  const renderer: Renderer = {
    ...f.renderer,
    profileSettingsApplied: applied,
  };
  const job = createRenderJob(
    { film: f.film, format: "long", outPath: f.outPath, profile: "final" },
    renderer,
    {
      services: {
        ...f.services,
        probe: (format, file) => ({
          format,
          path: file,
          width: 16,
          height: 16,
          fps: 30,
          durationSec: 0.1,
          sizeBytes: fs.statSync(file).size,
          videoStream: {
            codec: "h264",
            pixelFormat: "yuv420p",
            colorRange: "limited",
          },
        }),
      },
    },
  );

  await job.run();

  const sidecar = JSON.parse(fs.readFileSync(`${f.outPath}.render.json`, "utf8"));
  assert.deepEqual(sidecar.profileSettingsApplied, applied);
  assert.deepEqual(sidecar.output.videoStream, {
    codec: "h264",
    pixelFormat: "yuv420p",
    colorRange: "limited",
  });
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
  test(`cancel from ${state} is terminal and removes only attempt output`, async (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.outPath, "previous render");
    fs.writeFileSync(`${f.outPath}.render.json`, "previous sidecar");
    fs.writeFileSync(`${f.outPath}.master.json`, "previous master report");
    const job: ReturnType<typeof createRenderJob> = createRenderJob(
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
    assert.equal(fs.readFileSync(f.outPath, "utf8"), "previous render");
    if (f.attemptOutput()) assert.equal(fs.existsSync(f.attemptOutput()!), false);
    assert.equal(
      fs.readFileSync(`${f.outPath}.render.json`, "utf8"),
      "previous sidecar",
    );
    assert.equal(
      fs.readFileSync(`${f.outPath}.master.json`, "utf8"),
      "previous master report",
    );
  });
}

test("preflight failure preserves an earlier render and its metadata", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.outPath, "previous render");
  fs.writeFileSync(`${f.outPath}.render.json`, "previous sidecar");
  fs.writeFileSync(`${f.outPath}.master.json`, "previous master report");
  f.services.checkDeliverable = () => {
    throw new Error("preflight failed");
  };
  const job = createRenderJob(
    { film: f.film, format: "long", outPath: f.outPath, profile: "final" },
    f.renderer,
    { services: f.services },
  );

  await assert.rejects(job.run(), /preflight failed/);
  assert.equal(fs.readFileSync(f.outPath, "utf8"), "previous render");
  assert.equal(
    fs.readFileSync(`${f.outPath}.render.json`, "utf8"),
    "previous sidecar",
  );
  assert.equal(
    fs.readFileSync(`${f.outPath}.master.json`, "utf8"),
    "previous master report",
  );
});

test("a failed concurrent attempt cannot remove another job's published artifacts", async (t) => {
  const f = fixture(t);
  let resumePreflight: (error: Error) => void = () => {};
  let enteredPreflight: () => void = () => {};
  const reachedPreflight = new Promise<void>((resolve) => {
    enteredPreflight = resolve;
  });
  const blockedRenderer: Renderer = {
    ...f.renderer,
    checkDiskBudget: () =>
      new Promise<void>((_resolve, reject) => {
        resumePreflight = reject;
        enteredPreflight();
      }),
  };
  const blocked = createRenderJob(
    { film: f.film, format: "long", outPath: f.outPath, profile: "review" },
    blockedRenderer,
    { services: f.services },
  );
  const failed = blocked.run();
  await reachedPreflight;

  const successful = createRenderJob(
    { film: f.film, format: "long", outPath: f.outPath, profile: "final" },
    f.renderer,
    { services: f.services },
  );
  await successful.run();
  const output = fs.readFileSync(f.outPath, "utf8");
  const sidecar = fs.readFileSync(`${f.outPath}.render.json`, "utf8");
  const masterReport = fs.readFileSync(`${f.outPath}.master.json`, "utf8");
  resumePreflight(new Error("blocked attempt failed"));
  await assert.rejects(failed, /blocked attempt failed/);

  assert.equal(fs.readFileSync(f.outPath, "utf8"), output);
  assert.equal(fs.readFileSync(`${f.outPath}.render.json`, "utf8"), sidecar);
  assert.equal(fs.readFileSync(`${f.outPath}.master.json`, "utf8"), masterReport);
});

test("separate render processes publish matching artifacts with a stale lock file", async (t) => {
  const f = fixture(t);
  const release = path.join(path.dirname(f.outPath), "release-publishers");
  const lockPath = `${path.resolve(f.outPath)}.publish.lock`;
  fs.writeFileSync(lockPath, "");
  const stale = new Date(Date.now() - 5000);
  fs.utimesSync(lockPath, stale, stale);
  const worker = `
    import fs from "node:fs";
    import { createRenderJob } from "./backend/renderJob.ts";
    import { loadFixtureFilm } from "./backend/testSupport/fixtureFilms.ts";
    const [outPath, name, dir] = process.argv.slice(1);
    const film = loadFixtureFilm("fixture-canvas-a");
    film.title = name;
    const renderer = {
      checkDiskBudget: async () => {},
      render: async (request) => {
        fs.writeFileSync(request.outPath, name);
        fs.writeFileSync(dir + "/ready-" + name, "ready");
        while (!fs.existsSync(dir + "/release-publishers"))
          await new Promise((resolve) => setTimeout(resolve, 5));
      },
    };
    const services = {
      checkDeliverable: () => {}, checkBroll: () => {}, retimeAudio: () => {},
      master: (file) => {
        fs.writeFileSync(file + ".master.json", name);
        return { status: "skipped", reason: "fixture" };
      },
      probe: (format, file) => ({ format, path: file, width: 16, height: 16, fps: 30, durationSec: 1, sizeBytes: fs.statSync(file).size }),
    };
    await createRenderJob({ film, format: "long", outPath, profile: "final" }, renderer, { services }).run();
  `;
  t.after(() => fs.rmSync(path.dirname(f.outPath), { recursive: true, force: true }));
  const children = (["alpha", "beta"] as const).map((name) =>
    spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", worker, f.outPath, name, path.dirname(f.outPath)],
      { cwd: process.cwd(), stdio: ["ignore", "ignore", "inherit"] },
    ),
  );
  t.after(() => {
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGKILL");
  });
  const closed = children.map(
    (child) =>
      new Promise<number | null>((resolve) =>
        child.once("close", (code) => resolve(code)),
      ),
  );
  const deadline = Date.now() + 8000;
  while (
    !["alpha", "beta"].every((name) =>
      fs.existsSync(path.join(path.dirname(f.outPath), `ready-${name}`)),
    )
  ) {
    if (Date.now() > deadline) assert.fail("render processes did not reach publication");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  fs.writeFileSync(release, "release");
  const codes = await Promise.all(closed);
  assert.deepEqual(codes, [0, 0]);

  const video = fs.readFileSync(f.outPath, "utf8");
  const sidecar = JSON.parse(fs.readFileSync(`${f.outPath}.render.json`, "utf8"));
  const masterReport = fs.readFileSync(`${f.outPath}.master.json`, "utf8");
  assert.ok(video === "alpha" || video === "beta");
  assert.equal(masterReport, video);
  assert.equal(
    sidecar.filmHash,
    renderFilmHash({ ...f.film, title: video }),
  );
  assert.equal(sidecar.output.sizeBytes, Buffer.byteLength(video));
});

test("a job proceeds past an abandoned lock file before initialization", { timeout: 8000 }, async (t) => {
  const f = fixture(t);
  const lockPath = `${path.resolve(f.outPath)}.publish.lock`;
  fs.writeFileSync(lockPath, "");
  const stale = new Date(Date.now() - 5000);
  fs.utimesSync(lockPath, stale, stale);
  const job = createRenderJob(
    { film: f.film, format: "long", outPath: f.outPath, profile: "final" },
    f.renderer,
    { services: f.services },
  );

  await job.run();
  assert.equal(job.state, "done");
  assert.ok(fs.existsSync(f.outPath));
  assert.equal(fs.existsSync(lockPath), true);
});

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
      f.renderer.render = async (request) => {
        fs.writeFileSync(request.outPath, "partial");
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
