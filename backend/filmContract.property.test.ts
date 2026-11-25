/**
 * File Description: Property and expect tests of the film contract's clips and scene. A layered or overlay clip parses against the payload schema
 * its kind names, keeping every payload field (a plain union once parsed an audio payload as video, dropping its channel, and a subtitle cue as
 * text, dropping its frames), and a payload of another family is refused. An audio clip's volume survives the Studio round trip up to the 2x the
 * schema allows. Through parseFilm (the render path), a scene asset keeps its tracks, sub-groups and line-endpoint clips, while an unknown camera
 * easing and legacy 2D actors fail with a field path.
 * Inputs and outputs: seeded random clips and volumes, and the inset-stage fixture film -> the invariants hold, or a failure naming the seed and input.
 * Used by: npm test (found by glob), the CI unit job.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { clipSchema, type ClipKind } from "../src/dl/layeredSchema";
import { overlayClipSchema, parseFilm, type OverlayClipKind } from "../src/dl/schema";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../src/dl/convertFilm";
import { forAll, pick, randFloat, randInt, type Rand } from "./testSupport/propertyTest";

const SCENE_FILM = path.resolve(__dirname, "../test_fixtures/packages/inset-stage/film.json");

/** Payload families: a payload of one family never carries the fields another family requires. */
const FAMILY: Record<ClipKind, "animation" | "media" | "words"> = {
  animation: "animation",
  video: "media",
  audio: "media",
  image: "media",
  text: "words",
  subtitle: "words",
};
const CLIP_KINDS = Object.keys(FAMILY) as ClipKind[];
const OVERLAY_KINDS: readonly OverlayClipKind[] = ["text", "image", "subtitle"];

// Rounds to two decimals so generated numbers stay readable in a failure message.
function num(rand: Rand, lo: number, hi: number): number {
  return Number(randFloat(rand, lo, hi).toFixed(2));
}

// Adds each optional field with probability one half.
function maybe(rand: Rand, fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(() => rand() < 0.5));
}

// Draws a payload of one kind with every defaulted field set, so parsing it must hand back exactly the same object.
function genPayload(rand: Rand, kind: ClipKind): Record<string, unknown> {
  switch (kind) {
    case "animation":
      return {
        shotId: `shot-${randInt(rand, 1, 99)}`,
        stage: pick(rand, ["anchor", "frame", "none", "inset"] as const),
        look: pick(rand, ["all", "n1", ["n1", "n2"]] as const),
        move: pick(rand, ["pan", "zoom-in", "zoom-out", "hold", "cut"] as const),
        drift: rand() < 0.5,
        zoom: num(rand, 0.4, 2.5),
        speed: num(rand, 0.25, 4),
        blocks: [],
        ...maybe(rand, { scriptText: "spoken words", visualDirection: "a wide shot" }),
      };
    case "video":
      return { src: "media/clip.mp4", speed: num(rand, 0.25, 4), ...maybe(rand, { width: randInt(rand, 1, 3840), height: randInt(rand, 1, 2160), fps: pick(rand, [24, 30, 60]) }) };
    case "audio":
      return {
        src: "media/sound.wav",
        channel: pick(rand, ["voiceover", "music", "sfx", "external"] as const),
        speed: num(rand, 0.25, 4),
        ...maybe(rand, { duckUnderVoiceover: rand() < 0.5, retimedSrc: "media/sound.retimed.wav", role: "bed", itemId: "item-1", event: "swell", crossfadeSec: num(rand, 0, 3), gainDb: num(rand, -24, 6) }),
      };
    case "image":
      return { src: "media/photo.png", scale: num(rand, 0.1, 4), ...maybe(rand, { x: num(rand, -500, 500), y: num(rand, -500, 500) }) };
    case "text":
      return {
        text: "A headline",
        size: pick(rand, ["kicker", "headline", "body", "caption"] as const),
        ...maybe(rand, { accentWord: "headline", subtitle: "a subtitle", lowerThird: rand() < 0.5, position: pick(rand, ["top", "center", "bottom"] as const), x: num(rand, 0, 1), y: num(rand, 0, 1) }),
      };
    case "subtitle":
      return { text: "a caption cue", ...maybe(rand, { startFrame: randInt(rand, 0, 100), endFrame: randInt(rand, 100, 200) }) };
  }
}

// Wraps a payload in the timeline fields every layered clip carries, with every defaulted field set.
function layeredClip(kind: ClipKind, payload: Record<string, unknown>): Record<string, unknown> {
  return { id: "clip-1", layerId: "layer-1", position: 1, start: 0, end: 3, kind, payload, opacity: 1, volume: 1 };
}

/** The parts of the unparsed fixture film these tests edit. */
interface RawSceneFilm {
  [field: string]: unknown;
  scene: {
    props: Array<{ tracks?: unknown; subGroups?: unknown; animation: { clips: unknown[] } }>;
    camera?: unknown;
    actors?: unknown[];
  };
}

// Reads the committed inset-stage scene film fixture, unparsed.
function sceneFilm(): RawSceneFilm {
  return JSON.parse(fs.readFileSync(SCENE_FILM, "utf8")) as RawSceneFilm;
}

test("a layered clip keeps every field of the payload its kind names", () => {
  forAll(
    "layered clip payload round trip",
    (rand) => {
      const kind = pick(rand, CLIP_KINDS);
      return { kind, payload: genPayload(rand, kind) };
    },
    ({ kind, payload }) => {
      const parsed = clipSchema.parse(layeredClip(kind, payload));
      assert.equal(parsed.kind, kind);
      assert.deepEqual(parsed.payload, payload);
    },
  );
});

test("a layered clip refuses a payload of another kind's family", () => {
  forAll(
    "layered clip kind and payload mismatch",
    (rand) => {
      const kind = pick(rand, CLIP_KINDS);
      const other = pick(rand, CLIP_KINDS.filter((k) => FAMILY[k] !== FAMILY[kind]));
      return { kind, other, payload: genPayload(rand, other) };
    },
    ({ kind, payload }) => {
      assert.equal(clipSchema.safeParse(layeredClip(kind, payload)).success, false);
    },
  );
});

test("an overlay clip keeps its own payload and refuses one of the other family", () => {
  forAll(
    "overlay clip payload",
    (rand) => {
      const kind = pick(rand, OVERLAY_KINDS);
      const other = pick(rand, OVERLAY_KINDS.filter((k) => FAMILY[k] !== FAMILY[kind]));
      return { kind, payload: genPayload(rand, kind), foreign: genPayload(rand, other) };
    },
    ({ kind, payload, foreign }) => {
      const clip = { id: "overlay-1", kind, position: 0, start: 0, end: 2, opacity: 1 };
      assert.deepEqual(overlayClipSchema.parse({ ...clip, payload }).payload, payload);
      assert.equal(overlayClipSchema.safeParse({ ...clip, payload: foreign }).success, false);
    },
  );
});

test("an audio clip's volume survives the Studio layered round trip up to 2x", () => {
  const film = parseFilm(sceneFilm());
  forAll(
    "audio clip volume round trip",
    (rand) => ({ volume: num(rand, 0, 2), channel: pick(rand, ["voiceover", "music", "sfx", "external"] as const) }),
    ({ volume, channel }) => {
      const withClip = parseFilm({ ...film, audioClips: [{ id: "level", src: "media/level.wav", end: 2, volume, channel }] });
      const layered = convertFilmToLayeredFilm(withClip);
      assert.equal(layered.clips.find((c) => c.id === "level")?.volume, volume);
      assert.equal(convertLayeredFilmToFilm(layered, withClip).audioClips?.find((c) => c.id === "level")?.volume, volume);
    },
    { cases: 60 },
  );
});

test("parseFilm keeps a scene asset's tracks, rotating sub-groups and line-endpoint clips", () => {
  const raw = sceneFilm();
  const prop = raw.scene.props[0];
  prop.tracks = [{ trackId: "x", keyframes: [{ frame: 0, value: 700 }, { frame: 299, value: 900 }], continuity: "C1" }];
  prop.subGroups = [{ elementId: "rack", pivot: { x: 4, y: 8 }, degreesPerSecond: 90 }];
  prop.animation.clips.push({ clipId: "line-grow", targets: ["rack"], property: "x2", from: 0, to: 40, startFrame: 0, durationFrames: 30 });
  const parsed = parseFilm(raw).scene!.props[0];
  const clips = parsed.animation?.clips ?? [];
  assert.deepEqual(parsed.tracks, prop.tracks);
  assert.deepEqual(parsed.subGroups, prop.subGroups);
  assert.deepEqual(clips[clips.length - 1], prop.animation.clips[prop.animation.clips.length - 1]);
});

test("parseFilm names the field of an unknown camera easing and of legacy 2D actors", () => {
  const eased = sceneFilm();
  eased.scene.camera = { keyframes: [{ frame: 0, center: { x: 960, y: 960 }, zoom: 1, easing: "easeOut" }, { frame: 299, center: { x: 960, y: 960 }, zoom: 1.2 }] };
  assert.throws(() => parseFilm(eased), /scene\.camera\.keyframes\.0\.easing/);
  const named = sceneFilm();
  named.scene.camera = { keyframes: [{ frame: 0, center: { x: 960, y: 960 }, zoom: 1, easing: "expoInOut" }, { frame: 299, center: { x: 960, y: 960 }, zoom: 1.2 }] };
  assert.equal(parseFilm(named).scene?.camera?.keyframes[0].easing, "expoInOut");
  const actors = sceneFilm();
  actors.scene.actors = [{ instanceId: "legacy" }];
  assert.throws(() => parseFilm(actors), /scene\.actors: 2D actors are not rendered/);
});
