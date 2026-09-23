/**
 * File Description: The scene-film kit: everything a bespoke scene film is built from.
 * Stage geometry, the continuity-checked timeline builder, audio-first cues aimed at spoken words,
 * validated SVG asset writing and review stills. Extracted from the "Still Talking" builder so every
 * film designed by an agent gets the same standard layer (see docs/SCENE_FILMS.md when present, and
 * src/dl/scene/README.md for the clip format).
 */

export { FPS, SCENE_SIZE, FORMAT_WINDOWS, SAFE_SQUARE, rectInside, type SceneRect } from "./stage";
export { Timeline, type ClipSpec } from "./timeline";
export { shotFrames, createCues, type NarrationTiming, type ShotFrames, type Cues } from "./timing";
export { writeSvgAssets } from "./assets";
export { renderReviewStills, midShotPicks, type StillPick } from "./reviewStills";
