/**
 * File Description: Tests for the studio's design tools: the design overview (motion placed in the
 * shot it starts in, look plan and cast), captain approval of the look plan, and the shot-focused
 * redesign prompt the agent bridge builds.
 * Inputs and outputs: shot tool operations and context -> test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { parseFilm } from "../../src/dl/schema";
import { buildDirectingPrompt } from "../agentBridge/contextBuilder";
import { approveLookPlan, designOverview } from "./shotTools";

const DESIGNED = parseFilm(JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed/film.json"), "utf8")));

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

test("ShotTools: the overview reads LOOK.md and exposes cast and per-shot treatments", () => {
  const overview = designOverview(DESIGNED);
  assert.ok(overview.look);
  assert.match(overview.look.markdown ?? "", /^# Look Plan: Speculative Decoding/m);
  assert.equal(overview.look.plan.film.cast[0].id, "memory");
  assert.equal(overview.look.plan.shots.find((shot) => shot.id === "beat-19")?.treatment, "device");
  assert.equal(overview.lookError, null);
});

test("ShotTools: captain approval is persisted to look.json", () => {
  const planFile = path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed/design/look.json");
  const original = fs.readFileSync(planFile, "utf8");
  try {
    const approved = approveLookPlan("speculative-decoding-designed");
    const saved = JSON.parse(fs.readFileSync(planFile, "utf8"));
    assert.equal(approved.approval?.captain, "Captain");
    assert.equal(saved.approval.captain, "Captain");
  } finally {
    fs.writeFileSync(planFile, original, "utf8");
  }
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
  assert.match(prompt, /Look plan for this shot: treatment is/);
  assert.match(prompt, /carried cast:/);
  assert.match(prompt, /treatment may change only by editing videos\/speculative-decoding-designed\/design\/look\.json/);
  assert.match(prompt, /aideos design build speculative-decoding-designed/);
});
