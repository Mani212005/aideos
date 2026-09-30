/**
 * File Description: Renders review stills of "RAG, in four steps" from its real Remotion composition.
 * With no arguments it takes one frame just past the middle of every shot; otherwise it takes the frame
 * numbers given. Unlike preview.ts this goes through the full film compositor, so the chapter rail and
 * its scrim are in the picture, which is how the film actually ships.
 */

import * as path from "path";
import { shotFrames } from "../sceneKit";
import { midShotPicks, renderReviewStills, type StillPick } from "../sceneKit/reviewStills";
import { readVoiceoverTiming } from "./produceVoiceover";

/** Where the review stills land. Ignored by git, like every other proofing artefact. */
const OUT_DIR = path.resolve(__dirname, "../../.frames/rag-explainer/review");

if (typeof require !== "undefined" && require.main === module) {
  const frames = process.argv.slice(2).map(Number).filter((v) => Number.isFinite(v));
  const { spans } = shotFrames(readVoiceoverTiming());
  const picks: StillPick[] = frames.length > 0 ? frames.map((frame) => ({ composition: "Long", frame, name: `f${String(frame).padStart(5, "0")}` })) : midShotPicks(spans, "Long");
  renderReviewStills(picks, OUT_DIR, 0.5)
    .then((dir) => console.log(`[rag-explainer] review stills in ${dir}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
