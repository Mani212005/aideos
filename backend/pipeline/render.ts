/**
 * File Description: The render and verification stages. Drives Remotion's CLI to produce the long
 * and reel deliverables at broadcast-grade settings, then inspects what came out: container and
 * stream facts from ffprobe, audio level and silence statistics, and a contact sheet of frames
 * spread across the whole duration so the output can actually be looked at rather than assumed.
 * Inputs and outputs: composition name, video slug, and format -> rendered MP4 video deliverables and technical facts.
 * Used by: backend/pipeline/run.ts.
 */

import { execFileSync, spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { ProductionFormat, RenderedOutput } from "./types";
import { ROOT } from "./filmStore";
import { getExamplesDir, getVideosDir } from "../../src/dl/videoPackageLoader";

/** Composition id and frame size for each deliverable format. */
export const FORMAT_SPECS: Record<ProductionFormat, { composition: string; width: number; height: number }> = {
  long: { composition: "Long", width: 1920, height: 1080 },
  reel: { composition: "Reel", width: 1080, height: 1920 },
};

/**
 * The still-image format and quality Remotion writes every frame in before it stitches them. The
 * disk guard samples frames with exactly these settings (backend/pipeline/renderDiskBudget.ts), so
 * changing them here changes the estimate with them. `jpegQuality` only applies to "jpeg".
 */
export const RENDER_IMAGE: { format: "png" | "jpeg"; jpegQuality: number } = { format: "png", jpegQuality: 80 };

/** Encoder settings shared by both formats. Tuned for text legibility, not for file size. */
const ENCODE_FLAGS = [
  "--codec=h264",
  // PNG frames rather than the default JPEG. The design language is fine hairlines and small
  // mono type, and JPEG chroma subsampling smears both before the encoder ever sees them. It
  // also fixes the delivery format: a JPEG frame pipeline tags the stream yuvj420p, the
  // deprecated full-range variant, which players that assume limited range render with
  // crushed blacks - and this film is almost entirely black. Measured cost is under two
  // minutes on a three-minute film.
  `--image-format=${RENDER_IMAGE.format}`,
  ...(RENDER_IMAGE.format === "jpeg" ? [`--jpeg-quality=${RENDER_IMAGE.jpegQuality}`] : []),
  "--crf=16",
  "--pixel-format=yuv420p",
  "--audio-codec=aac",
  "--audio-bitrate=320k",
  "--log=error",
];

/**
 * The GL backend Remotion's headless Chrome uses. ANGLE is right on a Mac with a GPU. A CI runner
 * has no GPU, so `AIDEOS_GL=swangle` selects the software rasterizer, which draws the same pixels
 * on every machine and is what makes a rendered 3D frame comparable between runs.
 */
export function glFlag(env: NodeJS.ProcessEnv = process.env): string {
  const gl = env.AIDEOS_GL?.trim() || "angle";
  if (!/^[a-z-]+$/.test(gl)) throw new Error(`AIDEOS_GL must be a Remotion --gl value such as angle or swangle, got "${gl}"`);
  return `--gl=${gl}`;
}

/**
 * A Remotion public dir that serves `videos/<slug>/...` from wherever the packages really are.
 * The tracked `public/videos` symlink only reaches `<repo>/videos`, so a run that moved its
 * packages with AIDEOS_VIDEOS_DIR (every test, and anyone keeping videos elsewhere) rendered 404s
 * for its own narration. Returns null when the default layout already works.
 */
export function stagePublicDir(
  videosDir = getVideosDir(),
  examplesDir = getExamplesDir(),
  repoPublic = path.join(ROOT, "public"),
): { dir: string; cleanup: () => void } | null {
  const defaultVideos = path.join(ROOT, "videos");
  if (path.resolve(videosDir) === path.resolve(defaultVideos)) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-public-"));
  const link = (target: string, name: string) => {
    fs.rmSync(path.join(dir, name), { force: true });
    fs.symlinkSync(target, path.join(dir, name));
  };
  if (fs.existsSync(repoPublic)) {
    for (const entry of fs.readdirSync(repoPublic)) if (entry !== "videos") link(path.join(repoPublic, entry), entry);
  }
  // Packages in the moved dir win over the committed examples, the same precedence the loader uses.
  const videosRoot = path.join(dir, "videos");
  fs.mkdirSync(videosRoot);
  for (const pool of [examplesDir, videosDir]) {
    if (!fs.existsSync(pool)) continue;
    for (const slug of fs.readdirSync(pool)) {
      if (!fs.existsSync(path.join(pool, slug, "film.json"))) continue;
      fs.rmSync(path.join(videosRoot, slug), { force: true });
      fs.symlinkSync(path.join(pool, slug), path.join(videosRoot, slug));
    }
  }
  return {
    dir,
    // Only symlinks live here, so each is unlinked rather than followed into the real folders.
    cleanup: () => {
      for (const sub of [videosRoot, dir]) {
        for (const entry of fs.existsSync(sub) ? fs.readdirSync(sub) : []) {
          const p = path.join(sub, entry);
          if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p);
        }
      }
      fs.rmSync(videosRoot, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Anything the render or verify stage wants to say while it works. */
export type RenderLogger = (message: string, progress?: number) => void;

/** Renders one composition to an mp4, streaming Remotion's progress back to the caller. */
export function renderFormat(
  format: ProductionFormat,
  outPath: string,
  options?: { concurrency?: number; browserExecutable?: string; frames?: [number, number]; onLog?: RenderLogger },
): Promise<RenderedOutput> {
  const spec = FORMAT_SPECS[format];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const publicDir = stagePublicDir();
  const args = [
    "remotion",
    "render",
    spec.composition,
    outPath,
    ...ENCODE_FLAGS,
    ...(publicDir ? [`--public-dir=${publicDir.dir}`] : []),
    glFlag(),
    ...(options?.frames ? [`--frames=${options.frames[0]}-${options.frames[1]}`] : []),
    ...(options?.concurrency ? [`--concurrency=${options.concurrency}`] : []),
    ...(options?.browserExecutable ? [`--browser-executable=${options.browserExecutable}`] : []),
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
    child.on("error", (err) => {
      publicDir?.cleanup();
      reject(err);
    });
    child.on("close", (code) => {
      publicDir?.cleanup();
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
      // ffmpeg 7 and later refuse to write limited-range YUV (what yuv420p H.264 decodes to) as
      // JPEG unless told the non-standard range is acceptable; the sheet is a viewing aid only.
      "-strict", "unofficial",
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
    "-strict", "unofficial",
    "-q:v", "2",
    outPath,
  ]);

  return { framePaths, sheetPath: outPath };
}
