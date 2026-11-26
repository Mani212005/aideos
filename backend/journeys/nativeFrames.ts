/**
 * File Description: Helpers for the journeys that check the native renderer (P4.5): stage a film's emitted Render IR package, draw one cold frame with the `aideos-render` binary (one process, nothing carried over from any other frame), average a frame down to the native golden scale, measure an exported video frame against a lossless frame, and measure the SSIM of a native frame against a Remotion frame on the stage (the parity bar of the native reports). Nothing here touches Remotion, Chrome or the Player.
 * Inputs and outputs: a film, a format and frame numbers, plus the release binary -> PNG files and raw RGB frames that the journeys compare.
 * Used by: backend/journeys/j1_pipeline.journey.ts (native determinism), backend/journeys/native_character_goldens.journey.ts, backend/journeys/pictures_stage.journey.ts, backend/journeys/svg_filters.journey.ts.
 */

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { emitFilmIr, nativeBinaryProblem, nativeRendererBinary, stageRenderPackage } from "../nativeRenderer";
import type { NativeFormat } from "../renderIr/emit";
import type { Film } from "../../src/dl/schema";
import type { Rgb } from "./harness";

/** Native against Remotion on the stage (above the caption band): the bar of the native parity reports in docs/NATIVE_RENDERER.md. */
export const STAGE_SSIM_MIN = 0.995;
/** The stage region compared per format: the frame above the caption band and the chapter rail. */
export const STAGE_CROP: Record<NativeFormat, string> = { long: "crop=1920:780:0:0", reel: "crop=1080:1400:0:0" };

/** The golden scale of the native frame set: every frame is box-averaged 4 x 4 (`native/aideos-render/tests/golden.rs`). */
export const GOLDEN_SHRINK = 4;

/** Why the native journeys cannot run on this machine, or null when the release binary is built. */
export function nativeJourneyProblem(): string | null {
  return nativeBinaryProblem(nativeRendererBinary());
}

/** Whether a missing binary is a failure (CI builds it before the journeys) or a skip (a developer machine without the Rust toolchain). */
export function nativeJourneysRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CI === "true" || env.AIDEOS_NATIVE_TESTS_REQUIRED === "1";
}

/** A staged native render package: the IR file and the directory its asset paths resolve against. */
export interface StagedNativePackage {
  irPath: string;
  packageDir: string;
}

/**
 * Emits the film's Render IR for one format and stages it, with its artwork, fonts and meshes, in `dir`, the way a render job does.
 * A frame render never opens audio, so with `pictureOnly` the narration, music and effect clips are left out (a fixture package has no voiceover file).
 */
export function stageNativePackage(film: Film, format: NativeFormat, dir: string, options: { pictureOnly?: boolean } = {}): StagedNativePackage {
  const emitted = emitFilmIr(film, format);
  if (!options.pictureOnly) return { irPath: stageRenderPackage(emitted, dir), packageDir: dir };
  const picture = {
    ir: { ...emitted.ir, assets: emitted.ir.assets.filter((asset) => asset.kind !== "audio"), audio: [] },
    files: emitted.files.filter((file) => !file.path.startsWith("audio/")),
  };
  return { irPath: stageRenderPackage({ ...emitted, ...picture }, dir), packageDir: dir };
}

/** Draws one frame of a staged package to a PNG in its own `aideos-render` process, so no state carries over from any other frame. */
export function renderNativeFrame(staged: StagedNativePackage, format: NativeFormat, frame: number, out: string): void {
  execFileSync(nativeRendererBinary(), [staged.irPath, "--package", staged.packageDir, "--frame", String(frame), "--format", format, "--out", out], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
}

/** Box-averages a frame down by `shrink` in each direction with round-half-up, exactly as the native golden test makes its reference frames. */
export function boxAverage(frame: Rgb, shrink = GOLDEN_SHRINK): Rgb {
  if (frame.width % shrink !== 0 || frame.height % shrink !== 0) throw new Error(`frame size ${frame.width}x${frame.height} is not divisible by ${shrink}`);
  const width = frame.width / shrink, height = frame.height / shrink, area = shrink * shrink;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      for (let dy = 0; dy < shrink; dy++) {
        for (let dx = 0; dx < shrink; dx++) {
          const i = ((y * shrink + dy) * frame.width + x * shrink + dx) * 3;
          sum[0] += frame.data[i];
          sum[1] += frame.data[i + 1];
          sum[2] += frame.data[i + 2];
        }
      }
      const o = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) data[o + c] = Math.floor((sum[c] + area / 2) / area);
    }
  }
  return { width, height, data };
}

/** The SSIM of two PNGs over one crop, measured by ffmpeg. */
export function ssim(a: string, b: string, crop: string): number {
  const run = spawnSync("ffmpeg", ["-nostdin", "-i", a, "-i", b, "-lavfi", `[0]${crop}[x];[1]${crop}[y];[x][y]ssim`, "-f", "null", "-"], { encoding: "utf8" });
  const match = /All:([0-9.]+)/.exec(String(run.stderr));
  if (run.status !== 0 || !match) throw new Error(`ffmpeg could not measure the SSIM of ${path.basename(a)}: ${String(run.stderr).slice(-300)}`);
  return Number(match[1]);
}

/** The PSNR in dB between frame `n` of an mp4 and a PNG, compared in RGB (the measure `native/aideos-render/tests/video.rs` uses for a video frame against its reference still). */
export function psnrDb(mp4: string, n: number, png: string): number {
  const run = spawnSync("ffmpeg", ["-v", "info", "-i", mp4, "-i", png, "-lavfi", `[0:v]select=eq(n\\,${n}),format=rgb24[a];[1:v]format=rgb24[b];[a][b]psnr`, "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8" });
  const text = String(run.stderr);
  const at = text.lastIndexOf("average:");
  if (run.status !== 0 || at < 0) throw new Error(`ffmpeg could not measure the PSNR of frame ${n} of ${path.basename(mp4)}: ${text.slice(-300)}`);
  const token = text.slice(at + "average:".length).trim().split(/\s+/)[0];
  if (token === "inf") return Number.POSITIVE_INFINITY;
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value)) throw new Error(`no PSNR number in: ${text.slice(at, at + 80)}`);
  return value;
}
