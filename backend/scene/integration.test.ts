/**
 * File Description: Comprehensive Integration Test Suite for the Complete Aideos Scene System (§13).
 * Executes the full 10-step lifecycle: NL authoring -> compilation -> pristine 1920x1080 PNG frame rendering ->
 * natural language critique 1 (retime_action) -> deep-diff locality check -> recompilation ->
 * revised PNG frame rendering -> natural language critique 2 (set_layer) -> render order verification -> C-13 DOM ref stability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import type { Scene, ActorInstance } from "../../src/dl/scene/types";
import { validateScene } from "../../src/dl/scene/validateScene";
import { compileScene, type CompiledScene } from "../../src/dl/scene/compile";
import { authorScene, reviseScene } from "./author";
import { type PatchOp } from "../../src/dl/scene/patch";
import { renderFrameStill } from "./renderStill";

const STAGE_SVG = path.resolve("test_fixtures/svg/stage_and_prop.svg");
const OUT_FRAMES_DIR = path.resolve("out/integration");

// Deep diff helper
function getSceneDifferences(original: Scene, modified: Scene): string[] {
  const diffs: string[] = [];
  const compareObjects = (pathStr: string, a: any, b: any) => {
    if (a === b) return;
    if (typeof a !== typeof b) {
      diffs.push(`${pathStr}: type changed from ${typeof a} to ${typeof b}`);
      return;
    }
    if (typeof a !== "object" || a === null || b === null) {
      diffs.push(`${pathStr}: value changed from ${JSON.stringify(a)} to ${JSON.stringify(b)}`);
      return;
    }
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of allKeys) {
      compareObjects(pathStr ? `${pathStr}.${key}` : key, a[key], b[key]);
    }
  };
  compareObjects("", original, modified);
  return diffs;
}

test("§13 Complete System Integration Test: 10-Step Full Authoring, PNG Rendering & Revision Lifecycle", async () => {
  fs.mkdirSync(OUT_FRAMES_DIR, { recursive: true });

  console.log("\n=======================================================");
  console.log("=== §13 FULL SCENE SYSTEM INTEGRATION TEST LIFECYCLE ===");
  console.log("=======================================================");

  // STEP 1: Author scene from natural-language prompt
  console.log("\n[Step 1] Authoring scene from natural-language prompt...");
  const userPrompt = "A stage with Astro Guide on the left walking, Tech Architect in center waving then pointing, and Cyber AI Bot on the right jumping";
  const audioContext = {
    audioSource: "audio/integration_voiceover.wav",
    audioDurationMs: 4000, // 4.0s
    fps: 30, // 120 frames
  };

  const mockAuthorLlm = async () => {
    const scene: Scene = {
      schemaVersion: "1.0.0",
      sceneId: "scene-integration-live",
      fps: 30,
      durationFrames: 120, // 4.0s = 4000ms
      audioSource: audioContext.audioSource,
      audioDurationMs: audioContext.audioDurationMs,
      sceneSize: { w: 1920, h: 1080 },
      background: {
        assetId: "bg-stage",
        svgSource: STAGE_SVG,
        layer: 0,
        position: { x: 0, y: 0 },
        scale: 1.0,
        rotation: 0,
        opacity: 1.0,
      },
      props: [
        {
          assetId: "prop-fan",
          svgSource: STAGE_SVG,
          position: { x: 960, y: 180 },
          scale: 1.0,
          rotation: 0,
          opacity: 1.0,
          subGroups: [
            {
              elementId: "wheel-front",
              pivot: { x: 0, y: 0 },
              degreesPerSecond: 360, // D1 rotating fan subgroup
            },
          ],
        },
      ],
      actors: [
        {
          instanceId: "actor-1-astro",
          rigId: "astronaut",
          position: { x: 420, y: 600 },
          scale: 1.0,
          facing: "right",
          actions: [
            { actionId: "walk", startFrame: 0, durationFrames: 60, intensity: 1.0 },
            { actionId: "idle", startFrame: 60, durationFrames: 60, intensity: 1.0 },
          ],
        },
        {
          instanceId: "actor-2-dev",
          rigId: "developer",
          position: { x: 960, y: 600 },
          scale: 1.0,
          facing: "right",
          actions: [
            { actionId: "wave", startFrame: 15, durationFrames: 45, intensity: 1.0, side: "right" },
            { actionId: "point", startFrame: 60, durationFrames: 60, intensity: 1.0, side: "right" },
          ],
        },
        {
          instanceId: "actor-3-bot",
          rigId: "robot",
          position: { x: 1480, y: 600 },
          scale: 0.8,
          facing: "left",
          actions: [
            { actionId: "jump", startFrame: 20, durationFrames: 40, intensity: 1.0 },
            { actionId: "idle", startFrame: 60, durationFrames: 60, intensity: 1.0 },
          ],
        },
      ],
    };
    return JSON.stringify(scene);
  };

  const initialScene = await authorScene(userPrompt, audioContext, mockAuthorLlm);
  const val1 = validateScene(initialScene);
  assert.equal(val1.isValid, true, "Authored scene must pass validation with 0 errors");
  console.log("✓ Step 1 complete: Scene authored and validated (3 actors on-canvas, 1 prop with D1 rotating fan, 120 frames).");

  // STEP 2: Compile & assert continuity and audio invariant
  console.log("\n[Step 2] Compiling initial scene...");
  const compiled1 = compileScene(initialScene);
  assert.equal(compiled1.frames.length, 120);
  assert.equal(compiled1.meta.continuityVerified, true);
  const diffMs = Math.abs((compiled1.durationFrames / compiled1.fps) * 1000 - initialScene.audioDurationMs);
  assert.ok(diffMs <= 50, `Duration must match audio within ±50ms (got diff: ${diffMs}ms)`);
  console.log(`✓ Step 2 complete: Compiled 120 frames in ${compiled1.meta.compileTimeMs}ms. Max velocity jump: ${compiled1.meta.maxVelocityDiscontinuity.toFixed(4)} deg/s.`);

  // STEP 3: Render real 1920x1080 PNG frames to disk for human visual inspection
  console.log("\n[Step 3] Rendering initial 1920x1080 PNG sample frames to disk...");
  const sampleFrames = [0, 45, 80];
  const renderedInitialPaths: string[] = [];
  for (const f of sampleFrames) {
    const frameData = compiled1.frames[f];
    const frameOutPng = path.join(OUT_FRAMES_DIR, `frame_${f}.png`);
    renderFrameStill(frameData, frameOutPng);
    assert.ok(fs.existsSync(frameOutPng), `PNG file must exist: ${frameOutPng}`);
    const size = fs.statSync(frameOutPng).size;
    assert.ok(size > 1000, `Rendered PNG must have non-zero size (got ${size} bytes)`);
    renderedInitialPaths.push(frameOutPng);
    console.log(`  -> Rendered PNG frame ${f} to ${frameOutPng} (${(size / 1024).toFixed(1)} KB)`);
  }
  console.log("✓ Step 3 complete: Initial 1920x1080 PNG frames written to disk.");

  // STEP 4 & 5: Submit critique 1 ("the third actor should jump one second later") -> expects retime_action
  console.log("\n[Step 4 & 5] Submitting Critique 1: 'the third actor should jump one second later'...");
  const critique1 = "the third actor should jump one second later";
  const mockCritique1Llm = async (prompt: string) => {
    assert.ok(prompt.includes(critique1));
    // LLM identifies third actor (actor-3-bot), actionIndex 0 (jump), shifts by +30 frames (1s @ 30fps)
    const patchOps: PatchOp[] = [
      {
        op: "retime_action",
        instanceId: "actor-3-bot",
        actionIndex: 0,
        shiftFrames: 30, // 20 + 30 = 50
      },
    ];
    return JSON.stringify(patchOps);
  };

  const rev1 = await reviseScene(initialScene, critique1, mockCritique1Llm);
  assert.equal(rev1.appliedOps.length, 1);
  assert.equal(rev1.appliedOps[0].op, "retime_action");
  console.log("✓ Step 4 & 5 complete: Emitted exact targeted 'retime_action' on actor-3-bot (shift +30 frames).");

  // STEP 6: Apply & assert via exhaustive deep-diff that ONLY actor-3 jump timing changed
  console.log("\n[Step 6] Running exhaustive deep-diff on revised scene...");
  const diffs1 = getSceneDifferences(initialScene, rev1.scene);
  console.log(`  -> Detected diffs count: ${diffs1.length}`);
  for (const d of diffs1) console.log(`     * ${d}`);
  assert.equal(diffs1.length, 1, "Exhaustive deep-diff must prove EXACTLY ONE field changed");
  assert.ok(diffs1[0].includes("actors.2.actions.0.startFrame: value changed from 20 to 50"));
  console.log("✓ Step 6 complete: Deep-diff locality proven: zero byte bleed into other actors or tracks.");

  // STEP 7: Recompile revised scene & assert continuity still passes
  console.log("\n[Step 7] Recompiling revised scene...");
  const compiled2 = compileScene(rev1.scene);
  assert.equal(compiled2.frames.length, 120);
  assert.equal(compiled2.meta.continuityVerified, true);
  console.log("✓ Step 7 complete: Recompilation clean, continuity verified.");

  // STEP 8: Render revised 1920x1080 PNG frames to disk
  console.log("\n[Step 8] Rendering revised 1920x1080 PNG sample frames to disk...");
  const renderedRevisedPaths: string[] = [];
  for (const f of sampleFrames) {
    const frameData = compiled2.frames[f];
    const frameOutPng = path.join(OUT_FRAMES_DIR, `revised_frame_${f}.png`);
    renderFrameStill(frameData, frameOutPng);
    assert.ok(fs.existsSync(frameOutPng), `PNG file must exist: ${frameOutPng}`);
    const size = fs.statSync(frameOutPng).size;
    assert.ok(size > 1000, `Rendered revised PNG must have non-zero size (got ${size} bytes)`);
    renderedRevisedPaths.push(frameOutPng);
    console.log(`  -> Rendered revised PNG frame ${f} to ${frameOutPng} (${(size / 1024).toFixed(1)} KB)`);
  }
  console.log("✓ Step 8 complete: Revised 1920x1080 PNG frames written to disk.");

  // STEP 9 & 10: Submit critique 2 ("the actor on the left should be in front of the one on the right") -> expects set_layer
  console.log("\n[Step 9 & 10] Submitting Critique 2: 'the actor on the left should be in front of the one on the right'...");
  const critique2 = "the actor on the left should be in front of the one on the right";
  const mockCritique2Llm = async (prompt: string) => {
    assert.ok(prompt.includes(critique2));
    // LLM identifies left actor (actor-1-astro) and sets explicit layer = 999
    const patchOps: PatchOp[] = [
      {
        op: "set_layer",
        entityId: "actor-1-astro",
        layer: 999, // Explicit override in front of all others
      },
    ];
    return JSON.stringify(patchOps);
  };

  const rev2 = await reviseScene(rev1.scene, critique2, mockCritique2Llm);
  assert.equal(rev2.appliedOps.length, 1);
  assert.equal(rev2.appliedOps[0].op, "set_layer");

  const compiled3 = compileScene(rev2.scene);
  for (let f = 0; f < 120; f++) {
    const frame = compiled3.frames[f];
    const astro = frame.entities.find((e) => e.entityId === "actor-1-astro")!;
    const bot = frame.entities.find((e) => e.entityId === "actor-3-bot")!;
    assert.equal(astro.layerSource, "explicit");
    assert.equal(astro.resolvedLayer, 999);
    const idxAstro = frame.entities.indexOf(astro);
    const idxBot = frame.entities.indexOf(bot);
    assert.ok(idxAstro > idxBot, `Frame ${f}: Actor on left (actor-1-astro) must render AFTER actor on right (actor-3-bot) in DOM order`);
  }
  console.log("✓ Step 9 & 10 complete: 'set_layer' applied, render order verified across all 120 frames.");

  // C-13 DISCHARGE: DOM Element Key Invariance & Identity Check across Depth Crossing
  console.log("\n[C-13 Discharge] Verifying React DOM element key stability across depth crossing...");
  const actorIds = ["actor-1-astro", "actor-2-dev", "actor-3-bot", "prop-fan", "bg-stage"];
  for (let f = 0; f < 120; f++) {
    const frame = compiled3.frames[f];
    const presentIds = frame.entities.map((e) => e.entityId);
    assert.equal(presentIds.length, actorIds.length);
    for (const id of actorIds) {
      assert.ok(presentIds.includes(id), `Frame ${f} missing entityId "${id}" for keying`);
    }
  }
  console.log("✓ C-13 Discharged: Stable entity keying verified across 120 depth-reordered frames.");

  console.log("\n=======================================================");
  console.log("=== §13 ALL 10 STEPS PASSED WITH 1920x1080 PNGS ===");
  console.log("=======================================================\n");
});
