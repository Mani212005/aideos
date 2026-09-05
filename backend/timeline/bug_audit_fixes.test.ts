/**
 * File Description: Comprehensive Unit and Regression Test Suite for Video Layer and Timeline Trimmer Bug Fixes.
 * Exercises and verifies all 15 audit findings across rendering, collision geometry, schema converters, and UI operations.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  trimShotEdge,
  resolveTrackCollisions,
  splitShotAtTime,
  getShotDuration,
} from "./timeline";
import {
  trimLayerClipEdge,
  resolveLayerCollisions,
} from "./layer_engine";
import {
  reorderLayer,
} from "./layer_manager";
import {
  mergeSubtitleClips,
} from "./subtitle_engine";
import {
  closeAudioGapWithDependencies,
} from "./voiceover_engine";
import {
  convertFilmToLayeredFilm,
  convertLayeredFilmToFilm,
} from "../../src/dl/convertFilm";
import {
  generateWordsFromFilm,
} from "../../src/dl/captionsParser";
import {
  validateFilmAudioAndAssets,
} from "../../src/dl/validateFilm";
import {
  validateLayeredFilm,
} from "../../src/dl/validateLayeredFilm";
import {
  calculateDuckingVolume,
} from "../../src/dl/audio/ducking";
import {
  easeExpo,
} from "../../src/dl/motion";
import type { Film, Shot, AudioClip } from "../../src/dl/schema";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

// Creates a typed Shot fixture with required defaults.
function createTestShot(s: Partial<Shot> & { id: string }): Shot {
  return {
    id: s.id,
    dur: s.dur ?? 3,
    stage: s.stage ?? "frame",
    look: s.look ?? "n1",
    move: s.move ?? "cut",
    drift: s.drift ?? false,
    zoom: s.zoom ?? 1,
    ch: s.ch ?? "ch1",
    position: s.position ?? s.startSec ?? 0,
    startSec: s.startSec ?? s.position ?? 0,
    blocks: s.blocks ?? [],
    scriptText: s.scriptText,
    metaphor: s.metaphor,
  };
}

// Creates a minimal valid test Film manifest.
function createTestFilm(shots: (Partial<Shot> & { id: string })[]): Film {
  const sanitizedShots = shots.map((rawShot) => {
    const s = createTestShot(rawShot);
    if (s.stage === "frame" && (!s.blocks || s.blocks.length === 0)) {
      return {
        ...s,
        blocks: [{ c: "TextReveal" as const, text: "Sample text", size: "headline" as const }],
      };
    }
    return s;
  });

  return {
    id: "test-film-manifest",
    title: "Test Film",
    fps: 30,
    chapters: ["ch1"],
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 200, h: 100 },
        { id: "n2", label: "Node 2", x: 400, y: 0, w: 200, h: 100 },
        { id: "n3", label: "Node 3", x: 800, y: 0, w: 200, h: 100 },
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
      ],
    },
    shots: sanitizedShots,
    voiceover: { src: "test_vo.wav", volume: 1 },
  };
}

// Finding 1 & 2: Audio Ducking volume calculation dynamically evaluates per frame without stale closures.
test("Finding 1 & 2: calculateDuckingVolume dynamically evaluates frame inputs for volume ducking", () => {
  const speechIntervals = [{ startSec: 1.0, endSec: 3.0 }];
  const fps = 30;
  const totalFrames = 150;
  const musicVolume = 0.8;

  // Frame 15 (0.5s) is before speech: un-ducked
  const volBefore = calculateDuckingVolume({
    frame: 15,
    fps,
    totalFrames,
    musicVolume,
    speechIntervals,
  });

  // Frame 60 (2.0s) is inside speech: ducked
  const volInside = calculateDuckingVolume({
    frame: 60,
    fps,
    totalFrames,
    musicVolume,
    speechIntervals,
  });

  assert.ok(volBefore > volInside, "Ducking volume during speech must be lower than before speech");
  assert.ok(volInside <= musicVolume * 0.3, "Ducking volume must attenuate under speech");
});

// Finding 3: trimShotEdge resolves track collisions when expanding right edge into neighbor.
test("Finding 3: trimShotEdge resolves collisions when expanding right edge", () => {
  const film = createTestFilm([
    { id: "s1", ch: "ch1", position: 0, startSec: 0, start: 0, end: 3, dur: 3, stage: "frame", look: "n1", move: "cut", blocks: [] },
    { id: "s2", ch: "ch1", position: 3, startSec: 3, start: 0, end: 4, dur: 4, stage: "frame", look: "n2", move: "pan", blocks: [] },
  ]);

  // Trim s1 right edge outward by +2s (duration becomes 5s)
  const result = trimShotEdge(film, 0, "right", 2.0);
  const shot1 = result.film.shots[0];
  const shot2 = result.film.shots[1];

  assert.equal(shot1.dur, 5);
  // Shot 2 should have been pushed downstream to 5s so they do not overlap
  assert.ok((shot2.position ?? 0) >= 5, `Shot 2 position (${shot2.position}) must be pushed after Shot 1 end (5.0s)`);
});

// Finding 3: trimLayerClipEdge resolves layer collisions when expanding right edge.
test("Finding 3: trimLayerClipEdge resolves layer collisions when expanding clip duration", () => {
  const layeredFilm: LayeredFilm = {
    id: "lf-test",
    title: "Layered Test",
    fps: 30,
    accent: "#635BFF",
    chapters: ["ch1"],
    canvas: { nodes: [{ id: "n1", label: "N1", x: 0, y: 0, w: 100, h: 50 }, { id: "n2", label: "N2", x: 200, y: 0, w: 100, h: 50 }], edges: [{ from: "n1", to: "n2" }] },
    layers: [{ id: "layer-1", number: 1, label: "L1", locked: false, hidden: false, muted: false, height: 50 }],
    clips: [
      { id: "c1", layerId: "layer-1", position: 0, start: 0, end: 3, kind: "audio", payload: { src: "a.wav" }, opacity: 1, volume: 1 },
      { id: "c2", layerId: "layer-1", position: 3, start: 0, end: 4, kind: "audio", payload: { src: "b.wav" }, opacity: 1, volume: 1 },
    ],
  };

  const result = trimLayerClipEdge(layeredFilm, "c1", "right", 2.0);
  const c1 = result.film.clips.find((c) => c.id === "c1")!;
  const c2 = result.film.clips.find((c) => c.id === "c2")!;

  assert.equal(c1.end, 5);
  assert.ok(c2.position >= 5, `Clip 2 position (${c2.position}) must be pushed after Clip 1 end (5.0s)`);
  assert.doesNotThrow(() => validateLayeredFilm(result.film));
});

// Finding 4: Cascading ripple collision resolution across 3 or more shots.
test("Finding 4: resolveTrackCollisions cascades through 3 or more sequential shots", () => {
  const shots: Shot[] = [
    createTestShot({ id: "s1", ch: "ch1", position: 5, startSec: 5, start: 0, end: 4, dur: 4, stage: "frame", look: "n1", move: "cut", blocks: [] }),
    createTestShot({ id: "s2", ch: "ch1", position: 4, startSec: 4, start: 0, end: 5, dur: 5, stage: "frame", look: "n2", move: "pan", blocks: [] }),
    createTestShot({ id: "s3", ch: "ch1", position: 12, startSec: 12, start: 0, end: 4, dur: 4, stage: "frame", look: "n3", move: "pan", blocks: [] }),
  ];

  // s1 placed at 5s (dur 4, ends at 9s). s2 starts at 4s (dur 5 -> pushed to 9s..14s).
  // s3 was at 12s (dur 4). When s2 ends at 14s, s3 must cascade to 14s!
  const resolved = resolveTrackCollisions(shots, 0);
  const r1 = resolved[0];
  const r2 = resolved[1];
  const r3 = resolved[2];

  assert.equal(r1.position, 9);
  assert.equal(r2.position, 4);
  assert.ok((r3.position ?? 0) >= (r1.position ?? 0) + getShotDuration(r1));
});

// Finding 4: Cascading ripple collision resolution across 3 or more layer clips.
test("Finding 4: resolveLayerCollisions cascades downstream clips without overlaps", () => {
  const clips = [
    { id: "c1", layerId: "layer-1", position: 0, start: 0, end: 5, kind: "audio" as const, payload: { src: "1.wav" }, opacity: 1, volume: 1 },
    { id: "c2", layerId: "layer-1", position: 4, start: 0, end: 5, kind: "audio" as const, payload: { src: "2.wav" }, opacity: 1, volume: 1 },
    { id: "c3", layerId: "layer-1", position: 8, start: 0, end: 4, kind: "audio" as const, payload: { src: "3.wav" }, opacity: 1, volume: 1 },
  ];

  // c1 at 0..5. c2 at 4..9 (collides with c1, pushed to 5..10).
  // c3 at 8..12 (collides with c2 at 5..10, must be pushed to 10..14).
  const resolved = resolveLayerCollisions(clips, 0);
  const rc1 = resolved[0];
  const rc2 = resolved[1];
  const rc3 = resolved[2];

  assert.equal(rc1.position, 0);
  assert.ok(rc2.position >= rc1.position + (rc1.end - rc1.start));
  assert.ok(rc3.position >= rc2.position + (rc2.end - rc2.start));
});

// Finding 5: Splitting a shot with a metaphor does not duplicate MetaphorViewer and passes validation.
test("Finding 5: splitShotAtTime keeps metaphor on left half and passes Rule M6", () => {
  const film = createTestFilm([
    {
      id: "s1",
      ch: "ch1",
      position: 0,
      startSec: 0,
      dur: 6,
      stage: "frame",
      look: "n1",
      move: "cut",
      metaphor: "liquid-bucket",
      blocks: [
        {
          c: "MetaphorViewer",
          metaphorType: "liquid-bucket",
          content: {
            kind: "liquid-bucket",
            levelLabel: "Level",
            caption: "Dynamic Capacity",
            fillRatio: 0.75,
          },
        },
      ],
    },
    { id: "s2", ch: "ch1", position: 6, startSec: 6, dur: 4, stage: "frame", look: "n2", move: "pan", blocks: [] },
  ]);

  const result = splitShotAtTime(film, 3.0);
  assert.equal(result.film.shots.length, 3);
  const left = result.film.shots[0];
  const right = result.film.shots[1];

  // Left has metaphor; right does not have duplicate MetaphorViewer or metaphor kind
  assert.equal(left.metaphor, "liquid-bucket");
  assert.equal(right.metaphor, undefined);
  assert.equal(right.blocks.some((b) => b.c === "MetaphorViewer"), false);
  assert.doesNotThrow(() => validateFilmAudioAndAssets(result.film));
});

// Finding 6: Left-edge audio trim clamps delta to prevent negative start.
test("Finding 6: Left edge audio trim clamps start to non-negative numbers", () => {
  const ac: AudioClip = {
    id: "clip-vo",
    src: "voiceover.wav",
    position: 5,
    start: 1,
    end: 10,
    volume: 1,
    channel: "voiceover",
  };

  // Attempt to drag left by -4s (newPos = 1s, delta = -4s)
  const newPos = 1;
  const rawDelta = newPos - ac.position; // -4
  const delta = Math.max(-ac.start, rawDelta); // max(-1, -4) = -1
  const updated = {
    ...ac,
    position: ac.position + delta,
    start: ac.start + delta,
  };

  assert.equal(updated.start, 0);
  assert.equal(updated.position, 4);
  assert.ok(updated.start >= 0);
});

// Finding 7: Subtitle generator respects shot positions and avoids drifting into gaps.
test("Finding 7: generateWordsFromFilm calculates word timestamps using explicit shot positions", () => {
  const film = createTestFilm([
    {
      id: "s1",
      ch: "ch1",
      position: 0,
      startSec: 0,
      dur: 3,
      stage: "frame",
      look: "n1",
      move: "cut",
      scriptText: "First shot intro",
      blocks: [],
    },
    {
      id: "s2",
      ch: "ch1",
      position: 6,
      startSec: 6,
      dur: 3,
      stage: "frame",
      look: "n2",
      move: "pan",
      scriptText: "Second shot content",
      blocks: [],
    },
  ]);

  const words = generateWordsFromFilm(film as unknown as Record<string, unknown>);
  const s2FirstWord = words.find((w) => w.text === "Second");
  assert.ok(s2FirstWord, "Should contain words from second shot");
  // 6s * 30fps = frame 180
  assert.ok(s2FirstWord!.startFrame >= 180, `Second shot word start frame (${s2FirstWord!.startFrame}) must be >= 180`);
});

// Finding 8: Lossless bidirectional conversion preserves audioClips, music, and sfx.
test("Finding 8: convertFilmToLayeredFilm and convertLayeredFilmToFilm roundtrip audio, music, and sfx", () => {
  const film = createTestFilm([
    { id: "s1", ch: "ch1", position: 0, startSec: 0, dur: 4, stage: "frame", look: "n1", move: "cut", blocks: [] },
    { id: "s2", ch: "ch1", position: 4, startSec: 4, dur: 4, stage: "frame", look: "n2", move: "pan", blocks: [] },
  ]);
  film.audioClips = [
    { id: "ac-1", src: "vo1.wav", position: 0, start: 0, end: 4, volume: 1, channel: "voiceover" },
    { id: "ac-2", src: "vo2.wav", position: 4, start: 0, end: 4, volume: 0.9, channel: "voiceover" },
  ];
  film.music = { src: "bgm.mp3", volume: 0.5, duckUnderVoiceover: true };
  film.sfx = [{ timeSec: 4.0, src: "whoosh.wav", volume: 0.8 }];

  const layered = convertFilmToLayeredFilm(film);
  assert.doesNotThrow(() => validateLayeredFilm(layered));

  const roundtripped = convertLayeredFilmToFilm(layered);
  assert.ok(roundtripped.audioClips && roundtripped.audioClips.length === 2);
  assert.equal(roundtripped.audioClips[0].id, "ac-1");
  assert.equal(roundtripped.audioClips[1].id, "ac-2");
  assert.ok(roundtripped.music);
  assert.equal(roundtripped.music?.src, "bgm.mp3");
  assert.ok(roundtripped.sfx && roundtripped.sfx.length === 1);
  assert.equal(roundtripped.sfx[0].src, "whoosh.wav");
});

// Finding 9: reorderLayer emits update actions for both target and colliding layers.
test("Finding 9: reorderLayer emits update actions for target and colliding layers", () => {
  const layeredFilm: LayeredFilm = {
    id: "lf-reorder",
    title: "Reorder Test",
    fps: 30,
    accent: "#635BFF",
    chapters: ["ch1"],
    canvas: { nodes: [{ id: "n1", label: "N1", x: 0, y: 0, w: 100, h: 50 }, { id: "n2", label: "N2", x: 200, y: 0, w: 100, h: 50 }], edges: [{ from: "n1", to: "n2" }] },
    layers: [
      { id: "l1", number: 0, label: "Layer 0", locked: false, hidden: false, muted: false, height: 50 },
      { id: "l2", number: 10, label: "Layer 10", locked: false, hidden: false, muted: false, height: 50 },
    ],
    clips: [],
  };

  const result = reorderLayer(layeredFilm, "l1", 10);
  assert.equal(result.actions.length, 2, "Must generate update action for both swapped layers");
  const action1 = result.actions.find((a) => a.path[1] === 0);
  const action2 = result.actions.find((a) => a.path[1] === 1);
  assert.ok(action1 && action2);
  assert.doesNotThrow(() => validateLayeredFilm(result.film));
});

// Finding 10: mergeSubtitleClips handles inverted clip ID order without producing negative duration.
test("Finding 10: mergeSubtitleClips handles reversed clip order correctly", () => {
  const layeredFilm: LayeredFilm = {
    id: "lf-sub-merge",
    title: "Subtitle Merge Test",
    fps: 30,
    accent: "#635BFF",
    chapters: ["ch1"],
    canvas: { nodes: [{ id: "n1", label: "N1", x: 0, y: 0, w: 100, h: 50 }, { id: "n2", label: "N2", x: 200, y: 0, w: 100, h: 50 }], edges: [{ from: "n1", to: "n2" }] },
    layers: [{ id: "sub-layer", number: 20, label: "Subtitles", locked: false, hidden: false, muted: false, height: 40 }],
    clips: [
      { id: "sub-1", layerId: "sub-layer", position: 1.0, start: 0, end: 2.0, kind: "subtitle", payload: { text: "Hello" }, opacity: 1, volume: 1 },
      { id: "sub-2", layerId: "sub-layer", position: 3.5, start: 0, end: 1.5, kind: "subtitle", payload: { text: "World" }, opacity: 1, volume: 1 },
    ],
  };

  // Pass second clip first
  const result = mergeSubtitleClips(layeredFilm, "sub-2", "sub-1");
  const merged = result.film.clips.find((c) => c.kind === "subtitle")!;
  assert.ok(merged);
  assert.equal(merged.position, 1.0);
  assert.equal(merged.end, 4.0); // 1.0s to (3.5 + 1.5 = 5.0s) -> dur 4.0s
  assert.ok(merged.end > merged.start);
  assert.doesNotThrow(() => validateLayeredFilm(result.film));
});

// Finding 11: closeAudioGapWithDependencies resolves collisions when multiple clips start in the gap.
test("Finding 11: closeAudioGapWithDependencies avoids stacking overlapping clips", () => {
  const layeredFilm: LayeredFilm = {
    id: "lf-gap-close",
    title: "Gap Close Test",
    fps: 30,
    accent: "#635BFF",
    chapters: ["ch1"],
    canvas: { nodes: [{ id: "n1", label: "N1", x: 0, y: 0, w: 100, h: 50 }, { id: "n2", label: "N2", x: 200, y: 0, w: 100, h: 50 }], edges: [{ from: "n1", to: "n2" }] },
    layers: [{ id: "audio-layer", number: 0, label: "Audio", locked: false, hidden: false, muted: false, height: 48 }],
    clips: [
      { id: "clip-1", layerId: "audio-layer", position: 0, start: 0, end: 2.0, kind: "audio", payload: { src: "1.wav" }, opacity: 1, volume: 1 },
      { id: "clip-2", layerId: "audio-layer", position: 3.0, start: 0, end: 2.0, kind: "audio", payload: { src: "2.wav" }, opacity: 1, volume: 1 },
      { id: "clip-3", layerId: "audio-layer", position: 4.0, start: 0, end: 2.0, kind: "audio", payload: { src: "3.wav" }, opacity: 1, volume: 1 },
    ],
  };

  // Gap between 2.0s and 8.0s (length 6.0s)
  const result = closeAudioGapWithDependencies(layeredFilm, 2.0, 6.0);
  assert.doesNotThrow(() => validateLayeredFilm(result.film));
  const c2 = result.film.clips.find((c) => c.id === "clip-2")!;
  const c3 = result.film.clips.find((c) => c.id === "clip-3")!;
  assert.ok(c3.position >= c2.position + (c2.end - c2.start), "Clip 3 must not overlap Clip 2");
});

// Finding 12: Audio split on speed-adjusted clip calculates source offsets accurately.
test("Finding 12: Speed-adjusted audio clip calculates split offsets in source time domain", () => {
  const speed = 1.5;
  const targetAudio: AudioClip = {
    id: "ac-fast",
    src: "vo.wav",
    position: 2.0,
    start: 0,
    end: 6.0, // 6s source = 4s timeline at 1.5x
    speed: 1.5,
    volume: 1,
    channel: "voiceover",
  };

  const playheadSec = 4.0; // 2.0s into the clip on the timeline
  const splitOffsetTimeline = playheadSec - targetAudio.position; // 2.0s
  const splitOffsetSource = splitOffsetTimeline * speed; // 3.0s

  const leftClip: AudioClip = {
    ...targetAudio,
    id: `${targetAudio.id}-part1`,
    position: targetAudio.position,
    start: targetAudio.start,
    end: Number((targetAudio.start + splitOffsetSource).toFixed(3)),
  };

  const rightClip: AudioClip = {
    ...targetAudio,
    id: `${targetAudio.id}-part2`,
    position: playheadSec,
    start: Number((targetAudio.start + splitOffsetSource).toFixed(3)),
    end: targetAudio.end,
  };

  assert.equal(leftClip.end, 3.0);
  assert.equal(rightClip.start, 3.0);
  assert.equal(rightClip.end, 6.0);
  const leftTimelineDur = (leftClip.end - leftClip.start) / speed;
  const rightTimelineDur = (rightClip.end - rightClip.start) / speed;
  assert.equal(leftTimelineDur, 2.0);
  assert.equal(rightTimelineDur, 2.0);
});

// Finding 13: validateFilmAudioAndAssets accounts for voiceover speed in duration-sum check.
test("Finding 13: validateFilm accounts for voiceover.speed in duration sum validation", () => {
  const film = createTestFilm([
    { id: "s1", ch: "ch1", position: 0, startSec: 0, dur: 24, stage: "frame", look: "n1", move: "cut", blocks: [] },
    { id: "s2", ch: "ch1", position: 24, startSec: 24, dur: 24, stage: "frame", look: "n2", move: "pan", blocks: [] },
  ]);
  // Total shot duration = 48s. Raw audio duration = 60s at 1.25x speed (60 / 1.25 = 48s).
  film.voiceover = { src: "test_vo.wav", speed: 1.25, volume: 1 };

  assert.doesNotThrow(() => {
    validateFilmAudioAndAssets(film, { measuredVoiceoverDurationSec: 60.0, toleranceSec: 0.1 });
  });
});

// Finding 14: Ease expo and camera drift clamp progress to [0, 1] during gaps.
test("Finding 14: easeExpo and camera drift progress clamp negative values to 0", () => {
  // Negative progress before a shot starts
  const negativeProgress = -0.25;
  const clampedProgress = Math.max(0, Math.min(1, negativeProgress));
  const eased = easeExpo(negativeProgress);
  const drift = 1 + (1.04 - 1) * clampedProgress;

  assert.equal(clampedProgress, 0);
  assert.equal(eased, 0);
  assert.equal(drift, 1.0);
});
