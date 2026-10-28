/**
 * File Description: Reproduces AAC peak overshoot through the delivered-MP4 master under decision D6.
 * Inputs and outputs: Deterministic transient PCM and wide/reel MP4 renders -> measured D6 delivery loudness and peak assertions.
 * Used by: npm run test:journeys (the CI journeys job).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { masterAudio } from "../masterAudio";
import { measureLoudness } from "../review/media";
import { journey } from "./harness";

// Writes stereo tones with a seeded noise transient whose AAC reconstruction can exceed its source peak.
function writeTransientPcm(file: string): void {
  const samples = Buffer.alloc(48000 * 3 * 2 * 2);
  let seed = 19;
  for (let frame = 0; frame < 48000 * 3; frame += 1) {
    for (let channel = 0; channel < 2; channel += 1) {
      let value = 0.18 * Math.sin(2 * Math.PI * (channel === 0 ? 440 : 530) * frame / 48000);
      if (frame >= 48000 && frame < 55500) {
        seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
        value = 0.8 * (seed / 2147483648 - 1);
      }
      samples.writeInt16LE(Math.trunc(value * 32767), (frame * 2 + channel) * 2);
    }
  }
  fs.writeFileSync(file, samples);
}

// Exercises the reported failure on real MP4s and measures the delivered files against the approved D6 limits.
journey("D6 master: AAC overshoot is corrected in wide and reel delivered MP4s", async (ctx) => {
  const pcm = path.join(ctx.workDir, "transient.pcm");
  writeTransientPcm(pcm);
  for (const [format, size] of [["long", "320x180"], ["reel", "180x320"]]) {
    const file = path.join(ctx.workDir, `${format}.mp4`);
    // Lossless source audio preserves the transient while the actual delivery path encodes AAC.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=gray:s=${size}:r=30:d=3`,
      "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", pcm, "-af", "volume=-4.2dB",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "alac", file]);
    const result = masterAudio(file);
    assert.equal(result.status, "mastered", `D6 ${format}: the encoded candidate must be corrected and delivered`);
    const delivered = measureLoudness(file);
    assert.ok(delivered, `D6 ${format}: delivered MP4 audio must be measurable`);
    assert.ok(Math.abs(delivered.integratedLufs + 16) <= 0.5, `D6 ${format}: delivered loudness ${delivered.integratedLufs} must be -16 +/- 0.5 LUFS`);
    assert.ok(delivered.truePeakDb <= -1, `D6 ${format}: delivered true peak ${delivered.truePeakDb} must be <= -1 dBTP`);
  }
});
