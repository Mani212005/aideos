/**
 * File Description: Renders review stills of any scene film from its real Remotion compositions.
 * Run as `npx tsx backend/sceneKit/reviewFrames.ts <slug> [frame...]`. With no frames it takes one
 * frame just past the middle of every shot; otherwise it takes the frame numbers given. Unlike the
 * quick preview this goes through the full film compositor, so the chapter rail and its scrim are in
 * the picture, which is how the film actually ships. Stills land in .frames/<slug>/review.
 * Inputs and outputs: slug and frame numbers -> rendered review PNG stills via Remotion.
 * Used by: CLI entry point (npx tsx backend/sceneKit/reviewFrames.ts).
 */

import * as path from "path";
import { shotFrames } from "./timing";
import { midShotPicks, renderReviewStills, type StillPick } from "./reviewStills";
import { readVoiceoverTiming } from "./voiceover";

// Renders review stills for a film: the given frames, or the middle of every shot.
export async function reviewFilmFrames(slug: string, frames: number[] = [], scale = 0.5): Promise<string> {
  const { spans } = shotFrames(readVoiceoverTiming(slug));
  const picks: StillPick[] =
    frames.length > 0 ? frames.map((frame) => ({ composition: "Long", frame, name: `f${String(frame).padStart(5, "0")}` })) : midShotPicks(spans, "Long");
  return renderReviewStills(picks, path.resolve(__dirname, "../../.frames", slug, "review"), scale);
}

if (typeof require !== "undefined" && require.main === module) {
  const [slug, ...rest] = process.argv.slice(2);
  if (!slug) {
    console.error("Usage: npx tsx backend/sceneKit/reviewFrames.ts <slug> [frame...]");
    process.exit(1);
  }
  reviewFilmFrames(slug, rest.map(Number).filter((v) => Number.isFinite(v)))
    .then((dir) => console.log(`[${slug}] review stills in ${dir}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
