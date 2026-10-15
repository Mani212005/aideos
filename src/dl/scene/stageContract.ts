/**
 * File Description: Strict serialized v2 stage cast, receive and cue contracts, including the embedded character spec.
 * Inputs and outputs: authored or compiled JSON -> validated browser-safe stage data.
 * Used by: film schema, design compiler, ThreeStage, stage facts and semantic validation.
 */
import { z } from "zod";
import { characterSpecSchema } from "../characters/schema";
import type { Quat, Vec3 } from "../performance/types";

// Keeps validated coordinates typed as a required three-number tuple.
export const vec3Schema = z.tuple([z.number(), z.number(), z.number()]).refine((v): v is [...Vec3] => v.length === 3);
// Keeps validated quaternion components typed as a required four-number tuple.
const quat = z.tuple([z.number(), z.number(), z.number(), z.number()]).refine((v): v is [...Quat] => v.length === 4);
// Keeps validated flight endpoints typed as the required pair used by the action evaluator.
const flight = z.tuple([vec3Schema, vec3Schema]).refine((v): v is [[...Vec3], [...Vec3]] => v.length === 2);
const track = z.array(z.strictObject({ frame: z.number().min(0), value: vec3Schema })).min(1);
export const decisiveSchema = z.strictObject({ shotId: z.string().min(1), phrase: z.string().min(1), edge: z.enum(["start", "end"]).default("start"), event: z.literal("contact") });
/** A rig id names a character and its version, e.g. "iona-v1". */
export const rigIdSchema = z.string().regex(/^[a-z][a-z0-9-]*-v\d+$/, "a rig id is <character id>-v<version>");
export const receiveSchema = z.strictObject({
  id: z.string().min(1), rigId: rigIdSchema, fps: z.number().int().positive(),
  fromFrame: z.number().int().min(0), toFrame: z.number().positive(), holdFromFrame: z.number().min(0),
  anchors: z.array(z.strictObject({ phase: z.enum(["setup", "anticipation", "intercept", "contact", "recoil", "settle"]), frame: z.number().min(0) })),
  root: z.strictObject({ position: track, rotation: track }),
  positions: z.record(z.string(), track), rotations: z.record(z.string(), track), secondary: z.record(z.string(), track),
  expressions: z.array(z.strictObject({ frame: z.number().min(0), name: z.enum(["neutral", "surprised", "determined", "relieved"]) })).min(1),
  constraints: z.array(z.strictObject({ limb: z.string(), target: track, pole: track, planted: z.boolean(), tipRotation: track.optional() })).min(1),
  contact: z.strictObject({ frame: z.number().int().min(0), joint: z.string(), gripOffset: vec3Schema, propOffset: vec3Schema, propScale: z.number().positive(), propRotation: quat, flightRotation: quat, flight }),
});
const identity = { id: z.string().regex(/^[a-z0-9-]+$/), renderer: z.literal("three"), treatment: z.literal("cel-v1"), resourceHash: z.string().regex(/^[0-9a-f]{64}$/) };
const placement = { position: z.tuple([z.number(), z.number()]), unitsToStage: z.number().positive().max(500), depth: z.number().default(0) };
/** A character cast member carries its resolved, hash-stamped spec, so the film renders without any library lookup. */
export const characterCastSchema = z.strictObject({ ...identity, kind: z.literal("character"), character: characterSpecSchema, ...placement });
/** P0 films compiled before character specs were embedded. */
export const legacyCharacterCastSchema = z.strictObject({ ...identity, kind: z.literal("character"), asset: z.literal("iona-art-v1"), rig: z.literal("iona-v1"), ...placement });
export const propCastSchema = z.strictObject({ ...identity, kind: z.literal("prop"), asset: z.literal("paper-glider-v1") });
export const castSchema = z.union([characterCastSchema, legacyCharacterCastSchema, propCastSchema]);
/** How the compiled receive was fitted to its actor: source rig, limit policy and any clamps applied. */
export const retargetRecordSchema = z.strictObject({ from: rigIdSchema, to: rigIdSchema, characterHash: z.string().regex(/^[0-9a-f]{64}$/).optional(), policy: z.enum(["fail", "clamp"]), warnings: z.array(z.string()) });
export const performanceSchema = z.strictObject({
  id: z.string().min(1), action: z.literal("receive-v1"), actor: z.string(), prop: z.string(),
  decisive: decisiveSchema.extend({ frame: z.number().int().min(0) }),
  afterState: z.string().min(1), data: receiveSchema, retarget: retargetRecordSchema.optional(),
});
export type StageCast = z.infer<typeof castSchema>;
export type LegacyCharacterCast = z.infer<typeof legacyCharacterCastSchema>;
export type StagePerformance = z.infer<typeof performanceSchema>;

export const LEGACY_P0_RESOURCE_HASH = "675cb9030633a2350ad9da0dbf18cb1055a06c81178ad02946b63e302dbb98c0";
