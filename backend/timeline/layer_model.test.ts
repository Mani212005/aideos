/**
 * File Description: Comprehensive Test Suite for Phase L-1 Layer and Clip Data Model.
 * Implements L1-1..L1-5 with 7 distinct negative rule assertions and migration fidelity tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../../src/dl/convertFilm";
import { flashAttentionFilm } from "../../src/dl/films/flash-attention";
import { transformersVsMambaFilm } from "../../src/dl/films/transformers-vs-mamba";
import { marsWaterFilm } from "../../src/dl/films/mars-water";
import { raftVsPaxosFilm } from "../../src/dl/films/raft-vs-paxos";
import { howBrowsersWorkFilm } from "../../src/dl/films/how-browsers-work";
import { buildTimeline, activeShotAt } from "../../src/dl/camera";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

function createValidLayeredFilm(): LayeredFilm {
  return {
    id: "test-layered-film",
    title: "Test Layered Film",
    fps: 30,
    accent: "#FF6B00",
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 190, h: 62 },
        { id: "n2", label: "Node 2", x: 200, y: 0, w: 190, h: 62 },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
    chapters: ["Introduction"],
    layers: [
      { id: "layer-audio", number: 0, label: "Audio", locked: false, hidden: false, muted: false, height: 48 },
      { id: "layer-video", number: 10, label: "Video Footage", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-anim", number: 20, label: "Animation", locked: false, hidden: false, muted: false, height: 72 },
    ],
    clips: [
      {
        id: "clip-vo",
        layerId: "layer-audio",
        position: 0,
        start: 0,
        end: 10.0,
        kind: "audio",
        payload: { src: "voiceover.wav", channel: "voiceover" },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-anim-1",
        layerId: "layer-anim",
        position: 0,
        start: 0,
        end: 5.0,
        kind: "animation",
        payload: {
          shotId: "shot-1",
          stage: "frame",
          look: "n1",
          move: "cut",
          drift: false,
          zoom: 1,
          blocks: [{ c: "StatCounter", from: 0, to: 90, label: "Speed", format: "plain" }],
        },
        volume: 1,
        opacity: 1,
      },
      {
        id: "clip-anim-2",
        layerId: "layer-anim",
        position: 5.0,
        start: 0,
        end: 5.0,
        kind: "animation",
        payload: {
          shotId: "shot-2",
          stage: "frame",
          look: "n2",
          move: "pan",
          drift: false,
          zoom: 1,
          blocks: [{ c: "StatCounter", from: 0, to: 99, label: "Efficiency", format: "plain" }],
        },
        volume: 1,
        opacity: 1,
      },
    ],
  };
}

// L1-1: A valid layered film passes all seven rules
test("L1-1: A valid layered film passes all seven rules without error", () => {
  const film = createValidLayeredFilm();
  assert.doesNotThrow(() => validateLayeredFilm(film));
});

// L1-2: Seven Negative Cases
test("L1-2 Negative 1: Rule 1 rejects clip referencing nonexistent layerId", () => {
  const film = createValidLayeredFilm();
  film.clips[0].layerId = "nonexistent-layer";
  assert.throws(() => validateLayeredFilm(film), /Rule 1 violation/);
});

test("L1-2 Negative 2: Rule 2 rejects duplicate layer.number", () => {
  const film = createValidLayeredFilm();
  film.layers[1].number = 0; // Collides with layer-audio (number: 0)
  assert.throws(() => validateLayeredFilm(film), /Rule 2 violation: duplicate layer.number/);
});

test("L1-2 Negative 3: Rule 3 rejects negative position or end <= start", () => {
  const film1 = createValidLayeredFilm();
  film1.clips[0].position = -2.5;
  assert.throws(() => validateLayeredFilm(film1), /position|Rule 3 violation/);

  const film2 = createValidLayeredFilm();
  film2.clips[0].start = 5.0;
  film2.clips[0].end = 4.0;
  assert.throws(() => validateLayeredFilm(film2), /Rule 3 violation/);
});

test("L1-2 Negative 4: Rule 4 rejects overlapping clips on the same layer", () => {
  const film = createValidLayeredFilm();
  // Set clip-anim-2 to start at 3.0s on layer-anim (overlapping clip-anim-1 which ends at 5.0s)
  film.clips[2].position = 3.0;
  assert.throws(() => validateLayeredFilm(film), /Rule 4 violation: clips .* overlap/);
});

test("L1-2 Negative 5: Rule 5 rejects nonexistent or asymmetric linkedClipId", () => {
  const film = createValidLayeredFilm();
  film.clips[0].linkedClipId = "clip-anim-1";
  // Asymmetric: clip-anim-1 does not link back to clip-vo
  assert.throws(() => validateLayeredFilm(film), /Rule 5 violation/);
});

test("L1-2 Negative 6: Rule 6 rejects invalid clip payload discriminator", () => {
  const film = createValidLayeredFilm() as any;
  film.clips[0].kind = "invalid-kind";
  assert.throws(() => validateLayeredFilm(film), /Invalid option|Invalid discriminator/);
});

test("L1-2 Negative 7: Rule 7 rejects opacity or volume outside [0, 1]", () => {
  const film1 = createValidLayeredFilm();
  film1.clips[0].opacity = 1.5;
  assert.throws(() => validateLayeredFilm(film1), /opacity|Rule 7 violation|Too big/);

  const film2 = createValidLayeredFilm();
  film2.clips[0].volume = -0.5;
  assert.throws(() => validateLayeredFilm(film2), /volume|Rule 7 violation|Too small/);
});

// L1-3: Round-trip JSON serialization
test("L1-3: Round-trip JSON.parse(JSON.stringify(film)) deep-equals original", () => {
  const film = createValidLayeredFilm();
  const serialized = JSON.parse(JSON.stringify(film));
  assert.deepEqual(serialized, film);
});

// L1-4: Migration Fidelity Gate
test("L1-4: Migration fidelity: Converting all 5 existing films to LayeredFilm and back preserves shot structure", () => {
  const prodFilms = [
    flashAttentionFilm,
    transformersVsMambaFilm,
    marsWaterFilm,
    raftVsPaxosFilm,
    howBrowsersWorkFilm,
  ];

  for (const origFilm of prodFilms) {
    const layered = convertFilmToLayeredFilm(origFilm);
    assert.doesNotThrow(() => validateLayeredFilm(layered));

    const roundTripFilm = convertLayeredFilmToFilm(layered);
    assert.equal(roundTripFilm.shots.length, origFilm.shots.length);
    assert.equal(roundTripFilm.id, origFilm.id);

    // Assert shot IDs and durations match exact
    for (let i = 0; i < origFilm.shots.length; i++) {
      assert.equal(roundTripFilm.shots[i].id, origFilm.shots[i].id);
      assert.equal(roundTripFilm.shots[i].dur, origFilm.shots[i].dur);
    }
  }
});

// L1-5: The Gap Bug Asserted at the Render Layer
test("L1-5: A clip at position: 4.0 with nothing before it produces null activeShotAt at frame 30 (t=1.0s)", () => {
  const film = createValidLayeredFilm();
  // Move clip-anim-1 to position: 4.0s (leaving 0.0s .. 4.0s gap)
  film.clips[1].position = 4.0;
  film.clips[2].position = 9.0;

  const reconFilm = convertLayeredFilmToFilm(film);
  const timeline = buildTimeline(reconFilm);

  // In the gap at frame 30 (1.0s): activeShotAt is null
  const activeInGap = activeShotAt(timeline, 30);
  assert.equal(activeInGap, null);

  // At frame 120 (4.0s): activeShotAt is shot-1
  const activeAtStart = activeShotAt(timeline, 120);
  assert.ok(activeAtStart);
  assert.equal(activeAtStart.shot.id, "shot-1");
  assert.equal(activeAtStart.from, 120);
});
