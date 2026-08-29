/**
 * File Description: Server-side still renderer for Visual Metaphors and Device Blocks.
 * Uses react-dom/server and Chrome Headless to rasterize 1920x1080 and 1080x1920 PNG stills.
 */

import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { MetaphorViewer } from "../../src/dl/metaphors/MetaphorViewer";
import type { MetaphorContent } from "../../src/dl/schema";
import { computeBlockRect } from "../../src/dl/layout";

export function renderMetaphorStill(
  type: MetaphorContent["kind"],
  content: MetaphorContent | undefined,
  viewport: { width: number; height: number },
  outputPath: string
): string {
  const absOutputDir = path.dirname(path.resolve(outputPath));
  fs.mkdirSync(absOutputDir, { recursive: true });

  const absOutputPath = path.resolve(outputPath);
  const baseName = path.basename(outputPath, ".png");
  const tmpHtmlPath = path.join(absOutputDir, `${baseName}.html`);

  const dummyFilm: any = {
    id: "test",
    title: "test",
    fps: 30,
    canvas: { nodes: [], edges: [] },
    shots: [],
  };
  const dummyShot: any = {
    id: "shot-1",
    dur: 5,
    stage: "frame",
    look: "all",
    move: "cut",
    blocks: [
      { c: "TextReveal", text: "Testing Unified Metaphor Layout", size: "headline" },
      { c: "MetaphorViewer", metaphorType: type, content },
    ],
  };

  const textRect = computeBlockRect(dummyFilm, dummyShot, dummyShot.blocks[0], viewport, { blockIndex: 0 });
  const metaphorRect = computeBlockRect(dummyFilm, dummyShot, dummyShot.blocks[1], viewport, { blockIndex: 1 });

  const element = React.createElement(
    "div",
    {
      style: {
        width: viewport.width,
        height: viewport.height,
        backgroundColor: "#0A0A0B",
        position: "relative",
        overflow: "hidden",
        fontFamily: "sans-serif",
      },
    },
    // Top Headline
    React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          left: textRect.x,
          top: textRect.y,
          width: textRect.w,
          height: textRect.h,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFFFF",
          fontSize: 28,
          fontWeight: "bold",
          border: "1px dashed rgba(255, 255, 255, 0.2)",
          borderRadius: 8,
        },
      },
      "Testing Unified Metaphor Layout"
    ),
    // Center Metaphor Container
    React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          left: metaphorRect.x,
          top: metaphorRect.y,
          width: metaphorRect.w,
          height: metaphorRect.h,
          border: "1px dashed rgba(99, 91, 255, 0.4)",
          borderRadius: 12,
          padding: 8,
          boxSizing: "border-box",
        },
      },
      React.createElement(MetaphorViewer, {
        type,
        content,
        frame: 30,
        accent: "#635BFF",
      })
    )
  );

  const markup = ReactDOMServer.renderToStaticMarkup(element);
  const fullHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #0A0A0B; width: ${viewport.width}px; height: ${viewport.height}px; overflow: hidden; }
    </style>
  </head>
  <body>
    ${markup}
  </body>
</html>`;

  fs.writeFileSync(tmpHtmlPath, fullHtml);

  // 2. Rasterize via native qlmanage or Chrome Headless
  try {
    execSync(`qlmanage -t -s 1920 -o "${absOutputDir}" "${tmpHtmlPath}" 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
    const qlPng = path.join(absOutputDir, `${baseName}.html.png`);
    if (fs.existsSync(qlPng)) {
      fs.renameSync(qlPng, absOutputPath);
      return absOutputPath;
    }
  } catch {
    // Continue to Chrome fallback
  }

  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(chromePath)) {
    const tmpProfile = path.join("/tmp", `chrome_metaphor_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    try {
      execSync(
        `"${chromePath}" --headless=new --disable-gpu --disable-background-networking --disable-default-apps --disable-extensions --no-first-run --no-default-browser-check --user-data-dir="${tmpProfile}" --screenshot="${absOutputPath}" --window-size=${viewport.width},${viewport.height} "${tmpHtmlPath}" 2>/dev/null`,
        { stdio: "ignore", timeout: 4000 }
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
    if (fs.existsSync(absOutputPath)) {
      return absOutputPath;
    }
  }

  return absOutputPath;
}
