/**
 * File Description: Renders review stills of "Still Talking" from both output formats.
 * Bundles the real Remotion compositions and screenshots one frame per shot in the wide cut plus a
 * vertical pass over the reel, so the film can be inspected as it will actually ship rather than as
 * a compiled data structure. One browser serves the whole batch: opening one per still is by far
 * the slowest part of the job.
 */

import * as path from "path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { readVoiceoverTiming } from "./produceVoiceover";
import { shotFrames } from "./scene";

/** Where the review stills land. Ignored by git, like every other proofing artefact. */
const OUT_DIR = path.resolve(__dirname, "../../.frames/still-talking");

/** Frames worth looking at: the middle of every shot, plus the moments motion is aimed at. */
function picks(): Array<{ composition: "Long" | "Reel"; frame: number; name: string }> {
  const { spans } = shotFrames(readVoiceoverTiming());
  const list: Array<{ composition: "Long" | "Reel"; frame: number; name: string }> = [];

  let index = 0;
  for (const [shotId, span] of spans) {
    index += 1;
    const label = `${String(index).padStart(2, "0")}-${shotId}`;
    list.push({ composition: "Long", frame: Math.round(span.from + (span.to - span.from) * 0.55), name: `long-${label}` });
  }

  // The reel is not a crop of the wide cut, so it gets its own pass over the arc's turning points.
  const reelShots = [
    "departure",
    "the-record",
    "jupiter",
    "saturn",
    "out-of-plane",
    "pale-blue-pixel",
    "that-is-everyone",
    "particles-change",
    "twenty-two-watts",
    "keep-going",
  ];
  reelShots.forEach((shotId, i) => {
    const span = spans.get(shotId);
    if (!span) return;
    list.push({
      composition: "Reel",
      frame: Math.round(span.from + (span.to - span.from) * 0.55),
      name: `reel-${String(i + 1).padStart(2, "0")}-${shotId}`,
    });
  });

  return list;
}

/** Bundles the compositions once and screenshots every pick through a single browser. */
export async function renderReviewStills(scale = 0.5): Promise<string> {
  const root = path.resolve(__dirname, "../..");
  const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts") });
  const browser = await openBrowser("chrome");
  const compositions = new Map<string, Awaited<ReturnType<typeof selectComposition>>>();

  try {
    for (const pick of picks()) {
      if (!compositions.has(pick.composition)) {
        compositions.set(pick.composition, await selectComposition({ serveUrl, id: pick.composition, inputProps: {} }));
      }
      const composition = compositions.get(pick.composition)!;
      const frame = Math.min(pick.frame, composition.durationInFrames - 1);
      await renderStill({
        composition,
        serveUrl,
        output: path.join(OUT_DIR, `${pick.name}.png`),
        frame,
        puppeteerInstance: browser,
        scale,
      });
      console.log(`  ${pick.name} (${pick.composition} @ ${frame})`);
    }
  } finally {
    await browser.close({ silent: true });
  }

  return OUT_DIR;
}

if (require.main === module) {
  const scaleArg = Number.parseFloat(process.argv[2] ?? "0.5");
  renderReviewStills(Number.isFinite(scaleArg) ? scaleArg : 0.5)
    .then((dir) => console.log(`[still-talking] review stills in ${dir}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
