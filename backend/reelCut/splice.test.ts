/**
 * File Description: Behavioural coverage of the smooth splice at dropped reel shots, on a short synthetic scene film.
 * Inputs and outputs: a generated twelve-shot package, cuts and measured narration stubs -> compiled reels checked for continuity, length and identity.
 * Used by: npm test.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";
import { parseFilm, type Film } from "../../src/dl/schema";
import { deliveryTimeline } from "../../src/dl/delivery";
import { compileCameraTrack } from "../../src/dl/scene/cameraTrack";
import { buildCaptionsVtt, type ProduceAudioResult } from "../audio";
import { compileDesign } from "../designSpec/compile";
import { designSpecSchema, type DesignSpec } from "../designSpec/spec";
import { MAX_CAMERA_PAN_WIDTHS, MAX_CAMERA_ZOOM_STEP } from "../designCheck/designCheck";
import { createReelContext } from "./constraints";
import { compileReel } from "./build";
import { SPLICE_DEFAULT_FRAMES, SPLICE_EASING, SPLICE_MIN_FRAMES } from "./splice";
import type { ReelCut } from "./schema";

const SLUG = "reel-splice-fixture";
const SHOTS = 12;
const LONG_SHOT_SEC = 10;
const SOURCE = path.resolve(__dirname, "../../test_fixtures/packages/speculative-decoding-designed");

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
  return { segments, words, shotDurations: durations, totalAudioDuration: cursor, captionsVttContent: buildCaptionsVtt(words), ttsBackend: "kokoro:af_heart", voice: "af_heart", speed: 0.75,
    voiceoverPath: "voiceover.wav", wordsPath: "voiceover_words.json", captionsPath: "captions.vtt" };
}

// Builds the long film, its design and the package artwork; every shot carries a camera move and a visible change.
function fixture(): { long: Film; base: Film; spec: DesignSpec; pkg: string; words: ProduceAudioResult["words"] } {
  const pkg = path.join(TEST_VIDEOS_DIR, SLUG);
  fs.rmSync(pkg, { recursive: true, force: true });
  fs.mkdirSync(path.join(pkg, "visuals"), { recursive: true });
  for (const file of ["canvas", "road", "memory"]) fs.copyFileSync(path.join(SOURCE, `visuals/${file}.svg`), path.join(pkg, `visuals/${file}.svg`));
  const template = parseFilm(loadFixtureFilm("fixture-canvas-a"));
  const base: Film = { ...template, id: SLUG, scene: undefined, voiceover: { src: `videos/${SLUG}/voiceover.wav`, volume: 1, durationSec: SHOTS * LONG_SHOT_SEC },
    shots: Array.from({ length: SHOTS }, (_, i) => ({ ...template.shots[0], id: id(i + 1), dur: LONG_SHOT_SEC, look: "all", stage: "none" as const, blocks: [], scriptText: line(i) })) };
  const audio = narration(base.shots.map((s) => s.scriptText ?? ""), base.shots.map((s) => s.dur));
  const spec = designSpecSchema.parse({
    brief: { concept: "A cargo crosses a road while the camera sweeps between two views." },
    assets: [{ id: "road", file: "visuals/road.svg", position: [960, 1215], scale: 0.9, layer: 1 }, { id: "memory", file: "visuals/memory.svg", position: [600, 1215], scale: 0.9, layer: 2 }],
    camera: Array.from({ length: SHOTS }, (_, i) => ({ id: `view-${i + 1}`, at: id(i + 1), center: i % 2 ? [1620 - 12 * i, 1500 - 8 * i] : [300 + 12 * i, 420 + 8 * i], zoom: i % 2 ? 1.1 : 1 })).concat([{ id: "view-end", at: "end", center: [960, 960], zoom: 1 }]),
    clips: [
      ...Array.from({ length: SHOTS }, (_, i) => ({ id: `cargo-${i + 1}`, asset: "road", targets: ["cargo"], property: "translateX", from: 40 * i, to: 40 * (i + 1), start: id(i + 1), end: `${id(i + 1)}@end`, easing: "linear" })),
      ...[0, 2, 4, 6, 8, 10].map((i) => ({ id: `glow-${i / 2 + 1}`, asset: "road", targets: ["road-glow"], property: "drawOn", from: 0.15 * (i / 2), to: 0.15 * (i / 2 + 1), start: id(i + 1), end: `${id(i + 1)}+24`, easing: "linear" })),
      ...Array.from({ length: SHOTS }, (_, i) => ({ id: `scan-${i + 1}`, asset: "memory", targets: ["read-scan"], property: "translateY", from: i % 2 ? 150 : 0, to: i % 2 ? 0 : 150, start: id(i + 1), end: `${id(i + 1)}@end`, easing: "linear" })),
    ],
  });
  const compiled = compileDesign(base, spec, audio.words, "hand-built");
  assert.ok(compiled.film, JSON.stringify(compiled.errors));
  fs.writeFileSync(path.join(pkg, "film.json"), JSON.stringify(compiled.film));
  return { long: compiled.film, base, spec, pkg, words: audio.words };
}

// Builds a checked cut that keeps the first and last shot and drops the named middle shots.
function cutDropping(long: Film, drops: number[], splice?: ReelCut["splice"]): ReelCut {
  const context = createReelContext({ film: long });
  return { schema: "aideos.reelcut/1", source: "agent", long: { shots: Object.fromEntries(context.shots.map((s) => [s.id, s.hash])) }, ...(splice ? { splice } : {}),
    shots: context.shots.map((s, i) => drops.includes(i + 1) ? { id: s.id, drop: true as const, reason: "restates the previous shot" } : { id: s.id, narration: s.narration }) };
}

// Compiles a cut with each kept shot narrated for the given seconds.
function compile(f: ReturnType<typeof fixture>, cut: ReelCut, sec: number) {
  const kept = cut.shots.filter((s) => !("drop" in s));
  return compileReel({ long: f.long, base: f.base, cut, spec: f.spec, pkg: f.pkg, narration: narration(kept.map((s) => ("narration" in s ? s.narration : "")), kept.map(() => sec)) });
}

const DROPS = [3, 4, 7, 8, 9];

test("reel splice: a cut that drops camera and visible-change shots fails today and compiles when it opts in", () => {
  const f = fixture();
  const plain = compile(f, cutDropping(f.long, DROPS), 6.5);
  assert.equal(plain.film, undefined);
  assert.match([...plain.errors, ...plain.findings.map((x) => `${x.rule}: ${x.message}`)].join("\n"), /time order|visible snap/);
  const spliced = compile(f, cutDropping(f.long, DROPS, {}), 6.5);
  assert.ok(spliced.film, JSON.stringify(spliced));
  assert.deepEqual(spliced.findings.filter((x) => x.severity === "error"), []);
});

test("reel splice: the spliced camera path never jumps and every cut is crossed within the camera speed and zoom limits", () => {
  const f = fixture();
  const { film } = compile(f, cutDropping(f.long, DROPS, {}), 6.5);
  const scene = film!.scene!;
  const curve = compileCameraTrack(scene.camera, scene.durationFrames, scene.sceneSize, scene.fps);
  const maxStep = scene.sceneSize.w * MAX_CAMERA_PAN_WIDTHS / scene.fps;
  for (let i = 1; i < curve.length; i++) {
    // A snap is a step an order of magnitude past the speed limit; eased moves may briefly exceed the average cap.
    assert.ok(Math.hypot(curve[i].center.x - curve[i - 1].center.x, curve[i].center.y - curve[i - 1].center.y) <= 3 * maxStep, `pan jump at frame ${i}`);
    assert.ok(Math.abs(curve[i].zoom - curve[i - 1].zoom) / curve[i - 1].zoom <= MAX_CAMERA_ZOOM_STEP + 1e-9, `zoom jump at frame ${i}`);
  }
});

test("reel splice: a reel reaches a 50 s delivery on a film whose every shot holds a move, below the unspliced floor", () => {
  const f = fixture();
  const floors = createReelContext({ film: f.long }).shots.map((s) => s.minSec);
  const everyShotFloor = floors.reduce((a, b) => a + b, 0) + 3;
  assert.ok(everyShotFloor > 50, `with every shot kept the floor is ${everyShotFloor.toFixed(1)} s`);
  const cut = cutDropping(f.long, DROPS, {});
  const keptFloor = floors.filter((_, i) => !DROPS.includes(i + 1)).reduce((a, b) => a + b, 0) + 3;
  assert.ok(keptFloor < 50, `with five shots spliced out the floor is ${keptFloor.toFixed(1)} s`);
  const result = compile(f, cut, 47 / 7);
  assert.ok(result.film, JSON.stringify(result));
  assert.ok(Math.abs(deliveryTimeline(result.film, "reel").totalFrames / f.long.fps - 50) < 0.5);
});

test("reel splice: dropped changes are carried by eased clips, never a one-frame jump", () => {
  const f = fixture();
  const { film } = compile(f, cutDropping(f.long, DROPS, {}), 6.5);
  const road = film!.scene!.props.find((p) => p.assetId === "road")!;
  const chain = (target: string) => road.animation!.clips.filter((c) => c.targets.includes(target)).sort((a, b) => a.startFrame - b.startFrame);
  for (const target of ["cargo", "road-glow"]) {
    const clips = chain(target);
    for (let i = 1; i < clips.length; i++) assert.ok(Math.abs(clips[i].from - clips[i - 1].to) < 1e-6, `${target}: ${clips[i].clipId} starts where ${clips[i - 1].clipId} left off`);
    assert.deepEqual(clips.filter((c) => c.from !== c.to && c.durationFrames <= 1), [], `${target} has a one-frame jump`);
  }
  // An idle slot gets one bounded eased clip per run of dropped shots.
  const carries = chain("road-glow").filter((c) => c.clipId.startsWith("splice-"));
  assert.equal(carries.length, 2);
  for (const carry of carries) {
    assert.equal(carry.easing, SPLICE_EASING);
    assert.ok(carry.durationFrames >= SPLICE_MIN_FRAMES && carry.durationFrames <= SPLICE_DEFAULT_FRAMES);
  }
  // A slot that is never idle carries the change inside the next kept clip, which leaves from the pre-cut value.
  const cargo = chain("cargo");
  assert.equal(cargo.length, SHOTS - DROPS.length);
  assert.ok(cargo.every((c) => c.durationFrames > SPLICE_MIN_FRAMES));
});

test("reel splice: a cut that drops nothing compiles byte-identically with or without the splice option", () => {
  const f = fixture();
  const plain = compile(f, cutDropping(f.long, []), 6.5);
  const spliced = compile(f, cutDropping(f.long, [], {}), 6.5);
  assert.ok(plain.film, JSON.stringify(plain));
  assert.equal(JSON.stringify(spliced.film), JSON.stringify(plain.film));
});
