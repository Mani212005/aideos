/**
 * File Description: The native renderer behind the RenderJob `Renderer` interface (R4 of the native renderer plan). `prepare` emits the film's Render IR for the requested format, stages a self-contained render package (the IR, its SVG artwork and pictures, the vendored fonts and the narration) beside the job's output and asks `aideos-render check` whether the native loader accepts it (a refusal is a `NativeLoadRefusal`, which the renderer choice turns into a visible Remotion fallback); `render` runs `aideos-render video` on it through the shared, renderer-neutral subprocess runner, which owns cancellation and the disk reserve. It imports no Remotion type and never touches the Remotion path.
 * Inputs and outputs: a renderer-neutral RenderRequest -> an encoded mp4 at the request's output path, with the encode policy it actually applied reported through `profileSettingsApplied`.
 * Used by: backend/rendererSelection.ts (the renderer choice), backend/pipeline/run.ts, backend/exportJobs.ts, backend/geminiReview/render.ts, scripts/render_active.ts, backend/nativeRenderer.test.ts.
 */

import { environment } from "./env";
import { REPO_ROOT as repositoryRoot } from "./paths";

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSceneAssets } from "./scene/loadSceneAssets";
import { resolveRepoAssetPath } from "../src/dl/videoPackageLoader";
import type { Film } from "../src/dl/schema";
import { emitRenderIr, type EmitResult, type MeasureReport, type MeasureRequest, type NativeFormat } from "./renderIr/emit";
import { runRenderCommand, RENDER_RESERVE_BYTES, type RenderProcessDeps } from "./renderProcess";
import type { Renderer, RenderProfileSetting, RenderRequest } from "./renderJob";

/** The repository root (this file lives in backend/). */
export const REPO_ROOT = repositoryRoot;

/** Where `cargo build --release` puts the renderer binary; `AIDEOS_RENDER_BIN` overrides it. */
export function nativeRendererBinary(env: NodeJS.ProcessEnv = environment): string {
  return env.AIDEOS_RENDER_BIN || path.join(REPO_ROOT, "native", "target", "release", "aideos-render");
}

/** Why the native binary cannot run here, or null when it can. */
export function nativeBinaryProblem(binary = nativeRendererBinary()): string | null {
  try {
    fs.accessSync(binary, fs.constants.X_OK);
    return null;
  } catch {
    return `the native renderer binary is not built (${binary}); build it with: cargo build --locked --release --manifest-path native/Cargo.toml -p aideos-render`;
  }
}

/**
 * Raised when the native renderer's own loader refuses a staged film before any frame is drawn (an SVG element or
 * attribute it does not draw, a picture it cannot decode). In `auto` the renderer choice then falls back to Remotion
 * and logs this reason; a film native accepted and then failed to render stays an error.
 */
export class NativeLoadRefusal extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NativeLoadRefusal";
  }
}

/** Asks `aideos-render check` whether the native loader accepts a staged package; null when it does, else its reason. */
export function checkRenderPackage(irPath: string, packageDir: string, binary = nativeRendererBinary()): string | null {
  const result = spawnSync(binary, ["check", irPath, "--package", packageDir], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) return `the native renderer could not be started: ${result.error.message}`;
  if (result.status === 0) return null;
  const said = `${result.stderr ?? ""}`.trim().split("\n")[0]?.replace(/^aideos-render:\s*/, "") ?? "";
  // A usage error means a binary older than this checkout, which has no `check`: it cannot vouch for the film.
  if (result.status === 2) return `the native renderer binary is older than this checkout (no \`check\`); rebuild it with: cargo build --locked --release --manifest-path native/Cargo.toml -p aideos-render`;
  return said || `aideos-render check exited with code ${result.status}`;
}

/** Measures text with the native renderer's own fonts through `aideos-render measure`. */
export function binaryMeasurer(binary = nativeRendererBinary()) {
  return (request: MeasureRequest): MeasureReport => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-measure-"));
    try {
      const file = path.join(dir, "request.json");
      fs.writeFileSync(file, JSON.stringify(request));
      const out = execFileSync(binary, ["measure", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return JSON.parse(out) as MeasureReport;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** Resolves a repo-relative path: `videos/<slug>/...` through the package loader, anything else against the repo root. */
export function resolveRepoPath(repoRelative: string): string {
  if (path.isAbsolute(repoRelative)) return repoRelative;
  if (repoRelative.startsWith("videos/")) return resolveRepoAssetPath(repoRelative);
  return path.join(REPO_ROOT, repoRelative);
}

/** Emits the Render IR of one format of a film, reading its scene artwork from disk. */
export function emitFilmIr(film: Film, format: NativeFormat, binary = nativeRendererBinary()): EmitResult {
  const svgSources = film.scene ? loadSceneAssets(film.scene).svgSources : {};
  return emitRenderIr({ film, format, svgSources, measure: binaryMeasurer(binary), resolvePath: resolveRepoPath });
}

/** Writes an emitted IR and its files into `dir` (hard links for large files where the filesystem allows). */
export function stageRenderPackage(emitted: EmitResult, dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of emitted.files) {
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if ("text" in file) fs.writeFileSync(target, file.text);
    else if ("bytes" in file) fs.writeFileSync(target, file.bytes);
    else {
      try {
        fs.linkSync(file.from, target);
      } catch {
        fs.copyFileSync(file.from, target);
      }
    }
  }
  const irPath = path.join(dir, "render.json");
  fs.writeFileSync(irPath, JSON.stringify(emitted.ir));
  return irPath;
}

/** A rough upper bound on a rendered mp4 (CRF 16 at 1080p rarely exceeds 40 Mbit/s), for the disk check. */
export function estimateOutputBytes(frames: number, fps: number): number {
  return Math.ceil((frames / fps) * (40_000_000 / 8)) + 64 * 1024 ** 2;
}

/** Facts the CLI prints in its final JSON report. */
export interface NativeVideoReport {
  encoder: string;
  frames: number;
  elapsedSec: number;
  framesPerSecond: number;
  fallbackReason: string | null;
}

export interface NativeRendererOptions {
  binary?: string;
  /** Raster threads; default lets the binary use the machine's parallelism. */
  threads?: number;
  onLog?: (message: string, progress?: number) => void;
  /** Receives the binary's final report. */
  onReport?: (report: NativeVideoReport) => void;
  /** Supplies the emitted IR and package files instead of emitting them from the film (the farm worker renders a stored package). */
  emit?: (film: Film, format: NativeFormat) => EmitResult;
}

/** Creates the native renderer adapter; one instance serves one render job. */
export function createNativeRenderer(options: NativeRendererOptions = {}, deps: RenderProcessDeps & { statfs?: (p: string) => { bavail: number | bigint; bsize: number | bigint } } = {}): Renderer {
  const binary = options.binary ?? nativeRendererBinary();
  let stageDir: string | undefined;
  let irPath: string | undefined;
  let frameCount = 0;
  let fps = 30;
  const applied: Partial<Record<RenderProfileSetting, boolean>> = {
    intermediate: true,
    codec: true,
    crf: false,
    pixelFormat: true,
    range: true,
    audioCodec: true,
    audioBitrate: true,
  };
  return {
    name: "native",
    profileSettingsApplied: applied,
    /** Emits and stages the render package inside the job's attempt directory. */
    prepare(request) {
      const problem = nativeBinaryProblem(binary);
      if (problem) throw new Error(problem);
      const emitted = options.emit ? options.emit(request.film, request.format) : emitFilmIr(request.film, request.format, binary);
      stageDir = path.join(path.dirname(request.outPath), "native-package");
      irPath = stageRenderPackage(emitted, stageDir);
      // The native loader is the authority on what it draws: it loads the staged film once, and refuses before any frame.
      const refusal = checkRenderPackage(irPath, stageDir, binary);
      if (refusal) throw new NativeLoadRefusal(refusal);
      fps = emitted.ir.film.fps;
      frameCount = request.frames ? request.frames[1] - request.frames[0] + 1 : emitted.ir.film.durationFrames;
    },
    /** Needs room for the encoded file plus the shared reserve; no frame images are written. */
    async checkDiskBudget(request) {
      const dir = path.dirname(request.outPath);
      const stat = (deps.statfs ?? fs.statfsSync)(dir);
      const free = Number(stat.bavail) * Number(stat.bsize);
      const need = estimateOutputBytes(frameCount, fps) + RENDER_RESERVE_BYTES;
      if (free < need) {
        throw new Error(`RENDER_DISK_LOW: the native render of ${frameCount} frames needs about ${Math.ceil(need / 1024 ** 2)} MiB free under ${dir} (including the 3 GiB reserve); ${Math.floor(free / 1024 ** 2)} MiB is free`);
      }
    },
    /** Runs `aideos-render video` and reports progress from its `frames D/T` lines. */
    async render(request: RenderRequest, context) {
      if (!irPath || !stageDir) throw new Error("the native renderer was not prepared");
      const args = [
        "video", irPath,
        "--package", stageDir,
        "--format", request.format,
        "--out", request.outPath,
        "--profile", request.profile,
        ...(request.frames ? ["--frames", `${request.frames[0]}-${request.frames[1]}`] : []),
        ...(options.threads ? ["--threads", String(options.threads)] : []),
      ];
      let stdout = "";
      await runRenderCommand(
        { command: binary, args, cwd: REPO_ROOT },
        request.outPath,
        {
          signal: context.signal,
          forceSignal: context.forceSignal,
          onOutput: context.onOutput,
          onStdout: (text) => {
            stdout += text;
            const match = [...text.matchAll(/frames (\d+)\/(\d+)/g)].pop();
            if (match && Number(match[2]) > 0) {
              options.onLog?.(`${request.format}: ${match[1]}/${match[2]} frames (native)`, Math.min(0.99, Number(match[1]) / Number(match[2])));
            }
          },
        },
        deps,
      );
      const json = stdout.slice(stdout.indexOf("{"));
      try {
        const report = JSON.parse(json) as NativeVideoReport;
        // x264 is the only encoder that takes a CRF; a hardware draft encodes at a fixed QP instead.
        applied.crf = report.encoder === "libx264";
        options.onReport?.(report);
      } catch {
        throw new Error(`aideos-render finished without its JSON report: ${stdout.slice(-400)}`);
      }
    },
    /** Removes the staged package. */
    cleanup() {
      if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
      stageDir = undefined;
      irPath = undefined;
    },
  };
}
