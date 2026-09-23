/**
 * File Description: Tests for the studio's per-shot design actions: the design overview (motion
 * placed in the shot it starts in), swapping a shot's visual through the honest authoring path,
 * and the shot-focused redesign prompt sent to the agent.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseFilm, type Film } from "../../src/dl/schema";
import { buildDirectingPrompt } from "../agentBridge/contextBuilder";
import { designOverview, swapShotVisual } from "./shotTools";

const DESIGNED = parseFilm(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../videos/speculative-decoding-designed/film.json"), "utf8")));

// A two-shot film with on-screen copy, for swaps.
function film(narration: string): Film {
  return parseFilm({
    ...DESIGNED,
    id: "swap-probe",
    scene: undefined,
    design: undefined,
    shots: [
      { ...DESIGNED.shots[0], id: "beat-01", scriptText: narration, stage: "frame", blocks: [{ c: "TextReveal", text: "The stack" }] },
      { ...DESIGNED.shots[1], id: "beat-02", stage: "none", blocks: [] },
    ],
  });
}

test("ShotTools: the overview places every clip in the shot it starts in, in time order", () => {
  const overview = designOverview(DESIGNED);
  assert.equal(overview.design?.source, "hand-built");
  assert.equal(overview.artwork.length, DESIGNED.scene!.props.length);
  const clips = DESIGNED.scene!.props.reduce((n, p) => n + (p.animation?.clips.length ?? 0), 0);
  assert.equal(overview.shots.reduce((n, s) => n + s.motion.length, 0), clips);
  for (const shot of overview.shots) {
    for (const m of shot.motion) assert.ok(m.startSec >= shot.startSec - 1e-6 && m.startSec < shot.endSec, `${m.clip} outside ${shot.id}`);
    assert.deepEqual(shot.motion.map((m) => m.startSec), [...shot.motion.map((m) => m.startSec)].sort((a, b) => a - b));
  }
});

test("ShotTools: a swap draws authored data, and refuses with the reason when it cannot", async () => {
  const f = film("At the bottom of the stack sits the hardware, then the kernels, then the model.");
  const ok = await swapShotVisual(f, "beat-01", "LayerStack", async () =>
    JSON.stringify({ "beat-01": { LayerStack: { layers: ["Hardware", "Kernels", "Model"] } } }),
  );
  assert.equal(ok.ok, true, ok.reason ?? "");
  assert.equal(ok.stage, "anchor");
  assert.deepEqual(ok.blocks.map((b) => b.c), ["TextReveal", "LayerStack"]);

  const invented = await swapShotVisual(f, "beat-01", "LayerStack", async () =>
    JSON.stringify({ "beat-01": { LayerStack: { layers: ["Hardware", "Runtime", "Model"] } } }),
  );
  assert.equal(invented.ok, false);
  assert.match(invented.reason ?? "", /runtime/);
  assert.deepEqual(invented.blocks, f.shots[0].blocks, "a refused swap leaves the shot as it was");

  assert.match((await swapShotVisual(f, "beat-01", "Plot", null)).reason ?? "", /never describes/);
  assert.match((await swapShotVisual(f, "beat-01", "LayerStack", null)).reason ?? "", /no chart data model/);
  assert.match((await swapShotVisual(f, "beat-02", "Text", null)).reason ?? "", /no on-screen copy/);
  const text = await swapShotVisual(f, "beat-01", "Text", null);
  assert.equal(text.ok, true);
  assert.equal(text.stage, "frame");
});

test("ShotTools: a shot redesign prompt names the shot and keeps the rest of the design", () => {
  const prompt = buildDirectingPrompt({
    eventType: "design_film",
    filmId: "speculative-decoding-designed",
    filmTitle: "Speculative decoding",
    customInstruction: "make the road feel longer",
    metadata: { shotId: "beat-04", says: "To produce a single token..." },
  });
  assert.match(prompt, /Redesign shot beat-04/);
  assert.match(prompt, /make the road feel longer/);
  assert.match(prompt, /Keep every other shot as it is/);
  assert.match(prompt, /aideos design build speculative-decoding-designed/);
});
