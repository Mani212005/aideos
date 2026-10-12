/**
 * File Description: Zod schema and TypeScript definitions for look.json, the machine-checked look plan for an Aideos film.
 * Inputs and outputs: JSON input or raw objects -> validated LookPlan data or Zod validation errors.
 * Used by: backend/lookPlan/check.ts, backend/lookPlan/render.ts, backend/lookPlan/brief.ts.
 */

import { z } from "zod";

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
    extra: z.record(z.string(), z.string()).default({}),
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
export const lookPlanSchema = z.object({
  schema: z.literal("aideos.look/1"),
  decidedBy: lookDecidedBySchema,
  film: lookFilmSchema,
  shots: z.array(lookShotSchema).min(1),
  approval: lookApprovalSchema.optional(),
});

export type LookPlan = z.infer<typeof lookPlanSchema>;

// Parses and validates a raw look plan object.
export function parseLookPlan(data: unknown): LookPlan {
  return lookPlanSchema.parse(data);
}

// Safely validates a raw look plan object, returning success status and data or error.
export function safeParseLookPlan(data: unknown) {
  return lookPlanSchema.safeParse(data);
}
