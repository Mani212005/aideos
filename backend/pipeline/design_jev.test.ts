/**
 * File Description: Tests for the Jev-driven async design compile path.
 * Verifies schema-valid block authoring for every shot visual, standard blocks for concrete
 * visuals with no footage, footage precedence, narration locking, and deterministic heuristic fallback with no network.
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
  setMockShotVisualHandler,
  SHOT_VISUALS,
  type ShotVisual,
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
});

test("DesignJev: async compile renders a concrete no-footage visual with standard blocks", async () => {
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
    const firstShot = result.film.shots[0];
    assert.equal(firstShot.metaphor, undefined, "no half-wired custom SVG metaphor");
    assert.deepEqual(
      firstShot.blocks.map((b) => b.c),
      ["TextReveal"],
      "a rat visual with no footage must still render its on-screen copy",
    );
  } finally {
    clearMockShotVisualHandler();
  }
});

test("DesignJev: async compile uses model shot-visual choice for device blocks", async () => {
  setMockShotVisualHandler(async () => ({ choice: "Plot", confidence: 0.9, probabilities: { Plot: 0.9 } }));
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
  }
});

test("DesignJev: async compile keeps visual directions off screen copy", async () => {
  clearMockShotVisualHandler();
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

const FOOTAGE_SCRIPT = `## 0:00 - The Rat
[VISUAL] A grey cartoon rat sniffing a wedge of cheese
[NARRATION] Think of a language model like a curious rat.

## 0:05 - Scale
[VISUAL] A big counter climbs to 70 billion
[NARRATION] This one has seventy billion parameters.

## 0:10 - Tokens
[VISUAL] The sentence splits into token chips, one per token
[NARRATION] It reads text as a strip of tokens.
`;

test("DesignJev: async compile keeps footage beats around a StatCounter or Text beat schema-valid", async () => {
  const { segments, shotDurations } = spine([4, 4, 4]);
  const between: Array<() => void> = [
    () => clearMockShotVisualHandler(),
    () => setMockShotVisualHandler(async () => ({ choice: "StatCounter", confidence: 0.9, probabilities: { StatCounter: 0.9 } })),
    () => setMockShotVisualHandler(async () => ({ choice: "Text", confidence: 0.9, probabilities: { Text: 0.9 } })),
  ];
  try {
    for (const [i, arrange] of between.entries()) {
      arrange();
      const result = await compileFilmFromScreenplayAsync(
        FOOTAGE_SCRIPT,
        segments,
        shotDurations,
        { title: "Footage Probe", maxFootageShots: 2 },
        { apiKey: i === 0 ? "" : "test-key" },
      );
      const firsts = result.film.shots.map((s) => s.blocks[0]?.c);
      assert.equal(firsts[0], "AnalogyInset", `case ${i}: beat 1 must be footage`);
      assert.equal(firsts[2], "AnalogyInset", `case ${i}: beat 3 must be footage`);
    }
  } finally {
    clearMockShotVisualHandler();
  }
});

test("DesignJev: a device the narration does not carry falls back to the on-screen copy", () => {
  const cases: Array<[ShotVisual, string]> = [
    ["StatCounter", "It cuts latency by 40%."],
    ["TokenStrip", "The core principle is fault tolerance."],
    ["Plot", "The core principle is fault tolerance."],
    ["MatrixGrid", "The core principle is fault tolerance."],
    ["Distribution", "The core principle is fault tolerance."],
    ["LayerStack", "The core principle is fault tolerance."],
    ["ScaleBar", "The core principle is fault tolerance."],
  ];
  for (const [visual, narration] of cases) {
    assert.deepEqual(
      buildBlocksForShotVisual(visual, narration, ["Latency"]).map((b) => b.c),
      ["TextReveal"],
      `${visual} must not invent data for "${narration}"`,
    );
  }
});

test("DesignJev: a confident model StatCounter for an unreadable number never renders a counter", async () => {
  setMockShotVisualHandler(async () => ({ choice: "StatCounter", confidence: 0.95, probabilities: { StatCounter: 0.95 } }));
  try {
    const script = `## 0:00 - Speed (speed)

[ON SCREEN] Latency
[NARRATION] The new cache cuts latency by 40% on every request we measured.

[ON SCREEN] Why it holds
[NARRATION] The reason is simple once you see where the time used to go.
`;
    const { segments, shotDurations } = spine([6, 6]);
    const result = await compileFilmFromScreenplayAsync(script, segments, shotDurations, { title: "Latency", maxFootageShots: 0 }, { apiKey: "test-key" });
    const kinds = result.film.shots[0].blocks.map((b) => b.c);
    assert.ok(!kinds.includes("StatCounter"), `no fabricated counter, got ${kinds.join(", ")}`);
    assert.deepEqual(kinds, ["TextReveal"]);
    assert.equal(result.film.shots[0].stage, "frame");
  } finally {
    clearMockShotVisualHandler();
  }
});

test("DesignJev: a beat with no on-screen copy never carries a lone device", async () => {
  setMockShotVisualHandler(async () => ({ choice: "LayerStack", confidence: 0.95, probabilities: { LayerStack: 0.95 } }));
  try {
    const script = `## 0:00 - Depth (depth)

[ON SCREEN] Deep networks
[NARRATION] This is where the story of depth begins for us.

[NARRATION] Every one of those layers refines what the previous stack of layers produced.
`;
    const { segments, shotDurations } = spine([6, 8]);
    const result = await compileFilmFromScreenplayAsync(script, segments, shotDurations, { title: "Depth", maxFootageShots: 0 }, { apiKey: "test-key" });
    const bare = result.film.shots[1];
    assert.ok(!bare.blocks.some((b) => b.c === "LayerStack"), "a device needs a headline to sit under");
    assert.notEqual(bare.stage, "anchor");
    assert.deepEqual(buildBlocksForShotVisual("LayerStack", "Every one of those layers.", []), []);
  } finally {
    clearMockShotVisualHandler();
  }
});

test("DesignJev: Jev is only asked about beats that could take a device", async () => {
  const asked: string[] = [];
  setMockShotVisualHandler(async (state) => {
    asked.push(state.narration ?? "");
    return { choice: "Text", confidence: 0.9, probabilities: { Text: 0.9 } };
  });
  try {
    const script = `## 0:00 - Mixed (mixed)

[VISUAL] B-roll: a drop of water falling in near darkness.
[ON SCREEN] Water
[NARRATION] A single drop of water falls through the dark.

[ON SCREEN] Short beat
[NARRATION] Brief.

[NARRATION] No on-screen copy sits over this longer beat of narration at all.

[ON SCREEN] Eligible
[NARRATION] This beat has copy and a duration a device could hold.
`;
    const { segments, shotDurations } = spine([5, 2, 6, 6]);
    const result = await compileFilmFromScreenplayAsync(script, segments, shotDurations, { title: "Mixed", maxFootageShots: 1 }, { apiKey: "test-key" });
    assert.equal(result.film.shots[0].needsFootage, true, "precondition: beat 1 is footage");
    assert.deepEqual(asked, ["This beat has copy and a duration a device could hold."]);
    assert.deepEqual([...result.shotVisuals.keys()], ["beat-04"]);
  } finally {
    clearMockShotVisualHandler();
  }
});
