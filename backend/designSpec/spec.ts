/**
 * File Description: The design spec - the data a bespoke film design is written as.
 * An agent (or the server-model fallback) designs a film by writing videos/<id>/design/design.json
 * plus the SVG artwork it names. Frames are never written by hand: every clip and camera pose is
 * timed with a cue that names a shot or a spoken phrase, and `aideos design build` resolves the cues
 * against the measured narration, holds the continuity rules and runs the design check before anything ships.
 * Inputs and outputs: TypeScript definitions -> types and schemas for DesignSpec and visual cues.
 * Used by: backend/designSpec/designer.ts, backend/designSpec/compile.ts.
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
import { SCENE_SIZE } from "../sceneKit/stage";
import { decisiveSchema, vec3Schema } from "../../src/dl/scene/stageContract";

const vec2 = z.tuple([z.number(), z.number()]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "an accent is a #rrggbb colour");
const cue = z.union([z.string().min(1).max(120), z.number().int().min(0)]);

/** One piece of artwork placed on the stage. */
export const specAssetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "asset ids are lowercase letters, digits and dashes"),
  /** Path inside the film's package, e.g. "visuals/probe.svg". */
  file: z.string().regex(/^visuals\/[a-z0-9-]+\.svg$/, 'artwork lives at "visuals/<name>.svg"'),
  /** Where the artwork's centre sits in the 1920 x 1920 scene. */
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

/** The whole design of one film. */
const legacyDesignSchema = z.object({
  brief: z.object({
    concept: z.string().min(1).max(600),
    throughLine: z.string().max(300).optional(),
    motifs: z.array(z.string().max(80)).max(12).optional(),
  }),
  /** The film's one accent colour; everything else uses the locked palette. */
  accent: hex.optional(),
  /** Full-bleed backdrop. Omit for the plain canvas colour. */
  background: z.object({ file: specAssetSchema.shape.file, scale: z.number().positive().default(4.8) }).optional(),
  assets: z.array(specAssetSchema).max(40),
  clips: z.array(specClipSchema).max(1500),
  /** Optional camera poses in time order (at least two). Omit for a fixed, centred camera. */
  camera: z.array(specCameraSchema).min(2).max(60).optional(),
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
