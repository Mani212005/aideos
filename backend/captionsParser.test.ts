/**
 * File Description: Unit and integration tests for WebVTT caption parsing, word frame alignment, and VTT serialization.
 * Inputs and outputs: sample WebVTT caption tracks -> parser test assertions.
 * Used by: npm test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVtt, vttToCaptionWords, generateWordsFromFilm, captionWordsToVtt } from "../src/dl/captionsParser";

// Tests parsing raw WebVTT strings into structured VttCue objects.
test("Captions: parseVtt correctly parses multiline WebVTT cue timestamps and text", () => {
  const sampleVtt = `WEBVTT

00:00:01.000 --> 00:00:03.500
First segment of narration.

00:00:04.000 --> 00:00:06.000
Second segment with more details.
`;

  const cues = parseVtt(sampleVtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startSec, 1.0);
  assert.equal(cues[0].endSec, 3.5);
  assert.equal(cues[0].text, "First segment of narration.");
  assert.equal(cues[1].startSec, 4.0);
  assert.equal(cues[1].endSec, 6.0);
  assert.equal(cues[1].text, "Second segment with more details.");
});

// A narrated number on its own is a cue of digits: it is cue text, never a cue identifier.
test("Captions: parseVtt keeps single-word numeric cues and drops only identifiers above a timing line", () => {
  const vtt = `WEBVTT

NOTE a comment block

1
00:00:00.000 --> 00:00:00.500
2026

intro
00:00:00.500 --> 00:00:01.000 align:start
42

00:00:01.000 --> 00:00:02.000
in 2026
7
`;
  assert.deepEqual(parseVtt(vtt), [
    { startSec: 0, endSec: 0.5, text: "2026" },
    { startSec: 0.5, endSec: 1, text: "42" },
    { startSec: 1, endSec: 2, text: "in 2026 7" },
  ]);
  // The words of a one-word numeric cue survive the whole caption path.
  assert.deepEqual(generateWordsFromFilm({ fps: 30, captions: vtt }).map((w) => w.text), ["2026", "42", "in", "2026", "7"]);
});

// Property: whatever the words are (numbers included), writing a track and reading it back keeps every word in order, and a one-word cue keeps its exact frames.
test("Captions: a written track reads back every word for any mix of numbers and text, exact frames at one word per cue", () => {
  let seed = 20261121;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
  const pool = ["2026", "42", "007", "3.5", "1", "ship", "the", "balancer", "GPU", "v2", "100%"];
  for (let run = 0; run < 200; run++) {
    const fps = [24, 25, 30, 60][Math.floor(next() * 4)];
    const count = 1 + Math.floor(next() * 30);
    let frame = Math.floor(next() * 10);
    const words = Array.from({ length: count }, () => {
      const startFrame = frame;
      frame += 1 + Math.floor(next() * 40);
      return { text: pool[Math.floor(next() * pool.length)], startFrame, endFrame: frame };
    });
    const perCue = 1 + Math.floor(next() * 6);
    const texts = generateWordsFromFilm({ fps, captions: captionWordsToVtt(words, fps, perCue) }).map((w) => w.text);
    assert.deepEqual(texts, words.map((w) => w.text), `run ${run}: ${perCue} per cue at ${fps} fps`);
    assert.deepEqual(generateWordsFromFilm({ fps, captions: captionWordsToVtt(words, fps, 1) }), words, `run ${run}: one word per cue at ${fps} fps`);
  }
});

// Tests converting VttCue objects into discrete CaptionWord items with frame timestamps.
test("Captions: vttToCaptionWords generates evenly spaced word frame bounds matching fps", () => {
  const cues = [
    {
      startSec: 0.0,
      endSec: 2.0,
      text: "Hello world explainer",
    },
  ];

  const fps = 30;
  const words = vttToCaptionWords(cues, fps);
  assert.equal(words.length, 3);
  assert.equal(words[0].text, "Hello");
  assert.equal(words[0].startFrame, 0);
  assert.equal(words[2].text, "explainer");
  assert.equal(words[2].endFrame, 60);
});

// Tests generating caption words dynamically from film shots and script text.
test("Captions: generateWordsFromFilm derives words from shot scriptText when captions field is absent", () => {
  const film = {
    fps: 30,
    shots: [
      {
        dur: 2.0,
        scriptText: "Fast attention mechanism",
        blocks: [],
      },
      {
        dur: 3.0,
        scriptText: "Saves GPU memory bandwidth",
        blocks: [],
      },
    ],
  };

  const words = generateWordsFromFilm(film);
  assert.equal(words.length, 7);
  assert.equal(words[0].text, "Fast");
  assert.equal(words[0].startFrame, 0);
  assert.equal(words[3].text, "Saves");
  assert.equal(words[3].startFrame, 60);
});

// Tests converting CaptionWord array back into valid WebVTT string format.
test("Captions: captionWordsToVtt chunks words into standard WebVTT cues", () => {
  const words = [
    { text: "Word1", startFrame: 0, endFrame: 15 },
    { text: "Word2", startFrame: 15, endFrame: 30 },
    { text: "Word3", startFrame: 30, endFrame: 45 },
  ];

  const vtt = captionWordsToVtt(words, 30);
  assert.ok(vtt.startsWith("WEBVTT"));
  assert.ok(vtt.includes("-->"));
  assert.ok(vtt.includes("Word1 Word2 Word3"));
});
