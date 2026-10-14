/**
 * File Description: Shared harness for headless user-journey and golden-frame tests: a disk-headroom guard, active-film restore, temp-leak accounting, ffmpeg frame decode and comparison, and failure artifacts that CI uploads. A journey test is written as `journey("J1 ...", async (ctx) => {...})` and gets cleanup and artifacts for free.
 * Inputs and outputs: test bodies, mp4 and png files -> node:test results, decoded frames, pixel statistics and saved failure evidence under .ci-artifacts/.
 * Used by: backend/journeys/*.journey.ts, backend/journeys/*.golden.ts, backend/journeys/harness.test.ts, docs/CI.md.
 */

import "../testSupport/fixtureVideosDir";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every journey process works in its own temp dir: Remotion and Chrome write their frames, bundles
 * and profiles under TMPDIR, so a private one makes "nothing is left behind" an exact statement
 * instead of a race with whatever else is rendering on the machine. It is removed on exit.
 */
const PRIVATE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-journey-tmp-"));
process.env.TMPDIR = PRIVATE_TMP;
process.on("exit", () => fs.rmSync(PRIVATE_TMP, { recursive: true, force: true }));

export const REPO_ROOT = path.resolve(__dirname, "../..");
/** Where failing frames and reports are copied so CI can upload them. */
export const ARTIFACT_DIR = process.env.AIDEOS_CI_ARTIFACTS ? path.resolve(process.env.AIDEOS_CI_ARTIFACTS) : path.join(REPO_ROOT, ".ci-artifacts");
const ACTIVE_FILM_FILE = path.join(REPO_ROOT, "src/dl/activeFilm.ts");

/** Free space the journeys refuse to go below, in GiB. A render writes every frame to disk first. */
export const MIN_FREE_GIB = Number(process.env.AIDEOS_JOURNEY_MIN_FREE_GIB ?? 3);

/** Thrown, with this name in the message, when a journey would start with too little disk. */
export class DiskHeadroomError extends Error {
  /** Names the directory and both numbers so the fix is obvious. */
  constructor(dir: string, freeGiB: number, needGiB: number) {
    super(`DISK_HEADROOM: only ${freeGiB.toFixed(1)} GiB free under ${dir}, need ${needGiB} GiB; free space instead of deleting renders or caches`);
    this.name = "DiskHeadroomError";
  }
}

/** Free space under a directory in GiB; `statfs` is injectable so the guard is testable. */
export function freeGiB(dir: string, statfs: (p: string) => { bavail: number | bigint; bsize: number | bigint } = fs.statfsSync): number {
  const s = statfs(dir);
  return (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
}

/** Refuses to start a render-heavy journey when the temp or repo disk is under the headroom. */
export function assertDiskHeadroom(dirs: string[] = [os.tmpdir(), REPO_ROOT], need = MIN_FREE_GIB, statfs?: Parameters<typeof freeGiB>[1]): void {
  for (const dir of dirs) {
    const free = freeGiB(dir, statfs);
    if (free < need) throw new DiskHeadroomError(dir, free, need);
  }
}

/** Remembers src/dl/activeFilm.ts (a render rewrites it) and returns the function that restores it. */
export function holdActiveFilm(): () => void {
  const before = fs.existsSync(ACTIVE_FILM_FILE) ? fs.readFileSync(ACTIVE_FILM_FILE, "utf8") : null;
  return () => {
    if (before === null) fs.rmSync(ACTIVE_FILM_FILE, { force: true });
    else if (fs.readFileSync(ACTIVE_FILM_FILE, "utf8") !== before) fs.writeFileSync(ACTIVE_FILM_FILE, before, "utf8");
  };
}

/** Temp entries a render or journey may create; anything with these prefixes left behind is a leak. */
export const TEMP_PREFIXES = ["remotion-", "react-motion-render", "aideos-journey-", "puppeteer_dev"];

/** Lists the temp-dir entries that match the prefixes, so a before/after diff shows a leak. */
export function tempEntries(prefixes: string[] = TEMP_PREFIXES, dir = os.tmpdir()): string[] {
  return fs.readdirSync(dir).filter((name) => prefixes.some((p) => name.startsWith(p))).sort();
}

/** Total size in bytes of a file or directory tree (0 when it is gone). */
export function sizeOf(target: string): number {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(target).reduce((sum, name) => sum + sizeOf(path.join(target, name)), 0);
}

/** Facts about a rendered video, read with ffprobe. */
export interface VideoFacts {
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSec: number;
  hasAudio: boolean;
}

/** Probes a video's size, frame rate, frame count and whether it carries audio. */
export function probeVideo(file: string): VideoFacts {
  const out = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,width,height,r_frame_rate,nb_read_frames:format=duration", "-of", "json", file]).toString(),
  ) as { streams: Array<{ codec_type: string; width?: number; height?: number; r_frame_rate?: string; nb_read_frames?: string }>; format: { duration?: string } };
  const video = out.streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error(`no video stream in ${file}`);
  const [num, den] = (video.r_frame_rate ?? "30/1").split("/").map(Number);
  return {
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: den ? num / den : num,
    frames: Number(video.nb_read_frames ?? 0),
    durationSec: Number(out.format.duration ?? 0),
    hasAudio: out.streams.some((s) => s.codec_type === "audio"),
  };
}

/** One decoded frame: raw RGB bytes, three per pixel. */
export interface Rgb {
  width: number;
  height: number;
  data: Buffer;
}

/** Decodes frame `index` of a video, or the first frame of an image, to raw RGB at an optional width. */
export function decodeFrame(file: string, options: { frame?: number; scaleWidth?: number } = {}): Rgb {
  const probe = probeVideo(file);
  const filterList = [
    ...(options.frame === undefined ? [] : [`select=eq(n\\,${options.frame})`]),
    ...(options.scaleWidth ? [`scale=${options.scaleWidth}:-2:flags=area`] : []),
  ];
  const filters = filterList.join(",");
  const args = ["-v", "error", "-i", file, ...(filters ? ["-vf", filters] : []), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"];
  const r = spawnSync("ffmpeg", args, { maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg could not decode ${file}: ${String(r.stderr).slice(0, 300)}`);
  const width = options.scaleWidth ?? probe.width;
  // `scale=W:-2` keeps the aspect ratio and rounds the height to an even number; unscaled frames keep their own height.
  const height = options.scaleWidth ? Math.round((probe.height * width) / probe.width / 2) * 2 : probe.height;
  if (r.stdout.length !== width * height * 3) throw new Error(`decoded ${r.stdout.length} bytes for ${file}, expected ${width * height * 3}; the frame does not exist`);
  return { width, height, data: r.stdout };
}

/** Writes frame `frame` of a video as a PNG, for evidence and for goldens. */
export function extractFramePng(video: string, frame: number, out: string, scaleWidth?: number): void {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const filter = `select=eq(n\\,${frame})${scaleWidth ? `,scale=${scaleWidth}:-2:flags=area` : ""}`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", filter, "-frames:v", "1", out]);
  if (!fs.existsSync(out) || fs.statSync(out).size < 200) throw new Error(`frame ${frame} of ${video} could not be extracted`);
}

/** Mean and standard deviation of luma, which tell a blank or flat frame from a drawn one. */
export function frameStats(rgb: Rgb): { mean: number; stddev: number } {
  const n = rgb.width * rgb.height;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const y = 0.2126 * rgb.data[i * 3] + 0.7152 * rgb.data[i * 3 + 1] + 0.0722 * rgb.data[i * 3 + 2];
    sum += y;
    sumSq += y * y;
  }
  const mean = sum / n;
  return { mean, stddev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}

/** Mean absolute channel difference (0..255) and the share of pixels that differ by more than `threshold`. */
export function frameDiff(a: Rgb, b: Rgb, threshold = 8): { meanAbs: number; changedShare: number } {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`cannot compare ${a.width}x${a.height} with ${b.width}x${b.height}`);
  const n = a.width * a.height;
  let total = 0;
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(a.data[i * 3] - b.data[i * 3]), Math.abs(a.data[i * 3 + 1] - b.data[i * 3 + 1]), Math.abs(a.data[i * 3 + 2] - b.data[i * 3 + 2]));
    total += Math.abs(a.data[i * 3] - b.data[i * 3]) + Math.abs(a.data[i * 3 + 1] - b.data[i * 3 + 1]) + Math.abs(a.data[i * 3 + 2] - b.data[i * 3 + 2]);
    if (d > threshold) changed++;
  }
  return { meanAbs: total / (n * 3), changedShare: changed / n };
}

/** What a journey body receives: a private work dir and a way to keep evidence when it fails. */
export interface JourneyContext {
  /** A temp directory, removed when the journey ends. */
  workDir: string;
  /** Registers a file or folder to copy into .ci-artifacts/ if the journey fails. */
  keep: (file: string) => void;
}

/** Copies the kept files into .ci-artifacts/<journey>/ so CI can upload them. */
export function saveArtifacts(name: string, kept: string[]): void {
  const dir = path.join(ARTIFACT_DIR, name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  for (const file of kept) if (fs.existsSync(file)) fs.cpSync(file, path.join(dir, path.basename(file)), { recursive: true });
}

/**
 * Declares one journey test. It checks disk headroom first, gives the body a private work dir,
 * restores the generated active film afterwards, and saves every kept file when the body throws.
 */
export function journey(name: string, body: (ctx: JourneyContext) => Promise<void> | void, options: { disk?: boolean } = {}): void {
  test(name, async () => {
    if (options.disk !== false) assertDiskHeadroom();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-journey-"));
    const kept: string[] = [];
    const restore = holdActiveFilm();
    try {
      await body({ workDir, keep: (f) => kept.push(f) });
    } catch (err) {
      saveArtifacts(name, kept);
      throw err;
    } finally {
      restore();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
}
