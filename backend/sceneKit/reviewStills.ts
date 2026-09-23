/**
 * File Description: Renders review stills of a film from its real Remotion compositions.
 * The film is inspected as it will ship (both formats, real fonts and compositing) rather than as a
 * compiled data structure. One browser serves the whole batch, because opening one per still is by
 * far the slowest part of the job.
 */

import * as path from "path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";

/** One still to render: which composition, which frame, and the output file's base name. */
export interface StillPick {
  composition: "Long" | "Reel";
  frame: number;
  name: string;
}

// Picks one frame just past the middle of every shot in the wide cut, named in shot order.
export function midShotPicks(spans: Map<string, { from: number; to: number }>, composition: "Long" | "Reel" = "Long"): StillPick[] {
  const prefix = composition === "Long" ? "long" : "reel";
  return [...spans].map(([shotId, span], i) => ({
    composition,
    frame: Math.round(span.from + (span.to - span.from) * 0.55),
    name: `${prefix}-${String(i + 1).padStart(2, "0")}-${shotId}`,
  }));
}

/** Bundles the compositions once and screenshots every pick through a single browser. */
export async function renderReviewStills(picks: StillPick[], outDir: string, scale = 0.5): Promise<string> {
  const root = path.resolve(__dirname, "../..");
  const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts") });
  const browser = await openBrowser("chrome");
  const compositions = new Map<string, Awaited<ReturnType<typeof selectComposition>>>();
  try {
    for (const pick of picks) {
      if (!compositions.has(pick.composition)) {
        compositions.set(pick.composition, await selectComposition({ serveUrl, id: pick.composition, inputProps: {} }));
      }
      const composition = compositions.get(pick.composition)!;
      const frame = Math.min(pick.frame, composition.durationInFrames - 1);
      await renderStill({
        composition,
        serveUrl,
        output: path.join(outDir, `${pick.name}.png`),
        frame,
        puppeteerInstance: browser,
        scale,
      });
      console.log(`  ${pick.name} (${pick.composition} @ ${frame})`);
    }
  } finally {
    await browser.close({ silent: true });
  }
  return outDir;
}
