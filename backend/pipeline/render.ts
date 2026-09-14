/**
 * File Description: The render and verification stages. Drives Remotion's CLI to produce the long
 * and reel deliverables at broadcast-grade settings, then inspects what came out: container and
 * stream facts from ffprobe, audio level and silence statistics, and a contact sheet of frames
 * spread across the whole duration so the output can actually be looked at rather than assumed.
 */

import { execFileSync, spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import type { ProductionFormat, RenderedOutput } from "./types";
import { ROOT } from "./filmStore";

/** Composition id and frame size for each deliverable format. */
export const FORMAT_SPECS: Record<ProductionFormat, { composition: string; width: number; height: number }> = {
  long: { composition: "Long", width: 1920, height: 1080 },
  reel: { composition: "Reel", width: 1080, height: 1920 },
};

/** Encoder settings shared by both formats. Tuned for text legibility, not for file size. */
const ENCODE_FLAGS = [
  "--codec=h264",
  // PNG frames rather than the default JPEG. The design language is fine hairlines and small
  // mono type, and JPEG chroma subsampling smears both before the encoder ever sees them. It
  // also fixes the delivery format: a JPEG frame pipeline tags the stream yuvj420p, the
  // deprecated full-range variant, which players that assume limited range render with
  // crushed blacks - and this film is almost entirely black. Measured cost is under two
  // minutes on a three-minute film.
  "--image-format=png",
  "--crf=16",
  "--pixel-format=yuv420p",
  "--audio-codec=aac",
  "--audio-bitrate=320k",
  "--gl=angle",
  "--log=error",
];

/** Anything the render or verify stage wants to say while it works. */
export type RenderLogger = (message: string, progress?: number) => void;

/** Renders one composition to an mp4, streaming Remotion's progress back to the caller. */
export function renderFormat(
  format: ProductionFormat,
  outPath: string,
  options?: { concurrency?: number; onLog?: RenderLogger },
): Promise<RenderedOutput> {
  const spec = FORMAT_SPECS[format];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const args = [
    "remotion",
    "render",
    spec.composition,
    outPath,
    ...ENCODE_FLAGS,
    ...(options?.concurrency ? [`--concurrency=${options.concurrency}`] : []),
  ];

  return new Promise<RenderedOutput>((resolve, reject) => {
    const child = spawn("npx", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";

    /** Remotion prints "Rendered 120/5400" style lines; surface them as fractional progress. */
    const observe = (chunk: Buffer) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000);
      const match = [...text.matchAll(/(\d+)\s*\/\s*(\d+)/g)].pop();
      if (match) {
        const done = Number(match[1]);
        const total = Number(match[2]);
        if (total > 0) options?.onLog?.(`${format}: ${done}/${total} frames`, Math.min(0.99, done / total));
      }
    };

    child.stdout.on("data", observe);
    child.stderr.on("data", observe);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`remotion render exited with code ${code}:\n${tail.trim()}`));
        return;
      }
      if (!fs.existsSync(outPath)) {
        reject(new Error(`remotion render reported success but ${outPath} does not exist`));
        return;
      }
      try {
        resolve(describeVideo(format, outPath));
      } catch (err) {
        reject(err as Error);
      }
    });
  });
}

/** Reads the real container and stream facts of a rendered file. */
export function describeVideo(format: ProductionFormat, filePath: string): RenderedOutput {
  const raw = execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate",
    "-show_entries", "format=duration,size",
    "-of", "json",
    filePath,
  ]).toString();

  const probe = JSON.parse(raw) as {
    streams?: Array<{ width?: number; height?: number; r_frame_rate?: string }>;
    format?: { duration?: string; size?: string };
  };
  const stream = probe.streams?.[0] ?? {};
  const [num, den] = (stream.r_frame_rate ?? "30/1").split("/").map(Number);

  return {
    format,
    path: filePath,
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    fps: den ? num / den : num,
    durationSec: Number(probe.format?.duration ?? 0),
    sizeBytes: Number(probe.format?.size ?? 0),
  };
}

/** Measured audio characteristics of a rendered file. */
export interface AudioReport {
  peakDb: number;
  rmsDb: number;
  channels: number;
  sampleRate: number;
  /** Stretches of near-silence longer than a second, as [startSec, durationSec] pairs. */
  silences: Array<{ startSec: number; durationSec: number }>;
  clippedSamples: number;
}

/**
 * Runs ffmpeg's astats and silencedetect over a file and parses the numbers that matter.
 *
 * The report goes to stderr, not stdout, and `-f null` writes nothing to stdout at all. Reading
 * the wrong stream gives an empty report, which parses as a peak of zero and makes every render
 * look like it is clipping.
 */
export function analyseAudio(filePath: string): AudioReport {
  const probe = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-nostats",
      "-i", filePath,
      "-af", "silencedetect=noise=-50dB:d=1.0,astats=metadata=1:reset=0",
      "-f", "null", "-",
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
  );
  const output = `${probe.stderr ?? ""}${probe.stdout ?? ""}`;
  if (!output.includes("Peak level dB")) {
    throw new Error(`ffmpeg produced no audio statistics for ${filePath}`);
  }

  /** Every value astats reported for a field, one per channel plus the overall summary. */
  const values = (label: string): number[] =>
    [...output.matchAll(new RegExp(`${label}:\\s*(-?[\\d.]+|-?inf)`, "g"))].map((m) =>
      m[1].includes("inf") ? -Infinity : Number(m[1]),
    );

  /** The worst channel, which is the one that decides whether the mix clips. */
  const worst = (label: string): number => {
    const all = values(label);
    return all.length > 0 ? Math.max(...all) : -Infinity;
  };

  const silences: AudioReport["silences"] = [];
  const starts = [...output.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...output.matchAll(/silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)];
  ends.forEach((m, i) => {
    silences.push({ startSec: starts[i] ?? Number(m[1]), durationSec: Number(m[2]) });
  });

  // Queried one field at a time: a multi-field csv comes back in the container's own field
  // order rather than the order asked for, which silently swaps channels and sample rate.
  const streamField = (field: string): number => {
    const value = execFileSync("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", `stream=${field}`,
      "-of", "csv=p=0",
      filePath,
    ]).toString().trim();
    return Number(value) || 0;
  };

  return {
    peakDb: worst("Peak level dB"),
    rmsDb: worst("RMS level dB"),
    channels: streamField("channels"),
    sampleRate: streamField("sample_rate"),
    silences,
    clippedSamples: Math.max(0, worst("Number of clipped samples")),
  };
}

/**
 * Writes a contact sheet of frames spread evenly across a video.
 *
 * Sampling the whole duration rather than the opening seconds is the point: the defects that make
 * a film look amateur - a dropped B-roll clip, text clipping the frame edge, a caption colliding
 * with the rail - happen somewhere in the middle, where nobody looks.
 */
export function contactSheet(
  filePath: string,
  outPath: string,
  options?: { count?: number; columns?: number; tileWidth?: number },
): { framePaths: string[]; sheetPath: string } {
  const count = options?.count ?? 12;
  const columns = options?.columns ?? 4;
  const tileWidth = options?.tileWidth ?? 480;
  const rows = Math.ceil(count / columns);

  const info = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath,
  ]).toString().trim();
  const duration = Number(info);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`cannot read duration of ${filePath}`);

  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });

  const framePaths: string[] = [];
  for (let i = 0; i < count; i++) {
    // Offset half a step inward at both ends so the sheet never samples a fade-in or the
    // final black frame and mistakes either for a defect.
    const t = ((i + 0.5) / count) * duration;
    const framePath = path.join(dir, `${path.basename(outPath, path.extname(outPath))}-${String(i).padStart(2, "0")}.jpg`);
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-ss", t.toFixed(3),
      "-i", filePath,
      "-frames:v", "1",
      "-q:v", "2",
      framePath,
    ]);
    framePaths.push(framePath);
  }

  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-i", path.join(dir, `${path.basename(outPath, path.extname(outPath))}-%02d.jpg`),
    "-filter_complex", `scale=${tileWidth}:-1,tile=${columns}x${rows}:margin=8:padding=8:color=0x1A1A1F`,
    "-frames:v", "1",
    "-q:v", "2",
    outPath,
  ]);

  return { framePaths, sheetPath: outPath };
}
