/**
 * File Description: Audio-first narration step for the film "Still Talking".
 * Runs the project's narration pipeline over the beat sheet's spoken text and records the shot
 * spine it produced: which shot each narration segment belongs to, where it starts, how long it
 * runs, and when each word inside it is spoken. The film's picture is compiled from that
 * measurement, so a re-recorded take retimes the film instead of drifting away from it.
 *
 * The pipeline itself owns voiceover.wav, captions.vtt and voiceover_words.json, which are shared
 * artefacts every film produces. This step owns shot-spine.json, the same measurement keyed by
 * shot, and that is the only narration artefact the film builder reads.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import dotenv from "dotenv";
import { produceAudioPipeline } from "../audio";
import { narrationSegments, spokenWordCount, BEATS } from "./beats";

dotenv.config();

/**
 * Delivery loudness for the master, in LUFS, with its true-peak ceiling in dBFS.
 * The pipeline peak-normalizes, which leaves a neural voice around -21 LUFS: correct on paper and
 * noticeably quiet next to anything else on a feed. Loudness normalizing on top of it is a per-film
 * mastering decision, so it lives here rather than in the shared pipeline.
 */
const TARGET_LUFS = -16;
const TARGET_TRUE_PEAK_DB = -1;

/**
 * Narration pace multiplier handed to the synthesizer.
 * Slightly under one reads as narration rather than as conversation, which is what a film about
 * something that has been travelling for fifty years needs.
 */
const NARRATION_SPEED = 0.94;

/** Silence held between narration beats, which is also the film's smallest breathing space. */
const BEAT_GAP_MS = 520;

/**
 * Silence appended after the last word, in milliseconds.
 * Narration assembly trims its tail, which leaves the film cutting to black under a tenth of a
 * second after the final syllable and gives the closing card no time to be read. The handle is
 * part of the take rather than a frame count added later, so the scene stays clocked to its audio.
 */
const TAIL_HANDLE_MS = 2200;

/** The measurement the film builder reads back: what was said, and exactly when. */
export interface VoiceoverTiming {
  totalDurationSec: number;
  /** Which synthesizer produced the take, recorded for provenance. */
  ttsBackend?: string;
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

/** Path of the shot spine artefact the film builder consumes. */
export function timingPath(): string {
  return path.join(packageDir(), "shot-spine.json");
}

/** Runs ffmpeg and hands back its report, which is written to stderr rather than to stdout. */
function ffmpegReport(args: string[]): string {
  const run = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (run.error) throw run.error;
  return run.stderr ?? "";
}

/** Measured loudness of a wav: integrated LUFS and true peak in dBFS. */
function measureLoudness(wavPath: string): { lufs: number; truePeakDb: number } {
  const report = ffmpegReport([
    "-i", wavPath,
    "-af", `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK_DB}:LRA=7:print_format=json`,
    "-f", "null", "-",
  ]);
  const json = report.slice(report.lastIndexOf("{"), report.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as { input_i: string; input_tp: string };
  return { lufs: Number.parseFloat(parsed.input_i), truePeakDb: Number.parseFloat(parsed.input_tp) };
}

/** Reads the sample peak of a wav in dBFS, as ffmpeg's volumedetect filter reports it. */
function measurePeakDb(wavPath: string): number {
  const report = ffmpegReport(["-i", wavPath, "-af", "volumedetect", "-f", "null", "-"]);
  const match = report.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (!match) throw new Error(`Could not read a peak level from ${wavPath}.`);
  return Number.parseFloat(match[1]);
}

/**
 * Masters the narration for delivery without changing its length.
 * Two things have to be true at once and neither follows from the other. Loudness normalization
 * rides the voice's isolated plosive peaks down and brings the body of the narration up, which is
 * what puts the film at the level everything else on a feed sits at; peak normalization then
 * spends the headroom that leaves, so the file is as loud as it can be while still holding a
 * decibel clear of full scale. Doing only the second is how a correct-looking master plays quiet.
 */
function masterForDelivery(wavPath: string): { lufs: number; truePeakDb: number } {
  const staged = `${wavPath}.mastered.wav`;
  ffmpegReport([
    "-y", "-i", wavPath,
    "-af", `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK_DB}:LRA=7`,
    "-ar", "44100", "-ac", "2", staged,
  ]);
  if (!fs.existsSync(staged)) throw new Error(`Mastering produced no output for ${wavPath}.`);

  const gainDb = TARGET_TRUE_PEAK_DB - measurePeakDb(staged);
  const peaked = `${wavPath}.peaked.wav`;
  ffmpegReport([
    "-y", "-i", staged,
    "-af", `volume=${gainDb.toFixed(2)}dB`,
    "-ar", "44100", "-ac", "2", peaked,
  ]);
  fs.rmSync(staged, { force: true });
  fs.renameSync(peaked, wavPath);

  // Remotion resolves staticFile() against public/, so the copy there has to be the mastered one.
  const publicCopy = path.resolve(__dirname, "../../public/voiceover.wav");
  if (fs.existsSync(path.dirname(publicCopy))) fs.copyFileSync(wavPath, publicCopy);

  return { lufs: measureLoudness(wavPath).lufs, truePeakDb: measurePeakDb(wavPath) };
}

/**
 * Appends the tail handle to the master and copies the result where Remotion reads it.
 * Padding the take rather than the timeline is what keeps the scene honestly clocked to its
 * audio: the film is exactly as long as the wav, tail included.
 */
function appendTailHandle(wavPath: string): void {
  const padded = `${wavPath}.padded.wav`;
  ffmpegReport([
    "-y", "-i", wavPath,
    "-af", `apad=pad_dur=${(TAIL_HANDLE_MS / 1000).toFixed(3)}`,
    "-ar", "44100", "-ac", "2", padded,
  ]);
  if (!fs.existsSync(padded)) throw new Error(`Could not append a tail handle to ${wavPath}.`);
  fs.renameSync(padded, wavPath);

  const publicCopy = path.resolve(__dirname, "../../public/voiceover.wav");
  if (fs.existsSync(path.dirname(publicCopy))) fs.copyFileSync(wavPath, publicCopy);
}

/** Synthesizes the narration and records the shot spine it produced. */
export async function produceVoiceover(): Promise<VoiceoverTiming> {
  const outDir = packageDir();
  fs.mkdirSync(outDir, { recursive: true });

  const segments = narrationSegments();
  console.log(
    `[still-talking] ${segments.length} narration beats, ${spokenWordCount()} spoken words.`,
  );

  const result = await produceAudioPipeline(segments, outDir, {
    gapMs: BEAT_GAP_MS,
    speed: NARRATION_SPEED,
  });

  if (result.segments.length !== BEATS.length) {
    throw new Error(
      `Narration produced ${result.segments.length} segments for ${BEATS.length} beats. ` +
        "The pipeline merged a beat that was too short to stand on its own: lengthen it in beats.ts.",
    );
  }

  const mastered = masterForDelivery(result.voiceoverPath);
  appendTailHandle(result.voiceoverPath);
  const tailSec = TAIL_HANDLE_MS / 1000;

  // Shot spans run boundary to boundary, so a shot starts exactly where its narration does and
  // the spans sum to the length of the wav.
  const shotDurations = result.shotDurations.map((d, i) =>
    i === result.shotDurations.length - 1 ? d + tailSec : d,
  );

  let cursor = 0;
  const timing: VoiceoverTiming = {
    totalDurationSec: Number((result.totalAudioDuration + tailSec).toFixed(3)),
    ttsBackend: result.ttsBackend,
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
          startSec: Number((segment.startOffset + w.start).toFixed(3)),
          endSec: Number((segment.startOffset + w.end).toFixed(3)),
        })),
      };
    }),
  };

  fs.writeFileSync(timingPath(), `${JSON.stringify(timing, null, 2)}\n`, "utf8");
  console.log(
    `[still-talking] voiceover.wav is ${timing.totalDurationSec.toFixed(2)}s across ` +
      `${timing.segments.length} shots, synthesized with ${result.ttsBackend}, ` +
      `mastered to ${mastered.lufs.toFixed(1)} LUFS / ${mastered.truePeakDb.toFixed(1)} dBTP.`,
  );
  return timing;
}

/** Reads back the measured shot spine, failing loudly when the audio step has not run yet. */
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
