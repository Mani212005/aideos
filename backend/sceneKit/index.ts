/**
 * File Description: The scene-film kit: everything a bespoke scene film is built from.
 * Stage geometry, the continuity-checked timeline builder, audio-first cues aimed at spoken words,
 * and validated SVG asset writing; review stills live in ./reviewStills, imported directly.
 * Extracted from the "Still Talking" builder so every film designed by an agent gets the same
 * standard layer (clip format: src/dl/scene/README.md).
 */

export { FPS, SCENE_SIZE, FORMAT_WINDOWS, SAFE_SQUARE, rectInside, type SceneRect } from "./stage";
export { Timeline, type ClipSpec } from "./timeline";
export { shotFrames, createCues, type NarrationTiming, type ShotFrames, type Cues } from "./timing";
export { writeSvgAssets } from "./assets";
// Review stills (./reviewStills) are deliberately not re-exported: they load Remotion's bundler
// and renderer, and this index is imported by code the editor dev server loads.
