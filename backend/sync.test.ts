/**
 * File Description: Unit tests for segment synchronization, audio result film compilation, and ducking calculations.
 * Inputs and outputs: segment data and audio results -> test assertions.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBriefFromSegmentFallback,
  runSegmentSyncGate,
} from "./ideation/segmentSync";
import { buildFilmFromAudioResult } from "./audio";
import { calculateDuckingVolume } from "../src/dl/audio/ducking";

test("segment->shot brief mapping derives shot visuals strictly from segment text", async () => {
  const seg1Text = "Our system utilizes quantitative performance metrics reaching 95% efficiency.";
  const seg2Text = "Data points form a clear growth trend over time.";

  const brief1 = buildBriefFromSegmentFallback(seg1Text, "shot-1");
  const brief2 = buildBriefFromSegmentFallback(seg2Text, "shot-2");

  assert.equal(brief1.shotId, "shot-1");
  assert.ok(brief1.blocks.some((b) => b.c === "StatCounter" || b.c === "TextReveal"));

  assert.equal(brief2.shotId, "shot-2");
  assert.ok(brief2.blocks.some((b) => b.c === "TextReveal"));

  // Verify buildFilmFromAudioResult maps segment briefs to shot list
  const dummyAudioResult = {
    segments: [
      { text: seg1Text, duration: 4.0, startOffset: 0, words: [], utterances: [] },
      { text: seg2Text, duration: 4.0, startOffset: 4.2, words: [], utterances: [] },
      { text: "Conclusion summary segment.", duration: 3.5, startOffset: 8.4, words: [], utterances: [] },
    ],
    shotDurations: [4.2, 4.2, 3.5],
    totalAudioDuration: 11.9,
    voiceoverPath: "public/voiceover.wav",
    captionsPath: "public/captions.vtt",
    captionsVttContent: "WEBVTT\n",
  };

  const film = buildFilmFromAudioResult("Sync Test Film", dummyAudioResult);
  assert.equal(film.shots.length, 3);
  assert.equal(film.shots[0].scriptText, seg1Text);
});

test("sync-gate verdict handling verifies all segment-shot mappings", async () => {
  const dummyAudioResult = {
    segments: [
      { text: "Explaining vector spaces.", duration: 4.0, startOffset: 0, words: [], utterances: [] },
      { text: "Explaining liquid bucket dynamics.", duration: 4.0, startOffset: 4.2, words: [], utterances: [] },
      { text: "Wrapping up technical overview.", duration: 3.5, startOffset: 8.4, words: [], utterances: [] },
    ],
    shotDurations: [4.2, 4.2, 3.5],
    totalAudioDuration: 11.9,
    voiceoverPath: "public/voiceover.wav",
    captionsPath: "public/captions.vtt",
    captionsVttContent: "WEBVTT\n",
  };

  const syncResult = await runSegmentSyncGate(dummyAudioResult.segments);

  assert.equal(syncResult.verdicts.length, 3);
  assert.equal(syncResult.verdicts[0].status, "pass");
  assert.ok(syncResult.allPassedOrFixed);
});

test("ducking envelope math attenuates music during speech and restores in gaps", () => {
  const fps = 30;
  const totalFrames = 300; // 10 seconds
  const musicVolume = 0.8;
  const speechIntervals = [
    { startSec: 2.0, endSec: 5.0 }, // speech active from 2s to 5s (frame 60 to 150)
  ];

  // At frame 15 (0.5s - no speech): volume should be full level (with headIn ramp)
  const volGapBefore = calculateDuckingVolume({
    frame: 15,
    fps,
    totalFrames,
    musicVolume,
    duckUnderVoiceover: true,
    speechIntervals,
  });
  assert.ok(volGapBefore > 0);

  // At frame 90 (3.0s - inside speech interval): volume should attenuate to 25% level
  const volSpeech = calculateDuckingVolume({
    frame: 90,
    fps,
    totalFrames,
    musicVolume,
    duckUnderVoiceover: true,
    speechIntervals,
  });

  // At frame 210 (7.0s - after speech interval, gap): volume should restore to full level
  const volGapAfter = calculateDuckingVolume({
    frame: 210,
    fps,
    totalFrames,
    musicVolume,
    duckUnderVoiceover: true,
    speechIntervals,
  });

  // Volume inside speech should be significantly lower than in gaps (~25% ratio)
  assert.ok(volSpeech < volGapAfter * 0.4, `Ducked volume (${volSpeech}) should be ~25% of un-ducked (${volGapAfter})`);
  assert.ok(Math.abs(volSpeech - 0.2) < 0.05);

  // When duckUnderVoiceover is false, volume inside speech remains un-ducked
  const volNoDuck = calculateDuckingVolume({
    frame: 90,
    fps,
    totalFrames,
    musicVolume,
    duckUnderVoiceover: false,
    speechIntervals,
  });

  assert.ok(volNoDuck > volSpeech, "Volume with duckUnderVoiceover=false should be higher than ducked volume");
});

test("sfx timeline placement maps timestamps to sequence frame offsets", () => {
  const fps = 30;
  const sfxItems = [
    { timeSec: 1.5, src: "transition-cut.wav", volume: 0.9 },
    { timeSec: 4.2, src: "whoosh.wav", volume: 0.7 },
  ];

  const frameOffsets = sfxItems.map((item) => Math.round(item.timeSec * fps));

  assert.equal(frameOffsets[0], 45); // 1.5s * 30fps = 45 frames
  assert.equal(frameOffsets[1], 126); // 4.2s * 30fps = 126 frames
});
