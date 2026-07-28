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
const OUT = path.join(ROOT, ".frames");

const PICKS = [
  ["Long", 60, "01-open-beat"],
  ["Long", 400, "02-tokenstrip"],
  ["Long", 700, "03-spine"],
  ["Long", 1150, "04-attention-arcs"],
  ["Long", 1700, "05-matrix"],
  ["Long", 2300, "06-kv-copy"],
  ["Long", 3100, "07-layerstack"],
  ["Long", 3500, "08-cache-matrix"],
  ["Long", 4300, "09-distribution"],
  ["Long", 4900, "10-scalebar"],
  ["Long", 5400, "11-plot"],
  ["Long", 6200, "12-payoff-wide"],
  ["Long", 6440, "13-close"],
  ["Reel", 400, "R1-tokenstrip"],
  ["Reel", 1150, "R2-attention"],
  ["Reel", 4300, "R3-distribution"],
  ["Reel", 6200, "R4-payoff"],
];

await mkdir(OUT, { recursive: true });

console.log("bundling…");
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/index.ts") });

// One browser for every still. Opening one per frame is the single biggest
// cost in this script — the render itself is milliseconds.
const browser = await openBrowser("chrome");

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
    scale: 0.5,
  });
  console.log(`  ${name} (${id} @ ${frame})`);
}

await browser.close({ silent: true });
console.log(`\n→ ${OUT}`);
