/**
 * File Description: A short synthetic scene film for the native renderer's TypeScript tests: one SVG asset whose clips cover every case the emitter must reproduce (adjacent continuing clips, a snapping clip, staggered targets, transform origins, scale then scaleX on one element, hold and expo easings, a clip still running when the story ends), four shots with an accented headline, a counter and a wrapping line, and a fake text measurer with deterministic widths.
 * Inputs and outputs: none -> a parsed Film, its SVG sources keyed by svgSource, and a measurer.
 * Used by: backend/renderIr/emit.test.ts, backend/rendererSelection.test.ts, backend/nativeRenderer.test.ts.
 */

import { parseFilm, type Film } from "../../src/dl/schema";
import type { MeasureReport, MeasureRequest } from "../renderIr/emit";

/** The package-relative SVG path the film's asset names. */
export const PROBE_SVG_SOURCE = "videos/native-probe/visuals/probe.svg";

/** The asset artwork: a group with a path, a bar, a dot and a line. */
export const PROBE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <g id="grp"><path id="arm" d="M0 0 L40 0" stroke="#F5F5F5" stroke-width="4"/></g>
  <rect id="bar" x="80" y="80" width="40" height="40" fill="#635BFF"/>
  <circle id="dot" cx="20" cy="20" r="10" fill="#F5F5F5"/>
  <line id="ray" x1="0" y1="100" x2="10" y2="100" stroke="#F5F5F5" stroke-width="2"/>
</svg>`;

/** Builds the film; `overrides` replace top-level fields after the defaults. */
export function nativeSceneFilm(overrides: Record<string, unknown> = {}): Film {
  const shot = (id: string, dur: number, stage: "frame" | "none", move: "cut" | "pan", blocks: unknown[]) => ({
    id, ch: id, dur, stage, look: "all", move, drift: false, zoom: 1, scriptText: `Narration for ${id}.`, speed: 1, blocks,
  });
  return parseFilm({
    schemaVersion: "1.0.0",
    id: "native-probe",
    title: "Native Probe",
    fps: 30,
    accent: "#635BFF",
    theme: { background: "smooth-dark", fontFamily: "geist", accent: "#635BFF" },
    chapters: ["Arrival", "Count"],
    canvas: { nodes: [{ id: "a", label: "a", x: 0, y: 0, w: 100, h: 60 }, { id: "b", label: "b", x: 200, y: 0, w: 100, h: 60 }], edges: [{ from: "a", to: "b" }] },
    captions: "off",
    subtitles: false,
    scene: {
      schemaVersion: "1.0.0",
      sceneId: "native-probe",
      fps: 30,
      durationFrames: 420,
      sceneSize: { w: 1920, h: 1920 },
      audioSource: "none",
      audioDurationMs: 14000,
      actors: [],
      background: { assetId: "probe-bg", svgSource: PROBE_SVG_SOURCE, layer: 0, position: { x: 960, y: 960 }, scale: 4, rotation: 0, opacity: 1 },
      props: [
        {
          assetId: "probe",
          svgSource: PROBE_SVG_SOURCE,
          layer: 1,
          position: { x: 900, y: 1000 },
          scale: 2,
          rotation: 0,
          opacity: 1,
          animation: {
            timelineId: "probe-motion",
            clips: [
              { clipId: "dot-in", targets: ["dot"], property: "translateX", from: 0, to: 100, startFrame: 0, durationFrames: 30 },
              { clipId: "dot-on", targets: ["dot"], property: "translateX", from: 100, to: 40, startFrame: 30, durationFrames: 20, easing: "linear" },
              { clipId: "dot-snap", targets: ["dot"], property: "translateX", from: 0, to: 60, startFrame: 50, durationFrames: 25, easing: "expoIn" },
              { clipId: "dot-fade", targets: ["dot"], property: "opacity", from: 0.2, to: 1, startFrame: 10, durationFrames: 12, easing: "hold" },
              { clipId: "bar-grow", targets: ["bar"], property: "scale", from: 1, to: 2, startFrame: 5, durationFrames: 20, origin: { x: 100, y: 100 } },
              { clipId: "bar-wide", targets: ["bar"], property: "scaleX", from: 2, to: 3, startFrame: 30, durationFrames: 10, easing: "expoInOut", origin: { x: 100, y: 100 } },
              { clipId: "ray-draw", targets: ["ray"], property: "drawOn", from: 0, to: 1, startFrame: 0, durationFrames: 40, easing: "linear" },
              { clipId: "ray-reach", targets: ["ray"], property: "translateY", from: 0, to: 15, startFrame: 40, durationFrames: 40, easing: "expoIn" },
              { clipId: "turn", targets: ["grp", "arm"], property: "rotate", from: 0, to: 45, startFrame: 60, durationFrames: 20, staggerFrames: 7, origin: { x: 20, y: 0 } },
              { clipId: "late-drift", targets: ["bar"], property: "translateY", from: 0, to: 80, startFrame: 340, durationFrames: 60 },
              { clipId: "late-slide", targets: ["dot"], property: "translateY", from: 0, to: 30, startFrame: 350, durationFrames: 60, easing: "linear" },
            ],
          },
        },
      ],
    },
    shots: [
      shot("arrival", 3, "frame", "cut", [{ c: "TextReveal", text: "Hello, native stage", size: "display", accentWord: "native" }]),
      shot("between", 3, "none", "pan", []),
      shot("count", 3.5, "frame", "cut", [{ c: "StatCounter", to: 22, label: "transmitter power", format: "plain", suffix: " watts" }]),
      shot("closing", 3, "frame", "pan", [{ c: "TextReveal", text: "A much longer closing line that has to wrap onto a second row because it is far wider than the stage", size: "subhead" }]),
    ],
    ...overrides,
  });
}

/** SVG sources keyed by svgSource, as the emitter takes them. */
export const NATIVE_SVG_SOURCES: Record<string, string> = { [PROBE_SVG_SOURCE]: PROBE_SVG };

/** A deterministic measurer: half an em per character plus letter spacing; line height 1.3 em with the baseline at 1 em. */
export function fakeMeasurer(seen?: MeasureRequest[]) {
  return (request: MeasureRequest): MeasureReport => {
    seen?.push(request);
    return {
      widths: request.runs.map((r) => [...r.text].length * (0.5 * r.size + r.letterSpacing)),
      metrics: request.metrics.map((m) => ({ baseline: m.size, height: 1.3 * m.size, ascent: m.size, descent: 0.3 * m.size })),
    };
  };
}
