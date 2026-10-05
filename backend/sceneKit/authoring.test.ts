/**
 * File Description: Tests for the scene kit's authoring layer: the Canvas (motion continuity and
 * kinetic lyric lines), SVG primitives, type metrics and balanced wrapping, frame furniture, the
 * word-measurement helpers, and the voiceover step's alignment and spine reading. They run on
 * plain fixtures with no network, TTS, browser or real film package.
 * Inputs and outputs: canvas markup, typography measurements, and cues -> test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseSvgDocument, collectSvgElementIds } from "../../src/dl/scene/svgDocument";
import { Canvas, PAL, DEFAULT_ACCENT, W, H, OY, FORMAT_WINDOWS, rng, text, measureText, tokenWidth, wrapBalanced, backdropSvg, corners, hudTag, readoutSeries, type NarrationTiming } from "./index";
import { displayWords, unmeasuredWords } from "./measureWords";
import { alignWords, readVoiceoverTiming, timingPath } from "./voiceover";

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

/** A line whose first token is spelled out letter by letter: "H N S W is fast". */
const SPELLED: NarrationTiming = {
  totalDurationSec: 3,
  segments: [
    {
      shotId: "spell",
      text: "H N S W is fast",
      startSec: 0,
      durationSec: 3,
      words: ["H", "N", "S", "W", "is", "fast"].map((word, i) => ({ word, startSec: i * 0.3, endSec: i * 0.3 + 0.25 })),
    },
  ],
};

test("window geometry is the wide cut's strip through the square scene", () => {
  assert.equal(W, FORMAT_WINDOWS.wide.x1 - FORMAT_WINDOWS.wide.x0);
  assert.equal(H, 1080);
  assert.equal(OY, 420);
});

test("canvas: a lyric whose words are not the narration fails the build", () => {
  const c = new Canvas("t", TIMING, 90);
  assert.throws(() => c.lyric({ beat: "hello", rows: ["Hello brave planet"], x: 100, y: 200, size: 80 }), /do not match the narration/);
});

test("canvas: a row too wide for its bounds fails instead of overflowing the frame", () => {
  const c = new Canvas("t", TIMING, 90);
  assert.throws(() => c.lyric({ beat: "hello", rows: ["Hello brave world"], x: 100, y: 200, size: 400 }), /outside/);
});

test("canvas: each word lands on the frame it is spoken, one frame ahead", () => {
  const c = new Canvas("t", TIMING, 90);
  const line = c.lyric({ beat: "hello", rows: ["Hello brave world"], x: 100, y: 200, size: 60, exit: "hold" });
  assert.deepEqual(line.words.map((w) => w.startFrame), [0, 11, 23]);
});

test("canvas: a display token may cover several spoken words and lands on the first", () => {
  const c = new Canvas("t", SPELLED, 90);
  const line = c.lyric({ beat: "spell", rows: ["HNSW{4} is fast"], x: 100, y: 200, size: 60, exit: "hold" });
  assert.deepEqual(line.words.map((w) => w.text), ["HNSW", "is", "fast"]);
  assert.equal(line.words[0].startFrame, 0);
  assert.equal(line.words[1].startFrame, Math.round(1.2 * 30) - 1, "the next word is cued on its own spoken word, after the four letters");
  assert.throws(() => new Canvas("t", SPELLED, 90).lyric({ beat: "spell", rows: ["HNSW{3} is fast"], x: 100, y: 200, size: 60 }), /do not match the narration/);
});

test("canvas: accent spans take the film's accent, and the design accent when none is given", () => {
  const withAccent = new Canvas("t", TIMING, 90, { accent: "#35E0A1" });
  withAccent.lyric({ beat: "hello", rows: ["Hello *brave* world"], x: 100, y: 200, size: 60, exit: "hold" });
  assert.match(withAccent.svg(), /fill="#35E0A1"/);
  const plain = new Canvas("t", TIMING, 90);
  plain.lyric({ beat: "hello", rows: ["Hello *brave* world"], x: 100, y: 200, size: 60, exit: "hold" });
  assert.match(plain.svg(), new RegExp(`fill="${DEFAULT_ACCENT}"`));
});

test("canvas: motion helpers refuse a clip that overlaps the previous one on the same property", () => {
  const c = new Canvas("t", TIMING, 90);
  c.to("a", "translateX", 10, 0, 20);
  assert.throws(() => c.to("a", "translateX", 20, 10, 30), /overlaps/);
  // Starting where the last clip ended is fine, and begins from its end value by construction.
  c.to("a", "translateX", 20, 20, 30);
  const clips = c.timeline().clips;
  assert.equal(clips[1].from, 10, "the second clip starts from where the first left the value");
});

test("canvas: a value declared with init() but never animated is pinned, not left visible", () => {
  const c = new Canvas("t", TIMING, 90);
  c.init("hidden", { opacity: 0 });
  const clips = c.timeline().clips;
  assert.ok(clips.some((clip) => clip.targets.includes("hidden") && clip.property === "opacity" && clip.from === 0 && clip.to === 0));
});

test("canvas: mark and wrapSince group everything added after the mark into one element", () => {
  const c = new Canvas("t", TIMING, 90);
  c.add(text("before", { size: 20, id: "before" }));
  const mark = c.mark();
  c.add(text("one", { size: 20, id: "one" }));
  c.add(text("two", { size: 20, id: "two" }));
  c.wrapSince(mark, "group");
  const svg = c.svg();
  const ids = collectSvgElementIds(parseSvgDocument(svg));
  assert.ok(ids.includes("group"));
  assert.match(svg, /<g id="group">[\s\S]*id="one"[\s\S]*id="two"[\s\S]*<\/g>/);
  assert.ok(svg.indexOf('id="before"') < svg.indexOf('id="group"'), "markup before the mark stays outside the group");
});

test("canvas: svg() is a parseable full-scene document with the window offset applied once", () => {
  const c = new Canvas("t", TIMING, 90);
  c.add(text("hi", { size: 20, id: "hi" }));
  const svg = c.svg();
  assert.match(svg, /viewBox="0 0 1920 1920"/);
  assert.match(svg, new RegExp(`translate\\(0 ${OY}\\)`));
  assert.doesNotThrow(() => parseSvgDocument(svg));
});

test("svg: rng is deterministic per seed and text() escapes its content", () => {
  const a = rng(7);
  const b = rng(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(rng(7)(), rng(8)());
  assert.match(text("a < b & c", { size: 20 }), /a &lt; b &amp; c/);
});

test("type metrics: trailing punctuation adds its own glyph width to the measured word", () => {
  const bare = tokenWidth("fast", 60, "sans", 800, -0.03);
  const withStop = tokenWidth("fast.", 60, "sans", 800, -0.03);
  assert.ok(Math.abs(withStop - bare - measureText(".", 60, "sans", 800, -0.03)) < 1e-9);
  assert.equal(tokenWidth("fast", 60, "mono", 500, 0), 4 * 0.6 * 60, "mono is fixed pitch");
});

test("wrapBalanced: rows fit the limit, and a stray word is not left alone on the last row", () => {
  const line = "The honest way to answer is to *measure the distance* to *every single one.*";
  const opts = { size: 58, maxWidth: 680 };
  const rows = wrapBalanced(line, opts);
  assert.ok(rows.length >= 2);
  assert.equal(rows.join(" "), line, "no token is dropped or reordered");
  const widths = rows.map((r) => r.split(" ").reduce((sum, t, i) => sum + tokenWidth(t.replace(/\*/g, ""), 58, "sans", 800, -0.03) + (i ? measureText(" ", 58, "sans", 800, -0.03) : 0), 0));
  for (const w of widths) assert.ok(w <= opts.maxWidth + 0.5, `row of ${Math.round(w)}px fits ${opts.maxWidth}`);
  assert.ok(Math.min(...widths) > 0.55 * Math.max(...widths), "rows are even, not one long and one short");
  assert.deepEqual(wrapBalanced("", opts), []);
  assert.deepEqual(wrapBalanced("one", opts), ["one"]);
});

test("frame furniture: the backdrop and corners are valid scene markup in the window", () => {
  const backdrop = backdropSvg({ accent: "#35E0A1" });
  assert.doesNotThrow(() => parseSvgDocument(backdrop));
  assert.match(backdrop, /#35E0A1/);
  assert.match(backdrop, new RegExp(`y="${OY}" width="${W}" height="${H}"`));
  assert.equal((corners().match(/<path/g) ?? []).length, 4);
  assert.match(hudTag("A / B"), new RegExp(PAL.muted));
});

test("frame furniture: a readout series shows exactly one value at a time", () => {
  const c = new Canvas("t", TIMING, 90);
  readoutSeries(c, "r", 100, 100, [{ label: "1", frame: 0 }, { label: "2", frame: 30 }, { label: "3", frame: 60 }]);
  const clips = c.timeline().clips;
  const onFor = (id: string) => clips.filter((clip) => clip.targets.includes(id) && clip.property === "opacity");
  assert.equal(onFor("r-1").length, 2, "the middle value is cut on and off");
  assert.equal(onFor("r-0").length, 1, "the first value starts visible and is cut off");
});

test("measureWords: display words are bare, in both cases, and only unmeasured ones are queued", () => {
  const words = displayWords(["Hello, *world*. HNSW:*{4} ok"], ["Extra"]);
  assert.deepEqual(words, ["Extra", "HNSW", "Hello", "OK", "WORLD", "world", "HELLO", "ok"].sort());
  const table = { "500": { Hello: 3 }, "800": { Hello: 3, ok: 1 } };
  assert.deepEqual(unmeasuredWords(["Hello", "ok"], table as never), ["ok"]);
});

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

test("voiceover: the spine is read from the film's own package and a missing one says how to make it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-voiceover-"));
  try {
    assert.throws(() => readVoiceoverTiming("demo", "shot-spine.json", root), /Missing .*shot-spine\.json/);
    fs.mkdirSync(path.join(root, "videos/demo"), { recursive: true });
    fs.writeFileSync(timingPath("demo", "shot-spine.json", root), JSON.stringify(TIMING));
    assert.deepEqual(readVoiceoverTiming("demo", "shot-spine.json", root).segments[0].shotId, "hello");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
