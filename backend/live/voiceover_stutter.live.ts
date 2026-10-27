/**
 * File Description: Opt-in live narration synthesis regression check.
 * Inputs and outputs: TTS provider and narration -> audio samples, captions and film timing assertions
 * Used by: npm run test:live (opt-in, excluded from CI).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { produceAudioPipeline, buildFilmFromAudioResult } from "../audio";
import { decodeWav, longestSilenceSec } from "../pcm";
import { buildTimeline } from "../../src/dl/camera";

// Live end-to-end synthesis check. Opt-in so the default suite stays offline and fast.
test("live narration synthesis produces a clean, drift-free track", async (t) => {
  if (!process.env.RUN_TTS_TESTS) {
    t.skip("Set RUN_TTS_TESTS=1 to run live text-to-speech synthesis.");
    return;
  }

  const script = [
    "Every diffusion model you have heard of used to be built on a U-Net.",
    "Then, almost overnight, the entire field switched to transformers.",
    "A U-Net is a funnel. It squeezes an image down, then expands it back up.",
  ];
  const outDir = path.join(__dirname, "../../out/test_narration");
  const result = await produceAudioPipeline(script, outDir, { syncToPreview: false });

  const wav = decodeWav(await fs.readFile(result.voiceoverPath));
  assert.equal(wav.channels, 1);
  assert.ok(
    Math.abs(wav.samples.length / wav.sampleRate - result.totalAudioDuration) < 0.001,
    "The written file's duration must equal the duration the timeline was built from",
  );

  const sum = result.shotDurations.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - result.totalAudioDuration) < 1e-6, "Shot durations must sum to the audio duration");

  const lastWord = result.words[result.words.length - 1];
  assert.ok(
    lastWord.end <= result.totalAudioDuration + 0.001,
    "The last word must not be timed past the end of the audio",
  );
  assert.ok(
    longestSilenceSec(wav.samples, wav.sampleRate) < 1.0,
    "No stretch of the narration should sit silent for a second",
  );

  const film = buildFilmFromAudioResult("Live Narration Test", result);
  const timeline = buildTimeline(film);
  film.shots.forEach((_, i) => {
    const expectedFrame = Math.round(result.segments[i].startOffset * film.fps);
    assert.ok(
      Math.abs(timeline[i].from - expectedFrame) <= 1,
      `Shot ${i} renders at frame ${timeline[i].from} but its narration starts at frame ${expectedFrame}`,
    );
  });

  await fs.rm(outDir, { recursive: true, force: true });
});
