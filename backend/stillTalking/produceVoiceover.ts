/**
 * File Description: Audio-first narration step for the film "Still Talking".
 * Runs the project's TTS pipeline over the beat sheet's spoken narration, writes the master
 * voiceover into the video package, and records the measured per-shot durations and word offsets to
 * videos/still-talking/voiceover_words.json. The film's visuals are compiled from that measurement,
 * so the timeline is locked to the audio rather than the other way round.
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync, spawnSync } from "child_process";
import dotenv from "dotenv";
import { produceAudioPipeline, measureAudioDuration } from "../audio";
import { narrationSegments, spokenWordCount, BEATS } from "./beats";

dotenv.config();

/**
 * Reading rate handed to the macOS `say` fallback, in its own nominal words per minute.
 * Its default of 175 reads at roughly 210 real words a minute, which is conversation speed and
 * far too quick to narrate over. 140 lands the film at a documentary cadence.
 */
const NARRATION_RATE_WPM = 140;

/** Silence held between narration beats, which is also the film's smallest breathing space. */
const BEAT_GAP_MS = 550;

/** Peak the mastered voiceover is normalized to, leaving a decibel of headroom below full scale. */
const TARGET_PEAK_DB = -1;

/** The measurement the film builder reads back: what was said, and exactly when. */
export interface VoiceoverTiming {
  totalDurationSec: number;
  segments: Array<{
    shotId: string;
    text: string;
    startSec: number;
    durationSec: number;
    words: Array<{ word: string; startSec: number; endSec: number }>;
  }>;
}

/** Absolute path to the still-talking video package. */
export function packageDir(): string {
  return path.resolve(__dirname, "../../videos/still-talking");
}

/** Path of the measured timing artefact the film builder consumes. */
export function timingPath(): string {
  return path.join(packageDir(), "voiceover_words.json");
}

/** Reads the peak level of a wav in dBFS, as ffmpeg's volumedetect filter reports it. */
function measurePeakDb(wavPath: string): number {
  // volumedetect writes its report to stderr, which is where the measurement has to be read from.
  const run = spawnSync("ffmpeg", ["-i", wavPath, "-af", "volumedetect", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const match = (run.stderr ?? "").match(/max_volume:\s*(-?[\d.]+) dB/);
  if (!match) throw new Error(`Could not read a peak level from ${wavPath}.`);
  return Number.parseFloat(match[1]);
}

/**
 * Peak-normalizes the master voiceover so it sits a decibel below full scale.
 * Raw synthesis peaks several decibels low, which plays quiet next to anything else on a feed;
 * normalizing to a fixed target rather than to zero keeps the headroom that stops it clipping.
 */
function normalizePeak(wavPath: string): number {
  const before = measurePeakDb(wavPath);
  const gainDb = TARGET_PEAK_DB - before;
  const staged = `${wavPath}.normalized.wav`;
  execFileSync(
    "ffmpeg",
    ["-y", "-i", wavPath, "-af", `volume=${gainDb.toFixed(2)}dB`, "-ar", "44100", "-ac", "2", staged],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  fs.renameSync(staged, wavPath);
  return measurePeakDb(wavPath);
}

/** Synthesizes the narration and records its measured timing next to the wav. */
export async function produceVoiceover(): Promise<VoiceoverTiming> {
  const outDir = packageDir();
  fs.mkdirSync(outDir, { recursive: true });

  const segments = narrationSegments();
  console.log(
    `[still-talking] ${segments.length} narration beats, ${spokenWordCount()} spoken words.`,
  );

  const result = await produceAudioPipeline(segments, outDir, {
    gapMs: BEAT_GAP_MS,
    sayRateWpm: NARRATION_RATE_WPM,
  });

  if (result.segments.length !== BEATS.length) {
    throw new Error(
      `Narration produced ${result.segments.length} segments for ${BEATS.length} beats. ` +
        "The pipeline merged a beat that was too short to stand on its own: lengthen it in beats.ts.",
    );
  }

  const peakDb = normalizePeak(result.voiceoverPath);
  const totalDurationSec = await measureAudioDuration(result.voiceoverPath);

  // Normalizing re-encodes the master, so the shot durations are re-anchored to the length the
  // file actually has now. The film's frame count comes from this number and nothing else.
  const shotDurations = [...result.shotDurations];
  const drift = totalDurationSec - shotDurations.reduce((a, b) => a + b, 0);
  shotDurations[shotDurations.length - 1] += drift;

  let cursor = 0;
  const timing: VoiceoverTiming = {
    totalDurationSec,
    segments: result.segments.map((segment, i) => {
      const startSec = cursor;
      cursor += shotDurations[i];
      return {
        shotId: BEATS[i].id,
        text: segment.text,
        startSec: Number(startSec.toFixed(3)),
        durationSec: Number(shotDurations[i].toFixed(3)),
        words: segment.words.map((w) => ({
          word: w.punctuated_word ?? w.word,
          startSec: Number((startSec + w.start).toFixed(3)),
          endSec: Number((startSec + w.end).toFixed(3)),
        })),
      };
    }),
  };

  fs.writeFileSync(timingPath(), `${JSON.stringify(timing, null, 2)}\n`, "utf8");
  console.log(
    `[still-talking] voiceover.wav is ${totalDurationSec.toFixed(2)}s across ${timing.segments.length} shots, peaking at ${peakDb.toFixed(1)} dBFS.`,
  );
  return timing;
}

/** Reads back the measured timing, failing loudly when the audio step has not run yet. */
export function readVoiceoverTiming(): VoiceoverTiming {
  const file = timingPath();
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing ${file}. Run the narration step first: npx tsx backend/stillTalking/produceVoiceover.ts`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as VoiceoverTiming;
}

if (require.main === module) {
  produceVoiceover().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
