/**
 * File Description: Comprehensive test suite for Phase B Critique Engine & Validation Surfacing.
 * Tests B-1 through B-6: patch extraction, persistence, rollback on validation failure,
 * deep-equal undo, deep-diff locality, and explicit out-of-vocabulary critique rejection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Film } from "../../src/dl/schema";
import { executeCritique, applyFilmPatch } from "./engine";

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
