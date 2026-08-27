/**
 * File Description: Server-side and test renderer for Aideos Scene Graphs.
 * Uses react-dom/server to render SceneView to SVG, and macOS QuickLook CoreGraphics to rasterize high-res 1920x1080 PNG stills.
 */

import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { CompiledFrame } from "../../src/dl/scene/compile";
import { SceneView } from "../../src/dl/scene/SceneView";

/**
 * Renders a CompiledFrame into a 1920x1080 PNG image file on disk.
 * @param frame Compiled frame data.
 * @param outputPath Target PNG output path.
 */
export function renderFrameStill(frame: CompiledFrame, outputPath: string): string {
  const absOutputDir = path.dirname(path.resolve(outputPath));
  fs.mkdirSync(absOutputDir, { recursive: true });

  // 1. Render React SceneView to raw SVG string
  const element = React.createElement(SceneView, { frame, width: 1920, height: 1080 });
  const svgString = ReactDOMServer.renderToStaticMarkup(element);

  const baseName = path.basename(outputPath, ".png");
  const tmpSvgPath = path.join(absOutputDir, `${baseName}.svg`);
  fs.writeFileSync(tmpSvgPath, svgString);

  // 2. Rasterize SVG to high-res PNG using macOS QuickLook CoreGraphics
  try {
    execSync(`qlmanage -t -s 1920 -o "${absOutputDir}" "${tmpSvgPath}" 2>/dev/null`, { stdio: "ignore" });
    const generatedPng = path.join(absOutputDir, `${baseName}.svg.png`);
    if (fs.existsSync(generatedPng)) {
      fs.renameSync(generatedPng, path.resolve(outputPath));
    }
  } catch (err) {
    console.error(`Failed to rasterize SVG to PNG via qlmanage:`, err);
  }

  return outputPath;
}
