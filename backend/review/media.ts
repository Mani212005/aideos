/**
 * File Description: ffmpeg and ffprobe access for `aideos review`.
 * Probes the rendered file, streams decoded gray frames (small ones for layout analysis, full
 * resolution ones for OCR and contrast), measures loudness and silence, and extracts evidence
 * stills. Frames are streamed and reduced one at a time, so a long film never sits in memory.
 * The parsers for ffmpeg's text output are pure and exported for tests.
 * Inputs and outputs: video file path -> ffmpeg frame decodes, audio loudness stats, and extracted stills.
 * Used by: backend/review/renderFacts.ts, backend/review/review.ts.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { VideoFacts } from "./types";

// Runs a binary to completion and returns stdout and stderr; a missing binary throws a clear error.
function run(bin: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run ${bin}: ${r.error.message}. Install ffmpeg to use aideos review.`);
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

// Reads width, height, fps, duration and audio presence of a media file.
export function probeVideo(file: string): VideoFacts {
  if (!fs.existsSync(file)) throw new Error(`no video at ${file}`);
  const r = run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate,duration:format=duration", "-of", "json", file]);
  if (r.status !== 0) throw new Error(`ffprobe could not read ${file}: ${r.stderr.trim().slice(0, 300)}`);
  const info = JSON.parse(r.stdout) as { streams?: Array<{ codec_type: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }>; format?: { duration?: string } };
  const video = info.streams?.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new Error(`${file} has no video stream`);
  const audio = info.streams?.find((s) => s.codec_type === "audio");
  const [num, den] = (video.avg_frame_rate ?? "30/1").split("/").map(Number);
  return {
    path: file,
    durationSec: Number(video.duration ?? info.format?.duration ?? 0),
    width: video.width,
    height: video.height,
    fps: den ? Math.round((num / den) * 100) / 100 : 30,
    hasAudio: Boolean(audio),
    audioDurationSec: audio?.duration ? Number(audio.duration) : audio ? Number(info.format?.duration ?? 0) : null,
  };
}

// Streams fixed-size raw gray frames out of an ffmpeg process, calling onFrame for each in order.
function streamFrames(file: string, filter: string, size: { width: number; height: number }, onFrame: (frame: Uint8Array, index: number) => Promise<void> | void): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", filter, "-pix_fmt", "gray", "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const frameBytes = size.width * size.height;
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let index = 0;
    let chain: Promise<void> = Promise.resolve();
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => reject(new Error(`could not run ffmpeg: ${e.message}. Install ffmpeg to use aideos review.`)));
    child.stdout.on("data", (chunk: Buffer) => {
      pending.push(chunk);
      pendingBytes += chunk.length;
      while (pendingBytes >= frameBytes) {
        const all = pending.length === 1 ? pending[0] : Buffer.concat(pending);
        const frame = new Uint8Array(all.subarray(0, frameBytes));
        const rest = all.subarray(frameBytes);
        pending = rest.length ? [Buffer.from(rest)] : [];
        pendingBytes = rest.length;
        const i = index++;
        // Frames are handed over strictly in order; a slow consumer pauses the pipe instead of buffering.
        child.stdout.pause();
        chain = chain.then(() => onFrame(frame, i)).then(() => { child.stdout.resume(); }, (e) => { child.kill(); reject(e); });
      }
    });
    child.on("close", (code) => {
      chain.then(() => {
        if (code !== 0 && index === 0) reject(new Error(`ffmpeg failed on ${file}: ${stderr.trim().slice(0, 300)}`));
        else resolve(index);
      }, reject);
    });
  });
}

// Decodes the whole video at a low frame rate and size for layout analysis, one callback per frame.
export function streamSmallFrames(file: string, spec: { fps: number; width: number; height: number }, onFrame: (frame: Uint8Array, index: number) => void): Promise<number> {
  return streamFrames(file, `fps=${spec.fps},scale=${spec.width}:${spec.height}:flags=area`, spec, onFrame);
}

// Decodes one full-resolution gray frame every `everySec` seconds, centred in its interval.
export function streamSampleFrames(file: string, video: VideoFacts, everySec: number, onFrame: (frame: Uint8Array, index: number, t: number) => Promise<void>): Promise<number> {
  // tpad is not needed: fps=1/n takes the first frame of each interval, so shift by half an interval.
  const filter = `fps=1/${everySec}:start_time=${everySec / 2}`;
  return streamFrames(file, filter, { width: video.width, height: video.height }, (frame, i) => onFrame(frame, i, i * everySec + everySec / 2));
}

/** Integrated loudness and true peak of the audio track. */
export interface Loudness {
  integratedLufs: number;
  truePeakDb: number;
}

// Parses the summary block ffmpeg's ebur128 filter prints to stderr.
export function parseEbur128(stderr: string): Loudness | null {
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const lufs = /I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/.exec(summary);
  const peak = /Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/.exec(summary);
  if (!lufs || !peak) return null;
  return { integratedLufs: Number(lufs[1]), truePeakDb: Number(peak[1]) };
}

// Measures integrated loudness and true peak; null when the file has no audio.
export function measureLoudness(file: string): Loudness | null {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  return parseEbur128(r.stderr);
}

/** A stretch of silence in seconds. */
export interface Silence {
  start: number;
  end: number;
}

// Parses ffmpeg's silencedetect lines into intervals; an unterminated silence runs to `totalSec`.
export function parseSilences(stderr: string, totalSec: number): Silence[] {
  const out: Silence[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: totalSec });
  return out;
}

// Finds silences at least `minSec` long below `noiseDb`; empty when the file has no audio.
export function detectSilences(file: string, totalSec: number, noiseDb = -45, minSec = 0.3): Silence[] {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=noise=${noiseDb}dB:d=${minSec}`, "-f", "null", "-"]);
  return parseSilences(r.stderr, totalSec);
}

// Extracts one still at a time offset into `outFile` (jpg), returning the path or null on failure.
export function extractStill(file: string, t: number, outFile: string): string | null {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const r = run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1", "-q:v", "3", outFile]);
  return r.status === 0 && fs.existsSync(outFile) ? outFile : null;
}
