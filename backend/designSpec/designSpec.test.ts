/**
 * File Description: Tests for design specs: cue resolution, compiling a spec onto a film, and the
 * errors a designer gets back. The committed demo (test_fixtures/packages/speculative-decoding-designed) is the
 * fixture, so the test also proves that design keeps compiling and passing the design check.
 * Inputs and outputs: design specification test cases and fixtures -> test assertions.
 * Used by: npm test.
 * Inputs and outputs: design specification test cases and fixtures -> test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { parseFilm } from "../../src/dl/schema";
import { Timeline, createCues } from "../sceneKit";
import { checkFilmDesign } from "../designCheck/designCheck";
import { compileDesign, narrationTimingForFilm, type TimedWord } from "./compile";
import { resolveCue } from "./cues";
import { designSpecSchema, type DesignSpec } from "./spec";

const PKG = path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed");
const base = () => parseFilm(JSON.parse(fs.readFileSync(path.join(PKG, "design/base-film.json"), "utf8")));
const words = (): TimedWord[] => JSON.parse(fs.readFileSync(path.join(PKG, "voiceover_words.json"), "utf8")).words;
const spec = (): DesignSpec => designSpecSchema.parse(JSON.parse(fs.readFileSync(path.join(PKG, "design/design.json"), "utf8")));

test("DesignSpec: cues resolve shots, fractions, phrases, the end and offsets", () => {
  const cues = createCues(narrationTimingForFilm(base(), words()));
  const start = cues.from("beat-02");
  assert.equal(resolveCue("beat-02", cues), start);
  assert.equal(resolveCue("beat-02+5", cues), start + 5);
  assert.equal(resolveCue("beat-02@end", cues), cues.to("beat-02"));
  assert.equal(resolveCue("beat-02@0.5", cues), cues.at("beat-02", 0.5));
  assert.equal(resolveCue('beat-02:"One word"', cues), cues.word("beat-02", "One word"));
  assert.equal(resolveCue('beat-02:"One word"@end-2', cues), cues.word("beat-02", "One word", "end") - 2);
  assert.equal(resolveCue("end", cues), cues.durationFrames);
  assert.equal(resolveCue(42, cues), 42);
  assert.throws(() => resolveCue('beat-02:"never said"', cues), /is not spoken in shot "beat-02"/);
  assert.throws(() => resolveCue("beat-02@7", cues), /between 0 and 1/);
  assert.throws(() => resolveCue("Beat Two", cues), /is not valid/);
});

test("DesignSpec: the demo design compiles into a scene film that passes the design check", () => {
  const { film, errors } = compileDesign(base(), spec(), words(), "hand-built");
  assert.deepEqual(errors, []);
  assert.ok(film?.scene);
  assert.equal(film.scene.props.length, 5);
  assert.equal(film.design?.source, "hand-built");
  assert.equal(film.shots.find((s) => s.id === "beat-04")?.stage, "frame", "a text override takes the chart panel off the scene");
  const report = checkFilmDesign(film);
  assert.equal(report.ok, true, JSON.stringify(report.findings.filter((f) => f.severity === "error")));
});

test("DesignSpec: every mistake comes back named, and no partial film is produced", () => {
  const s = spec();
  s.clips.push({ ...s.clips[0], id: "ghost", asset: "nope" });
  s.clips.push({ ...s.clips.find((c) => c.id === "trickle")!, id: "mumble", start: 'beat-02:"not in this shot"' });
  s.clips.push({ id: "snap", asset: "chip", targets: ["chip"], property: "opacity", from: 0.3, to: 1, start: "beat-20", end: "beat-20@0.5" });
  s.shots = { ...s.shots, "beat-99": { blocks: [] } };
  const { film, errors } = compileDesign(base(), s, words(), "agent");
  assert.equal(film, undefined);
  const text = errors.join("\n");
  assert.match(text, /clip "ghost" animates unknown asset "nope"/);
  assert.match(text, /clip "mumble": "not in this shot" is not spoken/);
  assert.match(text, /clip "snap": .*visible snap/);
  assert.match(text, /shots\."beat-99" overrides a shot the film does not have/);
});

test("DesignSpec: the schema keeps artwork inside the package and accents to one colour", () => {
  const bad = { ...spec(), accent: "purple", assets: [{ ...spec().assets[0], file: "../../etc/x.svg" }] };
  const parsed = designSpecSchema.safeParse(bad);
  assert.equal(parsed.success, false);
  const paths = parsed.success ? [] : parsed.error.issues.map((i) => i.path.join("."));
  assert.ok(paths.includes("accent") && paths.includes("assets.0.file"), paths.join(","));
});

const withCamera = (camera: DesignSpec["camera"]): DesignSpec => ({ ...spec(), camera });
const pose = (id: string, at: string, x: number, y: number, zoom: number) => ({ id, at, center: [x, y] as [number, number], zoom });

test("DesignSpec camera: poses resolve through the cues into a continuous keyframe track", () => {
  const { film, errors } = compileDesign(base(), spec(), words(), "hand-built");
  assert.deepEqual(errors, []);
  const frames = createCues(narrationTimingForFilm(base(), words()), 30);
  const track = film?.scene?.camera?.keyframes ?? [];
  assert.equal(track.length, spec().camera?.length);
  assert.equal(track[0].frame, frames.from("beat-01"));
  assert.equal(track[2].frame, frames.at("beat-04", 0.85), "a fractional cue lands on the narration, not on a guessed frame");
  assert.equal(track[track.length - 1].frame, frames.durationFrames - 1, 'a cue on "end" arrives on the last real frame');
  assert.ok(track.every((k, i) => i === 0 || k.frame > track[i - 1].frame), "keyframes are in time order");
  assert.ok(track.every((k) => k.easing === undefined), "no easing, so the compiler flows a spline through the poses");
});

test("DesignSpec camera: no camera field leaves the scene without a camera track", () => {
  const { film } = compileDesign(base(), withCamera(undefined), words(), "agent");
  assert.equal(film?.scene?.camera, undefined);
});

test("DesignSpec camera: an easing shapes the move into its pose", () => {
  const eased = withCamera([pose("a", "beat-01", 960, 960, 1), { ...pose("b", "beat-02", 960, 1000, 1.1), easing: "expoOut" }, pose("c", "beat-03", 960, 1000, 1.1)]);
  const track = compileDesign(base(), eased, words(), "agent").film?.scene?.camera?.keyframes ?? [];
  assert.deepEqual(track.map((k) => k.easing), ["expoOut", undefined, undefined]);
});

test("DesignSpec camera: mistakes come back naming the pose, with no partial film", () => {
  const cases: Array<[string, DesignSpec["camera"], RegExp]> = [
    ["out of order", [pose("a", "beat-03", 960, 960, 1), pose("b", "beat-02", 960, 960, 1.1)], /camera "b": cue "beat-02" is frame \d+, not after "a"/],
    ["same frame", [pose("a", "beat-02", 960, 960, 1), pose("b", "beat-02", 900, 960, 1)], /camera "b": cue "beat-02" is frame \d+, not after "a"/],
    ["phrase not spoken", [pose("a", "beat-01", 960, 960, 1), pose("ghost", 'beat-02:"never said"', 960, 960, 1.1)], /camera "ghost": "never said" is not spoken in shot "beat-02"/],
    ["bad cue", [pose("a", "beat-01", 960, 960, 1), pose("b", "Beat Two", 960, 960, 1.1)], /camera "b": cue "Beat Two" is not valid/],
    ["before the film", [pose("a", "beat-01-5", 960, 960, 1), pose("b", "beat-02", 960, 960, 1.1)], /camera "a"/],
    ["easing on the first pose", [{ ...pose("a", "beat-01", 960, 960, 1), easing: "expoOut" }, pose("b", "beat-02", 960, 960, 1.1)], /camera "a": the first pose has no move to arrive by/],
    ["duplicate id", [pose("a", "beat-01", 960, 960, 1), pose("a", "beat-02", 960, 960, 1.1)], /camera pose "a" is declared twice/],
  ];
  for (const [name, camera, expected] of cases) {
    const { film, errors } = compileDesign(base(), withCamera(camera), words(), "agent");
    assert.equal(film, undefined, name);
    assert.match(errors.join("\n"), expected, name);
  }
});

test("DesignSpec camera: Timeline continuity names the clip that starts away from where the last one left the camera", () => {
  const timeline = new Timeline("camera", 300);
  timeline.camera({ id: "first", from: { center: { x: 960, y: 960 }, zoom: 1 }, to: { center: { x: 900, y: 960 }, zoom: 1.1 }, start: 0, end: 90 });
  assert.throws(
    () => timeline.camera({ id: "second", from: { center: { x: 960, y: 960 }, zoom: 1 }, to: { center: { x: 900, y: 960 }, zoom: 1.1 }, start: 90, end: 180 }),
    /\[camera\/second\] camera starts at different state than "first" left it/,
  );
});

test("DesignSpec camera: a move over the speed cap is refused by the existing design check", () => {
  const fast = withCamera([pose("a", "beat-01@0.5", 400, 960, 1), pose("b", "beat-01@0.5+30", 1500, 960, 1), pose("c", "beat-03", 1500, 960, 1)]);
  const { film, errors } = compileDesign(base(), fast, words(), "agent");
  assert.deepEqual(errors, []);
  const report = checkFilmDesign(film!);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.rule === "camera" && /exceeding the speed limit/.test(f.message)), JSON.stringify(report.findings));
});

test("DesignSpec camera: the schema wants two poses inside the scene and a sane zoom", () => {
  const parse = (camera: unknown) => designSpecSchema.safeParse({ ...spec(), camera });
  assert.equal(parse([pose("a", "beat-01", 960, 960, 1)]).success, false, "one pose is not a move");
  assert.equal(parse([pose("a", "beat-01", 960, 960, 1), pose("b", "beat-02", 5000, 960, 1)]).success, false, "centre outside the scene");
  assert.equal(parse([pose("a", "beat-01", 960, 960, 1), pose("b", "beat-02", 960, 960, 9)]).success, false, "zoom past 4");
  assert.equal(parse([pose("a", "beat-01", 960, 960, 1), { ...pose("B", "beat-02", 960, 960, 1) }]).success, false, "ids are lowercase");
  assert.equal(parse([pose("a", "beat-01", 960, 960, 1), pose("b", "beat-02", 960, 960, 1.1)]).success, true);
});

test("DesignSpec camera: the demo's poses keep both artwork pieces inside the reel's crop", () => {
  // A pose at (cx, z) shows scene x cx +/- 540/z in the reel (the format's fixed 1080-wide window).
  const edges = spec().assets.filter((a) => a.id === "memory" || a.id === "chip").map((a) => [a.position[0] - 100, a.position[0] + 100]);
  for (const p of spec().camera ?? []) {
    const half = 540 / p.zoom;
    for (const [l, r] of edges) {
      assert.ok(p.center[0] - half <= l && p.center[0] + half >= r, `pose "${p.id}" crops the artwork out of the reel (x ${p.center[0] - half}-${p.center[0] + half})`);
    }
  }
});
