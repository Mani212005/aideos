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
          blocks: [{ c: "StatCounter", to: 90, label: "Speed", format: "plain" }],
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
          blocks: [{ c: "StatCounter", to: 99, label: "Efficiency", format: "plain" }],
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

// ==============================================================================
// REGRESSION: LOSSLESS FILM <-> LAYEREDFILM ROUND TRIPS
// The layer model cannot represent every Film field, so the reverse conversion takes the
// originating Film as a base and carries the rest through untouched.
// ==============================================================================

test("Regression: round tripping preserves voiceover metadata the layer model cannot hold", () => {
  const original = flashAttentionFilm;
  const film = {
    ...original,
    voiceover: {
      src: "voiceover.wav",
      volume: 1,
      speed: 1.25,
      version: "1788945136237",
      durationSec: 166.357,
    },
    captions: "WEBVTT\n\n00:00.000 --> 00:02.000\nhello",
  };

  const layered = convertFilmToLayeredFilm(film);
  const back = convertLayeredFilmToFilm(layered, film);

  assert.equal(back.voiceover?.src, "voiceover.wav");
  assert.equal(back.voiceover?.durationSec, 166.357, "voiceover duration must survive a round trip");
  assert.equal(back.voiceover?.speed, 1.25);
  assert.equal(back.voiceover?.version, "1788945136237");
  assert.equal(back.captions, film.captions, "captions must survive a round trip");
});

test("Regression: round tripping preserves per-shot fields outside the animation payload", () => {
  const original = flashAttentionFilm;
  const film = {
    ...original,
    shots: original.shots.map((s, i) =>
      i === 0 ? { ...s, transition: "whip-pan" as const, needsFootage: true, speed: 1.5 } : s,
    ),
  };

  const back = convertLayeredFilmToFilm(convertFilmToLayeredFilm(film), film);
  const shot = back.shots.find((s) => s.id === film.shots[0].id)!;

  assert.equal(shot.transition, "whip-pan");
  assert.equal(shot.needsFootage, true);
  assert.equal(shot.speed, 1.5);
});

test("Regression: imported footage audio survives the trip back to a Film", () => {
  const original = flashAttentionFilm;
  const layered = convertFilmToLayeredFilm(original);
  const withFootageAudio = {
    ...layered,
    layers: [
      ...layered.layers,
      { id: "layer-audio-footage", number: 5, label: "Footage Audio", locked: false, hidden: false, muted: false, height: 44 },
    ],
    clips: [
      ...layered.clips,
      {
        id: "clip-audio-interview",
        layerId: "layer-audio-footage",
        position: 12,
        start: 1,
        end: 6,
        kind: "audio" as const,
        payload: { src: "media/interview.mp4", channel: "external" as const },
        opacity: 1,
        volume: 0.8,
      },
    ],
  };

  const back = convertLayeredFilmToFilm(withFootageAudio, original);
  const external = back.audioClips?.find((c) => c.id === "clip-audio-interview");
  assert.ok(external, "external footage audio must be written out to audioClips");
  assert.equal(external!.channel, "external");
  assert.equal(external!.position, 12);
  assert.equal(external!.start, 1);
  assert.equal(external!.end, 6);

  // And it comes back as a clip on the next forward conversion rather than being dropped.
  const again = convertFilmToLayeredFilm(back);
  assert.ok(again.clips.some((c) => c.id === "clip-audio-interview"));
});

test("Regression: an edited music clip keeps its timing across a round trip", () => {
  const original = { ...flashAttentionFilm, music: { src: "bgm.mp3", volume: 0.5, duckUnderVoiceover: true } };
  const layered = convertFilmToLayeredFilm(original);

  const moved = {
    ...layered,
    clips: layered.clips.map((c) => (c.id === "clip-music-main" ? { ...c, position: 8, end: 20 } : c)),
  };

  const back = convertLayeredFilmToFilm(moved, original);
  const musicClip = back.audioClips?.find((c) => c.channel === "music");
  assert.ok(musicClip, "a music clip that was moved can no longer be described by film.music alone");
  assert.equal(musicClip!.position, 8);
  assert.equal(musicClip!.end, 20);

  // A second forward pass reads audioClips as the authority and does not duplicate the track.
  const again = convertFilmToLayeredFilm(back);
  assert.equal(again.clips.filter((c) => (c.payload as { channel?: string }).channel === "music").length, 1);
});

test("Regression: an untouched film still round trips without gaining an audioClips list", () => {
  const original = { ...flashAttentionFilm, music: { src: "bgm.mp3", volume: 0.5, duckUnderVoiceover: true } };
  const back = convertLayeredFilmToFilm(convertFilmToLayeredFilm(original), original);
  assert.equal(back.audioClips, undefined, "nothing was edited, so the summary fields still suffice");
  assert.equal(back.music?.src, "bgm.mp3");
});

test("Regression: user-created lanes and per-clip lane assignments survive a round trip", () => {
  const original = flashAttentionFilm;
  const layered = convertFilmToLayeredFilm(original);

  const withCustomLane = {
    ...layered,
    layers: [
      ...layered.layers,
      { id: "layer-overlay", number: 30, label: "Overlay", locked: false, hidden: true, muted: false, height: 60 },
    ],
    clips: layered.clips.map((c) =>
      c.id === `clip-anim-${original.shots[0].id}` ? { ...c, layerId: "layer-overlay" } : c,
    ),
  };

  const back = convertLayeredFilmToFilm(withCustomLane, original);
  assert.ok(back.layers, "a film with a custom lane must persist its layers block");
  assert.ok(back.layers!.some((l) => l.id === "layer-overlay" && l.hidden === true));
  assert.equal(back.shots.find((s) => s.id === original.shots[0].id)!.layerId, "layer-overlay");

  // Reopening the saved film puts the clip back on the lane it was dragged to.
  const reopened = convertFilmToLayeredFilm(back);
  assert.ok(reopened.layers.some((l) => l.id === "layer-overlay"));
  assert.equal(
    reopened.clips.find((c) => c.id === `clip-anim-${original.shots[0].id}`)!.layerId,
    "layer-overlay",
  );
});

test("Regression: an untouched film does not gain a layers block", () => {
  const original = flashAttentionFilm;
  const back = convertLayeredFilmToFilm(convertFilmToLayeredFilm(original), original);
  assert.equal(back.layers, undefined);
});
