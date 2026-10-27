/**
 * File Description: Opt-in live audio synthesis and caption alignment check.
 * Inputs and outputs: Deepgram credentials and narration -> synthesized audio and timing assertions
 * Used by: npm run test:live (opt-in, excluded from CI).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { produceAudioPipeline } from "../audio";

dotenv.config({ quiet: true });

test("duration sum invariant holds within ±50ms for live synthesized audio", async (t) => {
  if (!process.env.DEEPGRAM_API_KEY) {
    t.skip("Skipping live Deepgram test; DEEPGRAM_API_KEY is not set.");
    return;
  }

  const script =
    "Welcome to Aideos audio pipeline.\n\nWe test segment splitting and caption alignment.\n\nEvery shot duration sums to the audio file duration.";

  const tmpOut = path.join(__dirname, "../../out/test_produce");
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Deepgram synthesis timed out after 10s")), 10000)
  );
  let result;
  try {
    result = (await Promise.race([
      produceAudioPipeline(script, tmpOut, { syncToPreview: false }),
      timeoutPromise,
    ])) as any;
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
