/**
 * File Description: Parses and validates character specs, reporting every problem with the field path to fix.
 * Inputs and outputs: unknown JSON -> parsed CharacterSpec, derived rig and issues (schema, topology, sockets, ground, palette, parts, hash).
 * Used by: the character library loader, design compilation, stage validation (browser-safe) and the character CLI.
 */
import { characterSpecSchema, type CharacterSpec } from "./schema";
import { characterHash } from "./hash";
import { expandParts, type CharacterIssue, type ResolvedPart } from "./expand";
import { restPositions, rigFromCharacter } from "./rig";
import type { CharacterRig } from "../performance/types";

export type { CharacterIssue } from "./expand";

/** Largest rest-pose gap between a sole socket and the ground before the spec is rejected. */
export const GROUND_TOLERANCE = 1e-6;

// Formats a Zod or semantic issue path as a readable field reference such as parts[3].joint.
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join("") || "(root)";
}

// Renders issues as the one-line-per-field strings the CLI, compiler and stage print.
export function formatIssues(issues: CharacterIssue[], prefix = ""): string[] {
  return issues.map((issue) => `${prefix}${issue.path}: ${issue.message}`);
}

export interface ParsedCharacter {
  spec?: CharacterSpec;
  rig?: CharacterRig;
  parts?: ResolvedPart[];
  errors: CharacterIssue[];
}

// Validates a parsed spec's semantics: joints, sockets, ground contact, limits, palette, face, parts and swings.
export function validateCharacterSemantics(spec: CharacterSpec): { rig: CharacterRig; parts: ResolvedPart[]; errors: CharacterIssue[] } {
  const errors: CharacterIssue[] = [];
  const rig = rigFromCharacter(spec);
  const jointIds = new Set<string>();
  rig.joints.forEach((joint, i) => {
    const path = i < 21 ? "skeleton.proportions" : `skeleton.extraJoints[${i - 21}]`;
    if (jointIds.has(joint.id)) errors.push({ path: `${path}.id`, message: `joint "${joint.id}" is declared twice` });
    if (joint.parent !== null && !jointIds.has(joint.parent)) errors.push({ path: `${path}.parent`, message: `parent "${joint.parent}" of "${joint.id}" must be declared earlier` });
    jointIds.add(joint.id);
  });
  for (const [name, limb] of Object.entries(rig.limbs)) {
    for (const id of [limb.middle, limb.tip]) {
      const offset = rig.joints.find((j) => j.id === id)!.offset;
      if (Math.hypot(...offset) < 1e-6) errors.push({ path: `skeleton.proportions.${id.replace(/[LR]$/, "")}`, message: `${name} needs a nonzero bone length at ${id}` });
    }
  }
  const expected = { gripL: "wristL", gripR: "wristR", soleL: "ankleL", soleR: "ankleR" } as const;
  for (const [name, joint] of Object.entries(expected)) {
    const socket = spec.sockets[name as keyof typeof expected];
    if (socket.joint !== joint) errors.push({ path: `sockets.${name}.joint`, message: `${name} rides on ${joint}, not "${socket.joint}"` });
  }
  const rest = restPositions(rig);
  for (const side of ["L", "R"] as const) {
    const lift = rest[`ankle${side}`][1] + spec.sockets[`sole${side}`].offset[1];
    if (Math.abs(lift) > GROUND_TOLERANCE) {
      const fixed = spec.skeleton.proportions.hips[1] - lift;
      errors.push({ path: "skeleton.proportions.hips", message: `the rest pose leaves sole${side} ${lift > 0 ? "above" : "below"} the ground by ${Math.abs(lift).toFixed(4)}; set hips y to ${Number(fixed.toFixed(6))} or move sockets.sole${side}` });
    }
  }
  for (const kind of ["arm", "leg"] as const) {
    const [lo, hi] = spec.limits.bend[kind];
    if (!(lo >= 0 && lo < hi && hi <= Math.PI)) errors.push({ path: `limits.bend.${kind}`, message: `needs 0 <= min < max <= pi radians, got [${lo}, ${hi}]` });
  }
  for (const [id, limit] of Object.entries(spec.limits.rotation)) {
    if (!jointIds.has(id)) errors.push({ path: `limits.rotation.${id}`, message: `unknown joint "${id}"` });
    if ([0, 1, 2].some((axis) => limit.min[axis] > limit.max[axis])) errors.push({ path: `limits.rotation.${id}`, message: "min must not exceed max on any axis" });
  }
  const tokens = new Set(Object.keys(spec.palette));
  // Requires a palette token to exist, naming the field that used it.
  const needToken = (token: string, path: string) => { if (!tokens.has(token)) errors.push({ path, message: `unknown palette token "${token}" (palette: ${[...tokens].join(", ")})` }); };
  needToken(spec.outline.color, "outline.color");
  needToken(spec.face.skin, "face.skin");
  needToken(spec.face.brows.color, "face.brows.color");
  needToken(spec.face.eyes.line, "face.eyes.line");
  if (spec.face.hairline) needToken(spec.face.hairline.color, "face.hairline.color");
  if (spec.face.hairline && spec.face.hairline.path[0][0] !== "M") errors.push({ path: "face.hairline.path[0]", message: "a path starts with an M command" });
  if (!spec.expressions.neutral) errors.push({ path: "expressions.neutral", message: "every character needs a neutral expression" });
  for (const [name, surface] of Object.entries(spec.surfaces)) {
    if (surface.rx.length !== surface.y.length || surface.rz.length !== surface.y.length) errors.push({ path: `surfaces.${name}`, message: "y, rx and rz need the same number of entries" });
    if (surface.y.some((y, i) => i > 0 && y <= surface.y[i - 1])) errors.push({ path: `surfaces.${name}.y`, message: "heights must strictly increase" });
  }
  const expanded = expandParts(spec);
  errors.push(...expanded.issues);
  const partIds = new Map<string, string>();
  let heads = 0;
  for (const part of expanded.parts) {
    if (partIds.has(part.id)) errors.push({ path: part.path, message: `part id "${part.id}" is also used at ${partIds.get(part.id)}` });
    partIds.set(part.id, part.path);
    if (!jointIds.has(part.joint)) errors.push({ path: `${part.path}.joint`, message: `unknown joint "${part.joint}"` });
    if (part.material !== null) needToken(part.material, `${part.path}.material`);
    if (part.geometry.kind === "head") heads++;
  }
  if (heads !== 1) errors.push({ path: "parts", message: `needs exactly one head part for the painted face, found ${heads}` });
  spec.secondary.forEach((swing, i) => swing.parts.forEach((piece, j) => {
    if (!partIds.has(piece.part)) errors.push({ path: `secondary[${i}].parts[${j}].part`, message: `unknown part "${piece.part}"` });
  }));
  return { rig, parts: expanded.parts, errors };
}

// Parses raw JSON, applies defaults, validates semantics and verifies the content hash when present or required.
export function parseCharacter(raw: unknown, options: { requireHash?: boolean } = {}): ParsedCharacter {
  const parsed = characterSpecSchema.safeParse(raw);
  if (!parsed.success) return { errors: parsed.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
  const spec = parsed.data;
  const { rig, parts, errors } = validateCharacterSemantics(spec);
  const actual = characterHash(spec);
  if (spec.hash === undefined) {
    if (options.requireHash) errors.push({ path: "hash", message: `missing; stamp the spec with \`aideos character check <file> --stamp\` (content hash ${actual})` });
  } else if (spec.hash !== actual) {
    errors.push({ path: "hash", message: `content hash mismatch: the spec says ${spec.hash} but its content hashes to ${actual}; the spec changed after it was stamped, so review the change and re-stamp it` });
  }
  return { spec, rig, parts, errors };
}

/** What one action needs from a character. */
export interface ActionNeeds { action: string; expressions: readonly string[]; channels: readonly string[] }

// Reports what a character lacks for an action: expressions the action plays and swing channels it cannot drive.
export function actionCompatibility(spec: CharacterSpec, needs: ActionNeeds): CharacterIssue[] {
  const issues: CharacterIssue[] = [];
  for (const name of needs.expressions) if (!spec.expressions[name]) issues.push({ path: `expressions.${name}`, message: `${needs.action} plays the "${name}" expression; add a preset for it` });
  spec.secondary.forEach((swing, i) => {
    if (!needs.channels.includes(swing.channel)) issues.push({ path: `secondary[${i}].channel`, message: `${needs.action} drives channels ${needs.channels.join(", ")}, not "${swing.channel}"` });
  });
  return issues;
}
