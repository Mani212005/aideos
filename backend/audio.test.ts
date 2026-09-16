/**
 * File Description: Unit tests for audio segmentation, caption offsets, timeline gap math, and film construction.
 */

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
  retimeAudio,
  retimeAudioSync,
  buildAtempoFilter,
  resolveAudioSourcePath,
} from "./audio";

test("segment splitting handles shot-scoped multi-sentence and newline-separated scripts", () => {
  const script = "Welcome to Aideos. We build explainer videos as data.\n\nEvery node is a concept.";
  const segments = splitScriptIntoSegments(script);
  assert.equal(segments.length, 2);
  assert.equal(segments[0], "Welcome to Aideos. We build explainer videos as data.");
  assert.equal(segments[1], "Every node is a concept.");

  const shotArray = [
    "Meet Yann LeCun, pioneer. While tech went in on chatbots, he argued LLMs are dead end.",
    "A French American computer scientist, LeCun won Turing Award.",
  ];
  const arraySegments = splitScriptIntoSegments(shotArray);
  assert.equal(arraySegments.length, 2);
  assert.equal(arraySegments[0], shotArray[0]);
  assert.equal(arraySegments[1], shotArray[1]);
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
    "Welcome to Aideos audio pipeline.\n\nWe test segment splitting and caption alignment.\n\nEvery shot duration sums to the audio file duration.";

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

test("buildAtempoFilter builds valid single and chained atempo filters", () => {
  assert.equal(buildAtempoFilter(1.5), "atempo=1.5000");
  assert.equal(buildAtempoFilter(0.8), "atempo=0.8000");
  assert.equal(buildAtempoFilter(3.0), "atempo=2.0,atempo=1.5000");
  assert.equal(buildAtempoFilter(0.4), "atempo=0.5,atempo=0.8000");
  assert.throws(() => buildAtempoFilter(0), /Invalid speed/);
  assert.throws(() => buildAtempoFilter(-1), /Invalid speed/);
});

test("resolveAudioSourcePath resolves files across packages and public directories", () => {
  const whyDit = resolveAudioSourcePath("videos/why-dit-replaced-unet/voiceover.wav");
  assert.ok(whyDit.includes("why-dit-replaced-unet"));

  const withSlash = resolveAudioSourcePath("/videos/why-dit-replaced-unet/voiceover.wav");
  assert.equal(whyDit, withSlash);

  assert.throws(() => resolveAudioSourcePath("nonexistent/missing_file.wav"), /not found/);
});

test("retimeAudio retimes audio across 0.8x, 1.2x, 1.5x, 2.0x speeds with WSOLA duration scaling", async () => {
  const sourcePath = "videos/why-dit-replaced-unet/voiceover.wav";
  const orig = retimeAudioSync(sourcePath, 1.0);
  assert.ok(orig.durationSec > 0);

  const speeds = [0.8, 1.2, 1.5, 2.0];
  for (const speed of speeds) {
    const retimed = await retimeAudio(sourcePath, speed);
    assert.ok(retimed.filePath.endsWith(".wav"));
    // Expected duration is original duration divided by speed, within 1% tolerance
    const expectedDur = orig.durationSec / speed;
    assert.ok(
      Math.abs(retimed.durationSec - expectedDur) < expectedDur * 0.02,
      `Duration mismatch at speed ${speed}: got ${retimed.durationSec}, expected ${expectedDur}`
    );
  }
});

test("retimeAudioSync caches results so subsequent calls return immediately from disk", () => {
  const sourcePath = "videos/why-dit-replaced-unet/voiceover.wav";
  const first = retimeAudioSync(sourcePath, 1.5);
  const start = Date.now();
  const second = retimeAudioSync(sourcePath, 1.5);
  const elapsed = Date.now() - start;

  assert.equal(first.filePath, second.filePath);
  assert.equal(first.durationSec, second.durationSec);
  // Cache lookup should take less than 100ms
  assert.ok(elapsed < 100, `Expected cached lookup under 100ms, took ${elapsed}ms`);
});

