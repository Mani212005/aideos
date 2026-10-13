/**
 * File Description: Strict serialized v2 stage cast, receive and cue contracts.
 * Inputs and outputs: authored or compiled JSON -> validated browser-safe stage data.
 * Used by: film schema, design compiler, ThreeStage and semantic validation.
 */
import { z } from "zod";

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const quat = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const track = z.array(z.strictObject({ frame: z.number().min(0), value: vec3 })).min(1);
export const decisiveSchema = z.strictObject({ shotId: z.string().min(1), phrase: z.string().min(1), edge: z.enum(["start", "end"]).default("start"), event: z.literal("contact") });
export const receiveSchema = z.strictObject({
  id: z.string().min(1), rigId: z.literal("iona-v1"), fps: z.number().int().positive(),
  fromFrame: z.number().int().min(0), toFrame: z.number().positive(), holdFromFrame: z.number().min(0),
  anchors: z.array(z.strictObject({ phase: z.enum(["setup", "anticipation", "intercept", "contact", "recoil", "settle"]), frame: z.number().min(0) })),
  root: z.strictObject({ position: track, rotation: track }),
  positions: z.record(z.string(), track), rotations: z.record(z.string(), track), secondary: z.record(z.string(), track),
  expressions: z.array(z.strictObject({ frame: z.number().min(0), name: z.enum(["neutral", "surprised", "determined", "relieved"]) })).min(1),
  constraints: z.array(z.strictObject({ limb: z.string(), target: track, pole: track, planted: z.boolean(), tipRotation: track.optional() })).min(1),
  contact: z.strictObject({ frame: z.number().int().min(0), joint: z.string(), gripOffset: vec3, propOffset: vec3, propScale: z.number().positive(), propRotation: quat, flightRotation: quat, flight: z.tuple([vec3, vec3]) }),
});
const identity = { id: z.string().regex(/^[a-z0-9-]+$/), renderer: z.literal("three"), treatment: z.literal("cel-v1"), resourceHash: z.string().regex(/^[0-9a-f]{64}$/) };
export const castSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...identity, kind: z.literal("character"), asset: z.literal("iona-art-v1"), rig: z.literal("iona-v1"), position: z.tuple([z.number(), z.number()]), unitsToStage: z.number().positive().max(500), depth: z.number().default(0) }),
  z.strictObject({ ...identity, kind: z.literal("prop"), asset: z.literal("paper-glider-v1") }),
]);
export const performanceSchema = z.strictObject({
  id: z.string().min(1), action: z.literal("receive-v1"), actor: z.string(), prop: z.string(),
  decisive: decisiveSchema.extend({ frame: z.number().int().min(0) }),
  afterState: z.string().min(1), data: receiveSchema,
});
export type StageCast = z.infer<typeof castSchema>;
export type StagePerformance = z.infer<typeof performanceSchema>;
