/**
 * File Description: Audio-first narration step for the film "RAG, in four steps".
 * Synthesizes every beat with the project's own narration pipeline (Kokoro), masters the take,
 * then replaces the synthesizer's estimated word offsets with real ones measured by the locally
 * cached Whisper model, aligned back onto the script's own words. The result is shot-spine.json:
 * which shot each line belongs to, where it starts, and the frame-accurate moment of every word.
 * The picture is compiled from that file alone, so a re-recorded take retimes the whole film.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import dotenv from "dotenv";
import { produceAudioPipeline } from "../audio";
import { BEATS, narrationSegments } from "./beats";

dotenv.config();

/** Delivery loudness for the master, in LUFS, with its true-peak ceiling in dBFS. */
const TARGET_LUFS = -16;
const TARGET_TRUE_PEAK_DB = -1.5;

/** Pace multiplier: a touch quick, so short lines land like a chorus rather than a lecture. */
const NARRATION_SPEED = 1.04;

/** Silence between lines, which is also the beat the typography resets on. */
const BEAT_GAP_MS = 380;

/** Silence appended after the last word so the closing card can be read. */
const TAIL_HANDLE_MS = 2600;

/** The measurement the film builder reads back: what was said, and exactly when. */
export interface VoiceoverTiming {
  totalDurationSec: number;
  ttsBackend?: string;
  segments: Array<{
    shotId: string;
    text: string;
    startSec: number;
    durationSec: number;
    words: Array<{ word: string; startSec: number; endSec: number }>;
  }>;
}

/** A word as whisper heard it. */
interface HeardWord {
  word: string;
  start: number;
  end: number;
}

// Absolute path to the rag-explainer video package.
export function packageDir(): string {
  return path.resolve(__dirname, "../../videos/rag-explainer");
}

// Path of the shot spine artefact the film builder consumes.
export function timingPath(): string {
  return path.join(packageDir(), "shot-spine.json");
}

// Runs ffmpeg and hands back its stderr report.
function ffmpegReport(args: string[]): string {
  const run = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (run.error) throw run.error;
  return run.stderr ?? "";
}

// Loudness-normalizes the master in place, pads a tail handle, and copies it where Remotion reads it.
function masterForDelivery(wavPath: string): void {
  const staged = `${wavPath}.mastered.wav`;
  ffmpegReport([
    "-y", "-i", wavPath,
    "-af", `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK_DB}:LRA=7,apad=pad_dur=${(TAIL_HANDLE_MS / 1000).toFixed(3)}`,
    "-ar", "44100", "-ac", "2", staged,
  ]);
  if (!fs.existsSync(staged)) throw new Error(`Mastering produced no output for ${wavPath}.`);
  fs.renameSync(staged, wavPath);
  const publicCopy = path.resolve(__dirname, "../../public/voiceover.wav");
  if (fs.existsSync(path.dirname(publicCopy))) fs.copyFileSync(wavPath, publicCopy);
}

// Lowercases a word and strips everything but letters and digits, for matching spoken to scripted.
function norm(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Transcribes each [start, end] range of a wav with local whisper, one word list per range.
function whisperWords(wavPath: string, ranges: Array<[number, number]>): HeardWord[][] {
  const rangesFile = `${wavPath}.ranges.json`;
  const out = `${wavPath}.words.json`;
  fs.writeFileSync(rangesFile, JSON.stringify(ranges));
  const script = path.resolve(__dirname, "whisperWords.py");
  const run = spawnSync("python3", [script, wavPath, rangesFile, out], {
    encoding: "utf8",
    env: { ...process.env, KMP_DUPLICATE_LIB_OK: "TRUE" },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`whisper failed: ${run.stderr || run.error}`);
  const lines = JSON.parse(fs.readFileSync(out, "utf8")) as HeardWord[][];
  fs.rmSync(out, { force: true });
  fs.rmSync(rangesFile, { force: true });
  return lines;
}

/**
 * Aligns scripted words onto heard words with a longest-common-subsequence match, then fills any
 * scripted word whisper missed by spreading it evenly between its matched neighbours.
 */
export function alignWords(
  scripted: string[],
  heard: HeardWord[],
  fallbackStart: number,
  fallbackEnd: number,
): Array<{ startSec: number; endSec: number }> {
  const n = scripted.length;
  const m = heard.length;
  const a = scripted.map(norm);
  const b = heard.map((h) => norm(h.word));
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched: Array<{ startSec: number; endSec: number } | null> = new Array(n).fill(null);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      matched[i] = { startSec: heard[j].start, endSec: heard[j].end };
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  // Fill the gaps: a run of unmatched words shares the time between its matched neighbours.
  const out: Array<{ startSec: number; endSec: number }> = new Array(n);
  let k = 0;
  while (k < n) {
    const hit = matched[k];
    if (hit) {
      out[k] = hit;
      k++;
      continue;
    }
    let end = k;
    while (end < n && !matched[end]) end++;
    const left = k > 0 ? out[k - 1].endSec : fallbackStart;
    const right = end < n ? (matched[end] as { startSec: number }).startSec : fallbackEnd;
    const step = Math.max(0.05, (right - left) / (end - k));
    for (let q = k; q < end; q++) out[q] = { startSec: left + step * (q - k), endSec: left + step * (q - k + 1) };
    k = end;
  }
  return out;
}

// Synthesizes the narration, measures real word timings and records the shot spine.
export async function produceVoiceover(): Promise<VoiceoverTiming> {
  const outDir = packageDir();
  fs.mkdirSync(outDir, { recursive: true });
  const segments = narrationSegments();
  console.log(`[rag-explainer] ${segments.length} lines, ${segments.join(" ").split(/\s+/).length} spoken words.`);

  const result = await produceAudioPipeline(segments, outDir, { gapMs: BEAT_GAP_MS, speed: NARRATION_SPEED });
  if (result.segments.length !== BEATS.length) {
    throw new Error(
      `Narration produced ${result.segments.length} segments for ${BEATS.length} beats: a line was too short to stand alone.`,
    );
  }
  masterForDelivery(result.voiceoverPath);
  const tailSec = TAIL_HANDLE_MS / 1000;
  const totalSec = result.totalAudioDuration + tailSec;

  const shotDurations = result.shotDurations.map((d, idx) => (idx === result.shotDurations.length - 1 ? d + tailSec : d));

  // Each line is transcribed on its own clip, padded a little either side.
  let probe = 0;
  const ranges = shotDurations.map((d): [number, number] => {
    const range: [number, number] = [Math.max(0, probe - 0.1), Math.min(totalSec, probe + d + 0.1)];
    probe += d;
    return range;
  });
  const heardByLine = whisperWords(result.voiceoverPath, ranges);

  let cursor = 0;
  const timing: VoiceoverTiming = {
    totalDurationSec: Number(totalSec.toFixed(3)),
    ttsBackend: result.ttsBackend,
    segments: result.segments.map((segment, idx) => {
      const startSec = cursor;
      cursor += shotDurations[idx];
      const scripted = segment.text.split(/\s+/).filter(Boolean);
      const times = alignWords(scripted, heardByLine[idx], startSec, startSec + segment.duration);
      return {
        shotId: BEATS[idx].id,
        text: segment.text,
        startSec: Number(startSec.toFixed(3)),
        durationSec: Number(shotDurations[idx].toFixed(3)),
        // Speech cannot start before its line does (whisper tends to pull a first word early), and
        // a word is never shorter than a frame or earlier than the word before it.
        words: scripted.map((word, w) => {
          const prevEnd = w > 0 ? Math.max(startSec, times[w - 1].startSec) : startSec;
          const from = Math.max(startSec, prevEnd, times[w].startSec);
          times[w] = { startSec: from, endSec: Math.max(from + 0.06, times[w].endSec) };
          return { word, startSec: Number(from.toFixed(3)), endSec: Number(times[w].endSec.toFixed(3)) };
        }),
      };
    }),
  };
  fs.writeFileSync(timingPath(), `${JSON.stringify(timing, null, 2)}\n`, "utf8");
  console.log(`[rag-explainer] voiceover.wav ${timing.totalDurationSec.toFixed(2)}s, ${timing.segments.length} shots, ${result.ttsBackend}.`);
  return timing;
}

// Reads back the measured shot spine, failing loudly when the audio step has not run yet.
export function readVoiceoverTiming(): VoiceoverTiming {
  const file = timingPath();
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. Run the narration step first: npx tsx backend/ragExplainer/produceVoiceover.ts`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as VoiceoverTiming;
}

if (typeof require !== "undefined" && require.main === module) {
  produceVoiceover().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
