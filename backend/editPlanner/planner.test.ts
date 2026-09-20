/**
 * File Description: Unit tests for the AI Video Edit Planner (Phase 2).
 * Tests the LLM planner with injected stub callers, prompt formatting,
 * and the 3-attempt validate-then-repair loop.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { planEdits, buildPlannerPrompt } from "./planner";
import { buildEditContext } from "../editContext/buildEditContext";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

/**
 * Creates a standard LayeredFilm fixture for planner testing.
 */
function createPlannerFilmFixture(): LayeredFilm {
  return {
    id: "planner-test-film",
    title: "Planner Test Film",
    fps: 30,
    accent: "#635BFF",
    canvas: { nodes: [{ id: "n1", label: "Scene", x: 0, y: 0, w: 190, h: 62 }], edges: [] },
    chapters: [],
    layers: [
      { id: "layer-video", number: 15, label: "Video Footage", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-audio-footage", number: 5, label: "Footage Audio", locked: false, hidden: false, muted: false, height: 48 },
    ],
    clips: [
      {
        id: "clip-video-1",
        layerId: "layer-video",
        position: 0,
        start: 0,
        end: 15,
        kind: "video",
        payload: { src: "media/video.mp4" },
        opacity: 1,
        volume: 1,
      },
      {
        id: "clip-audio-1",
        layerId: "layer-audio-footage",
        position: 0,
        start: 0,
        end: 15,
        kind: "audio",
        payload: { src: "media/video.mp4" },
        opacity: 1,
        volume: 1,
      },
    ],
  };
}

test("planner: planEdits succeeds on first attempt with valid model output", async () => {
  const film = createPlannerFilmFixture();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 15 });

  const mockResponse = JSON.stringify({
    plan: "I will add a title card at the start and set the accent color to orange.",
    ops: [
      {
        op: "add_text_overlay",
        text: "Overview",
        startSec: 0,
        endSec: 3,
        size: "headline",
        position: "center",
      },
      {
        op: "set_accent",
        hex: "#FF6B00",
      },
    ],
  });

  const stubCaller = async (_prompt: string) => mockResponse;

  const result = await planEdits("Add a title card and make the accent orange", context, stubCaller);
  assert.equal(result.attempts, 1);
  assert.equal(result.plan, "I will add a title card at the start and set the accent color to orange.");
  assert.equal(result.ops.length, 2);
  assert.equal(result.ops[0].op, "add_text_overlay");
  assert.equal(result.ops[1].op, "set_accent");
});

test("planner: planEdits triggers repair loop when attempt 1 produces invalid schema, succeeding on attempt 2", async () => {
  const film = createPlannerFilmFixture();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 15 });

  let callCount = 0;
  const promptsReceived: string[] = [];

  const stubCaller = async (prompt: string) => {
    callCount++;
    promptsReceived.push(prompt);

    if (callCount === 1) {
      // First attempt: unknown op and invalid timestamps
      return JSON.stringify({
        plan: "Initial bad plan",
        ops: [
          {
            op: "invalid_op_kind",
            foo: "bar",
          },
        ],
      });
    }

    // Second attempt: corrected plan
    return JSON.stringify({
      plan: "Corrected plan with valid trim operation.",
      ops: [
        {
          op: "trim_range",
          fromSec: 2,
          toSec: 5,
        },
      ],
    });
  };

  const result = await planEdits("Trim the first few seconds", context, stubCaller);
  assert.equal(callCount, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.ops.length, 1);
  assert.equal(result.ops[0].op, "trim_range");
  assert.ok(promptsReceived[1].includes("PREVIOUS ATTEMPT REJECTED"));
  assert.ok(promptsReceived[1].includes("Schema violation"));
});

test("planner: planEdits throws after maxAttempts if output continues to fail", async () => {
  const film = createPlannerFilmFixture();
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 15 });

  const badResponse = JSON.stringify({
    plan: "Always bad",
    ops: [{ op: "unknown_forever" }],
  });

  const stubCaller = async (_prompt: string) => badResponse;

  await assert.rejects(
    async () => {
      await planEdits("Do something", context, stubCaller, { maxAttempts: 3 });
    },
    /failed after 3 attempts/i,
  );
});

test("planner: buildPlannerPrompt includes user request, transcript, fillers, silences, and agent hints", () => {
  const film = createPlannerFilmFixture();
  const transcript = [{ word: "Hello", start: 0, end: 1, confidence: 0.99 }];
  const fillers = [{ startIndex: 0, endIndex: 0, start: 0, end: 1, text: "Hello" }];
  const silences = [{ start: 2, end: 4 }];
  const context = buildEditContext(film, transcript, fillers, silences, { fps: 30, durationSec: 15 });

  const prompt = buildPlannerPrompt(
    "Clean up the speech and make it pop",
    context,
    "Agent hint: focus on opening 5 seconds",
  );

  assert.ok(prompt.includes("Clean up the speech and make it pop"));
  assert.ok(prompt.includes("Agent hint: focus on opening 5 seconds"));
  assert.ok(prompt.includes("[0.00s - 1.00s] Hello"));
  assert.ok(prompt.includes("2.00s-4.00s (2.00s)"));
  assert.ok(prompt.includes("#635BFF"));
});
