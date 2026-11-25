/**
 * File Description: The one ffprobe probe of a rendered video or image: frame size, frame rate, picture and
 * container durations, audio presence and length, and (on request) the exact decoded frame count.
 * Inputs and outputs: media file path (+ countFrames option) -> VideoFacts; throws a clear error when the file,
 * ffprobe or a video stream is missing.
 * Used by: backend/review/media.ts (aideos review, all-check, study), backend/journeys/harness.ts, backend/geminiReview/facts.ts.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";

/** Facts about a rendered file. */
export interface VideoFacts {
  path: string;
  /** Duration of the picture stream in seconds (the container duration when the stream does not state one). */
  durationSec: number;
  /** Delivered container duration, which can include an encoded audio tail beyond the picture. */
  containerDurationSec?: number;
  width: number;
  height: number;
  /** Average frame rate, rounded to two decimals; 30 when the stream does not state one (a still image). */
  fps: number;
  hasAudio: boolean;
  /** Duration of the audio stream in seconds, null when there is none. */
  audioDurationSec: number | null;
  /** Exact number of decoded video frames; present only when the probe was asked to count them. */
  frames?: number;
}

/** Options for {@link probeVideo}. */
export interface ProbeOptions {
  /** Decode the whole stream to count its frames exactly. Slow on long films, so only tests that assert a frame count ask for it. */
  countFrames?: boolean;
}

interface ProbeStream {
  codec_type: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  nb_read_frames?: string;
}

// Turns an ffprobe "num/den" rate into frames per second, or undefined when it states none.
function rate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [num, den] = value.split("/").map(Number);
  if (!Number.isFinite(num) || !(num > 0)) return undefined;
  if (den === undefined) return num;
  return den > 0 ? num / den : undefined;
}

// Reads width, height, fps, durations, audio presence and (optionally) the frame count of a media file.
export function probeVideo(file: string, options: ProbeOptions = {}): VideoFacts {
  if (!fs.existsSync(file)) throw new Error(`no video at ${file}`);
  const entries = `stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration${options.countFrames ? ",nb_read_frames" : ""}:format=duration`;
  const args = ["-v", "error", ...(options.countFrames ? ["-count_frames"] : []), "-show_entries", entries, "-of", "json", file];
  const r = spawnSync("ffprobe", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run ffprobe: ${r.error.message}. Install ffmpeg to probe videos.`);
  if (r.status !== 0) throw new Error(`ffprobe could not read ${file}: ${String(r.stderr).trim().slice(0, 300)}`);
  const info = JSON.parse(r.stdout) as { streams?: ProbeStream[]; format?: { duration?: string } };
  const video = info.streams?.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new Error(`${file} has no video stream`);
  const audio = info.streams?.find((s) => s.codec_type === "audio");
  const fps = rate(video.avg_frame_rate) ?? rate(video.r_frame_rate);
  return {
    path: file,
    durationSec: Number(video.duration ?? info.format?.duration ?? 0),
    containerDurationSec: Number(info.format?.duration ?? video.duration ?? 0),
    width: video.width,
    height: video.height,
    fps: fps ? Math.round(fps * 100) / 100 : 30,
    hasAudio: Boolean(audio),
    audioDurationSec: audio?.duration ? Number(audio.duration) : audio ? Number(info.format?.duration ?? 0) : null,
    ...(options.countFrames ? { frames: Number(video.nb_read_frames ?? 0) } : {}),
  };
}
