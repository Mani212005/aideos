/**
 * File Description: Comprehensive test suite for Phase 5 LLM Scene Authoring & Revision (L-1 through L-6).
 * Verifies end-to-end authoring, 3-attempt validation retry loop, un-pretranslated natural-language
 * critique revision via PatchOp[], programmatic prompt registry synchronization (L-5), and D4 audio budget propagation (L-6).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import type { Scene } from "../../src/dl/scene/types";
import { validateScene } from "../../src/dl/scene/validateScene";
import { compileScene } from "../../src/dl/scene/compile";
import { buildSceneAuthoringPrompt, buildSceneRevisionPrompt } from "./prompt";
import { authorScene, reviseScene } from "./author";
import { getAllCharacterRigs } from "../../src/dl/characters";
import { MODEL_SHEETS } from "../../src/dl/scene/modelSheet";
import { ACTION_METADATA } from "../../src/dl/scene/actions";

const TEST_SVG = path.resolve("test_fixtures/svg/test_prop.svg");

function makeValidScene(): Scene {
  return {
    schemaVersion: "1.0.0",
    sceneId: "scene-author-test",
    fps: 30,
    durationFrames: 90, // 3.0s = 3000ms
    audioSource: "audio/segment-1.wav",
    audioDurationMs: 3000,
    sceneSize: { w: 1920, h: 1080 },
    background: {
      assetId: "bg-main",
      svgSource: TEST_SVG,
      layer: 0,
      position: { x: 0, y: 0 },
      scale: 1.0,
      rotation: 0,
      opacity: 1.0,
    },
    props: [],
    actors: [
      {
        instanceId: "actor-1",
        rigId: "developer",
        position: { x: 960, y: 540 },
        scale: 1.0,
        facing: "right",
        actions: [
          {
            actionId: "walk",
            startFrame: 0,
            durationFrames: 30,
            intensity: 1.0,
          },
          {
            actionId: "wave",
            startFrame: 30,
            durationFrames: 30,
            intensity: 1.0,
            side: "right",
          },
        ],
      },
    ],
  };
}

// L-1: An authored scene passes validateScene and compiles
test("L-1: An authored scene passes validateScene and compiles cleanly", async () => {
  const mockScene = makeValidScene();
  const mockLlm = async () => JSON.stringify(mockScene);

  const authored = await authorScene(
    "A developer walking then waving",
    { audioSource: "audio/seg1.wav", audioDurationMs: 3000, fps: 30 },
    mockLlm,
  );

  const validation = validateScene(authored);
  assert.equal(validation.isValid, true);
  assert.equal(validation.errors.length, 0);

  const compiled = compileScene(authored);
  assert.equal(compiled.frames.length, 90);
});

// L-2: A deliberately malformed LLM response is caught by validation and triggers a retry
test("L-2: Malformed response on attempt 1 triggers retry and succeeds on attempt 2", async () => {
  let callCount = 0;
  const validScene = makeValidScene();

  const mockLlm = async (prompt: string) => {
    callCount++;
    if (callCount === 1) {
      // Attempt 1: Return malformed scene violating Rule 13 (duration exceeded)
      const badScene = JSON.parse(JSON.stringify(validScene));
      badScene.actors[0].actions[0].durationFrames = 200; // Exceeds 90
      return JSON.stringify(badScene);
    }
    // Attempt 2: Return valid scene, asserting that the prompt included attempt 1 error feedback
    assert.ok(prompt.includes("PREVIOUS ATTEMPT FAILED WITH VALIDATION ERRORS"));
    assert.ok(prompt.includes("Rule 13"));
    return JSON.stringify(validScene);
  };

  const scene = await authorScene(
    "A developer walking",
    { audioSource: "audio/seg1.wav", audioDurationMs: 3000, fps: 30 },
    mockLlm,
  );

  assert.equal(callCount, 2, "Must have called LLM exactly twice (1 retry)");
  assert.equal(scene.sceneId, "scene-author-test");
});

// L-3: After 3 failed attempts, the function returns accumulated errors and no scene
test("L-3: After 3 failed attempts, authorScene throws and includes accumulated errors", async () => {
  let callCount = 0;
  const badScene = makeValidScene();
  badScene.actors[0].rigId = "non-existent-alien"; // Rule 6 violation

  const mockLlm = async () => {
    callCount++;
    return JSON.stringify(badScene);
  };

  await assert.rejects(
    async () => {
      await authorScene(
        "Alien scene",
        { audioSource: "audio/seg1.wav", audioDurationMs: 3000, fps: 30 },
        mockLlm,
      );
    },
    (err: Error) => {
      assert.ok(err.message.includes("SCENE_AUTHORING_FAILED"));
      assert.ok(err.message.includes("Failed to produce a valid Scene after 3 attempts"));
      assert.ok(err.message.includes("Rule 6"));
      return true;
    },
  );

  assert.equal(callCount, 3, "Must have retried up to MAX_AUTHOR_ATTEMPTS = 3");
});

// L-4: Three un-pretranslated natural language critiques
test("L-4.1: Natural Language Critique: 'the actor should wave a bit later' -> emits retime_action", async () => {
  const currentScene = makeValidScene();
  const mockLlm = async (prompt: string) => {
    assert.ok(prompt.includes("the actor should wave a bit later"));
    return JSON.stringify([
      { op: "retime_action", instanceId: "actor-1", actionIndex: 1, shiftFrames: 15 },
    ]);
  };

  const res = await reviseScene(currentScene, "the actor should wave a bit later", mockLlm);
  assert.equal(res.appliedOps.length, 1);
  assert.equal(res.appliedOps[0].op, "retime_action");
  assert.equal(res.scene.actors[0].actions![1].startFrame, 45); // 30 + 15 = 45
});

test("L-4.2: Natural Language Critique: 'he is too big' -> emits set_scale reduction", async () => {
  const currentScene = makeValidScene();
  const mockLlm = async (prompt: string) => {
    assert.ok(prompt.includes("he is too big"));
    return JSON.stringify([
      { op: "set_scale", entityId: "actor-1", scale: 0.8 },
    ]);
  };

  const res = await reviseScene(currentScene, "he is too big", mockLlm);
  assert.equal(res.appliedOps.length, 1);
  assert.equal(res.appliedOps[0].op, "set_scale");
  assert.equal(res.scene.actors[0].scale, 0.8);
});

test("L-4.3: Natural Language Critique: 'he should be facing the other way' -> emits set_facing", async () => {
  const currentScene = makeValidScene();
  const mockLlm = async (prompt: string) => {
    assert.ok(prompt.includes("he should be facing the other way"));
    return JSON.stringify([
      { op: "set_facing", instanceId: "actor-1", facing: "left" },
    ]);
  };

  const res = await reviseScene(currentScene, "he should be facing the other way", mockLlm);
  assert.equal(res.appliedOps.length, 1);
  assert.equal(res.appliedOps[0].op, "set_facing");
  assert.equal(res.scene.actors[0].facing, "left");
});

// L-5: Programmatic prompt verification: asserts all rigs, model sheets, and actions are in prompt
test("L-5: Programmatic Prompt Sync: prompt must include 100% of rigs, model sheets, and actions", () => {
  const ctx = { audioSource: "audio/seg1.wav", audioDurationMs: 4500, fps: 30 };
  const prompt = buildSceneAuthoringPrompt("Test prompt", ctx);

  // 1. Assert all 8 character rigs are present in prompt
  const rigs = getAllCharacterRigs();
  assert.ok(rigs.length >= 8);
  for (const rig of rigs) {
    assert.ok(
      prompt.includes(`**rigId**: "${rig.id}"`),
      `Authoring prompt is missing character rigId "${rig.id}"`,
    );
  }

  // 2. Assert all ModelSheets are present
  for (const [rigId, ms] of Object.entries(MODEL_SHEETS)) {
    assert.ok(
      prompt.includes(`Canonical Height: ${ms.canonicalHeight}px`),
      `Authoring prompt is missing ModelSheet canonicalHeight for "${rigId}"`,
    );
  }

  // 3. Assert all 8 Action IDs are present
  for (const actionId of Object.keys(ACTION_METADATA)) {
    assert.ok(
      prompt.includes(`**actionId**: "${actionId}"`),
      `Authoring prompt is missing actionId "${actionId}"`,
    );
  }
});

// L-6: Prompt states the exact audio duration and frame budget (D4)
test("L-6: Prompt states exact audio duration, frame rate, and frame budget (D4)", () => {
  const ctx = { audioSource: "audio/voice-intro.wav", audioDurationMs: 4000, fps: 30 };
  const prompt = buildSceneAuthoringPrompt("Intro scene", ctx);

  assert.ok(prompt.includes("4000 ms"), "Prompt must state audio duration in ms");
  assert.ok(prompt.includes("30 FPS"), "Prompt must state fps");
  assert.ok(prompt.includes("Exactly 120 frames"), "Prompt must state exact frame budget (4.0s * 30fps = 120 frames)");
});
