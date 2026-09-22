/**
 * File Description: Tests for the Jev-driven async design compile path.
 * Verifies schema-valid block authoring for every shot visual, SVG routing for concrete visuals,
 * footage precedence, narration locking, and deterministic heuristic fallback with no network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { blockSchema, shotSchema } from "../../src/dl/schema";
import {
  buildBlocksForShotVisual,
  compileFilmFromScreenplayAsync,
  flattenScreenplay,
} from "./design";
import { parseClaudeScript } from "../scriptIntake";
import {
  clearMockShotVisualHandler,
  clearMockSvgRouteHandler,
  setMockShotVisualHandler,
  setMockSvgRouteHandler,
  SHOT_VISUALS,
} from "../jev";
import type { SegmentAudioInfo } from "../audio";

const SCRIPT = `## 0:00 - 0:20 - The Opening (opening)

[VISUAL] A rat exploring a spatial maze diagram with labelled chambers.
[ON SCREEN] Maze Runner
[NARRATION] This is the first thing the narrator says out loud.

[ON SCREEN] Seventy billion parameters
[NARRATION] To produce a single token the model reads seventy billion parameters out of memory.

## 0:20 - 0:44 - The Middle (middle)

[ON SCREEN] Throughput curve
[NARRATION] Throughput scales linearly with draft length and loss curves flatten.
`;

/** Builds a narration spine matching the screenplay beat count. */
function spine(durations: number[]): { segments: SegmentAudioInfo[]; shotDurations: number[] } {
  const segments: SegmentAudioInfo[] = [];
  let cursor = 0;
  durations.forEach((duration, i) => {
    segments.push({ text: `segment ${i}`, duration, startOffset: cursor, words: [], utterances: [] });
    cursor += duration + (i < durations.length - 1 ? 0.2 : 0);
  });
  const shotDurations = segments.map((seg, i) => {
    const next = segments[i + 1];
    return (next ? next.startOffset : cursor) - seg.startOffset;
  });
  return { segments, shotDurations };
}

test("DesignJev: buildBlocksForShotVisual authors schema-valid blocks for every visual", () => {
  for (const visual of SHOT_VISUALS) {
    const blocks = buildBlocksForShotVisual(visual, "Throughput scales with seventy billion parameters.", ["Headline", "Support line"]);
    assert.ok(blocks.length > 0, `${visual} must produce blocks`);
    for (const block of blocks) {
      assert.doesNotThrow(() => blockSchema.parse(block), `${visual} block failed schema`);
    }
  }
});

test("DesignJev: async compile produces a schema-valid film locked to the narration spine", async () => {
  clearMockShotVisualHandler();
  clearMockSvgRouteHandler();
  const { segments, shotDurations } = spine([6, 8, 7]);
  const result = await compileFilmFromScreenplayAsync(
    SCRIPT,
    segments,
    shotDurations,
    { title: "Probe Jev Film", maxFootageShots: 0 },
    { apiKey: "" },
  );
  assert.equal(result.film.shots.length, shotDurations.length);
  result.film.shots.forEach((shot, i) => {
    assert.doesNotThrow(() => shotSchema.parse(shot), `shot ${shot.id} failed schema`);
    assert.ok(Math.abs(shot.dur - shotDurations[i]) < 0.001, `shot ${i} drifted`);
  });
  const beats = flattenScreenplay(parseClaudeScript(SCRIPT));
  result.film.shots.forEach((shot, i) => {
    assert.equal(shot.scriptText, beats[i].narration);
  });
  assert.equal(result.shotVisuals.size, 3);
  assert.equal(result.svgRoutes.size, 3);
});

test("DesignJev: async compile routes concrete visuals to SVG assets with metaphor custom", async () => {
  setMockSvgRouteHandler(async (state): Promise<{ choice: "svg-asset" | "standard-blocks"; confidence: number; probabilities: Record<string, number> } | null> => {
    if ((state.visual || "").includes("rat") && (state.onscreen || []).some((t) => t.includes("Maze Runner"))) {
      return { choice: "svg-asset", confidence: 0.92, probabilities: { "svg-asset": 0.92 } };
    }
    return { choice: "standard-blocks", confidence: 0.9, probabilities: { "standard-blocks": 0.9 } };
  });
  setMockShotVisualHandler(async () => ({ choice: "Text", confidence: 0.9, probabilities: { Text: 0.9 } }));
  try {
    const { segments, shotDurations } = spine([6, 8, 7]);
    const result = await compileFilmFromScreenplayAsync(
      SCRIPT,
      segments,
      shotDurations,
      { title: "Probe Jev Film", maxFootageShots: 0 },
      { apiKey: "test-key" },
    );
    assert.equal(result.svgAssets.length, 1);
    assert.equal(result.svgAssets[0].shotId, "beat-01");
    assert.ok(result.svgAssets[0].visualDirection.includes("rat"));
    const firstShot = result.film.shots[0];
    assert.equal(firstShot.metaphor, "custom");
  } finally {
    clearMockSvgRouteHandler();
    clearMockShotVisualHandler();
  }
});

test("DesignJev: async compile uses model shot-visual choice for device blocks", async () => {
  setMockShotVisualHandler(async () => ({ choice: "Plot", confidence: 0.9, probabilities: { Plot: 0.9 } }));
  setMockSvgRouteHandler(async () => ({ choice: "standard-blocks", confidence: 0.9, probabilities: { "standard-blocks": 0.9 } }));
  try {
    const { segments, shotDurations } = spine([6, 8, 7]);
    const result = await compileFilmFromScreenplayAsync(
      SCRIPT,
      segments,
      shotDurations,
      { title: "Probe Jev Film", maxFootageShots: 0 },
      { apiKey: "test-key" },
    );
    const withPlot = result.film.shots.filter((s) => s.blocks.some((b) => b.c === "Plot"));
    assert.ok(withPlot.length > 0, "model Plot choice must author Plot blocks");
  } finally {
    clearMockShotVisualHandler();
    clearMockSvgRouteHandler();
  }
});

test("DesignJev: async compile keeps visual directions off screen copy", async () => {
  clearMockShotVisualHandler();
  clearMockSvgRouteHandler();
  const { segments, shotDurations } = spine([6, 8, 7]);
  const result = await compileFilmFromScreenplayAsync(
    SCRIPT,
    segments,
    shotDurations,
    { title: "Probe Jev Film", maxFootageShots: 0 },
    { apiKey: "" },
  );
  const rendered = result.film.shots.flatMap((s) =>
    s.blocks.flatMap((b) => ("text" in b && typeof b.text === "string" ? [b.text] : [])),
  );
  for (const text of rendered) {
    assert.ok(!text.toLowerCase().includes("rat exploring"), `direction leaked: ${text}`);
  }
});

test("DesignJev: async compile refuses a mismatched narration spine", async () => {
  const { segments, shotDurations } = spine([6, 8]);
  await assert.rejects(
    () => compileFilmFromScreenplayAsync(SCRIPT, segments, shotDurations, { title: "Probe" }, { apiKey: "" }),
    /narration beat/,
  );
});
