/**
 * File Description: The scene-film kit: everything a bespoke scene film is built from.
 * Stage geometry, the continuity-checked timeline builder, audio-first cues aimed at spoken words,
 * validated SVG asset writing, SVG authoring primitives, the Canvas (markup plus motion authored
 * together, with kinetic-type lyric lines), measured type metrics, balanced wrapping and frame
 * furniture. Everything here is topic-free: a film supplies its own beats, artwork and accent.
 * Node-only tools are imported directly by the film that needs them rather than re-exported here,
 * because this index is imported by code the editor dev server loads: ./voiceover (narration
 * step), ./measureWords, ./preview, ./reviewStills and ./reviewFrames (stills load Remotion).
 * Clip format: src/dl/scene/README.md.
 */

export { FPS, SCENE_SIZE, FORMAT_WINDOWS, SAFE_SQUARE, CAPTION_SAFE_SQUARE, rectInside, type SceneRect } from "./stage";
export { Timeline, type ClipSpec } from "./timeline";
export { shotFrames, createCues, type NarrationTiming, type ShotFrames, type Cues } from "./timing";
export { writeSvgAssets } from "./assets";
export { PAL, DEFAULT_ACCENT, HAIR, HAIR2, W, H, OY, FONT, frameOf, rng, n, attrs, el, g, text, stroke, type AttrValue, type TextOpts } from "./svg";
export { Canvas, type LyricOpts, type MotionOpts, type PlacedLine, type PlacedWord } from "./canvas";
export { measureText, tokenWidth, advanceEm, MONO_ADVANCE, type Face } from "./typeMetrics";
export { wrapBalanced, type WrapOpts } from "./wrap";
export { corners, backdropSvg, hudTag, readoutSeries, type BackdropOpts } from "./chrome";
