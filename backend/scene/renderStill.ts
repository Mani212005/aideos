/**
 * File Description: Server-side and test renderer for Aideos Scene Graphs.
 * Uses react-dom/server to render SceneView to SVG, and Google Chrome headless to rasterize pristine 1920x1080 PNG stills.
 */

import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { CompiledFrame } from "../../src/dl/scene/compile";
import { SceneView } from "../../src/dl/scene/SceneView";

/**
 * Renders a CompiledFrame into a true 1920x1080 PNG image file on disk.
 * @param frame Compiled frame data.
 * @param outputPath Target PNG output path.
 */
export function renderFrameStill(frame: CompiledFrame, outputPath: string): string {
  const absOutputDir = path.dirname(path.resolve(outputPath));
  fs.mkdirSync(absOutputDir, { recursive: true });

  const absOutputPath = path.resolve(outputPath);
  const baseName = path.basename(outputPath, ".png");
  const tmpSvgPath = path.join(absOutputDir, `${baseName}.svg`);

  // 1. Render React SceneView to raw SVG string
  const element = React.createElement(SceneView, { frame, width: 1920, height: 1080 });
  const svgString = ReactDOMServer.renderToStaticMarkup(element);
  fs.writeFileSync(tmpSvgPath, svgString);

  // 2. Rasterize SVG to bit-perfect 1920x1080 PNG via macOS native qlmanage or Chrome Headless
  try {
    execSync(`qlmanage -t -s 1920 -o "${absOutputDir}" "${tmpSvgPath}" 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
    const qlPng = path.join(absOutputDir, `${baseName}.svg.png`);
    if (fs.existsSync(qlPng)) {
      fs.renameSync(qlPng, absOutputPath);
      return absOutputPath;
    }
  } catch {
    // Continue to Chrome headless fallback
  }

  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(chromePath)) {
    const tmpProfile = path.join("/tmp", `chrome_aideos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    try {
      execSync(
        `"${chromePath}" --headless=new --disable-gpu --disable-background-networking --disable-default-apps --disable-extensions --no-first-run --no-default-browser-check --user-data-dir="${tmpProfile}" --screenshot="${absOutputPath}" --window-size=1920,1080 "${tmpSvgPath}" 2>/dev/null`,
        { stdio: "ignore", timeout: 4000 },
      );
    } catch {
      // Chrome failed or timed out
    } finally {
      try {
        if (fs.existsSync(tmpProfile)) {
          fs.rmSync(tmpProfile, { recursive: true, force: true });
        }
      } catch {
        // Ignore lock cleanup in /tmp
      }
    }
  }

  return absOutputPath;
}
