/**
 * File Description: Joint-limit geometry shared by the retargeter and the numerical critique.
 * Inputs and outputs: rig with limits and a limb or action -> allowed base-to-target distances and rotation excess.
 * Used by: performance/retarget.ts and performance/critique.ts.
 */
import type { PerformanceRig, ReceiveAction, RigLimits, Vec3 } from "./types";

// Measures a limb's upper and lower bone lengths from its bind offsets.
export function limbBones(rig: PerformanceRig, limb: string): { upper: number; lower: number } {
  const def = rig.limbs[limb];
  if (!def) throw new Error(`rig ${rig.id} has no ${limb} limb`);
  const length = (id: string): number => {
    const joint = rig.joints.find((j) => j.id === id);
    if (!joint) throw new Error(`rig ${rig.id} has no joint ${id}`);
    return Math.hypot(...joint.offset);
  };
  return { upper: length(def.middle), lower: length(def.tip) };
}

// Returns the base-to-target distances a limb may span: reach caps the far end, hinge flexion bounds both ends.
export function limbRange(rig: PerformanceRig & { limits: RigLimits }, limb: string): { min: number; max: number; reachMax: number } {
  const { upper, lower } = limbBones(rig, limb);
  const [lo, hi] = rig.limits.bend[limb.startsWith("arm") ? "arm" : "leg"];
  const span = (flex: number) => Math.sqrt(Math.max(0, upper * upper + lower * lower + 2 * upper * lower * Math.cos(flex)));
  const reachMax = rig.limits.reach * (upper + lower);
  return { min: Math.max(span(hi), Math.abs(upper - lower)), max: Math.min(reachMax, span(lo)), reachMax };
}

// Measures how far any directly rotated joint key (including wrist tip rotations) exceeds its Euler limits.
export function rotationExcess(rig: PerformanceRig & { limits: RigLimits }, action: ReceiveAction): number {
  let excess = 0;
  const tracks: Array<[string, readonly { value: Vec3 }[]]> = [
    ...Object.entries(action.rotations),
    ...action.constraints.flatMap((c): Array<[string, readonly { value: Vec3 }[]]> => (c.tipRotation ? [[rig.limbs[c.limb].tip, c.tipRotation]] : [])),
  ];
  for (const [joint, track] of tracks) {
    const limit = rig.limits.rotation[joint];
    if (!limit) continue;
    for (const key of track) key.value.forEach((v, axis) => { excess = Math.max(excess, limit.min[axis] - v, v - limit.max[axis]); });
  }
  return excess;
}
