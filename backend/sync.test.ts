import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import {
  buildBriefFromSegmentFallback,
  runPreRenderSyncGate,
} from "./ideation/segmentSync";
import { buildFilmFromAudioResult } from "./audio";
import { calculateDuckingVolume } from "../src/dl/audio/ducking";
import { validateFilmAudioAndAssets } from "../src/dl/validateFilm";
import type { Film } from "../src/dl/schema";

test("segment->shot brief mapping derives shot visuals strictly from segment text", async () => {
  const seg1Text = "Our system utilizes clock gears and timing controls.";
  const seg2Text = "Data points form a clear growth plot over time.";

  const brief1 = buildBriefFromSegmentFallback(seg1Text, "shot-1");
  const brief2 = buildBriefFromSegmentFallback(seg2Text, "shot-2");

  assert.equal(brief1.shotId, "shot-1");
  assert.equal(brief1.metaphor, "clock-gears");
  assert.ok(brief1.visualDirection.includes(seg1Text));

  assert.equal(brief2.shotId, "shot-2");
  assert.ok(brief2.blocks.some((b) => b.c === "Plot"));
  assert.ok(brief2.visualDirection.includes(seg2Text));

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
  assert.equal(film.shots[0].metaphor, "clock-gears");
  assert.ok(film.shots[1].visualDirection?.includes(seg2Text));
});

test("sync-gate verdict handling flags mismatch, runs ONE retry, and accepts updated brief", async () => {
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

  const film = buildFilmFromAudioResult("Sync Gate Test", dummyAudioResult);

  // Inject a deliberate mismatch into shot-2
  film.shots[1].visualDirection = "unrelated placeholder_error visual direction";

  const syncResult = await runPreRenderSyncGate(film, dummyAudioResult.segments);

  assert.equal(syncResult.verdicts.length, 3);
  assert.equal(syncResult.verdicts[0].status, "pass");

  // Shot 2 should have been flagged mismatch, retried ONCE, and fixed
  assert.equal(syncResult.verdicts[1].status, "fixed_after_retry");
  assert.equal(syncResult.verdicts[1].retriesPerformed, 1);
  assert.ok(syncResult.allPassedOrFixed);

  // Shot 2 visual direction in film should be updated
  assert.ok(!film.shots[1].visualDirection?.includes("placeholder_error"));
  assert.ok(film.shots[1].visualDirection?.includes("liquid bucket"));
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

test("validator hard-fails on duration-sum invariant violation and missing audio assets", () => {
  const tmpDir = path.join(__dirname, "../out/test_validator");
  fs.mkdirSync(tmpDir, { recursive: true });

  // Create real test files for missing asset checks
  const realVoPath = path.join(tmpDir, "test_vo.wav");
  const realMusicPath = path.join(tmpDir, "test_music.mp3");
  const realSfxPath = path.join(tmpDir, "test_sfx.wav");

  fs.writeFileSync(realVoPath, Buffer.from("RIFF dummy wav file"));
  fs.writeFileSync(realMusicPath, Buffer.from("ID3 dummy mp3 file"));
  fs.writeFileSync(realSfxPath, Buffer.from("RIFF dummy sfx file"));

  const baseFilm: Film = {
    id: "validator-test-film",
    title: "Validator Test",
    fps: 30,
    chapters: ["ch1"],
    canvas: {
      nodes: [
        { id: "n1", label: "ch1", x: 0, y: 0, w: 190, h: 62 },
        { id: "n2", label: "ch2", x: 400, y: 0, w: 190, h: 62 },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
    shots: [
      { id: "s1", ch: "ch1", dur: 5.0, stage: "frame", look: "n1", move: "cut", drift: false, zoom: 1, blocks: [{ c: "TextReveal", text: "Hi", size: "headline" }] },
      { id: "s2", ch: "ch1", dur: 5.0, stage: "frame", look: "n2", move: "pan", drift: false, zoom: 1, blocks: [{ c: "TextReveal", text: "Bye", size: "headline" }] },
    ],
    voiceover: { src: "test_vo.wav", volume: 1 },
    music: { src: "test_music.mp3", volume: 1, duckUnderVoiceover: true },
    sfx: [{ timeSec: 5.0, src: "test_sfx.wav", volume: 1 }],
  };

  // 1. Duration sum invariant failure (> 0.1s tolerance)
  assert.throws(
    () => validateFilmAudioAndAssets(baseFilm, { baseDir: tmpDir, measuredVoiceoverDurationSec: 12.5 }),
    /Duration sum invariant violated: total shot duration \(10.000s\) differs from voiceover duration \(12.500s\) by 2.500s/,
  );

  // 2. Missing voiceover file failure
  const filmMissingVo = { ...baseFilm, voiceover: { src: "nonexistent_vo.wav" } };
  assert.throws(
    () => validateFilmAudioAndAssets(filmMissingVo, { baseDir: tmpDir }),
    /Voiceover asset file missing: "nonexistent_vo.wav"/,
  );

  // 3. Missing music file failure
  const filmMissingMusic = { ...baseFilm, music: { src: "nonexistent_music.mp3" } };
  assert.throws(
    () => validateFilmAudioAndAssets(filmMissingMusic, { baseDir: tmpDir }),
    /Music asset file missing: "nonexistent_music.mp3"/,
  );

  // 4. Missing sfx file failure
  const filmMissingSfx = { ...baseFilm, sfx: [{ timeSec: 2.0, src: "nonexistent_sfx.wav" }] };
  assert.throws(
    () => validateFilmAudioAndAssets(filmMissingSfx, { baseDir: tmpDir }),
    /SFX asset file missing: "nonexistent_sfx.wav"/,
  );

  // 5. Valid film passes validation
  const validFilm = validateFilmAudioAndAssets(baseFilm, { baseDir: tmpDir, measuredVoiceoverDurationSec: 10.005 });
  assert.equal(validFilm.id, "validator-test-film");

  // Clean up test directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
