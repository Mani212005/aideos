/**
 * File Description: Server-side and test renderer for Aideos Scene Graphs.
 * Renders SceneView to deterministic SVG markup with react-dom/server, and rasterizes it to a true
 * 1920x1080 PNG with headless Chrome. Chrome is used rather than qlmanage because qlmanage ignores
 * the document's aspect ratio and emits a square thumbnail, which made every rendered still a
 * misleading record of what the scene actually looks like.
 */

import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import type { CompiledFrame } from "../../src/dl/scene/compile";
import { SceneView } from "../../src/dl/scene/SceneView";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export interface RenderStillOptions {
  /** Output width in pixels. Defaults to 1920. */
  width?: number;
  /** Output height in pixels. Defaults to 1080. */
  height?: number;
  /** The scene's own coordinate space. Defaults to the output size. */
  sceneSize?: { w: number; h: number };
  /** SVG source text per asset svgSource path, as produced by loadSceneAssets. */
  svgSources?: Record<string, string>;
}

/** Locates an installed Chrome or Chromium binary, or returns null when none is present. */
export function findChromeBinary(): string | null {
  const fromEnv = process.env.AIDEOS_CHROME_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Renders a CompiledFrame to SVG markup.
 * Pure and deterministic: the same frame and options always produce byte-identical output, which
 * is what makes a rendered scene reproducible.
 */
export function renderFrameSvgMarkup(frame: CompiledFrame, options: RenderStillOptions = {}): string {
  const element = React.createElement(SceneView, {
    frame,
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    sceneSize: options.sceneSize,
    svgSources: options.svgSources,
  });
  return ReactDOMServer.renderToStaticMarkup(element);
}

/**
 * Renders a CompiledFrame into a true PNG image file on disk at the requested pixel size.
 * @param frame Compiled frame data.
 * @param outputPath Target PNG output path.
 * @param options Render size and asset sources.
 */
export function renderFrameStill(
  frame: CompiledFrame,
  outputPath: string,
  options: RenderStillOptions = {},
): string {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const absOutputDir = path.dirname(path.resolve(outputPath));
  fs.mkdirSync(absOutputDir, { recursive: true });

  const absOutputPath = path.resolve(outputPath);
  const baseName = path.basename(outputPath, ".png");
  const tmpSvgPath = path.join(absOutputDir, `${baseName}.svg`);

  const svgString = renderFrameSvgMarkup(frame, { ...options, width, height });
  fs.writeFileSync(tmpSvgPath, svgString);

  const chromePath = findChromeBinary();
  if (!chromePath) {
    throw new Error(
      `STILL_RASTERIZER_UNAVAILABLE: no Chrome or Chromium binary found for rasterizing "${tmpSvgPath}". ` +
        `Install Google Chrome or set AIDEOS_CHROME_PATH. The SVG markup was still written to disk.`,
    );
  }

  if (fs.existsSync(absOutputPath)) fs.rmSync(absOutputPath, { force: true });
  rasterizeWithChrome(chromePath, tmpSvgPath, absOutputPath, width, height);

  if (!fs.existsSync(absOutputPath) || fs.statSync(absOutputPath).size < 1000) {
    throw new Error(
      `STILL_RASTERIZE_FAILED: Chrome produced no usable PNG for "${tmpSvgPath}" at ${width}x${height}.`,
    );
  }

  const dimensions = readPngDimensions(absOutputPath);
  if (dimensions.width !== width || dimensions.height !== height) {
    throw new Error(
      `STILL_RASTERIZE_WRONG_SIZE: expected ${width}x${height} for "${tmpSvgPath}", got ${dimensions.width}x${dimensions.height}.`,
    );
  }

  return absOutputPath;
}

/** Blocks the calling thread for the given number of milliseconds without spinning the CPU. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Screenshots an SVG file with headless Chrome at an exact pixel size.
 * Headless Chrome writes the screenshot and then keeps running on some builds, so this waits for
 * the file to appear and settle and then terminates the browser rather than blocking on exit.
 */
function rasterizeWithChrome(
  chromePath: string,
  svgPath: string,
  outputPath: string,
  width: number,
  height: number,
): void {
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-chrome-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--user-data-dir=${tmpProfile}`,
      `--screenshot=${outputPath}`,
      `--window-size=${width},${height}`,
      svgPath,
    ],
    { stdio: "ignore" },
  );

  const deadline = Date.now() + 30000;
  let lastSize = -1;
  try {
    while (Date.now() < deadline) {
      sleepSync(50);
      if (!fs.existsSync(outputPath)) continue;
      const size = fs.statSync(outputPath).size;
      // Two consecutive identical non-zero sizes means the write has finished.
      if (size > 0 && size === lastSize) return;
      lastSize = size;
    }
  } finally {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
    try {
      fs.rmSync(tmpProfile, { recursive: true, force: true });
    } catch {
      // Ignore profile cleanup failures in the OS temp directory.
    }
  }
}

/** Reads the pixel dimensions out of a PNG header, for verifying a rasterized still. */
export function readPngDimensions(pngPath: string): { width: number; height: number } {
  const buffer = fs.readFileSync(pngPath);
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`NOT_A_PNG: "${pngPath}" does not start with the PNG signature.`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
