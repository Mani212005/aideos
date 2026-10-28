/**
 * File Description: Journey J9 through the real pipeline: a film made with the explicit template path (no character, no 3D stage, no look plan) still produces a valid, drawn mp4, so the character work cannot break the films that existed before it. Pixel-level regression for the same films lives in legacy.golden.ts.
 * Inputs and outputs: a three-beat screenplay with tone narration and design "templates" -> a rendered long mp4 whose size, frame count, audio and picture are checked.
 * Used by: npm run test:journeys (the CI journeys job).
 */

import assert from "node:assert/strict";
import { journey, decodeFrame, frameStats, probeVideo } from "./harness";
import { runProduction } from "../pipeline/run";
import { journeyRequest } from "./ionaFilm";

const SCRIPT = [
  "## 0:00 - Idea",
  "[NARRATION] A load balancer shares incoming requests across several servers so that no single machine is overwhelmed by traffic.",
  "[VISUAL] A row of servers",
  "## 0:10 - Check",
  "[NARRATION] Every few seconds it asks each server whether it is healthy, and it stops sending work to any server that stays silent.",
  "[VISUAL] A heartbeat line",
  "## 0:20 - Recover",
  "[NARRATION] When the silent server answers again, the balancer adds it back and traffic spreads out evenly once more across the pool.",
  "[VISUAL] The pool recovering",
].join("\n");

journey("J9 an existing template film still renders through the real pipeline", async () => {
  const result = await runProduction({
    ...journeyRequest("j9-template", { script: SCRIPT, title: "Load balancing", formats: ["long"], renderFrames: [30, 59], design: "templates" }),
  });
  assert.equal(result.status, "completed", JSON.stringify(result.warnings));
  assert.deepEqual(result.warnings, [
    '[soundtrack] Skipping default music for "j9-template" (long): suitable tracks are not verified in the audio cache. Film remains unscored.',
  ]);
  const out = result.outputs[0];
  const facts = probeVideo(out.path);
  assert.deepEqual([facts.width, facts.height, facts.frames], [1920, 1080, 30]);
  assert.ok(facts.hasAudio);
  const stats = frameStats(decodeFrame(out.path, { frame: 15, scaleWidth: 480 }));
  assert.ok(stats.stddev > 5, `template frame looks flat (stddev ${stats.stddev.toFixed(1)})`);
});
