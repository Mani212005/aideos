/**
 * File Description: Tests for design specs: cue resolution, compiling a spec onto a film, and the
 * errors a designer gets back. The committed demo (videos/speculative-decoding-designed) is the
 * fixture, so the test also proves that design keeps compiling and passing the design check.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseFilm } from "../../src/dl/schema";
import { createCues } from "../sceneKit";
import { checkFilmDesign } from "../designCheck/designCheck";
import { compileDesign, narrationTimingForFilm, type TimedWord } from "./compile";
import { resolveCue } from "./cues";
import { designSpecSchema, type DesignSpec } from "./spec";

const PKG = path.resolve(__dirname, "../../videos/speculative-decoding-designed");
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
