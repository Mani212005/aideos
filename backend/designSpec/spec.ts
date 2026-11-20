/**
 * File Description: The design spec - the data a bespoke film design is written as.
 * An agent (or the server-model fallback) designs a film by writing videos/<id>/design/design.json
 * plus the SVG artwork it names. Frames are never written by hand: every clip and camera pose is
 * timed with a cue that names a shot or a spoken phrase, and `aideos design build` resolves the cues
 * against the measured narration, holds the continuity rules and runs the design check before anything ships.
 * A design may also declare generated pictures (the illustrated stage: one plate and a few objects) by prompt,
 * placed like SVG assets and pinned by sha256; every word, number, line and motion stays SVG.
 * Inputs and outputs: TypeScript definitions -> types and schemas for DesignSpec and visual cues.
 * Used by: backend/designSpec/designer.ts, backend/designSpec/compile.ts, backend/designSpec/soundtrack.ts.
 *
 * Cue grammar (a string, or a frame number):
 *   "jupiter"                shot start          "jupiter@0.4"      40% through the shot
 *   "jupiter@end"            shot end            "end"              the film's last frame
 *   'jupiter:"the storm"'    phrase start        'jupiter:"the storm"@end'   phrase end
 *   any of the above + "+12" or "-6"             offset in frames
 */

import { z } from "zod";
import { stageTreatmentSchema } from "../../src/dl/scene/materials/treatment";
import { blockSchema } from "../../src/dl/schema";
import { MAX_HOLD_PUSH, MIN_HOLD_PUSH } from "../../src/dl/holdPush";
import { SCENE_SIZE } from "../sceneKit/stage";
import { decisiveSchema, vec3Schema } from "../../src/dl/scene/stageContract";
import { PICTURE_ASPECTS } from "../pictures/policy";

const vec2 = z.tuple([z.number(), z.number()]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "an accent is a #rrggbb colour");
const cue = z.union([z.string().min(1).max(120), z.number().int().min(0)]);

/** One piece of artwork placed on the stage. */
export const specAssetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "asset ids are lowercase letters, digits and dashes"),
  /** Path inside the film's package, e.g. "visuals/probe.svg". */
  file: z.string().regex(/^visuals\/[a-z0-9-]+\.svg$/, 'artwork lives at "visuals/<name>.svg"'),
  /** Refused here: an asset names either SVG artwork (`file`) or a declared picture (`picture`), never both. */
  picture: z.never({ message: "an asset names either a file or a picture, not both" }).optional(),
  /** Where the artwork's centre sits in the 1920 x 1920 scene. */
  position: vec2,
  scale: z.number().positive().max(20).default(1),
  layer: z.number().int().min(0).max(50).optional(),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
});

const pictureId = z.string().regex(/^[a-z0-9-]+$/, "picture ids are lowercase letters, digits and dashes");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "a pin is the approved image's sha256 (64 lowercase hex digits)");

/**
 * One generated picture of the illustrated stage (the plate or one object). Its file comes from the picture
 * cache (backend/pictures/cache.ts) by the fingerprint of the film's style paragraph, this prompt, the aspect,
 * the tool and the cut-out; `sha256` pins the approved image so a render is as repeatable as an SVG render.
 */
export const specPictureSchema = z.strictObject({
  id: pictureId,
  /** The object only, abstract, no text, people, logos, brands or artists (backend/pictures/policy.ts). */
  prompt: z.string().min(10).max(1200),
  aspect: z.enum(PICTURE_ASPECTS),
  /** How the transparent background is obtained ("none" for the plate); part of the fingerprint. */
  cutout: z.string().min(1).max(80).default("none"),
  /** The approved image's sha256. A build refuses an unpinned or changed picture. */
  sha256: sha256.optional(),
});

/** The film's pictures: one style paragraph pasted into every prompt, one tool label, about one plate and 8 objects. */
export const specPicturesSchema = z.strictObject({
  style: z.string().min(20).max(1500),
  /** Which generator makes them, e.g. "codex-imagegen"; a label recorded and fingerprinted, never called by aideos. */
  tool: z.string().min(1).max(80),
  items: z.array(specPictureSchema).min(1).max(12),
});

/** A declared picture placed on the stage, like an SVG asset; clips move, scale, rotate and fade it by its asset id. */
export const specPictureAssetSchema = z.strictObject({
  id: specAssetSchema.shape.id,
  /** The id of an entry in `pictures.items`. */
  picture: pictureId,
  position: vec2,
  scale: z.number().positive().max(20).default(1),
  layer: z.number().int().min(0).max(50).optional(),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
});

/** One animation clip, timed by cues instead of frames. */
export const specClipSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  asset: z.string(),
  targets: z.array(z.string().min(1)).min(1),
  property: z.enum(["translateX", "translateY", "scale", "scaleX", "scaleY", "rotate", "opacity", "drawOn"]),
  from: z.number(),
  to: z.number(),
  start: cue,
  end: cue,
  easing: z.enum(["linear", "expoOut", "expoIn", "expoInOut", "hold"]).optional(),
  stagger: z.number().int().min(0).optional(),
  origin: vec2.optional(),
  /** Allow starting from a value the last clip did not leave, for a jump made while hidden. */
  allowJump: z.boolean().optional(),
});

/**
 * One camera pose, timed by a cue. The camera flows from the previous pose to this one, arriving at
 * `at`; repeat a pose to hold it. `easing` shapes that arrival: leave it off so the camera runs
 * smoothly through its poses (a named easing stops at both ends of the move, which reads as a jerk).
 */
export const specCameraSchema = z.object({
  /** Names this pose in build errors; defaults to "camera-<n>" (its position in the list). */
  id: z.string().regex(/^[a-z0-9-]+$/, "camera ids are lowercase letters, digits and dashes").optional(),
  at: cue,
  /** Where the camera looks, in the 1920 x 1920 scene. */
  center: vec2.refine(([x, y]) => x >= 0 && x <= SCENE_SIZE.w && y >= 0 && y <= SCENE_SIZE.h, "the camera looks at a point inside the scene"),
  zoom: z.number().min(0.5).max(4),
  /** The named look-plan cast object this pose is meant to keep in focus. */
  focus: z.string().regex(/^[a-z0-9-]+$/).optional(),
  easing: z.enum(["linear", "expoOut", "expoIn", "expoInOut", "hold"]).optional(),
});

/** One story act section of background music, timed with cues. */
export const specSoundtrackSectionSchema = z.object({
  role: z.enum(["hook", "explain", "tension", "payoff", "outro"]).default("explain"),
  item: z.string().min(1),
  start: cue,
  end: cue,
  offsetSec: z.number().min(0).optional(),
  volume: z.number().min(0).max(2).optional(),
});

/** One sound effect timed to land on an on-screen visual event. */
export const specSoundtrackSfxSchema = z.object({
  item: z.string().min(1),
  at: cue,
  gainDb: z.number().optional(),
  event: z.string().optional(),
  volume: z.number().min(0).max(2).optional(),
});

/** Soundtrack definition in design.json: sections and sound effects. */
export const specSoundtrackSchema = z.object({
  sections: z.array(specSoundtrackSectionSchema).default([]),
  sfx: z.array(specSoundtrackSfxSchema).default([]),
});

/** The whole design of one film. */
const legacyDesignSchema = z.object({
  brief: z.object({
    concept: z.string().min(1).max(600),
    throughLine: z.string().max(300).optional(),
    motifs: z.array(z.string().max(80)).max(12).optional(),
  }),
  /** The film's one accent colour; everything else uses the locked palette. */
  accent: hex.optional(),
  /** Full-bleed backdrop: SVG artwork, or the illustrated stage's generated plate (a declared picture). Omit for the plain canvas colour. */
  background: z.union([
    z.object({ file: specAssetSchema.shape.file, scale: z.number().positive().default(4.8) }),
    z.strictObject({ picture: pictureId, scale: z.number().positive().default(1) }),
  ]).optional(),
  assets: z.array(z.union([specPictureAssetSchema, specAssetSchema])).max(40),
  /** The illustrated stage's generated pictures (docs/GOOD_VIDEO.md "Pictures"). Omit for an SVG-only film. */
  pictures: specPicturesSchema.optional(),
  clips: z.array(specClipSchema).max(1500),
  /** Optional camera poses in time order (at least two). Omit for a fixed, centred camera. */
  camera: z.array(specCameraSchema).min(2).max(60).optional(),
  /** Opt-in slow camera push-in over every hold (1% to 3% extra zoom, never past the camera caps). Omit for none. Needs `camera`. */
  holdPush: z.number().min(MIN_HOLD_PUSH).max(MAX_HOLD_PUSH).optional(),
  /** Optional per-shot overrides of the on-screen blocks drawn over the scene. */
  shots: z
    .record(
      z.string(),
      z.object({
        blocks: z.array(blockSchema).max(4),
        /**
         * Defaults to "frame" for text cards, "none" for no blocks, and the shot's own stage when a chart remains.
         * "inset" puts one device in the format's fixed inset region (`getInsetRegion`) with the scene still in view;
         * the design check fails any scene art visible inside that region while the shot plays.
         */
        stage: z.enum(["frame", "anchor", "none", "inset"]).optional(),
      }),
    )
    .optional(),
  /** Optional soundtrack block choosing music sections and visual sound effects. */
  soundtrack: specSoundtrackSchema.optional(),
});

const stagePlacement = { position: vec2, unitsToStage: z.number().positive().max(500), depth: z.number().default(0), treatment: stageTreatmentSchema.optional() };
/** A character names an aideos.character/1 spec by id: the film package's characters/<id>.character.json, else the committed library. */
export const stageCharacterAssetSchema = z.strictObject({ id: specAssetSchema.shape.id, renderer: z.literal("three"), kind: z.literal("character"), character: z.string().regex(/^[a-z][a-z0-9-]*$/, "a character id is lowercase letters, digits and hyphens"), ...stagePlacement });
/** P0 designs named the Iona fixture directly; they still build and resolve to the Iona spec. Packages are never rewritten. */
const legacyIonaAssetSchema = z.strictObject({ id: specAssetSchema.shape.id, renderer: z.literal("three"), kind: z.literal("character"), asset: z.literal("iona-art-v1"), rig: z.literal("iona-v1"), ...stagePlacement })
  .transform(({ asset: _asset, rig: _rig, ...rest }) => { void _asset; void _rig; return { ...rest, character: "iona" }; });
/** V2 assets declare exactly which renderer and plane owns their pixels. */
const stageAsset = z.union([
  specAssetSchema.extend({ renderer: z.literal("svg"), plane: z.enum(["background", "foreground"]) }).strict(),
  stageCharacterAssetSchema,
  legacyIonaAssetSchema,
  z.strictObject({ id: specAssetSchema.shape.id, renderer: z.literal("three"), kind: z.literal("prop"), asset: z.literal("paper-glider-v1"), treatment: stageTreatmentSchema.optional() }),
]);
/** limits: "fail" refuses a character whose reach, hinge or rotation limits cannot hold the action; "clamp" fits the action inside them and records each change. */
export const authoredPerformanceSchema = z.strictObject({ id: specAssetSchema.shape.id, action: z.literal("receive-v1"), actor: z.string().min(1), prop: z.string().min(1), start: cue, decisive: decisiveSchema, targetOffset: vec3Schema.default([0, 0, 0]), limits: z.enum(["fail", "clamp"]).default("fail"), afterState: z.string().min(1) });
export const stageDesignSchema = legacyDesignSchema.extend({ schema: z.literal("aideos.design/2"), renderer: z.literal("three"), treatment: stageTreatmentSchema.optional(), shots: z.record(z.string(), z.strictObject({ blocks: z.array(blockSchema).max(4).optional(), stage: z.enum(["frame", "anchor", "none", "inset"]).optional(), stageTreatment: stageTreatmentSchema.optional() })).optional(), assets: z.array(stageAsset).max(40), performances: z.array(authoredPerformanceSchema).min(1) }).strict();
export const designSpecSchema = z.union([stageDesignSchema, legacyDesignSchema.extend({ schema: z.literal("aideos.design/1").optional(), renderer: z.literal("svg").optional() })]);

export type DesignSpec = z.infer<typeof designSpecSchema>;
export type LegacyDesignSpec = z.infer<typeof legacyDesignSchema>;
export type SpecClip = z.infer<typeof specClipSchema>;
export type SpecCamera = z.infer<typeof specCameraSchema>;
export type SpecSoundtrackSection = z.infer<typeof specSoundtrackSectionSchema>;
export type SpecSoundtrackSfx = z.infer<typeof specSoundtrackSfxSchema>;
export type SpecSoundtrack = z.infer<typeof specSoundtrackSchema>;
export type SpecPictures = z.infer<typeof specPicturesSchema>;
export type SpecPictureAsset = z.infer<typeof specPictureAssetSchema>;
