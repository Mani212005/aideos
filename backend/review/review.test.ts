/**
 * File Description: Tests for `aideos review`.
 * Pure units (pixel analysis, OCR geometry, ffmpeg output parsers, narration facts, film-data facts,
 * criterion verdicts) run on hand-built data; the end-to-end tests render small synthetic videos with
 * ffmpeg (a stable stage, a stage cleared at every beat, a captioned one) and review them for real,
 * including the CLI exit code and the evidence frames. They skip when ffmpeg or tesseract is missing.
 * Inputs and outputs: synthetic video samples and hand-crafted review data -> test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseFilm, type Film } from "../../src/dl/schema";
import { evaluateCriteria, type ReviewInputs } from "./criteria";
import { parseEbur128, parseSilences } from "./media";
import { analyzeSample, parseTsv, type OcrWord } from "./ocr";
import { correlation, frameFeatures, hardCuts, layoutPersistence, percentile, stageClears, staticRuns } from "./pixels";
import { reviewVideo } from "./review";
import { readFilmFacts } from "./source";
import { captionMatch, chanceNearWordStarts, cutsThroughWords, loadNarration, pauses, shareNearWordStarts, spokenNumbers, wordsPerMinute, type Narration } from "./speech";
import type { RenderFacts } from "./renderFacts";
import type { VideoFacts } from "./types";

const hasBin = (bin: string) => spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0 || spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
const HAVE_FFMPEG = hasBin("ffmpeg");
const HAVE_TESSERACT = hasBin("tesseract");
const FONT = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find((f) => fs.existsSync(f));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-review-"));

// ---- pixels ----------------------------------------------------------------------------------------

test("pixels: percentile interpolates and frameFeatures measures ink against the median", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([0, 10], 25), 2.5);
  const w = 48;
  const h = 27;
  const blank = new Uint8Array(w * h).fill(20);
  const inked = blank.slice();
  for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) inked[y * w + x] = 240;
  const a = frameFeatures(blank, null, w, h, 28);
  const b = frameFeatures(inked, blank, w, h, 28);
  assert.equal(a.coverage, 0);
  assert.equal(a.diff, 0);
  assert.ok(Math.abs(b.coverage - (16 * 9) / (w * h)) < 1e-9);
  assert.ok(b.diff > 0);
  assert.equal(b.grid[0], 1, "the top-left cell is fully inked");
});

test("pixels: correlation is 1 for equal layouts, null for a constant one", () => {
  const a = Float32Array.from([0, 1, 0, 1]);
  assert.ok(Math.abs((correlation(a, a) ?? 0) - 1) < 1e-9);
  assert.equal(correlation(a, Float32Array.from([1, 1, 1, 1])), null);
});

test("pixels: a layout that holds correlates high, one that is replaced every beat correlates low", () => {
  const cell = (on: number[]) => {
    const g = new Float32Array(48 * 27);
    on.forEach((i) => (g[i] = 1));
    return g;
  };
  const same = Array.from({ length: 80 }, () => cell([1, 2, 3, 50, 51, 400]));
  const layouts = [cell([1, 2, 3, 50, 51, 400]), cell([700, 701, 702, 900, 1000, 1200]), cell([300, 301, 560, 561, 1100, 1250])];
  const flip = Array.from({ length: 80 }, (_, i) => layouts[Math.floor(i / 10) % 3]);
  assert.ok((layoutPersistence(same, 10)?.median ?? 0) > 0.99);
  assert.ok((layoutPersistence(flip, 10)?.median ?? 1) < 0.3);
});

test("pixels: stage clears, hard cuts and static runs are found at the right times", () => {
  // 10 fps: coverage 0.2 for 6 s, collapse to 0.02 at 6 s, back at 8 s.
  const cov = Array.from({ length: 140 }, (_, i) => (i >= 60 && i < 80 ? 0.02 : 0.2));
  const clears = stageClears(cov, 10);
  assert.equal(clears.length, 1);
  assert.ok(clears[0] >= 5 && clears[0] <= 6.1, `clear near 6 s, got ${clears[0]}`);
  assert.equal(stageClears(Array.from({ length: 140 }, () => 0.2), 10).length, 0);
  assert.deepEqual(hardCuts([0, 1, 30, 2], 10, 12), [0.2]);
  const runs = staticRuns([0, ...Array(50).fill(0), 5, 5], 10, 0.05, 3);
  assert.equal(runs.length, 1);
  assert.ok(runs[0].end - runs[0].start > 4.5);
  assert.equal(staticRuns([0, ...Array(20).fill(0), 5], 10, 0.05, 3).length, 0, "a two second hold is allowed");
});

// ---- ocr -------------------------------------------------------------------------------------------

const word = (text: string, left: number, top: number, width: number, height: number, conf = 95): OcrWord => ({ text, conf, left, top, width, height });

test("ocr: parseTsv keeps word rows and drops empty text and layout rows", () => {
  const tsv = ["level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext", "5\t1\t1\t1\t1\t1\t10\t20\t30\t40\t96.5\tHello", "4\t1\t1\t1\t1\t0\t0\t0\t5\t5\t-1\t", "5\t1\t1\t1\t1\t2\t50\t20\t30\t40\t91\tworld"].join("\n");
  const words = parseTsv(tsv);
  assert.deepEqual(words.map((w) => w.text), ["Hello", "world"]);
  assert.equal(words[0].left, 10);
  assert.deepEqual(parseTsv("garbage"), []);
});

test("ocr: three caption-sized words in the bottom quarter are a caption; small body text is not", () => {
  const caption = [word("the", 300, 900, 120, 44), word("trick", 440, 900, 160, 44), word("is", 620, 900, 60, 44), word("layers", 700, 900, 200, 44)];
  const s = analyzeSample(caption, null, 1920, 1080, 4);
  assert.equal(s.hasCaption, true);
  assert.equal(s.captionLines, 1);
  assert.equal(s.captionText, "the trick is layers");
  const small = [word("tiny", 300, 900, 60, 14), word("label", 380, 900, 60, 14), word("text", 460, 900, 60, 14)];
  const t = analyzeSample(small, null, 1920, 1080, 4);
  assert.equal(t.hasCaption, false);
  assert.equal(t.smallWords, 3);
  const high = [word("not", 300, 300, 120, 44), word("a", 440, 300, 60, 44), word("caption", 520, 300, 200, 44)];
  assert.equal(analyzeSample(high, null, 1920, 1080, 4).hasCaption, false, "caption-sized text up the frame is not a caption band");
});

test("ocr: sizes are normalised to a 1080 short side, so a reel is held to the same standard", () => {
  // 20 px tall on a 540-wide reel is 40 px at 1080, which is large; on a 1080 frame it is small only below 18 px.
  const s = analyzeSample([word("readable", 100, 100, 300, 20)], null, 540, 960, 0);
  assert.equal(s.smallWords, 0);
  assert.ok((s.minHeight ?? 0) > 39);
});

test("ocr: overlapping words, edge crowding and numbers are reported; OCR artefacts are not overlap", () => {
  const overlapping = [word("alpha", 200, 200, 150, 40), word("beta", 250, 205, 150, 40)];
  assert.equal(analyzeSample(overlapping, null, 1920, 1080, 0).overlaps, 1);
  const artefact = [word("10", 100, 100, 177, 42), word("/", 170, 100, 8, 19), word("sixtyfour", 120, 110, 200, 30)];
  assert.equal(analyzeSample(artefact, null, 1920, 1080, 0).overlaps, 0, "a two-character token boxed as wide as a word is not trusted");
  const edge = analyzeSample([word("crowded", 4, 500, 120, 30)], null, 1920, 1080, 0);
  assert.equal(edge.offSafe, 1);
  const nums = analyzeSample([word("768", 100, 100, 70, 30), word("(95.5%)", 300, 100, 120, 30), word("words", 500, 100, 100, 30)], null, 1920, 1080, 0);
  assert.deepEqual(nums.numbers, ["768", "95.5%"]);
});

test("ocr: low contrast text is counted from the pixels under its box", () => {
  const w = 200;
  const h = 100;
  const gray = new Uint8Array(w * h).fill(100);
  for (let y = 40; y < 60; y++) for (let x = 20; x < 60; x++) gray[y * w + x] = 108; // barely lighter than the background
  const faint = analyzeSample([word("faint", 20, 40, 40, 20)], gray, w, h, 0);
  assert.equal(faint.lowContrastWords, 1);
  for (let y = 40; y < 60; y++) for (let x = 20; x < 60; x++) gray[y * w + x] = x % 2 ? 250 : 5;
  assert.equal(analyzeSample([word("bold", 20, 40, 40, 20)], gray, w, h, 0).lowContrastWords, 0);
});

// ---- media parsers ---------------------------------------------------------------------------------

test("media: ebur128 summary and silencedetect lines are parsed", () => {
  const log = ["[Parsed_ebur128_0] Summary:", "", "  Integrated loudness:", "    I:         -16.3 LUFS", "    Threshold: -26.3 LUFS", "  True peak:", "    Peak:       -3.7 dBFS"].join("\n");
  assert.deepEqual(parseEbur128(log), { integratedLufs: -16.3, truePeakDb: -3.7 });
  assert.equal(parseEbur128("nothing here"), null);
  const sil = parseSilences("silence_start: 1.5\nsilence_end: 2.7 | silence_duration: 1.2\nsilence_start: 9.0", 10);
  assert.deepEqual(sil, [{ start: 1.5, end: 2.7 }, { start: 9, end: 10 }]);
});

// ---- speech ----------------------------------------------------------------------------------------

const WORDS = [
  { word: "Hop", start: 0.0, end: 0.3 },
  { word: "down", start: 0.35, end: 0.7 },
  { word: "the", start: 0.75, end: 0.9 },
  { word: "layers", start: 0.95, end: 1.5 },
  { word: "Then", start: 3.0, end: 3.3 },
  { word: "stop", start: 3.35, end: 3.8 },
];

test("speech: loadNarration reads word lists, voiceover shapes, scene scripts and plain text", () => {
  const write = (name: string, body: string) => {
    const f = path.join(TMP, name);
    fs.writeFileSync(f, body);
    return f;
  };
  const timed = loadNarration(write("w1.json", JSON.stringify({ words: WORDS })));
  assert.equal(timed.timed, true);
  assert.equal(timed.words.length, 6);
  const vo = loadNarration(write("w2.json", JSON.stringify({ words: [{ word: "a", punctuated_word: "A,", start: 0, end: 1 }] })));
  assert.equal(vo.words[0].word, "A,");
  const bare = loadNarration(write("w3.json", JSON.stringify([{ word: "x", startSec: 1, endSec: 2 }])));
  assert.equal(bare.words[0].start, 1);
  const script = loadNarration(write("s.json", JSON.stringify({ scenes: [{ id: "a", text: "Meet {HNSW|H N S W} today." }] })));
  assert.equal(script.timed, false);
  assert.match(script.text, /HNSW H N S W today/);
  assert.equal(loadNarration(write("n.txt", "plain words")).text, "plain words");
  assert.throws(() => loadNarration(write("bad.json", JSON.stringify({ nope: 1 }))), /expected a word list/);
  assert.throws(() => loadNarration(write("bad2.json", JSON.stringify({ words: [{ word: "x" }] }))), /needs word, start and end/);
});

test("speech: pace, pauses and cuts through words", () => {
  assert.ok(Math.abs((wordsPerMinute(WORDS) ?? 0) - (6 / 3.8) * 60) < 1e-9);
  assert.deepEqual(pauses(WORDS, 0.7), [{ start: 1.5, end: 3.0 }]);
  assert.deepEqual(cutsThroughWords(WORDS, [1.2, 2.0, 3.55], 0.12).map((c) => c.word), ["layers", "stop"]);
  assert.equal(cutsThroughWords(WORDS, [0.72], 0.12).length, 0, "a cut at a word edge is clean");
});

test("speech: cues on word starts beat chance, cues on arbitrary times do not", () => {
  const dense = Array.from({ length: 60 }, (_, i) => ({ word: `w${i}`, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const chance = chanceNearWordStarts(dense, 0.04);
  assert.ok(chance > 0.1 && chance < 0.3, `chance ${chance}`);
  assert.equal(shareNearWordStarts(dense, dense.slice(0, 20).map((w) => w.start + 0.01), 0.04), 1);
  assert.ok(shareNearWordStarts(dense, dense.slice(0, 20).map((w) => w.start + 0.2), 0.04) < 0.2);
});

test("speech: spokenNumbers reads digits and number words", () => {
  const n = spokenNumbers("A hundred million vectors, seven hundred sixty eight dimensions, seventy-seven billion operations, 1,000 checks, two to three times");
  for (const v of [1e8, 768, 77e9, 1000, 2, 3]) assert.ok(n.includes(v), `missing ${v} in ${n}`);
  assert.deepEqual(spokenNumbers("no numbers here"), []);
});

test("speech: caption words are matched against what is said near that moment", () => {
  const narration: Narration = { words: WORDS, text: "", timed: true };
  assert.equal(captionMatch("hop down the layers", narration, 1, 4), 1);
  assert.equal(captionMatch("completely different words", narration, 1, 4), 0);
  assert.equal(captionMatch("then stop", narration, 1, 0.5), 0, "words outside the time window do not count");
  assert.equal(captionMatch("a", narration, 1), null);
});

// ---- film data -------------------------------------------------------------------------------------

// A small node-graph film whose shots look at the given nodes with the given stage and move.
function nodeFilm(shots: Array<{ look: string; stage?: "anchor" | "frame" | "none"; move?: "pan" | "hold" | "cut"; zoom?: number }>): Film {
  return parseFilm({
    id: "t-film",
    title: "T",
    fps: 30,
    chapters: ["One"],
    canvas: {
      nodes: [
        { id: "a", label: "A", x: 0, y: 0 },
        { id: "b", label: "B", x: 1600, y: 0 },
        { id: "c", label: "C", x: 3200, y: 800 },
      ],
      edges: [{ from: "a", to: "b" }],
    },
    shots: shots.map((s, i) => ({ id: `s${i}`, dur: 6, look: s.look, stage: s.stage ?? "anchor", move: i === 0 ? "cut" : (s.move ?? "pan"), zoom: s.zoom ?? 1, blocks: [{ c: "TextReveal", text: "A line" }] })),
  });
}

test("source: a node-graph film that pans between nodes has camera moves, a held one has none", () => {
  const moving = readFilmFacts(nodeFilm([{ look: "a" }, { look: "b" }, { look: "c" }, { look: "a" }]));
  assert.equal(moving.camera.kind, "node-graph");
  assert.ok(moving.camera.moves.length >= 2, `moves ${moving.camera.moves.length}`);
  assert.ok(moving.camera.maxSpeed > 0);
  const held = readFilmFacts(nodeFilm([{ look: "a" }, { look: "b", move: "hold" }, { look: "c", move: "cut" }]));
  assert.equal(held.camera.moves.length, 0);
  assert.equal(held.kind, "node-graph");
});

test("source: node-graph stage persistence follows which shots keep the canvas up", () => {
  const kept = readFilmFacts(nodeFilm([{ look: "a" }, { look: "b" }, { look: "c" }]));
  assert.ok(kept.boundaries.every((b) => b.kept === b.outgoing && b.outgoing > 0));
  const cleared = readFilmFacts(nodeFilm([{ look: "a" }, { look: "b", stage: "none" }, { look: "c" }]));
  assert.equal(cleared.boundaries[0].kept, 0, "a spine shot closes the canvas");
  assert.equal(cleared.boundaries[1].outgoing, 0);
});

test("source: node overlap on the canvas is reported", () => {
  const film = nodeFilm([{ look: "a" }, { look: "b" }]);
  film.canvas.nodes[1].x = 100;
  assert.deepEqual(readFilmFacts(film).nodeOverlaps, ["a / b"]);
});

// A scene film with two shots whose elements carry (or do not carry) across the boundary at 6 s.
function sceneFilm(carry: boolean): Film {
  const clip = (clipId: string, target: string, property: string, from: number, to: number, startFrame: number, durationFrames: number) => ({ clipId, targets: [target], property, from, to, startFrame, durationFrames });
  const clips = [
    clip("a-in", "a", "opacity", 0, 1, 0, 10),
    clip("b-in", "b", "opacity", 0, 1, 0, 10),
    carry ? clip("a-move", "a", "translateX", 0, 100, 150, 40) : clip("a-out", "a", "opacity", 1, 0, 170, 10),
    carry ? clip("b-keep", "b", "scale", 1, 1.4, 160, 30) : clip("b-out", "b", "opacity", 1, 0, 170, 10),
  ];
  return parseFilm({
    id: "t-scene",
    title: "T",
    fps: 30,
    chapters: ["One"],
    canvas: { nodes: [{ id: "a", label: "A", x: 0, y: 0 }, { id: "b", label: "B", x: 400, y: 0 }], edges: [{ from: "a", to: "b" }] },
    scene: {
      schemaVersion: "1.0.0", sceneId: "s", fps: 30, durationFrames: 360, audioSource: "x.wav", audioDurationMs: 12000, sceneSize: { w: 1920, h: 1920 },
      background: { assetId: "bg", svgSource: "videos/x/visuals/bg.svg", position: { x: 0, y: 0 }, scale: 1, rotation: 0, opacity: 1, animation: { timelineId: "t", clips } },
      props: [],
    },
    shots: [{ id: "s0", dur: 6, look: "a", move: "cut", blocks: [{ c: "TextReveal", text: "One" }] }, { id: "s1", dur: 6, look: "b", blocks: [{ c: "TextReveal", text: "Two" }] }],
  });
}

test("source: scene elements that stay and transform across a boundary count as carry-over", () => {
  const kept = readFilmFacts(sceneFilm(true));
  assert.equal(kept.kind, "scene");
  assert.equal(kept.boundaries[0].outgoing, 2);
  assert.equal(kept.boundaries[0].kept, 2);
  assert.equal(kept.boundaries[0].transformed, 2);
  assert.equal(kept.camera.available, false, "the scene engine has no camera track yet");
  const cleared = readFilmFacts(sceneFilm(false));
  assert.equal(cleared.boundaries[0].kept, 0);
  assert.ok(kept.clipStarts.includes(5), "a clip starting at frame 150 is a cue at 5 s");
});

// ---- criteria --------------------------------------------------------------------------------------

const VIDEO: VideoFacts = { path: "x.mp4", durationSec: 60, width: 1920, height: 1080, fps: 30, hasAudio: true, audioDurationSec: 60 };
const RENDER: RenderFacts = { persistence: { median: 0.85, p10: 0.6, min: 0.3, weakest: [], samples: 100 }, stageClearTimes: [], hardCutTimes: [], staticRuns: [], meanCoverage: 0.04, samples: [], ocrRan: true };

// Builds review inputs with the given overrides on top of a healthy default.
function inputs(over: Partial<ReviewInputs> = {}, samples: RenderFacts["samples"] = []): ReviewInputs {
  return { video: VIDEO, render: { ...RENDER, samples }, film: null, narration: null, loudness: { integratedLufs: -16, truePeakDb: -3 }, silences: [], ...over };
}

const sample = (t: number, over: Partial<RenderFacts["samples"][number]> = {}) => ({ t, words: 10, hasCaption: true, captionLines: 1, captionText: "hop down the layers", smallWords: 1, lowContrastWords: 0, overlaps: 0, offSafe: 0, numbers: [], minHeight: 30, ...over });
const byKey = (rs: ReturnType<typeof evaluateCriteria>, key: string) => rs.find((c) => c.key === key)!;

test("criteria: a healthy video passes every gate it can be measured on and skips what it cannot", () => {
  const samples = Array.from({ length: 30 }, (_, i) => sample(i * 2 + 1));
  const rs = evaluateCriteria(inputs({}, samples));
  for (const key of ["persistent-stage", "captions", "readability", "overlap", "audio-sync"]) assert.equal(byKey(rs, key).status, "pass", key);
  assert.equal(byKey(rs, "camera").status, "skipped", "camera is never read from pixels");
  assert.equal(byKey(rs, "carry-over").status, "skipped");
  assert.equal(byKey(rs, "grounding").status, "skipped", "no narration, nothing to ground against");
  assert.ok(rs.every((c) => c.status !== "skipped" || c.score === null));
});

test("criteria: a video with no captions, a cleared stage and small text fails the gates with evidence", () => {
  const samples = Array.from({ length: 30 }, (_, i) => sample(i * 2 + 1, { hasCaption: false, captionLines: 0, smallWords: 8 }));
  const render: RenderFacts = { ...RENDER, persistence: { ...RENDER.persistence!, median: 0.5 }, stageClearTimes: [10, 20, 30, 40], samples };
  const rs = evaluateCriteria(inputs({ render }));
  assert.equal(byKey(rs, "captions").status, "fail");
  assert.equal(byKey(rs, "captions").metrics.coverage, 0);
  assert.equal(byKey(rs, "persistent-stage").status, "fail");
  assert.equal(byKey(rs, "readability").status, "fail");
  assert.ok(byKey(rs, "persistent-stage").evidence.some((e) => Math.abs(e.t - 11) < 0.01), "the frame after a stage clear is evidence");
  assert.ok(byKey(rs, "captions").evidence.length > 0);
  assert.ok(byKey(rs, "captions").fix);
});

test("criteria: captions are only required over narrated time", () => {
  const narration: Narration = { words: [{ word: "hop", start: 0, end: 1 }, { word: "down", start: 1, end: 2 }, { word: "the", start: 2, end: 3 }, { word: "layers", start: 3, end: 5 }], text: "hop down the layers", timed: true };
  const samples = [sample(1), sample(3), sample(40, { hasCaption: false, captionLines: 0 }), sample(50, { hasCaption: false, captionLines: 0 })];
  assert.equal(byKey(evaluateCriteria(inputs({ narration }, samples)), "captions").status, "pass", "unnarrated moments need no caption");
  const asked = evaluateCriteria(inputs({}, samples));
  assert.equal(byKey(asked, "captions").status, "fail", "without timings every non-silent moment is narrated");
});

test("criteria: caption text that is not the narration fails, a third caption line fails", () => {
  const narration: Narration = { words: [{ word: "something", start: 0, end: 59 }], text: "something", timed: true };
  const samples = Array.from({ length: 10 }, (_, i) => sample(i * 2 + 1));
  assert.equal(byKey(evaluateCriteria(inputs({ narration }, samples)), "captions").status, "fail");
  const tall = Array.from({ length: 10 }, (_, i) => sample(i * 2 + 1, { captionLines: 3 }));
  assert.equal(byKey(evaluateCriteria(inputs({}, tall)), "captions").status, "fail");
});

test("criteria: camera comes from film data and fails a scene film without one", () => {
  const sceneFacts = readFilmFacts(sceneFilm(true));
  assert.equal(byKey(evaluateCriteria(inputs({ film: sceneFacts })), "camera").status, "fail");
  const moving = readFilmFacts(nodeFilm([{ look: "a" }, { look: "a", zoom: 1.1 }, { look: "a", zoom: 1.2 }]));
  const ok = byKey(evaluateCriteria(inputs({ film: moving, video: { ...VIDEO, durationSec: 24, audioDurationSec: 24 } })), "camera");
  assert.equal(ok.status, "pass");
  const tooFast = { ...moving, camera: { ...moving.camera, maxSpeed: 0.9 } };
  assert.equal(byKey(evaluateCriteria(inputs({ film: tooFast, video: { ...VIDEO, durationSec: 24, audioDurationSec: 24 } })), "camera").status, "fail");
});

test("criteria: audio sync catches a length mismatch and a shot boundary through a word", () => {
  const drifted = byKey(evaluateCriteria(inputs({ video: { ...VIDEO, audioDurationSec: 61 } })), "audio-sync");
  assert.equal(drifted.status, "fail");
  const narration: Narration = { words: WORDS, text: "", timed: true };
  const film = { ...readFilmFacts(nodeFilm([{ look: "a" }, { look: "b" }])), shotBoundaries: [1.2], durationSec: 60 };
  const cut = byKey(evaluateCriteria(inputs({ film, narration })), "audio-sync");
  assert.equal(cut.status, "fail");
  assert.match(cut.summary, /cut through a spoken word/);
  assert.equal(byKey(evaluateCriteria(inputs({ video: { ...VIDEO, hasAudio: false, audioDurationSec: null } })), "audio-sync").status, "skipped");
});

test("criteria: pacing fails hard cuts, loudness fails a hot mix, grounding fails unspoken numbers", () => {
  const cuts = byKey(evaluateCriteria(inputs({ render: { ...RENDER, hardCutTimes: [5, 10, 15, 20] } })), "pacing");
  assert.equal(cuts.status, "fail");
  assert.equal(byKey(evaluateCriteria(inputs({ loudness: { integratedLufs: -9, truePeakDb: 0 } })), "loudness").status, "fail");
  const narration: Narration = { words: [], text: "a hundred million vectors in seven hundred sixty eight dimensions", timed: false };
  const samples = [sample(1, { numbers: ["768", "100,000,000", "64", "01"] })];
  const g = byKey(evaluateCriteria(inputs({ narration }, samples)), "grounding");
  assert.equal(g.status, "fail");
  assert.equal(g.metrics.ungrounded, 1, "only 64 is never said; 01 is a chapter number");
});

test("criteria: cue timing needs word timings and a lift over chance", () => {
  const film = readFilmFacts(sceneFilm(true));
  assert.equal(byKey(evaluateCriteria(inputs({ film })), "cue-timing").status, "skipped");
  const words = Array.from({ length: 40 }, (_, i) => ({ word: `w${i}`, start: i * 0.3, end: i * 0.3 + 0.2 }));
  const aimed = { ...film, clipStarts: words.slice(0, 20).map((w) => w.start) };
  const loose = { ...film, clipStarts: words.slice(0, 20).map((w) => w.start + 0.15) };
  const narration: Narration = { words, text: "", timed: true };
  assert.equal(byKey(evaluateCriteria(inputs({ film: aimed, narration })), "cue-timing").status, "pass");
  assert.equal(byKey(evaluateCriteria(inputs({ film: loose, narration })), "cue-timing").status, "fail");
});

// ---- end to end ------------------------------------------------------------------------------------

// Renders a synthetic 1920x1080 video with ffmpeg: a persistent stage ("stable") or one replaced every 3 s ("cleared").
function synth(name: string, kind: "stable" | "cleared", extra: string[] = []): string {
  const out = path.join(TMP, `${name}.mp4`);
  const boxes = (x: number, enable: string) => [0, 1, 2, 3].map((k) => `drawbox=x=${x + k * 260}:y=${180 + (k % 2) * 300}:w=200:h=200:color=white@1:t=fill:enable='${enable}'`).join(",");
  const stage =
    kind === "stable"
      ? `${boxes(300, "1")},drawbox=x='300+20*t':y=800:w=120:h=120:color=white:t=fill`
      : `${boxes(100, "lt(mod(t,6),3)")},${boxes(900, "between(mod(t,6),3.4,6)")}`;
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x0a0a0b:s=1920x1080:r=10:d=24", "-f", "lavfi", "-i", "sine=frequency=220:duration=24", "-vf", stage, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", ...extra, out]);
  assert.equal(r.status, 0, r.stderr?.toString());
  return out;
}

test("review: a stable stage passes persistence, a stage replaced every beat fails it with evidence frames", { skip: !HAVE_FFMPEG }, async () => {
  const stable = await reviewVideo({ target: synth("stable", "stable"), outDir: path.join(TMP, "out-stable"), skipOcr: true });
  const cleared = await reviewVideo({ target: synth("cleared", "cleared"), outDir: path.join(TMP, "out-cleared"), skipOcr: true });
  const st = byKey(stable.criteria, "persistent-stage");
  const cl = byKey(cleared.criteria, "persistent-stage");
  assert.equal(st.status, "pass", st.summary);
  assert.equal(cl.status, "fail", cl.summary);
  assert.ok((st.metrics.layoutCorrelationMedian as number) > (cl.metrics.layoutCorrelationMedian as number));
  assert.ok((cl.metrics.stageClearEvents as number) >= 3);
  assert.equal(stable.passed, true);
  assert.deepEqual(cleared.gateFailures, ["persistent-stage"]);
  assert.equal(byKey(stable.criteria, "captions").status, "skipped", "OCR was skipped, so captions are unmeasured, not passed");
  // The report and an evidence frame for each failing criterion's first moment were written.
  const written = JSON.parse(fs.readFileSync(path.join(TMP, "out-cleared", "review.json"), "utf8"));
  assert.equal(written.schema, "aideos.review/1");
  assert.equal(written.passed, false);
  const frame = written.criteria.find((c: { key: string }) => c.key === "persistent-stage").evidence[0].frame as string;
  assert.ok(frame && fs.existsSync(path.join(TMP, "out-cleared", frame)), `evidence frame ${frame}`);
  assert.ok(written.recommendations[0].startsWith("[gate] One persistent stage"));
  assert.ok(byKey(stable.criteria, "loudness").metrics.integratedLufs !== undefined);
});

test("review: the CLI exits 0 when the gates pass, 1 when one fails, 2 when it cannot run", { skip: !HAVE_FFMPEG }, () => {
  const run = (args: string[]) => spawnSync("npx", ["tsx", path.join(__dirname, "../cli.ts"), "review", ...args], { encoding: "utf8", cwd: path.join(__dirname, "../..") });
  const ok = run([synth("cli-stable", "stable"), "--no-ocr", "--out", path.join(TMP, "cli-ok"), "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).passed, true);
  const bad = run([synth("cli-cleared", "cleared"), "--no-ocr", "--out", path.join(TMP, "cli-bad")]);
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stdout, /FAIL .*cli-cleared\.mp4/);
  const missing = run([path.join(TMP, "nope.mp4")]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no video/);
});

test("review: a slug that has no film or no rendered video explains what is missing", async () => {
  await assert.rejects(() => reviewVideo({ target: "definitely-not-a-film", noWrite: true }), /neither an mp4 nor a film/);
});

test("review: burned-in captions at the bottom are read by OCR end to end", { skip: !(HAVE_FFMPEG && HAVE_TESSERACT && FONT) }, async () => {
  const out = path.join(TMP, "captioned.mp4");
  const text = "the quick brown fox jumps over";
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x0a0a0b:s=1920x1080:r=10:d=12", "-vf", `drawtext=fontfile=${FONT}:text='${text}':fontsize=54:fontcolor=white:x=(w-text_w)/2:y=900`, "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
  assert.equal(r.status, 0, r.stderr?.toString());
  const captioned = await reviewVideo({ target: out, noWrite: true, words: (() => { const f = path.join(TMP, "cap.txt"); fs.writeFileSync(f, text); return f; })() });
  const caps = byKey(captioned.criteria, "captions");
  assert.equal(caps.status, "pass", caps.summary);
  assert.equal(caps.metrics.coverage, 1);
  assert.equal(caps.metrics.captionWordMatch, 1);
  const bare = path.join(TMP, "bare.mp4");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x0a0a0b:s=1920x1080:r=10:d=12", "-c:v", "libx264", "-pix_fmt", "yuv420p", bare]);
  assert.equal(byKey((await reviewVideo({ target: bare, noWrite: true })).criteria, "captions").status, "skipped", "a silent video with no narration has nothing to caption");
});
