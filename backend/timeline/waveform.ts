/**
 * File Description: PCM waveform peak extraction for Aideos audio clips.
 * Shells out to ffprobe and ffmpeg to reduce an audio file to normalised amplitude peaks for
 * offline tooling and tests. It lives apart from voiceover_engine.ts because it depends on Node
 * built-ins, and voiceover_engine.ts has to stay importable from the browser bundle. The editor
 * decodes waveforms in the browser instead (see editor/src/components/timeline/useAudioPeaks.ts).
 */

import fs from "fs";
import { execSync } from "child_process";

export interface WaveformData {
  /** Normalised amplitude peaks in the range 0 to 1. */
  peaks: number[];
  durationSec: number;
  sampleRate: number;
}

/** Deterministic stand-in peaks used when the file is missing or ffmpeg is unavailable. */
function syntheticPeaks(numPeaks: number): WaveformData {
  return {
    peaks: Array.from({ length: numPeaks }).map((_, i) => Math.abs(Math.sin(i * 0.15) * 0.8 + 0.2)),
    durationSec: 10.0,
    sampleRate: 44100,
  };
}

/**
 * Extract normalized PCM waveform peaks from a local audio file.
 */
export function extractAudioPeaks(audioFilePath: string, numPeaks = 100): WaveformData {
  if (!fs.existsSync(audioFilePath)) {
    // Return deterministic synthetic peaks if the file is not present on disk.
    return syntheticPeaks(numPeaks);
  }

  try {
    // Measure duration via ffprobe
    const durOutput = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioFilePath}"`
    )
      .toString()
      .trim();
    const durationSec = parseFloat(durOutput) || 10.0;

    // Extract raw 8-bit mono PCM stream
    const rawPcm = execSync(
      `ffmpeg -i "${audioFilePath}" -ac 1 -ar 8000 -f u8 - 2>/dev/null | head -c 80000`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    const step = Math.floor(rawPcm.length / numPeaks);
    const peaks: number[] = [];

    for (let i = 0; i < numPeaks; i++) {
      let maxVal = 0;
      const startIdx = i * step;
      const endIdx = Math.min(rawPcm.length, startIdx + step);
      for (let j = startIdx; j < endIdx; j++) {
        const sample = Math.abs(rawPcm[j] - 128) / 128;
        if (sample > maxVal) maxVal = sample;
      }
      peaks.push(Number(maxVal.toFixed(3)));
    }

    return {
      peaks,
      durationSec,
      sampleRate: 44100,
    };
  } catch {
    return syntheticPeaks(numPeaks);
  }
}
