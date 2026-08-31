/**
 * File Description: Unit and integration tests for WebVTT caption parsing, word frame alignment, and VTT serialization.
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
