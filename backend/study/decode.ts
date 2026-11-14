/**
 * File Description: ffmpeg decoding helpers for `aideos study`: the analysis frame size, a raw frame stream in any planar or packed pixel format,
 * and PCM audio decoding. Frames are streamed and handed over one at a time, so a long reference never sits in memory.
 * Inputs and outputs: a video file and an ffmpeg filter -> raw frames in order (callback per frame); an audio file -> mono 16 kHz samples.
 * Used by: backend/study/study.ts, backend/study/tone.ts, backend/study/audio.ts.
 */

import { spawn, spawnSync } from "node:child_process";
import { STUDY } from "./types";

/** Size of the frames the pixel analysis decodes. */
export interface FrameSize {
  width: number;
  height: number;
}

// The analysis frame size: the longest side is STUDY.analysisLongSide, the other keeps the aspect, both even.
export function analysisSize(width: number, height: number): FrameSize {
  const long = STUDY.analysisLongSide;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return width >= height ? { width: long, height: even((long * height) / width) } : { width: even((long * width) / height), height: long };
}

// Streams fixed-size raw frames from ffmpeg, calling onFrame (synchronously, in order) for each one, so a long file never sits in memory.
export function streamRawFrames(file: string, filter: string, pixFmt: string, frameBytes: number, onFrame: (frame: Uint8Array, index: number) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", filter, "-pix_fmt", pixFmt, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;
    let stderr = "";
    let failed = false;
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => reject(new Error(`could not run ffmpeg: ${e.message}. Install ffmpeg to use aideos study.`)));
    child.stdout.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (!failed && pending.length >= frameBytes) {
        const frame = new Uint8Array(pending.subarray(0, frameBytes));
        pending = pending.subarray(frameBytes);
        try {
          onFrame(frame, index++);
        } catch (e) {
          failed = true;
          child.kill();
          reject(e);
        }
      }
    });
    child.on("close", (code) => {
      if (failed) return;
      if (code !== 0 && index === 0) reject(new Error(`ffmpeg failed on ${file}: ${stderr.trim().slice(0, 300)}`));
      else resolve(index);
    });
  });
}

// Decodes the audio track to mono 16 kHz float samples in -1..1; null when the file has no audio.
export function decodeAudioMono16k(file: string): Float32Array | null {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { maxBuffer: 1024 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run ffmpeg: ${r.error.message}. Install ffmpeg to use aideos study.`);
  const bytes = r.stdout as Buffer;
  if (r.status !== 0 || bytes.length < 2) return null;
  const count = Math.floor(bytes.length / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = bytes.readInt16LE(i * 2) / 32768;
  return out;
}
