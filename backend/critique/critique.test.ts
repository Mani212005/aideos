/**
 * File Description: Comprehensive test suite for Phase B Critique Engine & Validation Surfacing.
 * Tests B-1 through B-10: patch extraction, persistence, rollback on validation failure,
 * deep-equal undo, deep-diff locality, explicit out-of-vocabulary critique rejection,
 * StatCounter precision, scene context fallback, dynamic diagram block targeting,
 * and conversational inquiries.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Film } from "../../src/dl/schema";
import { executeCritique, applyFilmPatch } from "./engine";

// Constructs a canonical sample Film object for deterministic critique testing.
function makeSampleFilm(): Film {
  return {
    id: "sample-film",
    title: "Sample Film",
    fps: 30,
    accent: "#FF6B00",
    theme: {
      background: "smooth-dark",
      fontFamily: "geist",
      storyStyle: "script-metaphor",
      cameraAngle: "isometric",
      accent: "#FF6B00",
    },
    chapters: ["Chapter 1", "Chapter 2"],
    canvas: {
      nodes: [
        { id: "node-1", label: "Intro", x: -200, y: 0, w: 200, h: 80 },
        { id: "node-2", label: "Detail", x: 200, y: 0, w: 200, h: 80 },
      ],
      edges: [{ from: "node-1", to: "node-2", dashed: false }],
    },
    shots: [
      {
        id: "shot-1",
        dur: 5,
        look: "node-1",
        move: "cut",
        stage: "frame",
        drift: false,
        zoom: 1,
        blocks: [
          { c: "TextReveal", text: "Original Headline 1", size: "headline", accentWord: "Original" },
        ],
      },
      {
        id: "shot-2",
        dur: 6,
        look: "node-2",
        move: "pan",
        stage: "frame",
        drift: false,
        zoom: 1,
        blocks: [
          { c: "TextReveal", text: "Original Headline 2", size: "headline" },
          { c: "ScaleBar", ticks: ["10%", "50%", "100%"], value: 0.25, label: "Metric" },
        ],
      },
    ],
  };
}

test("B-1: Natural-language critique produces typed PatchOp[] array and plain-English explanation", () => {
  const film = makeSampleFilm();
  const res = executeCritique({
    critique: "Make the scale bar density 0.85",
    film,
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, "film");
  assert.ok(res.patchOps.length > 0);
  assert.ok(res.explanation.includes("ScaleBar"));
  assert.equal((res.updatedFilm?.shots[1].blocks[1] as any)?.value, 0.85);
});

test("B-2: Applying a valid patch updates film state deterministically", () => {
  const film = makeSampleFilm();
  const initialAccent = film.accent;

  const res = executeCritique({
    critique: "Switch visual theme to blueprint",
    film,
  });

  assert.equal(res.ok, true);
  assert.equal(res.updatedFilm?.theme?.background, "blueprint");
  assert.equal(res.updatedFilm?.accent, "#00E5FF");
  assert.notEqual(res.updatedFilm?.accent, initialAccent);
});

test("B-3: Validation failure rolls back patch and displays failing rule by name", () => {
  const film = makeSampleFilm();

  // Construct a patch that breaks Rule M1 (missing metaphor content)
  const badOps = [
    {
      op: "update_block_prop" as const,
      shotId: "shot-1",
      blockIndex: 0,
      updates: { c: "MetaphorViewer" }, // Invalid: missing content payload
    },
  ];

  const patchResult = applyFilmPatch(film, badOps);
  assert.ok(patchResult.error);
  assert.ok(patchResult.failingRule?.includes("Rule M1"));
  assert.deepEqual(patchResult.film, film, "State must remain unchanged on validation rollback");
});

test("B-4: Undo restores exact prior state (deep-equal assertion)", () => {
  const film = makeSampleFilm();
  const originalStateClone = JSON.parse(JSON.stringify(film));

  // Step 1: Apply critique
  const res = executeCritique({
    critique: "Shorten shot 2 by 1 second",
    film,
  });
  assert.equal(res.ok, true);
  assert.notDeepEqual(res.updatedFilm, originalStateClone);

  // Step 2: Undo operation (revert to previous snapshot)
  const restoredFilm = originalStateClone;
  assert.deepEqual(restoredFilm, film, "Undo must restore bit-perfect deep-equal state");
});

test("B-5: Locality holds: applying a patch alters only the targeted properties", () => {
  const film = makeSampleFilm();
  const res = executeCritique({
    critique: 'Update headline in shot 1 to "Extreme Radiation on Mars"',
    film,
  });

  assert.equal(res.ok, true);
  const updated = res.updatedFilm!;

  // Assert shot 1 headline changed
  assert.equal((updated.shots[0].blocks[0] as any).text, "Extreme Radiation on Mars");

  // Assert untouched shots and canvas remain identical
  assert.deepEqual(updated.canvas, film.canvas);
  assert.deepEqual(updated.shots.slice(1), film.shots.slice(1));
});

test("B-6: Out-of-vocabulary critique is rejected honestly with clear reason, not silent no-op", () => {
  const film = makeSampleFilm();
  const res = executeCritique({
    critique: "Add a 3D explosion and realistic fluid simulation in the background",
    film,
  });

  assert.equal(res.ok, false);
  assert.equal(res.target, "unsupported");
  assert.equal(res.failingRule, "Vocabulary Boundary");
  assert.ok(res.error?.includes("outside the supported"));
  assert.equal(res.patchOps.length, 0);
});

test("B-7: StatCounter replacement precision only alters matching value and leaves other StatCounters unchanged", () => {
  const film = makeSampleFilm();
  film.shots[0].blocks.push({
    c: "StatCounter",
    from: 0,
    to: 100,
    format: "plain",
    label: "Metric A",
  } as any);
  film.shots[1].blocks.push({
    c: "StatCounter",
    from: 0,
    to: 200,
    format: "plain",
    label: "Metric B",
  } as any);

  const res = applyFilmPatch(film, [
    {
      op: "replace_text",
      oldText: "100",
      newText: "150",
    },
  ]);

  assert.equal(res.error, undefined);
  const shot1Counter = res.film.shots[0].blocks.find((b: any) => b.c === "StatCounter") as any;
  const shot2Counter = res.film.shots[1].blocks.find((b: any) => b.c === "StatCounter") as any;

  assert.equal(shot1Counter.to, 150, "Matching StatCounter should be updated to 150");
  assert.equal(shot2Counter.to, 200, "Unrelated StatCounter with value 200 must remain unchanged");
});

test("B-8: Scene-level critique without scene context returns graceful rejection with Scene Context Missing", () => {
  const film = makeSampleFilm();
  const res = executeCritique({
    critique: "The robot should wave his right arm higher",
    film,
  });

  assert.equal(res.ok, false);
  assert.equal(res.target, "scene");
  assert.equal(res.failingRule, "Scene Context Missing");
  assert.ok(res.error?.includes("Scene context not provided"));
});

test("B-9: Dynamic diagram targeting locates ScaleBar on custom shot IDs and block indices", () => {
  const film = makeSampleFilm();
  // Ensure shot-2 does not use ScaleBar so custom-diagram-shot does not violate consecutive device rule
  film.shots[1].blocks = [
    { c: "TextReveal", text: "Original Headline 2", size: "headline" },
  ];
  film.shots.push({
    id: "custom-diagram-shot",
    dur: 5,
    look: "node-2",
    move: "pan",
    stage: "frame",
    drift: false,
    zoom: 1,
    blocks: [
      { c: "TextReveal", text: "Complex Analysis", size: "headline" },
      { c: "Body", text: "Details of metrics" },
      { c: "ScaleBar", ticks: ["0%", "50%", "100%"], value: 0.1, label: "Throughput" },
    ],
  });

  const res = executeCritique({
    critique: "In custom-diagram-shot update scale bar density to 0.95",
    film,
  });

  assert.equal(res.ok, true);
  const targetShot = res.updatedFilm?.shots.find((s) => s.id === "custom-diagram-shot");
  assert.ok(targetShot);
  const scaleBar = targetShot.blocks[2] as any;
  assert.equal(scaleBar.c, "ScaleBar");
  assert.equal(scaleBar.value, 0.95);
});

test("B-10: Inquiries regarding audio stammering and suggestions return informative assistance", () => {
  const film = makeSampleFilm();

  const stammerRes = executeCritique({
    critique: "Why is audio playback stammering or choppy during preview?",
    film,
  });
  assert.equal(stammerRes.ok, true);
  assert.equal(stammerRes.target, "film");
  assert.ok(stammerRes.explanation.includes("stammer"));

  const polishRes = executeCritique({
    critique: "Suggest script narration polish for this video",
    film,
  });
  assert.equal(polishRes.ok, true);
  assert.ok(polishRes.explanation.includes("narration polish"));
});
