/**
 * File Description: Derives a character's numerical humanoid rig, sockets and limits from its spec.
 * Inputs and outputs: CharacterSpec -> CharacterRig (joint order matches the approved Iona rig) and rest-pose positions.
 * Used by: character validation, the receive retargeter, the stage, stage facts and the Three builder.
 */
import { characterRigId } from "./hash";
import { HUMANOID_PARENTS, HUMANOID_SIDE, HUMANOID_SPINE, SIDED_PARENTS, type CharacterSpec } from "./schema";
import type { CharacterRig, JointDefinition, PerformanceRig, Vec3 } from "../performance/types";

export type Side = "L" | "R";
/** Sign applied to authored (left-side) x for each side. */
export const SIDE_SIGN: Record<Side, 1 | -1> = { L: 1, R: -1 };

// Copies the first three entries of a numeric tuple into a fresh Vec3 (tuple inference differs between compilers).
export const vec3Of = (v: readonly number[]): Vec3 => [v[0], v[1], v[2]];
// Mirrors one x coordinate for a side without turning 0 into -0.
export const mirrorX = (x: number, side: Side): number => (side === "R" && x !== 0 ? -x : x);
// Mirrors a left-side vector into the given side.
export const mirrorVec = (v: readonly number[], side: Side): Vec3 => [mirrorX(v[0], side), v[1], v[2]];

// Lists the humanoid joints, in the approved rig's order, with offsets from the spec's proportions.
export function characterJoints(spec: CharacterSpec): JointDefinition[] {
  const p = spec.skeleton.proportions;
  const joints: JointDefinition[] = HUMANOID_SPINE.map((id) => ({ id, parent: HUMANOID_PARENTS[id], offset: vec3Of(p[id]) }));
  for (const side of ["L", "R"] as const) {
    for (const name of HUMANOID_SIDE) {
      const parent = HUMANOID_PARENTS[name]!;
      joints.push({ id: `${name}${side}`, parent: SIDED_PARENTS.has(parent) ? `${parent}${side}` : parent, offset: mirrorVec(p[name], side) });
    }
  }
  for (const extra of spec.skeleton.extraJoints) joints.push({ id: extra.id, parent: extra.parent, offset: vec3Of(extra.offset) });
  return joints;
}

// Builds the renderer-independent rig the evaluator, retargeter and critique consume.
export function rigFromCharacter(spec: CharacterSpec): CharacterRig {
  return {
    id: characterRigId(spec),
    joints: characterJoints(spec),
    limbs: {
      armR: { base: "shoulderR", middle: "elbowR", tip: "wristR" },
      armL: { base: "shoulderL", middle: "elbowL", tip: "wristL" },
      legR: { base: "hipR", middle: "kneeR", tip: "ankleR" },
      legL: { base: "hipL", middle: "kneeL", tip: "ankleL" },
    },
    sockets: {
      gripL: { joint: spec.sockets.gripL.joint, offset: vec3Of(spec.sockets.gripL.offset) },
      gripR: { joint: spec.sockets.gripR.joint, offset: vec3Of(spec.sockets.gripR.offset) },
      soleL: { joint: spec.sockets.soleL.joint, offset: vec3Of(spec.sockets.soleL.offset) },
      soleR: { joint: spec.sockets.soleR.joint, offset: vec3Of(spec.sockets.soleR.offset) },
    },
    limits: {
      reach: spec.limits.reach,
      bend: { arm: [spec.limits.bend.arm[0], spec.limits.bend.arm[1]], leg: [spec.limits.bend.leg[0], spec.limits.bend.leg[1]] },
      rotation: Object.fromEntries(Object.entries(spec.limits.rotation).map(([id, l]) => [id, { min: vec3Of(l.min), max: vec3Of(l.max) }])),
    },
  };
}

// Returns every joint's rest-pose position relative to the rig root (identity rotations).
export function restPositions(rig: Pick<PerformanceRig, "joints">): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const joint of rig.joints) {
    const base = joint.parent === null ? [0, 0, 0] : out[joint.parent];
    out[joint.id] = [base[0] + joint.offset[0], base[1] + joint.offset[1], base[2] + joint.offset[2]];
  }
  return out;
}

// Measures a two-bone limb's upper and lower bone lengths.
export function limbLengths(rig: PerformanceRig, limb: string): { upper: number; lower: number } {
  const def = rig.limbs[limb];
  const length = (id: string) => Math.hypot(...rig.joints.find((j) => j.id === id)!.offset);
  return { upper: length(def.middle), lower: length(def.tip) };
}
