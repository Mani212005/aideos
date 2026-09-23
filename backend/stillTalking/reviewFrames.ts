/**
 * File Description: Renders review stills of "Still Talking" from both output formats.
 * Bundles the real Remotion compositions and screenshots one frame per shot in the wide cut plus a
 * vertical pass over the reel, so the film can be inspected as it will actually ship rather than as
 * a compiled data structure. One browser serves the whole batch: opening one per still is by far
 * the slowest part of the job.
 */

import * as path from "path";
import { shotFrames } from "../sceneKit";
import { midShotPicks, renderReviewStills as renderStills, type StillPick } from "../sceneKit/reviewStills";
import { readVoiceoverTiming } from "./produceVoiceover";

/** Where the review stills land. Ignored by git, like every other proofing artefact. */
const OUT_DIR = path.resolve(__dirname, "../../.frames/still-talking");

/** Frames worth looking at: the middle of every shot, plus the moments motion is aimed at. */
function picks(): StillPick[] {
  const { spans } = shotFrames(readVoiceoverTiming());
  const list: StillPick[] = midShotPicks(spans, "Long");

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

/** Renders the film's review stills into .frames/still-talking/. */
export async function renderReviewStills(scale = 0.5): Promise<string> {
  return renderStills(picks(), OUT_DIR, scale);
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
