/**
 * File Description: The one-shot blank film the editor opens with before the project list arrives
 * from the dev server. It stands in for the generated film modules the editor must not import
 * (they are gitignored, rewritten on every autosave, and would hot-reload the page mid-edit).
 */

import type { Film } from "../../../src/dl/schema";

/** A minimal valid film: two canvas nodes, one edge and a single text shot. */
export const PLACEHOLDER_FILM: Film = {
  schemaVersion: "1.0.0",
  id: "untitled",
  title: "Untitled",
  fps: 30,
  accent: "#635BFF",
  chapters: ["Start"],
  canvas: {
    nodes: [
      { id: "start", label: "Start", x: 160, y: 200, w: 280, h: 124 },
      { id: "next", label: "Next", x: 590, y: 200, w: 280, h: 124 },
    ],
    edges: [{ from: "start", to: "next" }],
  },
  shots: [
    {
      id: "beat-01",
      ch: "Start",
      dur: 4,
      stage: "frame",
      look: "start",
      move: "cut",
      blocks: [{ c: "TextReveal", text: "Open or create a project", size: "headline" }],
    },
  ],
} as Film;
