/**
 * Render a handful of real frames from the design-language film.
 *
 * One bundle, one browser, many stills — letting each renderStill launch its
 * own Chromium disconnects partway through a batch.
 */
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".dl-frames");

const PICKS = [
  ["DL-Long", 60, "01-open-beat"],
  ["DL-Long", 400, "02-tokenstrip"],
  ["DL-Long", 700, "03-spine"],
  ["DL-Long", 1150, "04-attention-arcs"],
  ["DL-Long", 1700, "05-matrix"],
  ["DL-Long", 2300, "06-kv-copy"],
  ["DL-Long", 3100, "07-layerstack"],
  ["DL-Long", 3500, "08-cache-matrix"],
  ["DL-Long", 4300, "09-distribution"],
  ["DL-Long", 4900, "10-scalebar"],
  ["DL-Long", 5400, "11-plot"],
  ["DL-Long", 6200, "12-payoff-wide"],
  ["DL-Long", 6440, "13-close"],
  ["DL-Reel", 400, "R1-tokenstrip"],
  ["DL-Reel", 1150, "R2-attention"],
  ["DL-Reel", 4300, "R3-distribution"],
  ["DL-Reel", 6200, "R4-payoff"],
];

await mkdir(OUT, { recursive: true });

console.log("bundling…");
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/index.ts") });

// remotion.config.ts is CLI-only; the Node APIs need this passed explicitly.
const chromiumOptions = { gl: "angle" };
const browser = await openBrowser("chrome", { chromiumOptions });

const comps = new Map();
for (const [id, frame, name] of PICKS) {
  if (!comps.has(id)) {
    comps.set(id, await selectComposition({ serveUrl, id, inputProps: {} }));
  }
  await renderStill({
    composition: comps.get(id),
    serveUrl,
    output: path.join(OUT, `${name}.png`),
    frame,
    puppeteerInstance: browser,
    chromiumOptions,
    scale: 0.5,
  });
  console.log(`  ${name} (${id} @ ${frame})`);
}

await browser.close({ silent: true });
console.log(`\n→ ${OUT}`);
