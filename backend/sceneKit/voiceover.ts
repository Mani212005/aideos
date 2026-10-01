/**
 * File Description: Audio-first narration step shared by every scene film.
 * Synthesizes a film's beats with the project's own narration pipeline, masters the take for
 * delivery (loudness, then peak), appends a tail handle so the closing card can be read, and records
 * the shot spine: which shot each line belongs to, where it starts, and when each word is spoken.
 * Word offsets come either from the synthesizer or, for kinetic typography, from the locally cached
 * Whisper model aligned back onto the script's own words. The picture is compiled from the spine
 * alone, so a re-recorded take retimes the whole film.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import dotenv from "dotenv";
import { produceAudioPipeline } from "../audio";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import type { NarrationTiming } from "./timing";

dotenv.config();

/** Repo root, resolved from this file so it holds whichever directory the caller was launched from. */
const REPO_ROOT = path.resolve(__dirname, "../..");

/** The measurement a film builder reads back: what was said, and exactly when. */
export interface VoiceoverTiming extends NarrationTiming {
  /** Which synthesizer produced the take, recorded for provenance. */
  ttsBackend?: string;
}

/** One beat of the script: the shot it belongs to and the exact words spoken over it. */
export interface NarratedBeat {
  id: string;
  narration: string;
}

/** Everything a film decides about its narration. */
export interface VoiceoverConfig {
  /** The film's package folder name: videos/<slug>. */
  slug: string;
  beats: NarratedBeat[];
  /** Synthesizer pace multiplier. */
  speed?: number;
  /** Silence between lines in ms, which is also the beat a line resets on. */
  gapMs?: number;
  /** Silence appended after the last word in ms. The take is exactly this much longer. */
  tailMs?: number;
  /** Delivery loudness in LUFS and true-peak ceiling in dBFS. */
  targetLufs?: number;
  truePeakDb?: number;
  /** Where word offsets come from: the synthesizer's estimates, or Whisper measuring the real audio. */
  alignment?: "synthesizer" | "whisper";
  /** File the spine is written to inside the package. */
  spineFile?: string;
  /** Copy the mastered wav (and the pipeline's captions) to public/ for the live preview. */
  syncToPreview?: boolean;
  /** Override the package root (tests). */
  rootDir?: string;
}

/** A word as whisper heard it. */
export interface HeardWord {
  word: string;
  start: number;
  end: number;
}

const DEFAULTS = { speed: 1, gapMs: 420, tailMs: 2200, targetLufs: -16, truePeakDb: -1, alignment: "synthesizer", spineFile: "shot-spine.json" } as const;

// Absolute path to a film's video package.
export function packageDir(slug: string, rootDir?: string): string {
  if (rootDir) return path.resolve(rootDir, "videos", slug);
  return path.join(getVideosDir(), slug);
}

// Path of the shot spine artefact a film builder consumes.
export function timingPath(slug: string, spineFile: string = DEFAULTS.spineFile, rootDir?: string): string {
  return path.join(packageDir(slug, rootDir), spineFile);
}

// Runs ffmpeg and hands back its stderr report.
function ffmpegReport(args: string[]): string {
  const run = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (run.error) throw run.error;
  return run.stderr ?? "";
}

// Measured loudness of a wav: integrated LUFS and true peak in dBFS.
function measureLoudness(wavPath: string, lufs: number, tp: number): { lufs: number; truePeakDb: number } {
  const report = ffmpegReport(["-i", wavPath, "-af", `loudnorm=I=${lufs}:TP=${tp}:LRA=7:print_format=json`, "-f", "null", "-"]);
  const json = report.slice(report.lastIndexOf("{"), report.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as { input_i: string; input_tp: string };
  return { lufs: Number.parseFloat(parsed.input_i), truePeakDb: Number.parseFloat(parsed.input_tp) };
}

// Reads the sample peak of a wav in dBFS, as ffmpeg's volumedetect filter reports it.
function measurePeakDb(wavPath: string): number {
  const report = ffmpegReport(["-i", wavPath, "-af", "volumedetect", "-f", "null", "-"]);
  const match = report.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (!match) throw new Error(`Could not read a peak level from ${wavPath}.`);
  return Number.parseFloat(match[1]);
}

/**
 * Masters the narration for delivery without changing its length. Loudness normalization rides the
 * voice's isolated plosive peaks down and brings the body up; peak normalization then spends the
 * headroom that leaves. Doing only the second is how a correct-looking master plays quiet.
 */
function masterForDelivery(wavPath: string, lufs: number, tp: number): { lufs: number; truePeakDb: number } {
  const staged = `${wavPath}.mastered.wav`;
  ffmpegReport(["-y", "-i", wavPath, "-af", `loudnorm=I=${lufs}:TP=${tp}:LRA=7`, "-ar", "44100", "-ac", "2", staged]);
  if (!fs.existsSync(staged)) throw new Error(`Mastering produced no output for ${wavPath}.`);
  const gainDb = tp - measurePeakDb(staged);
  const peaked = `${wavPath}.peaked.wav`;
  ffmpegReport(["-y", "-i", staged, "-af", `volume=${gainDb.toFixed(2)}dB`, "-ar", "44100", "-ac", "2", peaked]);
  fs.rmSync(staged, { force: true });
  fs.renameSync(peaked, wavPath);
  return { lufs: measureLoudness(wavPath, lufs, tp).lufs, truePeakDb: measurePeakDb(wavPath) };
}

// Appends the tail handle to the master: the film is exactly as long as the wav, tail included.
function appendTailHandle(wavPath: string, tailMs: number): void {
  const padded = `${wavPath}.padded.wav`;
  ffmpegReport(["-y", "-i", wavPath, "-af", `apad=pad_dur=${(tailMs / 1000).toFixed(3)}`, "-ar", "44100", "-ac", "2", padded]);
  if (!fs.existsSync(padded)) throw new Error(`Could not append a tail handle to ${wavPath}.`);
  fs.renameSync(padded, wavPath);
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
  try {
    if (run.status !== 0) throw new Error(`whisper failed: ${run.stderr || run.error}`);
    return JSON.parse(fs.readFileSync(out, "utf8")) as HeardWord[][];
  } finally {
    fs.rmSync(out, { force: true });
    fs.rmSync(rangesFile, { force: true });
  }
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

// Synthesizes the narration, measures word timings and records the shot spine.
export async function produceVoiceover(config: VoiceoverConfig): Promise<VoiceoverTiming> {
  const alignment = config.alignment ?? DEFAULTS.alignment;
  const tailMs = config.tailMs ?? DEFAULTS.tailMs;
  const targetLufs = config.targetLufs ?? DEFAULTS.targetLufs;
  const truePeakDb = config.truePeakDb ?? DEFAULTS.truePeakDb;
  const syncToPreview = config.syncToPreview ?? true;
  const outDir = packageDir(config.slug, config.rootDir);
  fs.mkdirSync(outDir, { recursive: true });
  const { beats } = config;
  const segments = beats.map((b) => b.narration);
  console.log(`[${config.slug}] ${segments.length} lines, ${segments.join(" ").split(/\s+/).filter(Boolean).length} spoken words.`);

  const result = await produceAudioPipeline(segments, outDir, {
    gapMs: config.gapMs ?? DEFAULTS.gapMs,
    speed: config.speed ?? DEFAULTS.speed,
    syncToPreview,
  });
  if (result.segments.length !== beats.length) {
    throw new Error(
      `Narration produced ${result.segments.length} segments for ${beats.length} beats: a line was too short to stand alone. Lengthen it.`,
    );
  }
  const mastered = masterForDelivery(result.voiceoverPath, targetLufs, truePeakDb);
  appendTailHandle(result.voiceoverPath, tailMs);
  // Remotion resolves staticFile() against public/, so the copy there has to be the mastered one.
  const publicCopy = path.resolve(REPO_ROOT, "public/voiceover.wav");
  if (syncToPreview && path.resolve(outDir) !== path.dirname(publicCopy) && fs.existsSync(path.dirname(publicCopy))) {
    fs.copyFileSync(result.voiceoverPath, publicCopy);
  }
  const tailSec = tailMs / 1000;
  const totalSec = result.totalAudioDuration + tailSec;

  // Shot spans run boundary to boundary, so a shot starts exactly where its narration does and the
  // spans sum to the length of the wav.
  const shotDurations = result.shotDurations.map((d, i) => (i === result.shotDurations.length - 1 ? d + tailSec : d));

  let heardByLine: HeardWord[][] | null = null;
  if (alignment === "whisper") {
    // Each line is transcribed on its own clip, padded a little either side.
    let probe = 0;
    const ranges = shotDurations.map((d): [number, number] => {
      const range: [number, number] = [Math.max(0, probe - 0.1), Math.min(totalSec, probe + d + 0.1)];
      probe += d;
      return range;
    });
    heardByLine = whisperWords(result.voiceoverPath, ranges);
  }

  let cursor = 0;
  const timing: VoiceoverTiming = {
    totalDurationSec: Number(totalSec.toFixed(3)),
    ttsBackend: result.ttsBackend,
    segments: result.segments.map((segment, idx) => {
      const startSec = cursor;
      cursor += shotDurations[idx];
      const base = { shotId: beats[idx].id, text: segment.text, startSec: Number(startSec.toFixed(3)), durationSec: Number(shotDurations[idx].toFixed(3)) };
      if (!heardByLine) {
        return {
          ...base,
          words: segment.words.map((w) => ({
            word: w.punctuated_word ?? w.word,
            startSec: Number((segment.startOffset + w.start).toFixed(3)),
            endSec: Number((segment.startOffset + w.end).toFixed(3)),
          })),
        };
      }
      const scripted = segment.text.split(/\s+/).filter(Boolean);
      const times = alignWords(scripted, heardByLine[idx], startSec, startSec + segment.duration);
      return {
        ...base,
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

  fs.writeFileSync(path.join(outDir, config.spineFile ?? DEFAULTS.spineFile), `${JSON.stringify(timing, null, 2)}\n`, "utf8");
  console.log(
    `[${config.slug}] take ${timing.totalDurationSec.toFixed(2)}s, ${timing.segments.length} shots, ${result.ttsBackend}, ` +
      `mastered to ${mastered.lufs.toFixed(1)} LUFS / ${mastered.truePeakDb.toFixed(1)} dBTP.`,
  );
  return timing;
}

// Reads back a film's measured shot spine, failing loudly when the audio step has not run yet.
export function readVoiceoverTiming(slug: string, spineFile: string = DEFAULTS.spineFile, rootDir?: string): VoiceoverTiming {
  const file = timingPath(slug, spineFile, rootDir);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. Run the film's narration step first (it calls produceVoiceover from backend/sceneKit/voiceover.ts).`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as VoiceoverTiming;
}
