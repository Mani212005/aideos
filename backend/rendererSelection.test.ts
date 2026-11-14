/**
 * File Description: Behavioural tests of the renderer choice, encoding the native renderer Phase 1 wiring decision (firstmate decision p1-wire-step0, option A: native does the real work for every film it supports, Remotion is the kill switch, refusals are logged, a native failure on a supported film is an error): `auto` is the default and draws a supported film natively; it renders a refused film on Remotion with every reason (including a missing binary, a chapter no shot belongs to and an asset with no SVG source); `remotion` keeps every film on Remotion; `native` refuses a film it cannot draw; the job-level renderer chooses on the film the job actually renders, records the renderer in the sidecar, and fails, without trying Remotion, when native fails.
 * Inputs and outputs: argument lists, environments, the synthetic scene film, fake renderers and a RenderJob with stub services -> asserted choices, reasons, sidecars and failures.
 * Used by: npm test (Node test runner).
 */

import "./testSupport/fixtureVideosDir";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSelectedRenderer, rendererModeFromEnv, requestedRenderer, selectRenderer } from "./rendererSelection";
import { createRenderJob, type Renderer, type RenderServices } from "./renderJob";
import { nativeSceneFilm } from "./testSupport/nativeSceneFilm";

/** A renderer stand-in that writes a file on render, tagged with a name, plus a log of which factories ran. */
function factories(options: { nativeFails?: boolean } = {}) {
  const made: string[] = [];
  const make = (name: "remotion" | "native") => () => {
    made.push(name);
    return {
      name,
      profileSettingsApplied: { codec: true },
      checkDiskBudget: async () => {},
      render: async (request) => {
        if (name === "native" && options.nativeFails) throw new Error("aideos-render exited with code 1: frame 3 was refused");
        fs.writeFileSync(request.outPath, `${name} mp4`);
      },
    } as Renderer;
  };
  return { made, remotion: make("remotion"), native: make("native") };
}

/** Stub delivery services so a RenderJob runs without ffmpeg. */
const services: RenderServices = {
  checkDeliverable: () => {},
  checkBroll: () => {},
  retimeAudio: () => {},
  master: () => ({ status: "skipped", reason: "stub" }),
  probe: (format, file) => ({ format, path: file, width: 1920, height: 1080, fps: 30, durationSec: 2, sizeBytes: fs.statSync(file).size }),
};

/** A throwaway output path. */
function outPath(t: test.TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-selection-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "renders", "long.mp4");
}

test("auto is the default; remotion and native are asked for by the flag or the environment", () => {
  assert.deepEqual(requestedRenderer([], {}), { name: "auto", rest: [] });
  assert.equal(rendererModeFromEnv({}), "auto");
  assert.equal(rendererModeFromEnv({ AIDEOS_RENDERER: "remotion" }), "remotion");
  assert.equal(requestedRenderer([], { AIDEOS_RENDERER: "native" }).name, "native");
  assert.deepEqual(requestedRenderer(["--concurrency=2", "--renderer", "native", "--log=verbose"], { AIDEOS_RENDERER: "remotion" }), {
    name: "native",
    rest: ["--concurrency=2", "--log=verbose"],
  });
  assert.equal(requestedRenderer(["--renderer=remotion"], { AIDEOS_RENDERER: "native" }).name, "remotion", "the argument wins over the environment");
  assert.throws(() => requestedRenderer(["--renderer", "chrome"], {}), /Unknown renderer "chrome"/);
  assert.throws(() => rendererModeFromEnv({ AIDEOS_RENDERER: "chrome" }), /Unknown renderer "chrome"/);
  assert.throws(() => requestedRenderer(["--renderer"], {}), /needs a value/);
});

test("auto draws a supported film natively when the binary is built", () => {
  const f = factories();
  const choice = selectRenderer(nativeSceneFilm(), "reel", "auto", f, { binaryProblem: () => null });
  assert.equal(choice.name, "native");
  assert.equal(choice.fallbackReason, undefined);
  assert.deepEqual(f.made, ["native"]);
});

test("auto renders a refused film on Remotion with every reason native cannot draw it", () => {
  const f = factories();
  const film = nativeSceneFilm({ music: { src: "videos/native-probe/music.mp3", volume: 1 } });
  const choice = selectRenderer(film, "long", "auto", f, { binaryProblem: () => "the native renderer binary is not built" });
  assert.equal(choice.name, "remotion");
  assert.match(choice.fallbackReason ?? "", /legacy music/);
  assert.match(choice.fallbackReason ?? "", /binary is not built/);
  assert.deepEqual(f.made, ["remotion"], "the native renderer is never constructed");
});

test("a chapter with no shots or an asset with no SVG source renders on Remotion instead of failing the render", () => {
  const base = nativeSceneFilm();
  const film = nativeSceneFilm({ chapters: [...base.chapters, "Unreached"] });
  const scene = film.scene as { props: Array<{ svgSource?: string }> };
  delete scene.props[0].svgSource;
  const f = factories();
  const choice = selectRenderer(film, "long", "auto", f, { binaryProblem: () => null });
  assert.equal(choice.name, "remotion");
  assert.match(choice.fallbackReason ?? "", /chapters with no shots cannot be drawn on the native rail: Unreached/);
  assert.match(choice.fallbackReason ?? "", /asset probe has no SVG source/);
  assert.deepEqual(f.made, ["remotion"]);
});

test("remotion is the kill switch: a supported film stays on Remotion", () => {
  const f = factories();
  const choice = selectRenderer(nativeSceneFilm(), "long", "remotion", f, { binaryProblem: () => null });
  assert.equal(choice.name, "remotion");
  assert.equal(choice.fallbackReason, undefined);
  assert.deepEqual(f.made, ["remotion"]);
});

test("native is required when asked for: a film it cannot draw is refused with every reason and nothing renders", () => {
  const f = factories();
  const film = nativeSceneFilm({ music: { src: "videos/native-probe/music.mp3", volume: 1 } });
  assert.throws(
    () => selectRenderer(film, "long", "native", f, { binaryProblem: () => "the native renderer binary is not built" }),
    (error: Error) => /AIDEOS_RENDERER=native/.test(error.message) && /legacy music/.test(error.message) && /binary is not built/.test(error.message),
  );
  assert.deepEqual(f.made, []);
});

test("a render job chooses on the film it actually renders and records the renderer in its sidecar", async (t) => {
  for (const [label, prepared, expected] of [
    ["supported", nativeSceneFilm(), "native"],
    ["refused after preparation", nativeSceneFilm({ music: { src: "videos/native-probe/music.mp3", volume: 1 } }), "remotion"],
  ] as const) {
    const f = factories();
    const messages: string[] = [];
    const out = outPath(t);
    const renderer = createSelectedRenderer({ mode: "auto", ...f, binaryProblem: () => null, onChoice: (_c, message) => messages.push(message) });
    // The job renders the prepared film, not the one it was handed.
    await createRenderJob({ film: nativeSceneFilm(), format: "long", outPath: out, profile: "final" }, renderer, { services, prepareFilm: async () => prepared }).run();
    assert.equal(fs.readFileSync(out, "utf8"), `${expected} mp4`, label);
    assert.deepEqual(f.made, [expected], label);
    const sidecar = JSON.parse(fs.readFileSync(`${out}.render.json`, "utf8"));
    assert.equal(sidecar.renderer, expected, label);
    assert.equal(sidecar.profileSettingsApplied.codec, true, `${label}: the chosen renderer's applied settings are recorded`);
    assert.equal(messages.length, 1, label);
    if (expected === "remotion") assert.match(messages[0], /Remotion renders "native-probe"; the native renderer cannot: .*legacy music/);
    else assert.match(messages[0], /native renderer draws "native-probe"/);
  }
});

test("a native failure on a supported film fails the job and never falls back to Remotion", async (t) => {
  const f = factories({ nativeFails: true });
  const out = outPath(t);
  const renderer = createSelectedRenderer({ mode: "auto", ...f, binaryProblem: () => null });
  await assert.rejects(
    createRenderJob({ film: nativeSceneFilm(), format: "long", outPath: out, profile: "final" }, renderer, { services }).run(),
    /frame 3 was refused/,
  );
  assert.deepEqual(f.made, ["native"]);
  assert.equal(fs.existsSync(out), false);
});
