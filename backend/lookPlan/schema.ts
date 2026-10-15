/**
 * File Description: Zod schema and TypeScript definitions for look.json, the machine-checked look plan for an Aideos film.
 * Inputs and outputs: JSON input or raw objects -> validated LookPlan data or Zod validation errors.
 * Used by: backend/lookPlan/check.ts, backend/lookPlan/render.ts, backend/lookPlan/brief.ts.
 */

import { z } from "zod";
import { decisiveSchema } from "../../src/dl/scene/stageContract";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colours must be #rrggbb hex");

/** The permitted treatments for a shot in the look plan. Note: "footage" is reserved and refused by check. */
export const lookTreatmentEnum = z.enum(["scene", "scene+card", "device", "footage"]);
export type LookTreatment = z.infer<typeof lookTreatmentEnum>;

/** Information about who made or wrote the look plan. */
export const lookDecidedBySchema = z.object({
  agent: z.string().min(1),
  model: z.string().min(1),
  at: z.string().min(1),
  how: z.string().optional(),
});

/** An explicit transformation of a cast object at a given beat. */
export const lookChangeSchema = z.object({
  at: z.string().min(1),
  how: z.string().min(1),
  /** Names the distinct visible state the object reaches after the change. */
  state: z.string().min(1).optional(),
  magnitude: z.enum(["major", "moderate", "minor"]).optional(),
});
export type LookChange = z.infer<typeof lookChangeSchema>;

/** A member of the cast of objects that lives on the stage and carries over across beats. */
export const lookCastItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "cast id must be lowercase alphanumeric with hyphens"),
  what: z.string().min(1),
  enters: z.string().min(1),
  changes: z.array(lookChangeSchema).default([]),
});
export type LookCastItem = z.infer<typeof lookCastItemSchema>;

/** A camera pose cue in the look plan. */
export const lookCameraPoseSchema = z.object({
  at: z.string().min(1),
  pose: z.string().min(1),
  why: z.string().min(1),
  /** Cast object this pose should frame after its move. */
  focus: z.string().regex(/^[a-z0-9-]+$/).optional(),
});
export type LookCameraPose = z.infer<typeof lookCameraPoseSchema>;

/** Captions configuration in the look plan. */
export const lookCaptionsSchema = z.object({
  position: z.enum(["bottom"]),
  kineticColumn: z.boolean().default(false),
});

/** Film-level look configuration. */
export const lookFilmSchema = z.object({
  mode: z.literal("scene"),
  stage: z.string().min(1),
  cast: z.array(lookCastItemSchema).min(1),
  camera: z.array(lookCameraPoseSchema).min(1),
  palette: z.object({
    bg: hexColor,
    accent: hexColor,
  }),
  captions: lookCaptionsSchema,
  headlines: z.enum(["none", "few", "all"]).default("none"),
});

/** Per-shot plan in the look plan. */
export const lookShotSchema = z.object({
  id: z.string().min(1),
  treatment: lookTreatmentEnum,
  carries: z.array(z.string()).default([]),
  cue: z.string().min(1),
  criterion: z.string().min(1),
  why: z.string().min(1),
  device: z.string().optional(),
});
export type LookShot = z.infer<typeof lookShotSchema>;

/** Optional captain approval object. */
export const lookApprovalSchema = z.object({
  captain: z.string().nullable().optional(),
});

/** The authoritative look plan schema (aideos.look/1). */
const legacyLookSchema = z.object({
  schema: z.literal("aideos.look/1"),
  decidedBy: lookDecidedBySchema,
  film: lookFilmSchema,
  shots: z.array(lookShotSchema).min(1),
  approval: lookApprovalSchema.optional(),
});

/**
 * The character a performance plans, pinned by spec id, version and content hash (as printed by
 * `aideos character check <id>`). The version is identity; a hash that changed within the same
 * version is reported by the look check, and design and render rebuild with the new art.
 */
export const lookCharacterRefSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "a character id is lowercase letters, digits and hyphens"),
  version: z.number().int().positive(),
  hash: z.string().regex(/^[0-9a-f]{64}$/, "hash is the 64 lowercase hex characters `aideos character check` prints"),
});
export type LookCharacterRef = z.infer<typeof lookCharacterRefSchema>;

/** Cue-level acting intention, independent of sparse poses and mesh geometry. */
export const lookPerformanceSchema = z.strictObject({ id: z.string().min(1), action: z.literal("receive-v1"), actor: z.string().min(1), character: lookCharacterRefSchema, prop: z.string().min(1), start: z.union([z.string().min(1).max(120), z.number().int().min(0)]), decisive: decisiveSchema, afterState: z.string().min(1), carries: z.array(z.string()).min(1) });
export type LookPerformance = z.infer<typeof lookPerformanceSchema>;
const stageLookSchema = legacyLookSchema.extend({
  schema: z.literal("aideos.look/2"),
  decidedBy: lookDecidedBySchema.strict(),
  film: lookFilmSchema.extend({
    renderer: z.literal("three"),
    cast: z.array(lookCastItemSchema.extend({
      changes: z.array(lookChangeSchema.strict()).default([]),
      renderer: z.enum(["svg", "three"]),
      character: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
      asset: z.enum(["iona-art-v1", "paper-glider-v1"]).optional(),
      rig: z.literal("iona-v1").optional(),
      treatment: z.literal("cel-v1").optional(),
    }).strict()).min(1),
    camera: z.array(lookCameraPoseSchema.strict()).min(1),
    palette: z.strictObject({ bg: hexColor, accent: hexColor }),
    captions: lookCaptionsSchema.strict(),
    performances: z.array(lookPerformanceSchema).min(1),
  }).strict(),
  shots: z.array(lookShotSchema.extend({ performances: z.array(z.string()).default([]) }).strict()).min(1),
  approval: lookApprovalSchema.strict().optional(),
}).strict();
/** Discriminated on `schema`, so an error names the field of the version the plan declares rather than "Invalid input". */
export const lookPlanSchema = z.discriminatedUnion("schema", [stageLookSchema, legacyLookSchema]);

export type LookPlan = z.infer<typeof lookPlanSchema>;
export type LegacyLookPlan = z.infer<typeof legacyLookSchema>;

// Parses and validates a raw look plan object.
export function parseLookPlan(data: unknown): LookPlan {
  return lookPlanSchema.parse(data);
}

// Safely validates a raw look plan object, returning success status and data or error.
export function safeParseLookPlan(data: unknown) {
  return lookPlanSchema.safeParse(data);
}
