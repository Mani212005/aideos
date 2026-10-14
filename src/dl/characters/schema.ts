/**
 * File Description: Strict versioned aideos.character/1 schema: a character is data, not code.
 * Inputs and outputs: authored or compiled character JSON -> typed, defaulted CharacterSpec or Zod issues with field paths.
 * Used by: character validation, rig derivation, part expansion, the Three builder, the stage contract and the character CLI.
 */
import { z } from "zod";

/** The one schema id this module accepts. A breaking change gets a new id, never a silent reinterpretation. */
export const CHARACTER_SCHEMA_ID = "aideos.character/1";

/** Humanoid joints every character has, in rig order. Left-side joints are authored; right mirrors x. */
export const HUMANOID_SPINE = ["hips", "spine", "chest", "neck", "head"] as const;
export const HUMANOID_SIDE = ["shoulder", "elbow", "wrist", "fingers", "thumb", "hip", "knee", "ankle"] as const;
export type HumanoidSideJoint = (typeof HUMANOID_SIDE)[number];
/** Parent of each authored joint. Side joints name their parent without the side suffix. */
export const HUMANOID_PARENTS: Record<(typeof HUMANOID_SPINE)[number] | HumanoidSideJoint, string | null> = {
  hips: null, spine: "hips", chest: "spine", neck: "chest", head: "neck",
  shoulder: "chest", elbow: "shoulder", wrist: "elbow", fingers: "wrist", thumb: "wrist",
  hip: "hips", knee: "hip", ankle: "knee",
};
/** Side-suffixed parents: these keep their suffix when mirrored. */
export const SIDED_PARENTS = new Set<string>(["shoulder", "elbow", "wrist", "hip", "knee"]);

// Tuple schemas carry type predicates so the root and editor compilers both infer required elements.
const vec3 = z.tuple([z.number(), z.number(), z.number()]).refine((v): v is [number, number, number] => v.length === 3);
const vec2 = z.tuple([z.number(), z.number()]).refine((v): v is [number, number] => v.length === 2);
const positivePair = z.tuple([z.number().positive(), z.number().positive()]).refine((v): v is [number, number] => v.length === 2);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb");
const token = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, "a palette or surface token is camelCase letters and digits");
const jointRef = z.string().regex(/^[a-z][a-zA-Z0-9]*(\{side\})?$/, "a joint is a camelCase id, optionally ending in {side}");
const partId = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\{side\}[A-Za-z0-9_]*)?$/, "a part id is letters, digits and underscores, with at most one {side}");
const radius = z.union([z.number().positive(), positivePair]);
const ink = z.number().min(0).max(0.2);
const segments = (fallback: number) => z.number().int().min(2).max(128).default(fallback);
const caps = z.tuple([z.number().min(0), z.number().min(0)]).refine((v): v is [number, number] => v.length === 2).default([1, 1]);

// Fields every geometry part shares: the joint it rides on, its palette material and its cel outline.
const surface = {
  id: partId,
  joint: jointRef,
  material: token,
  shading: z.enum(["toon", "flat"]).default("toon"),
  /** Normal-extruded backface outline width in rig units; omitted uses outline.width, 0 draws none. */
  ink: ink.optional(),
  doubleSided: z.boolean().default(false),
};

/** A tapered elliptical ring-section tube along a Catmull-Rom path: limbs, torso, hair locks, boots. */
export const tubePartSchema = z.strictObject({
  type: z.literal("tube"), ...surface,
  points: z.array(vec3).min(2), radii: z.array(radius).min(1), origin: vec3.default([0, 0, 0]),
  segments: segments(20), radial: segments(20), caps,
});
/** The single sculpted head that carries the painted face texture. */
export const headPartSchema = z.strictObject({
  type: z.literal("head"), id: partId, joint: jointRef, ink: ink.optional(),
  points: z.array(vec3).min(2), radii: z.array(radius).min(1), origin: vec3.default([0, 0, 0]),
  segments: segments(36), radial: segments(32), caps,
});
/** A clothing panel hugging a named surface profile: lapels, linings, seams, openings. */
export const panelPartSchema = z.strictObject({
  type: z.literal("panel"), ...surface,
  surface: token, a: z.array(vec2).min(2), b: z.array(vec2).min(2), lift: z.number().default(0.03), steps: z.number().int().min(1).max(32).default(5),
});
/** Explicit flat triangles for small hard pieces: badges, visors, buckles. */
export const facetsPartSchema = z.strictObject({
  type: z.literal("facets"), ...surface, triangles: z.array(vec3).min(3),
});
/** A tube spanning one bone, so it follows the skeleton's proportions without hand-placed points. */
export const limbPartSchema = z.strictObject({
  type: z.literal("limb"), ...surface,
  to: jointRef, radii: z.array(radius).min(2), start: vec3.default([0, 0, 0]), bend: vec3.default([0, 0, 0]),
  segments: segments(20), radial: segments(20), caps,
});
/** A tube through a surface profile, so the torso and its clothing panels share one shape. */
export const torsoPartSchema = z.strictObject({
  type: z.literal("torso"), ...surface, surface: token, center: vec3, segments: segments(20), radial: segments(20), caps,
});
/** A gloved or bare hand: palm to the fingers joint, a row of curled fingers and a thumb. */
export const handPartSchema = z.strictObject({
  type: z.literal("hand"), joint: jointRef, material: token, shading: z.enum(["toon", "flat"]).default("toon"), doubleSided: z.boolean().default(false),
  palm: z.strictObject({ radii: z.tuple([radius, radius]).refine((v): v is [z.infer<typeof radius>, z.infer<typeof radius>] => v.length === 2), ink: ink.default(0.012), name: partId.default("palm{side}") }),
  fingers: z.strictObject({
    count: z.number().int().min(1).max(5), spacing: z.number().positive(),
    lengths: z.array(z.number().positive()).min(1), curls: z.array(z.number()).min(1),
    radii: z.array(radius).min(2), reach: vec2, depth: vec3, fan: vec2, shift: vec2,
    ink: ink.default(0.008), segments: segments(8), radial: segments(8), name: z.string().regex(/^[A-Za-z][A-Za-z0-9_{}]*$/).default("finger{i}{side}"),
  }),
  thumb: z.strictObject({ points: z.array(vec3).min(2), radii: z.array(radius).min(1), ink: ink.default(0.008), segments: segments(8), radial: segments(8), name: partId.default("thumbMesh{side}") }),
});

export const partSchema = z.discriminatedUnion("type", [tubePartSchema, headPartSchema, panelPartSchema, facetsPartSchema, limbPartSchema, torsoPartSchema, handPartSchema]);
/** Expands its parts once per listed side, substituting {side} and mirroring authored x for R. */
export const mirrorGroupSchema = z.strictObject({
  mirror: z.union([z.tuple([z.literal("L"), z.literal("R")]), z.tuple([z.literal("R"), z.literal("L")])]).refine((v): v is ["L", "R"] | ["R", "L"] => v.length === 2),
  parts: z.array(partSchema).min(1),
  /** Per-side replacements, authored in left-side space before mirroring, keyed by expanded id template. */
  overrides: z.partialRecord(z.enum(["L", "R"]), z.record(partId, z.record(z.string(), z.unknown()))).default({}),
});

const socket = z.strictObject({ joint: z.string().min(1), offset: vec3 });
const rotationLimit = z.strictObject({ min: vec3, max: vec3 });
const expression = z.strictObject({
  eyeOpen: z.number().min(0).max(2), browTilt: z.number().min(-1).max(1), browRaise: z.number().min(-0.2).max(0.2),
  mouthCurve: z.number().min(-0.2).max(0.2), mouthOpen: z.number().min(0).max(0.3),
});
const pathCommand = z.union([
  z.tuple([z.literal("M"), z.number(), z.number()]),
  z.tuple([z.literal("L"), z.number(), z.number()]),
  z.tuple([z.literal("Q"), z.number(), z.number(), z.number(), z.number()]),
  z.tuple([z.literal("C"), z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
]);
const swingPart = z.strictObject({ part: partId, pivot: vec3, gain: z.tuple([vec3, vec3, vec3]).refine((v): v is [[number, number, number], [number, number, number], [number, number, number]] => v.length === 3), bias: vec3.default([0, 0, 0]) });

/** The whole character. Strict at every level so a misspelt field is an error, not a silent default. */
export const characterSpecSchema = z.strictObject({
  schema: z.literal(CHARACTER_SCHEMA_ID),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "a character id is lowercase letters, digits and hyphens"),
  version: z.number().int().positive(),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(600),
  /** sha256 of the canonical spec without this field; `aideos character check --stamp` writes it. */
  hash: z.string().regex(/^[0-9a-f]{64}$/, "hash is 64 lowercase hex characters").optional(),
  treatment: z.literal("cel-v1"),
  skeleton: z.strictObject({
    type: z.literal("humanoid"),
    /** Each joint's rest offset from its parent in rig units (y up, z toward camera). Left side only. */
    proportions: z.strictObject({
      hips: vec3, spine: vec3, chest: vec3, neck: vec3, head: vec3,
      shoulder: vec3, elbow: vec3, wrist: vec3, fingers: vec3, thumb: vec3,
      hip: vec3, knee: vec3, ankle: vec3,
    }),
    /** Accessory joints appended after the humanoid joints; parents must already exist. */
    extraJoints: z.array(z.strictObject({ id: z.string().regex(/^[a-z][a-zA-Z0-9]*$/), parent: z.string().min(1), offset: vec3 })).default([]),
  }),
  /** Semantic attachment points: palm grips (wrist space) and sole contacts (ankle space). */
  sockets: z.strictObject({ gripL: socket, gripR: socket, soleL: socket, soleR: socket }),
  limits: z.strictObject({
    /** Largest fraction of a two-bone limb's length any action may extend it to. */
    reach: z.number().gt(0.5).lt(1).default(0.995),
    /** Hinge flexion range in radians (0 is straight) for elbows and knees. */
    bend: z.strictObject({ arm: vec2, leg: vec2 }),
    /** Euler XYZ limits in radians for directly rotated joints; a joint without an entry is unlimited. */
    rotation: z.record(z.string(), rotationLimit).default({}),
  }),
  palette: z.record(token, hex),
  outline: z.strictObject({ color: token, width: ink.default(0.022) }),
  silhouette: z.strictObject({ fill: hex }),
  /** Camera yaw in radians for each canonical model-sheet view. */
  views: z.strictObject({ front: z.number(), threequarter: z.number(), side: z.number(), back: z.number().optional() }),
  /** Cross-section profiles (local y, half-widths x and z) shared by torso tubes and clothing panels. */
  surfaces: z.record(token, z.strictObject({ y: z.array(z.number()).min(2), rx: z.array(z.number().positive()).min(2), rz: z.array(z.number().positive()).min(2) })).default({}),
  face: z.strictObject({
    size: z.number().int().min(256).max(2048).default(1024),
    base: hex, skin: token, oval: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]).refine((v): v is [number, number, number, number] => v.length === 4),
    ovalLine: z.strictObject({ color: hex, alpha: z.number().min(0).max(1), width: z.number().positive() }).optional(),
    blush: z.strictObject({ color: hex, alpha: z.number().min(0).max(1), at: vec2, size: vec2 }).optional(),
    hairline: z.strictObject({ color: token, path: z.array(pathCommand).min(3) }).optional(),
    brows: z.strictObject({ color: token, y: z.number().default(0.1), x: vec3.default([0.075, 0.17, 0.29]) }),
    eyes: z.strictObject({ style: z.enum(["almond", "round"]), at: vec2, scale: z.number().positive().default(1), sclera: hex, iris: z.tuple([hex, hex, hex]).refine((v): v is [string, string, string] => v.length === 3), pupil: hex, line: token }),
    mouth: z.strictObject({ y: z.number().default(-0.3), line: hex, inner: hex, scale: z.number().positive().default(1) }),
  }),
  expressions: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), expression),
  /** Swinging accessories driven by an action's secondary channel: euler = gain x channel + bias. */
  secondary: z.array(z.strictObject({ channel: z.string().min(1), parts: z.array(swingPart).min(1) })).default([]),
  parts: z.array(z.union([partSchema, mirrorGroupSchema])).min(1),
});

export type CharacterSpec = z.infer<typeof characterSpecSchema>;
export type CharacterSpecInput = z.input<typeof characterSpecSchema>;
export type CharacterPart = z.infer<typeof partSchema>;
export type MirrorGroup = z.infer<typeof mirrorGroupSchema>;
export type FaceSpec = CharacterSpec["face"];
export type ExpressionPreset = CharacterSpec["expressions"][string];
export type FaceCommand = z.infer<typeof pathCommand>;
