/**
 * File Description: Behavioural coverage of the stretched camera glide at dropped reel shots, on a short synthetic scene film.
 * Inputs and outputs: a generated eight-shot package whose long camera pans across two dropped shots, cuts and measured narration stubs -> compiled reels measured with the design check camera rule.
 * Used by: npm test.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";
import { parseFilm, type Film } from "../../src/dl/schema";
import { compileCameraTrack, measureCameraMotion } from "../../src/dl/scene/cameraTrack";
import { buildCaptionsVtt, type ProduceAudioResult } from "../audio";
import { compileDesign, narrationTimingForFilm } from "../designSpec/compile";
import { designSpecSchema, type DesignSpec } from "../designSpec/spec";
import { MAX_CAMERA_PAN_ACCEL_WIDTHS, MAX_CAMERA_PAN_WIDTHS, MAX_CAMERA_ZOOM_STEP } from "../designCheck/designCheck";
import { createReelContext } from "./constraints";
import { compileReel } from "./build";
import type { ReelCut } from "./schema";
import { FAKE_OWNER_BACKEND_NAME, FAKE_OWNER_VOICE_ID } from "../testSupport/fakeVcd";

const SLUG = "reel-splice-glide-fixture";
const SHOTS = 8;
const LONG_SHOT_SEC = 10;
const KEPT_SEC = 6.5;
const SOURCE = path.resolve(__dirname, "../../test_fixtures/packages/speculative-decoding-designed");
/** The two dropped shots carry the pan between the left pose and the right pose. */
const DROPS = [3, 4];

// Returns the zero-padded shot id of the one-based index.
const id = (n: number) => `s${String(n).padStart(2, "0")}`;
// Returns a number-free narration line for a shot so the reel number checks stay out of the way.
const line = (n: number) => `The cargo ${["crosses", "leaves", "reaches", "passes", "climbs", "skips"][n % 6]} the ${["road", "gate", "bridge", "hill", "bank", "bay"][n % 6]} while the reader waits patiently here.`;

// Makes a measured narration spine with exact shot boundaries for the real cue matcher.
function narration(texts: string[], durations: number[]): ProduceAudioResult {
  let cursor = 0;
  const segments = texts.map((text, index) => {
    const startOffset = cursor, duration = durations[index];
    const tokens = text.split(/\s+/);
    const words = tokens.map((word, k) => ({ word, punctuated_word: word, start: k * duration / tokens.length, end: (k + 1) * duration / tokens.length }));
    cursor += duration;
    return { text, duration, startOffset, words, utterances: [] };
  });
  const words = segments.flatMap((s) => s.words.map((w) => ({ ...w, start: s.startOffset + w.start, end: s.startOffset + w.end })));
  return { segments, words, shotDurations: durations, totalAudioDuration: cursor, captionsVttContent: buildCaptionsVtt(words), ttsBackend: FAKE_OWNER_BACKEND_NAME, voice: FAKE_OWNER_VOICE_ID, speed: 0.75,
    voiceoverPath: "voiceover.wav", wordsPath: "voiceover_words.json", captionsPath: "captions.vtt" };
}

type Pose = DesignSpec["camera"] extends infer C ? (C extends Array<infer P> ? P : never) : never;

/** The camera poses of the fixture: hold left, glide right (cued on the dropped span's far side), hold right, then settle. */
const POSES: Pose[] = [
  { id: "left", at: "s01", center: [500, 1290], zoom: 1.8 },
  { id: "left-hold", at: "s02@end", center: [500, 1290], zoom: 1.8 },
  { id: "right", at: "s05", center: [1400, 1290], zoom: 1.6 },
  { id: "right-hold", at: "s06@0.5", center: [1400, 1290], zoom: 1.6 },
  { id: "settle", at: "s08@0.3", center: [960, 960], zoom: 1 },
];

// Builds the long film, its design and the package artwork; the pan happens inside the two dropped shots in the long film.
function fixture(poses: Pose[] = POSES): { long: Film; base: Film; spec: DesignSpec; pkg: string } {
  const pkg = path.join(TEST_VIDEOS_DIR, SLUG);
  fs.rmSync(pkg, { recursive: true, force: true });
  fs.mkdirSync(path.join(pkg, "visuals"), { recursive: true });
  for (const file of ["canvas", "road", "memory"]) fs.copyFileSync(path.join(SOURCE, `visuals/${file}.svg`), path.join(pkg, `visuals/${file}.svg`));
  const template = parseFilm(loadFixtureFilm("fixture-canvas-a"));
  const base: Film = { ...template, id: SLUG, scene: undefined, voiceover: { src: `videos/${SLUG}/voiceover.wav`, volume: 1, durationSec: SHOTS * LONG_SHOT_SEC },
    shots: Array.from({ length: SHOTS }, (_, i) => ({ ...template.shots[0], id: id(i + 1), dur: LONG_SHOT_SEC, look: "all", stage: "none" as const, blocks: [], scriptText: line(i) })) };
  const audio = narration(base.shots.map((s) => s.scriptText ?? ""), base.shots.map((s) => s.dur));
  const spec = designSpecSchema.parse({
    brief: { concept: "A cargo crosses a road while the camera glides between two views." },
    assets: [{ id: "road", file: "visuals/road.svg", position: [1300, 1215], scale: 0.9, layer: 1 }, { id: "memory", file: "visuals/memory.svg", position: [700, 1215], scale: 0.9, layer: 2 }],
    camera: poses,
    clips: [
      ...Array.from({ length: SHOTS }, (_, i) => ({ id: `cargo-${i + 1}`, asset: "road", targets: ["cargo"], property: "translateX", from: 40 * i, to: 40 * (i + 1), start: id(i + 1), end: `${id(i + 1)}@end`, easing: "linear" })),
      ...[0, 2, 4, 6].map((i) => ({ id: `glow-${i / 2 + 1}`, asset: "road", targets: ["road-glow"], property: "drawOn", from: 0.15 * (i / 2), to: 0.15 * (i / 2 + 1), start: id(i + 1), end: `${id(i + 1)}+24`, easing: "linear" })),
      ...Array.from({ length: SHOTS }, (_, i) => ({ id: `scan-${i + 1}`, asset: "memory", targets: ["read-scan"], property: "translateY", from: i % 2 ? 150 : 0, to: i % 2 ? 0 : 150, start: id(i + 1), end: `${id(i + 1)}@end`, easing: "linear" })),
    ],
  });
  const compiled = compileDesign(base, spec, audio.words, "hand-built");
  assert.ok(compiled.film, JSON.stringify(compiled.errors));
  fs.writeFileSync(path.join(pkg, "film.json"), JSON.stringify(compiled.film));
  return { long: compiled.film, base, spec, pkg };
}

// Builds a checked cut that drops the named shots, with the splice marker when one is given.
function cutDropping(long: Film, drops: number[], splice?: ReelCut["splice"]): ReelCut {
  const context = createReelContext({ film: long });
  return { schema: "aideos.reelcut/1", source: "agent", long: { shots: Object.fromEntries(context.shots.map((s) => [s.id, s.hash])) }, ...(splice ? { splice } : {}),
    shots: context.shots.map((s, i) => drops.includes(i + 1) ? { id: s.id, drop: true as const, reason: "restates the previous shot" } : { id: s.id, narration: s.narration }) };
}

// Compiles a cut with each kept shot narrated for its own seconds (one number applies to every kept shot).
function compile(f: ReturnType<typeof fixture>, cut: ReelCut, sec: number | number[] = KEPT_SEC) {
  const kept = cut.shots.filter((s) => !("drop" in s));
  const durations = kept.map((_, i) => Array.isArray(sec) ? sec[i] : sec);
  return compileReel({ long: f.long, base: f.base, cut, spec: f.spec, pkg: f.pkg, narration: narration(kept.map((s) => ("narration" in s ? s.narration : "")), durations) });
}

// Measures the camera of a compiled film exactly as the design check does.
function measure(film: Film) {
  const scene = film.scene!;
  return measureCameraMotion(compileCameraTrack(scene.camera, scene.durationFrames, scene.sceneSize, scene.fps), scene.fps);
}

// Recompiles the reel's design with the splice window alone, the way a spliced cut compiled before the glide could stretch.
function squeezed(f: ReturnType<typeof fixture>, reel: Film): Film {
  const words = narration(reel.shots.map((s) => s.scriptText ?? ""), reel.shots.map((s) => s.dur)).words;
  const timing = narrationTimingForFilm(reel, words);
  const dropped = new Map(DROPS.map((n) => [id(n), timing.segments.slice(0, 2).reduce((sum, seg) => sum + Math.round(seg.durationSec * reel.fps), 0)]));
  const compiled = compileDesign({ ...reel, scene: undefined }, f.spec, words, "agent", { collapsed: dropped, format: "reel", splice: { frames: 18 } });
  assert.ok(compiled.film, JSON.stringify(compiled.errors));
  return compiled.film;
}

const WIDTH = 1920;
const LIMITS = { speed: WIDTH * MAX_CAMERA_PAN_WIDTHS, accel: WIDTH * MAX_CAMERA_PAN_ACCEL_WIDTHS, zoomStep: MAX_CAMERA_ZOOM_STEP };

test("reel splice glide: reproduction - squeezed into the splice window the pan breaks the camera rule with the measured numbers", () => {
  const f = fixture();
  const stretched = compile(f, cutDropping(f.long, DROPS, {}));
  assert.ok(stretched.film, JSON.stringify(stretched));
  const before = measure(squeezed(f, stretched.film));
  assert.ok(before.peakPanSpeed > LIMITS.speed, `peak speed ${before.peakPanSpeed}`);
  assert.ok(before.peakPanAccel > LIMITS.accel, `peak acceleration ${before.peakPanAccel}`);
  assert.ok(before.peakZoomStep > LIMITS.zoomStep, `zoom step ${before.peakZoomStep}`);
});

test("reel splice glide: the stretched glide passes the camera rule and the whole design check", () => {
  const f = fixture();
  const result = compile(f, cutDropping(f.long, DROPS, {}));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.filter((x) => x.severity === "error"), []);
  assert.ok(result.film);
  const after = measure(result.film);
  assert.ok(after.peakPanSpeed <= LIMITS.speed, `peak speed ${after.peakPanSpeed}`);
  assert.ok(after.peakPanAccel <= LIMITS.accel, `peak acceleration ${after.peakPanAccel}`);
  assert.ok(after.peakZoomStep <= LIMITS.zoomStep, `zoom step ${after.peakZoomStep}`);
});

test("reel splice glide: the stretched move ends inside the kept shot, starting and ending at rest", () => {
  const f = fixture();
  const { film } = compile(f, cutDropping(f.long, DROPS, {}));
  const scene = film!.scene!;
  const keyframes = scene.camera!.keyframes;
  const cut = Math.round(2 * KEPT_SEC * scene.fps), shotEnd = Math.round(3 * KEPT_SEC * scene.fps);
  const start = keyframes.find((k) => k.frame >= cut && k.center.x === 500)!;
  const end = keyframes.find((k) => k.frame > start.frame && k.center.x === 1400)!;
  assert.equal(start.frame, cut, "the glide leaves at the cut");
  // The squeezed window is 18 frames; the glide keeps the duration the limits need and finishes inside the next kept shot with a hold left.
  assert.ok(end.frame - start.frame > 18, `glide takes ${end.frame - start.frame} frames`);
  assert.ok(end.frame < shotEnd, `glide ends at frame ${end.frame}, inside the kept shot that ends at ${shotEnd}`);
  const curve = compileCameraTrack(scene.camera, scene.durationFrames, scene.sceneSize, scene.fps);
  const speed = (frame: number) => Math.hypot(curve[frame].center.x - curve[frame - 1].center.x, curve[frame].center.y - curve[frame - 1].center.y) * scene.fps;
  const peak = measure(film!).peakPanSpeed;
  assert.ok(speed(start.frame + 1) < peak * 0.05, "the move eases out of rest");
  assert.ok(speed(end.frame) < peak * 0.05, "the move eases into rest");
  assert.deepEqual(curve[end.frame].center, { x: 1400, y: 1290 });
  assert.equal(curve[end.frame].zoom, 1.6);
  const peakFrame = Array.from({ length: end.frame - start.frame }, (_, k) => start.frame + 1 + k).reduce((best, frame) => speed(frame) > speed(best) ? frame : best);
  assert.ok(peakFrame > start.frame + 20 && peakFrame < end.frame - 20, `speed peaks mid-move at frame ${peakFrame}`);
});

test("reel splice glide: a kept shot with no room for the glide fails the compile naming the shot and the missing frames", () => {
  const f = fixture();
  // The third kept shot is the one that follows the dropped span; 3 s leaves it no room for a move that needs well over 3 s.
  const result = compile(f, cutDropping(f.long, DROPS, {}), [KEPT_SEC, KEPT_SEC, 3, KEPT_SEC, KEPT_SEC, KEPT_SEC]);
  assert.equal(result.film, undefined);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /kept shot "s05"/);
  assert.match(result.errors[0], /missing \d+ frames in "s05"/);
  assert.deepEqual(result.findings, []);
});

test("reel splice glide: a following pose that cannot keep its own move fails the compile naming the shot and the missing frames", () => {
  // The pose after the glide sits 11 frames past the glide's end in the same shot, far too close for the move between them.
  const poses = POSES.flatMap((pose) => pose.id === "right-hold"
    ? [{ id: "right-next", at: "s05@0.6", center: [1000, 1290] as [number, number], zoom: 1.7 }, { id: "right-next-hold", at: "s06@0.5", center: [1000, 1290] as [number, number], zoom: 1.7 }]
    : [pose]);
  const f = fixture(poses);
  const result = compile(f, cutDropping(f.long, DROPS, {}));
  assert.equal(result.film, undefined);
  assert.match(result.errors.join("\n"), /camera "right-next": kept shot "s05" has no room: the glide to "right" now finishes at frame \d+ and the move on to "right-next" needs \d+ frames but has \d+; missing \d+ frames in "s05"/);
});

test("reel splice glide: without the splice marker the reel compiles exactly as before, with the ordering failure and no glide", () => {
  const f = fixture();
  const plain = compile(f, cutDropping(f.long, DROPS));
  assert.equal(plain.film, undefined);
  assert.match([...plain.errors, ...plain.findings.map((x) => x.message)].join("\n"), /time order|visible snap/);
  assert.doesNotMatch(plain.errors.join("\n"), /glide/);
});

test("reel splice glide: a cut that drops nothing compiles byte-identically with or without the splice marker", () => {
  const f = fixture();
  const plain = compile(f, cutDropping(f.long, []));
  const spliced = compile(f, cutDropping(f.long, [], {}));
  assert.ok(plain.film, JSON.stringify(plain));
  assert.equal(JSON.stringify(spliced.film), JSON.stringify(plain.film));
});

test("reel splice glide: a move that already fits the splice window is untouched by the stretch", () => {
  const small = POSES.map((pose) => pose.id === "right" || pose.id === "right-hold" ? { ...pose, center: [520, 1290] as [number, number], zoom: 1.8 } : pose);
  const f = fixture(small);
  const result = compile(f, cutDropping(f.long, DROPS, {}));
  assert.ok(result.film, JSON.stringify(result));
  assert.equal(JSON.stringify(result.film!.scene!.camera), JSON.stringify(squeezed(f, result.film!).scene!.camera));
});
