/**
 * File Description: Fast frame preview for scene films.
 * Compiles a film's scene straight from its builders, renders chosen frames to markup and
 * screenshots them with headless Chrome (real Geist and JetBrains Mono from Google Fonts), cropped to
 * the 1920x1080 window the wide cut shows. Far quicker than a Remotion bundle, so it is the loop used
 * while designing; the real compositions are still inspected (reviewStills.ts) before anything ships.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { compileScene } from "../../src/dl/scene/compile";
import type { Scene } from "../../src/dl/scene/types";
import { loadSceneAssets } from "../scene/loadSceneAssets";
import { renderFrameSvgMarkup, findChromeBinary } from "../scene/renderStill";
import { writeSvgAssets } from "./assets";
import { FORMAT_WINDOWS } from "./stage";

/** What a film hands the previewer: its scene and the artwork documents it was built with. */
export interface PreviewSource {
  slug: string;
  scene: Scene;
  /** SVG documents by file name, written to videos/<slug>/visuals before rendering. */
  artwork: Record<string, string>;
}

/** The page that crops the square scene to the wide window. */
function previewPage(svg: string): string {
  const win = FORMAT_WINDOWS.wide;
  const w = win.x1 - win.x0;
  const h = win.y1 - win.y0;
  return `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;800&family=JetBrains+Mono:wght@400;500;700&display=block" rel="stylesheet"><style>html,body{margin:0;background:#0A0A0B;overflow:hidden}#w{width:${w}px;height:${h}px;overflow:hidden;position:relative}#w svg{position:absolute;left:${-win.x0}px;top:${-win.y0}px}</style></head><body><div id="w">${svg}</div></body></html>`;
}

// Renders the given frames to PNGs under .frames/<slug>/preview and returns their paths.
export function previewFrames(source: PreviewSource, frames: Array<{ frame: number; name: string }>, rootDir: string = path.resolve(__dirname, "../..")): string[] {
  const outDir = path.join(rootDir, ".frames", source.slug, "preview");
  writeSvgAssets(path.join(rootDir, "videos", source.slug, "visuals"), source.artwork);
  const assets = loadSceneAssets(source.scene);
  const compiled = compileScene(source.scene, { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });
  const chrome = findChromeBinary();
  if (!chrome) throw new Error("No Chrome found for previews.");
  const win = FORMAT_WINDOWS.wide;
  fs.mkdirSync(outDir, { recursive: true });
  const out: string[] = [];
  for (const { frame, name } of frames) {
    const f = Math.min(frame, compiled.frames.length - 1);
    const svg = renderFrameSvgMarkup(compiled.frames[f], { width: 1920, height: 1920, sceneSize: source.scene.sceneSize, svgSources: assets.svgSources });
    const htmlPath = path.join(outDir, `${name}.html`);
    const png = path.join(outDir, `${name}.png`);
    fs.writeFileSync(htmlPath, previewPage(svg));
    const run = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${win.x1 - win.x0},${win.y1 - win.y0}`, "--virtual-time-budget=8000", `--screenshot=${png}`, `file://${htmlPath}`], { encoding: "utf8" });
    if (!fs.existsSync(png)) throw new Error(`preview failed for ${name}: ${run.stderr}`);
    fs.rmSync(htmlPath, { force: true });
    out.push(png);
  }
  return out;
}

// Parses CLI frame-number arguments into named preview picks.
export function framesFromArgs(args: string[]): Array<{ frame: number; name: string }> {
  return args.map(Number).filter((v) => Number.isFinite(v)).map((frame) => ({ frame, name: `f${String(frame).padStart(5, "0")}` }));
}
