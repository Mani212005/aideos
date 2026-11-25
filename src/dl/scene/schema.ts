/**
 * File Description: The one Zod definition of a film's vector scene (the stage drawn from committed SVG
 * assets and pictures, driven by declarative animation clips and a camera track). `scene/types.ts` derives
 * every scene type from these schemas, so the shape a film is parsed to and the shape the compiler and
 * renderers read cannot drift apart. Structure lives here; the semantic rules (frame order, track ids,
 * sub-group targets, resources) stay in validateScene.ts and validateStage.ts.
 * Inputs and outputs: raw scene JSON -> parsed scene data (sceneSchema) and the schemas its parts are built from.
 * Used by: src/dl/schema.ts (film.scene), src/dl/scene/types.ts (derived types).
 */

import { z } from "zod";
import { stageTreatmentSchema, treatmentSpanSchema } from "./materials/treatment";
import { castSchema, performanceSchema } from "./stageContract";
import { MAX_HOLD_PUSH, MIN_HOLD_PUSH } from "../holdPush";
import { SVG_ANIMATABLE_PROPERTIES, SVG_EASINGS } from "./svgAnimation";

export const vec2Schema = z.object({ x: z.number(), y: z.number() });

/** The easing curves a clip or a camera segment may name (svgAnimation.ts applies them). expoOut is the project standard. */
export const svgEasingSchema = z.enum(SVG_EASINGS);

/**
 * Mirroring the scene contract in Zod is what lets a hand-authored timeline of
 * several hundred clips fail at bundle time with a field path, instead of
 * rendering a film with one prop silently missing.
 */
export const svgAnimationClipSchema = z.object({
  clipId: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1),
  /** Every property the compiler animates, including the line endpoints x1, y1, x2 and y2. */
  property: z.enum(SVG_ANIMATABLE_PROPERTIES),
  from: z.number(),
  to: z.number(),
  startFrame: z.number().int().min(0),
  durationFrames: z.number().int().min(1),
  easing: svgEasingSchema.optional(),
  staggerFrames: z.number().int().min(0).optional(),
  origin: vec2Schema.optional(),
});

export const svgAnimationTimelineSchema = z.object({
  timelineId: z.string().min(1),
  clips: z.array(svgAnimationClipSchema),
});

/** One key of an asset track: the value at a scene frame. The compiler runs a spline through the keys. */
export const keyframeSchema = z.object({
  /** Index within the scene, integer >= 0 (validateScene checks it). */
  frame: z.number(),
  value: z.number(),
});

/** A keyframed property of an asset or sub-group. Asset track ids: "x" | "y" | "scale" | "rotation" | "opacity". */
export const trackSchema = z.object({
  /** Unique within its owning entity. */
  trackId: z.string(),
  keyframes: z.array(keyframeSchema),
  /** Requested AND verified at compile time. */
  continuity: z.enum(["C0", "C1"]).optional(),
});

/** D1: One rotating sub-group per environment asset (wheels, fans, cogs). */
export const rotatingSubGroupSchema = z.object({
  /** SVG element id within this asset's document. */
  elementId: z.string(),
  /** Rotation pivot in the asset's local coordinate space. */
  pivot: vec2Schema,
  /** Constant angular velocity in degrees per second. Use this OR track, not both. */
  degreesPerSecond: z.number().optional(),
  /** Keyframed rotation in degrees. Use this OR degreesPerSecond, not both. */
  track: trackSchema.optional(),
});

/**
 * A picture (the illustrated stage's plate or one of its generated objects): one PNG drawn centred on
 * its asset's origin at one scene unit per pixel, then placed, scaled and faded like an SVG asset. The
 * picture is the asset's single animatable element, so a clip targets it by the asset's own id. Pictures
 * carry no words, numbers or lines: SVG keeps all of those. See src/dl/scene/raster.ts.
 */
export const rasterSourceSchema = z.object({
  /** Repo-relative path to the PNG, e.g. "videos/<slug>/visuals/generated/<fingerprint>.png". */
  src: z.string().min(1).regex(/\.png$/i, "a picture is a .png file"),
  /** Pixel width of the PNG, which is also its drawn width in scene units at scale 1. */
  width: z.number().int().min(1).max(16_384),
  /** Pixel height of the PNG, which is also its drawn height in scene units at scale 1. */
  height: z.number().int().min(1).max(16_384),
  /** sha256 of the approved file (lowercase hex): the design pins it, and both renderers refuse other bytes. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "a picture is pinned by its sha256 (64 lowercase hex digits)"),
});

export const environmentAssetSchema = z.object({
  plane: z.enum(["background", "foreground"]).optional(),
  /** Unique within the scene. */
  assetId: z.string().min(1),
  /** SVG artwork; exactly one of `svgSource` and `raster` is set. */
  svgSource: z.string().min(1).endsWith(".svg").optional(),
  /** A picture instead of SVG artwork. */
  raster: rasterSourceSchema.optional(),
  /** D5: omit to derive from position.y per frame. Present = explicit override. */
  layer: z.number().int().optional(),
  /** Scene-space pixels. */
  position: vec2Schema,
  /** Uniform; 1.0 = authored size. */
  scale: z.number().positive(),
  /** Degrees. */
  rotation: z.number(),
  opacity: z.number().min(0).max(1),
  /** Track ids: "x" | "y" | "scale" | "rotation" | "opacity". */
  tracks: z.array(trackSchema).optional(),
  /** D1: Multiple rotating sub-groups per asset (e.g. front + rear bicycle wheels). */
  subGroups: z.array(rotatingSubGroupSchema).optional(),
  /**
   * Custom element-level SVG animation for this asset: which elements of its SVG document move,
   * along which property, over which frames. See svgAnimation.ts for the clip format.
   */
  animation: svgAnimationTimelineSchema.optional(),
}).refine((a) => (a.svgSource === undefined) !== (a.raster === undefined), { message: "an asset draws exactly one of svgSource (SVG artwork) and raster (a picture)" });

export const cameraKeyframeSchema = z.object({
  frame: z.number().int().min(0),
  center: vec2Schema,
  zoom: z.number().positive(),
  rotation: z.number().optional(),
  /** Omit to let the camera flow through its neighbours on the spline; a named easing stops at both ends of the segment. */
  easing: svgEasingSchema.optional(),
});

export const cameraTrackSchema = z.object({
  keyframes: z.array(cameraKeyframeSchema),
  /** Opt-in slow push-in over every camera hold, as a fraction of zoom (0.01 to 0.03). Absent means off. */
  holdPush: z.number().min(MIN_HOLD_PUSH).max(MAX_HOLD_PUSH).optional(),
});

export const sceneSchema = z.object({
  treatmentResourceHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  treatment: stageTreatmentSchema.optional(),
  treatments: z.array(treatmentSpanSchema).optional(),
  renderer: z.enum(["svg", "three"]).optional(),
  cast: z.array(castSchema).optional(),
  performances: z.array(performanceSchema).optional(),
  /** e.g. "1.0.0". */
  schemaVersion: z.string().min(1),
  sceneId: z.string().min(1),
  fps: z.number().int().positive(),
  durationFrames: z.number().int().positive(),
  /** D4: Audio segment this scene is clocked to. */
  audioSource: z.string().min(1),
  audioDurationMs: z.number().min(0),
  /** Virtual scene coordinate space (e.g. 1920 x 1920). */
  sceneSize: z.object({ w: z.number().positive(), h: z.number().positive() }),
  camera: cameraTrackSchema.optional(),
  background: environmentAssetSchema,
  props: z.array(environmentAssetSchema),
  /** Legacy 2D actors: no rig renders them, so a scene carries none. Characters are `cast` plus `performances`. */
  actors: z.array(z.unknown()).max(0, "2D actors are not rendered; put characters in cast and performances (src/dl/scene/README.md)").default([]),
}).strict();
