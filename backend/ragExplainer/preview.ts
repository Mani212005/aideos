/**
 * File Description: Fast frame preview for the RAG explainer.
 * Compiles the film's scene straight from the builders, renders chosen frames to markup and
 * screenshots them with headless Chrome (real Geist and JetBrains Mono from Google Fonts), cropped to
 * the 1920x1080 window the wide cut shows. Far quicker than a Remotion bundle, so it is the loop used
 * while designing; the real compositions are still inspected before anything ships.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { compileScene } from "../../src/dl/scene/compile";
import { loadSceneAssets } from "../scene/loadSceneAssets";
import { renderFrameSvgMarkup, findChromeBinary } from "../scene/renderStill";
import { writeSvgAssets } from "../sceneKit";
import { buildPackageScene } from "./buildFilm";

/** Where previews land (ignored by git with the rest of .frames/). */
const OUT = path.resolve(__dirname, "../../.frames/rag-explainer/preview");

// Renders the given frames (or shot-relative fractions) to PNGs and returns their paths.
export function previewFrames(frames: Array<{ frame: number; name: string }>): string[] {
  const { scene, artwork } = buildPackageScene();
  writeSvgAssets(path.resolve(__dirname, "../../videos/rag-explainer/visuals"), artwork);
  const assets = loadSceneAssets(scene);
  const compiled = compileScene(scene, { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });
  const chrome = findChromeBinary();
  if (!chrome) throw new Error("No Chrome found for previews.");
  fs.mkdirSync(OUT, { recursive: true });
  const out: string[] = [];
  for (const { frame, name } of frames) {
    const f = Math.min(frame, compiled.frames.length - 1);
    const svg = renderFrameSvgMarkup(compiled.frames[f], { width: 1920, height: 1920, sceneSize: scene.sceneSize, svgSources: assets.svgSources });
    const html = `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;800&family=JetBrains+Mono:wght@400;500;700&display=block" rel="stylesheet"><style>html,body{margin:0;background:#0A0A0B;overflow:hidden}#w{width:1920px;height:1080px;overflow:hidden;position:relative}#w svg{position:absolute;left:0;top:-420px}</style></head><body><div id="w">${svg}</div></body></html>`;
    const htmlPath = path.join(OUT, `${name}.html`);
    const png = path.join(OUT, `${name}.png`);
    fs.writeFileSync(htmlPath, html);
    const run = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,1080", "--virtual-time-budget=8000", `--screenshot=${png}`, `file://${htmlPath}`], { encoding: "utf8" });
    if (!fs.existsSync(png)) throw new Error(`preview failed for ${name}: ${run.stderr}`);
    fs.rmSync(htmlPath, { force: true });
    out.push(png);
  }
  return out;
}

if (typeof require !== "undefined" && require.main === module) {
  const args = process.argv.slice(2).map(Number).filter((v) => Number.isFinite(v));
  const list = args.map((frame) => ({ frame, name: `f${String(frame).padStart(5, "0")}` }));
  console.log(previewFrames(list).join("\n"));
}
