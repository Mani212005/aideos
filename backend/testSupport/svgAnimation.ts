/**
 * File Description: Shared declarative SVG demo scene and timeline for animation checks.
 * Inputs and outputs: static diagram fixture -> a four-second animated scene
 * Used by: backend/scene/svgAnimation.test.ts and backend/live/svgAnimation.live.ts.
 */

import path from "node:path";
import type { Scene } from "../../src/dl/scene/types";
import { stagedEntryClips, type SvgAnimationTimeline } from "../../src/dl/scene/svgAnimation";

export const DIAGRAM_SVG = path.resolve("test_fixtures/svg/pipeline_diagram.svg");

/** Builds the demo timeline: nodes stage in, edges draw on, a token travels, a caption lands. */
export function makeDemoTimeline(): SvgAnimationTimeline {
  return {
    timelineId: "pipeline-assembles",
    clips: [
      ...stagedEntryClips({
        clipIdPrefix: "nodes-in",
        targets: ["node-input", "node-model", "node-output"],
        startFrame: 0,
        durationFrames: 18,
        staggerFrames: 8,
        risePx: 14,
      }),
      { clipId: "edge-1-draw", targets: ["edge-in-model"], property: "drawOn", from: 0, to: 1, startFrame: 26, durationFrames: 14 },
      { clipId: "edge-2-draw", targets: ["edge-model-out"], property: "drawOn", from: 0, to: 1, startFrame: 40, durationFrames: 14 },
      { clipId: "token-appear", targets: ["token"], property: "opacity", from: 0, to: 1, startFrame: 54, durationFrames: 6 },
      { clipId: "token-travel", targets: ["token"], property: "translateX", from: 0, to: 290, startFrame: 60, durationFrames: 45, easing: "expoInOut" },
      { clipId: "model-pulse", targets: ["node-model"], property: "scale", from: 1, to: 1.18, startFrame: 62, durationFrames: 12, origin: { x: 0, y: 0 } },
      { clipId: "model-settle", targets: ["node-model"], property: "scale", from: 1.18, to: 1, startFrame: 74, durationFrames: 16, origin: { x: 0, y: 0 } },
      { clipId: "caption-in", targets: ["caption"], property: "opacity", from: 0, to: 1, startFrame: 88, durationFrames: 20 },
    ],
  };
}

/** Builds the demo scene: one animated diagram prop clocked to a 4 second audio segment. */
export function makeDemoScene(): Scene {
  return {
    schemaVersion: "1.0.0",
    sceneId: "svg-movie-demo",
    fps: 30,
    durationFrames: 120,
    audioSource: "audio/demo.wav",
    audioDurationMs: 4000,
    sceneSize: { w: 1920, h: 1080 },
    background: {
      assetId: "bg",
      svgSource: DIAGRAM_SVG,
      layer: 0,
      position: { x: 0, y: 0 },
      scale: 1,
      rotation: 0,
      opacity: 0,
    },
    props: [
      {
        assetId: "diagram",
        svgSource: DIAGRAM_SVG,
        layer: 10,
        position: { x: 960, y: 540 },
        scale: 2.2,
        rotation: 0,
        opacity: 1,
        animation: makeDemoTimeline(),
      },
    ],
    actors: [],
  };
}
