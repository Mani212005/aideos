/**
 * File Description: Regression tests for the "RAG, in four steps" video package.
 * Covers the pieces that keep a kinetic typography film honest: the whisper alignment that puts each
 * word on its real spoken moment, the authoring kit's refusal to mis-time or overflow a line, and the
 * shipped artefacts (manifest, design check, narration text, the film.json / shadow / SVG source map
 * trio that must never drift apart).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseFilm } from "../../src/dl/schema";
import { checkFilmDesignById } from "../designCheck/designCheck";
import { collectSvgSources, renderModule, generatedModulePath } from "../scene/buildSvgSources";
import type { NarrationTiming } from "../sceneKit";
import { BEATS } from "./beats";
import { alignWords } from "./produceVoiceover";
import { Canvas } from "./kit";

const ROOT = path.resolve(__dirname, "../..");
const PACKAGE_DIR = path.join(ROOT, "videos/rag-explainer");

/** A one-line narration fixture: "Hello brave world" spoken over the first second of a three second film. */
const TIMING: NarrationTiming = {
  totalDurationSec: 3,
  segments: [
    {
      shotId: "hello",
      text: "Hello brave world",
      startSec: 0,
      durationSec: 3,
      words: [
        { word: "Hello", startSec: 0, endSec: 0.3 },
        { word: "brave", startSec: 0.4, endSec: 0.7 },
        { word: "world", startSec: 0.8, endSec: 1.1 },
      ],
    },
  ],
};

test("alignWords: matched words take whisper's timing, missed words share the gap between neighbours", () => {
  const heard = [
    { word: "Hello,", start: 0.1, end: 0.4 },
    { word: "world", start: 1.0, end: 1.3 },
  ];
  const out = alignWords(["Hello", "brave", "world"], heard, 0, 1.5);
  assert.deepEqual(out[0], { startSec: 0.1, endSec: 0.4 });
  assert.deepEqual(out[2], { startSec: 1.0, endSec: 1.3 });
  assert.ok(out[1].startSec >= 0.4 && out[1].endSec <= 1.0, "the missed word sits between its neighbours");
});

test("alignWords: extra heard words never steal a scripted word's slot", () => {
  const heard = [
    { word: "uh", start: 0.0, end: 0.1 },
    { word: "brave", start: 0.3, end: 0.6 },
    { word: "new", start: 0.6, end: 0.8 },
    { word: "world", start: 0.8, end: 1.1 },
  ];
  const out = alignWords(["brave", "world"], heard, 0, 1.2);
  assert.equal(out[0].startSec, 0.3);
  assert.equal(out[1].startSec, 0.8);
});

test("kit: a lyric whose words are not the narration fails the build", () => {
  const c = new Canvas("t", TIMING, 90);
  assert.throws(() => c.lyric({ beat: "hello", rows: ["Hello brave planet"], x: 100, y: 200, size: 80 }), /do not match the narration/);
});

test("kit: a row too wide for its bounds fails instead of overflowing the frame", () => {
  const c = new Canvas("t", TIMING, 90);
  assert.throws(() => c.lyric({ beat: "hello", rows: ["Hello brave world"], x: 100, y: 200, size: 400 }), /outside/);
});

test("kit: each word lands on the frame it is spoken, one frame ahead", () => {
  const c = new Canvas("t", TIMING, 90);
  const line = c.lyric({ beat: "hello", rows: ["Hello brave world"], x: 100, y: 200, size: 60, exit: "hold" });
  assert.deepEqual(line.words.map((w) => w.startFrame), [0, 11, 23]);
});

test("kit: motion helpers refuse a clip that overlaps the previous one on the same property", () => {
  const c = new Canvas("t", TIMING, 90);
  c.to("a", "translateX", 10, 0, 20);
  assert.throws(() => c.to("a", "translateX", 20, 10, 30), /overlaps/);
  // Starting where the last clip ended is fine, and begins from its end value by construction.
  c.to("a", "translateX", 20, 20, 30);
});

test("kit: a value declared with init() but never animated is pinned, not left visible", () => {
  const c = new Canvas("t", TIMING, 90);
  c.init("hidden", { opacity: 0 });
  const clips = c.timeline().clips;
  assert.ok(clips.some((clip) => clip.targets.includes("hidden") && clip.property === "opacity" && clip.from === 0 && clip.to === 0));
});

test("rag-explainer: the manifest parses and its narration is the beat sheet's", () => {
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "film.json"), "utf8")));
  assert.equal(film.id, "rag-explainer");
  assert.equal(film.shots.length, BEATS.length);
  film.shots.forEach((shot, i) => {
    assert.equal(shot.id, BEATS[i].id);
    assert.equal(shot.scriptText, BEATS[i].narration);
  });
  assert.ok(film.scene, "the film's canvas is a scene");
});

test("rag-explainer: the film passes the standard design check", () => {
  const report = checkFilmDesignById("rag-explainer");
  const errors = report.findings.filter((f) => f.severity === "error");
  assert.deepEqual(errors, [], errors.map((f) => `[${f.rule}] ${f.where}: ${f.message}`).join("\n"));
});

test("rag-explainer: film.json, its generated shadow and the SVG source map agree", () => {
  const film = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "film.json"), "utf8"));
  const shadow = fs.readFileSync(path.join(ROOT, "src/dl/films/rag-explainer.ts"), "utf8");
  const match = shadow.match(/=\s*(\{[\s\S]*\})\s*;/);
  assert.ok(match, "the shadow module carries the film as a JSON literal");
  assert.deepEqual(JSON.parse(match![1]), film);
  assert.equal(fs.readFileSync(generatedModulePath(), "utf8"), renderModule(collectSvgSources()));
});
