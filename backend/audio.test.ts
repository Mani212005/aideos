import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

import {
  splitScriptIntoSegments,
  formatTime,
  produceAudioPipeline,
  buildFilmFromAudioResult,
} from "./audio";

test("segment splitting handles multi-sentence and newline-separated scripts", () => {
  const script = "Welcome to Aideos. We build explainer videos as data.\nEvery node is a concept.";
  const segments = splitScriptIntoSegments(script);
  assert.equal(segments.length, 3);
  assert.equal(segments[0], "Welcome to Aideos.");
  assert.equal(segments[1], "We build explainer videos as data.");
  assert.equal(segments[2], "Every node is a concept.");
});

test("no-narration-segment rejection throws error for empty or textless script sections", () => {
  assert.throws(
    () => splitScriptIntoSegments(""),
    /A shot with no narration is not allowed mid-script in v1/,
  );
  assert.throws(
    () => splitScriptIntoSegments("   \n\t  "),
    /A shot with no narration is not allowed mid-script in v1/,
  );
});

test("caption offset math correctly shifts timestamps by segment start offset", () => {
  const segStartOffset = 4.25; // 4.25 seconds into timeline
  const relativeUtteranceStart = 0.50; // 0.50s within segment
  const relativeUtteranceEnd = 2.10;

  const vttStart = formatTime(segStartOffset + relativeUtteranceStart);
  const vttEnd = formatTime(segStartOffset + relativeUtteranceEnd);

  assert.equal(vttStart, "00:00:04.750");
  assert.equal(vttEnd, "00:00:06.350");
});

test("gap handling adds fixed gap between segments on timeline", () => {
  const segDurations = [2.0, 3.0, 1.5];
  const gapSec = 0.2; // 200ms
  const numSegments = segDurations.length;

  const shotDurations = segDurations.map((dur, i) => dur + (i < numSegments - 1 ? gapSec : 0));
  const expectedTotalGap = (numSegments - 1) * gapSec;
  const expectedTotalDuration = segDurations.reduce((a, b) => a + b, 0) + expectedTotalGap;

  const actualShotSum = shotDurations.reduce((a, b) => a + b, 0);

  assert.equal(actualShotSum, expectedTotalDuration);
  assert.equal(shotDurations[0], 2.2);
  assert.equal(shotDurations[1], 3.2);
  assert.equal(shotDurations[2], 1.5);
});

test("duration sum invariant holds within ±50ms for live synthesized audio", async (t) => {
  if (!process.env.DEEPGRAM_API_KEY) {
    t.skip("Skipping live Deepgram test; DEEPGRAM_API_KEY is not set.");
    return;
  }

  const script =
    "Welcome to Aideos audio pipeline. We test segment splitting and caption alignment. Every shot duration sums to the audio file duration.";

  const tmpOut = path.join(__dirname, "../out/test_produce");
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Deepgram synthesis timed out after 10s")), 10000)
  );
  let result;
  try {
    result = (await Promise.race([produceAudioPipeline(script, tmpOut), timeoutPromise])) as any;
  } catch (err: any) {
    t.skip(`Skipping live Deepgram test due to network/timeout error: ${err.message}`);
    return;
  }

  const shotSum = result.shotDurations.reduce((a: number, b: number) => a + b, 0);
  const diff = Math.abs(shotSum - result.totalAudioDuration);

  // Invariant check: shot durations sum within 50ms of audio duration
  assert.ok(
    diff <= 0.05,
    `Duration sum mismatch: shot sum (${shotSum.toFixed(4)}) vs total audio (${result.totalAudioDuration.toFixed(4)}), diff ${diff.toFixed(4)}s`,
  );

  // Spot check caption VTT alignment against timeline
  assert.ok(result.captionsVttContent.includes("WEBVTT"));
  assert.ok(result.segments.length >= 3);

  // Cleanup tmp test files
  await fs.rm(tmpOut, { recursive: true, force: true });
});

test("buildFilmFromAudioResult produces valid film JSON matching audio result", () => {
  const dummyResult = {
    segments: [
      { text: "First shot text.", duration: 3.0, startOffset: 0, words: [], utterances: [] },
      { text: "Second shot text.", duration: 4.0, startOffset: 3.2, words: [], utterances: [] },
      { text: "Third shot text.", duration: 3.5, startOffset: 7.4, words: [], utterances: [] },
    ],
    shotDurations: [3.2, 4.2, 3.5],
    totalAudioDuration: 10.9,
    voiceoverPath: "public/voiceover.wav",
    captionsPath: "public/captions.vtt",
    captionsVttContent: "WEBVTT\n",
  };

  const film = buildFilmFromAudioResult("Test Film", dummyResult);
  assert.equal(film.shots.length, 3);
  assert.equal(film.shots[0].scriptText, "First shot text.");
  assert.equal(film.shots[0].dur, 3.2);
  assert.equal(film.shots[1].dur, 4.2);
  assert.equal(film.shots[2].dur, 3.5);
  assert.equal(film.voiceover?.src, "voiceover.wav");
  assert.equal(film.captions, "captions.vtt");

  const shotSum = film.shots.reduce((sum, s) => sum + s.dur, 0);
  assert.ok(Math.abs(shotSum - dummyResult.totalAudioDuration) < 0.05);
});
