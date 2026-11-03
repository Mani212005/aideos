/**
 * File Description: Tests for the opt-in hold push-in. With the option off no existing film's camera changes by
 * a bit; with it on every hold creeps in by 1 to 3 percent, smoothly, inside the design-check camera caps, in
 * both formats, and every authored pose is still landed on exactly.
 * Inputs and outputs: package films and synthetic camera tracks -> compiled camera curves and design-check reports.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { camAt, buildTimeline, lookBox, solveCam, type Cam } from "../src/dl/camera";
import { easeExpo, MS } from "../src/dl/motion";
import { parseFilm, type Film } from "../src/dl/schema";
import { compileCameraTrack, measureCameraMotion, CAMERA_ZOOM_STEP_CEILING } from "../src/dl/scene/cameraTrack";
import { MAX_HOLD_PUSH } from "../src/dl/holdPush";
import type { CameraTrack } from "../src/dl/scene/types";
import { checkFilmDesign, MAX_CAMERA_PAN_ACCEL_WIDTHS } from "./designCheck/designCheck";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";
import { TEST_VIDEOS_DIR } from "./testSupport/fixtureVideosDir";

const SIZE = { w: 1920, h: 1920 };
const FPS = 30;
const FORMATS = [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }];

// Reads one package film from the throwaway fixture videos directory.
function packageFilm(slug: string): any {
  return JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, slug, "film.json"), "utf8"));
}

// A move, a long hold, a move, a short hold and a move: the shape of a designed film's camera.
const track = (holdPush?: number): CameraTrack => ({
  keyframes: [
    { frame: 0, center: { x: 960, y: 960 }, zoom: 1 },
    { frame: 90, center: { x: 700, y: 800 }, zoom: 1.4 },
    { frame: 300, center: { x: 700, y: 800 }, zoom: 1.4 },
    { frame: 400, center: { x: 1100, y: 900 }, zoom: 1.2 },
    { frame: 460, center: { x: 1100, y: 900 }, zoom: 1.2 },
    { frame: 560, center: { x: 960, y: 960 }, zoom: 1 },
    { frame: 899, center: { x: 960, y: 960 }, zoom: 1 },
  ],
  ...(holdPush === undefined ? {} : { holdPush }),
});

// Verifies the option off leaves every held frame at the exact authored pose, so a still hold is still still.
test("hold push off: a held camera keeps the exact authored pose on every frame", () => {
  const curves = compileCameraTrack(track(), 900, SIZE, FPS);
  for (let f = 90; f <= 300; f++) assert.deepEqual(curves[f], { center: { x: 700, y: 800 }, zoom: 1.4, rotation: 0 }, `frame ${f}`);
  for (let f = 560; f < 900; f++) assert.equal(curves[f].zoom, 1);
});

// Verifies a package film that never asked for the push parses with no push and compiles to the same curves as an explicit zero.
test("hold push off: no package or fixture film carries the option, so none is changed", () => {
  for (const slug of fs.readdirSync(TEST_VIDEOS_DIR).filter((name) => fs.existsSync(path.join(TEST_VIDEOS_DIR, name, "film.json")))) {
    const film = parseFilm(packageFilm(slug));
    assert.equal(film.scene?.camera?.holdPush, undefined, slug);
    assert.ok(film.shots.every((s) => s.holdPush === undefined), slug);
    if (film.scene?.camera) {
      const off = compileCameraTrack(film.scene.camera, film.scene.durationFrames, film.scene.sceneSize, film.scene.fps);
      const zero = compileCameraTrack({ ...film.scene.camera, holdPush: 0 }, film.scene.durationFrames, film.scene.sceneSize, film.scene.fps);
      assert.deepEqual(zero, off, slug);
    }
  }
});

// The node-graph camera exactly as it was before the push-in existed, kept here as the reference the off case must match.
function referenceCamAt(film: Film, frame: number, frameSize: { width: number; height: number }): Cam {
  const timeline = buildTimeline(film);
  const current = timeline.find((t) => frame < t.to) ?? timeline[timeline.length - 1];
  const target = solveCam(lookBox(film, current.shot), frameSize, current.shot.zoom);
  const previous = current.index > 0 ? timeline[current.index - 1] : null;
  const moveFrames = (MS.move / 1000) * film.fps;
  if (previous && current.shot.move !== "cut" && frame < current.from + moveFrames) {
    const start = solveCam(lookBox(film, previous.shot), frameSize, previous.shot.zoom);
    const p = easeExpo((frame - current.from) / moveFrames);
    return {
      cx: start.cx + (target.cx - start.cx) * p,
      cy: start.cy + (target.cy - start.cy) * p,
      ppu: Math.exp(Math.log(start.ppu) + (Math.log(target.ppu) - Math.log(start.ppu)) * p),
    };
  }
  return target;
}

// Verifies the node-graph camera is bit-for-bit the old one on every frame of every canvas film, in both formats, when no shot opts in.
test("hold push off: the node-graph camera is unchanged on every frame of every canvas film in both formats", () => {
  const films = [parseFilm(packageFilm("sample-explainer")), loadFixtureFilm("fixture-canvas-a"), loadFixtureFilm("fixture-canvas-b"), loadFixtureFilm("fixture-canvas-c")];
  for (const film of films) {
    const timeline = buildTimeline(film);
    const frames = timeline[timeline.length - 1].to;
    for (const size of FORMATS) {
      for (let f = 0; f < frames; f++) assert.deepEqual(camAt(film, timeline, f, size), referenceCamAt(film, f, size), `${film.id} ${size.width}x${size.height} frame ${f}`);
    }
  }
});

// Verifies the push on a scene track: bounded 1 to 3 percent, zoom only, rising smoothly, landing every authored pose exactly.
test("hold push on: a scene camera pushes 1 to 3 percent over each hold, about its own centre, and lands on every authored pose", () => {
  const off = compileCameraTrack(track(), 900, SIZE, FPS);
  const on = compileCameraTrack(track(0.03), 900, SIZE, FPS);
  assert.equal(on.length, off.length);
  let peak = 0;
  for (let f = 0; f < off.length; f++) {
    assert.deepEqual(on[f].center, off[f].center, `frame ${f} centre moved`);
    assert.equal(on[f].rotation, off[f].rotation);
    assert.ok(on[f].zoom >= off[f].zoom - 1e-12, `frame ${f} zoomed out`);
    peak = Math.max(peak, on[f].zoom / off[f].zoom - 1);
  }
  assert.ok(peak <= MAX_HOLD_PUSH + 1e-9 && peak > 0.02, `peak push ${peak}`);
  // The long hold gets the full amount at its end; the film's first and last frames and every move landing are the authored pose.
  assert.ok(Math.abs(on[300].zoom / off[300].zoom - 1.03) < 1e-9, "long hold did not reach 3%");
  for (const f of [0, 90, 400, 560]) assert.deepEqual(on[f], off[f], `frame ${f} is an authored pose and moved`);
  // The film's closing hold is pushed too, and simply ends at the end of the film.
  assert.ok(Math.abs(on[899].zoom - 1.03) < 1e-9);
  // A shorter hold is pushed less, so the pace stays slow.
  assert.ok(on[460].zoom / off[460].zoom < on[300].zoom / off[300].zoom);
});

// Verifies the push never leaves a hold's motion in a jerk: no velocity jump.
test("hold push on: the push rises smoothly", () => {
  const on = compileCameraTrack(track(0.03), 900, SIZE, FPS);
  const logStep = (f: number) => Math.log(on[f].zoom / on[f - 1].zoom);
  for (let f = 92; f <= 300; f++) {
    assert.ok(logStep(f) >= -1e-12, `hold frame ${f} zoomed out`);
    assert.ok(Math.abs(logStep(f) - logStep(f - 1)) < 5e-5, `frame ${f} jerks the push by ${Math.abs(logStep(f) - logStep(f - 1))}`);
  }
});

// Verifies a hold too short to push is left alone, and a push never adds to a move already at the zoom-step ceiling.
test("hold push on: short holds stay still and the push never breaks the camera caps", () => {
  const brisk: CameraTrack = { holdPush: 0.03, keyframes: [
    { frame: 0, center: { x: 960, y: 960 }, zoom: 1 },
    { frame: 40, center: { x: 960, y: 960 }, zoom: 1 },
    { frame: 56, center: { x: 960, y: 960 }, zoom: 2.2 },
    { frame: 150, center: { x: 960, y: 960 }, zoom: 2.2 },
    { frame: 899, center: { x: 960, y: 960 }, zoom: 2.2 },
  ] };
  const { holdPush: _unused, ...bare } = brisk;
  void _unused;
  const base = measureCameraMotion(compileCameraTrack(bare, 900, SIZE, FPS), FPS);
  const pushed = measureCameraMotion(compileCameraTrack(brisk, 900, SIZE, FPS), FPS);
  assert.ok(pushed.peakZoomStep <= Math.max(CAMERA_ZOOM_STEP_CEILING, base.peakZoomStep) + 1e-12, `push raised the zoom step to ${pushed.peakZoomStep}`);
  assert.ok(pushed.peakPanSpeed === base.peakPanSpeed && pushed.peakPanAccel === base.peakPanAccel, "the push moved the centre");
  const shortHold = compileCameraTrack({ holdPush: 0.03, keyframes: [{ frame: 0, center: { x: 960, y: 960 }, zoom: 1 }, { frame: 10, center: { x: 960, y: 960 }, zoom: 1 }, { frame: 20, center: { x: 900, y: 960 }, zoom: 1 }, { frame: 80, center: { x: 900, y: 960 }, zoom: 1 }] }, 100, SIZE, FPS);
  assert.ok(shortHold.slice(0, 11).every((c) => c.zoom === 1), "a hold under a second was pushed");
});

// Verifies a real designed film stays clean on both formats with the push on, holds counted, no new camera, inset or safe-area finding.
test("hold push on: a designed scene film's design check reports nothing new, in both formats", () => {
  const film = packageFilm("speculative-decoding-designed");
  const before = checkFilmDesign(film, { formats: ["long", "reel"] }).findings;
  film.scene.camera.holdPush = 0.03;
  const after = checkFilmDesign(film, { formats: ["long", "reel"] }).findings;
  assert.deepEqual(after, before);
  for (const format of ["long", "reel"] as const) {
    const only = checkFilmDesign(film, { formats: [format] }).findings;
    assert.deepEqual(only.filter((f) => f.rule === "camera" || f.rule === "inset" || f.rule === "safe-area"), before.filter((f) => f.rule === "camera" || f.rule === "inset" || f.rule === "safe-area"), format);
  }
  const compiled = compileCameraTrack(film.scene.camera, film.scene.durationFrames, film.scene.sceneSize, film.scene.fps);
  // A waypoint the camera only passes through (not a hold) is still the authored pose, even far into a long move.
  const bare = compileCameraTrack({ keyframes: film.scene.camera.keyframes }, film.scene.durationFrames, film.scene.sceneSize, film.scene.fps);
  assert.deepEqual(compiled[2229], bare[2229]);
  const stats = measureCameraMotion(compiled, film.scene.fps);
  assert.ok(stats.peakZoomStep <= CAMERA_ZOOM_STEP_CEILING);
  assert.ok(stats.peakPanAccel <= film.scene.sceneSize.w * MAX_CAMERA_PAN_ACCEL_WIDTHS);
});

// Verifies the node-graph push on a shot: only that shot's hold zooms, in both formats, and the next move starts from where it ended.
test("hold push on: a node-graph shot pushes 1 to 3 percent, inside the hold, in both formats, with no snap into the next move", () => {
  const base = parseFilm(packageFilm("sample-explainer"));
  const film: Film = { ...base, shots: base.shots.map((s, i) => (i === 2 ? { ...s, holdPush: 0.02 } : s)) };
  const timeline = buildTimeline(film);
  const t = timeline[2];
  const moveFrames = Math.ceil((MS.move / 1000) * film.fps);
  assert.ok(timeline[3].shot.move !== "cut", "the shot after the pushed one must move, not cut, for this case");
  for (const size of FORMATS) {
    // Every frame before the pushed shot's hold is the old camera exactly; so is every frame after the next move has settled.
    for (let f = 0; f < t.from + moveFrames; f++) assert.deepEqual(camAt(film, timeline, f, size), referenceCamAt(film, f, size), `frame ${f} before the hold changed`);
    for (let f = timeline[3].from + moveFrames; f < timeline[timeline.length - 1].to; f++) assert.deepEqual(camAt(film, timeline, f, size), referenceCamAt(film, f, size), `frame ${f} after the move changed`);
    const last = camAt(film, timeline, t.to - 1, size);
    const push = last.ppu / referenceCamAt(film, t.to - 1, size).ppu - 1;
    assert.ok(push > 0.005 && push <= 0.02 + 1e-9, `push ${push}`);
    for (let f = t.from + moveFrames + 1; f < t.to; f++) {
      const step = Math.abs(camAt(film, timeline, f, size).ppu / camAt(film, timeline, f - 1, size).ppu - 1);
      assert.ok(step < CAMERA_ZOOM_STEP_CEILING, `hold frame ${f} zooms ${step} in one frame`);
    }
    // The move out leaves from the pushed camera, so the first frame of the next shot continues from it instead of snapping back.
    assert.ok(Math.abs(camAt(film, timeline, timeline[3].from, size).ppu / last.ppu - 1) < 1e-12, "the next move did not start from the pushed camera");
  }
});
