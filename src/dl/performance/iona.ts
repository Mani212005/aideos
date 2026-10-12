/**
 * File Description: Approved Iona rig's named bind hierarchy and fixed limb proportions.
 * Inputs and outputs: archived character.mjs joint definitions -> renderer-independent rig.
 * Used by: receive action evaluator, critique and Iona fixture adapter.
 */
import type { JointDefinition, PerformanceRig, Vec3 } from "./types";

// Names a bind joint with its parent and local translation.
const joint = (
  id: string,
  parent: string | null,
  offset: Vec3,
): JointDefinition => ({ id, parent, offset });
const joints: JointDefinition[] = [
  joint("hips", null, [0, 3.2, 0]),
  joint("spine", "hips", [0, 0.7, 0]),
  joint("chest", "spine", [0, 0.7, 0]),
  joint("neck", "chest", [0, 0.7, 0]),
  joint("head", "neck", [0, 0.7, 0]),
];
for (const side of ["L", "R"] as const) {
  const s = side === "L" ? 1 : -1;
  joints.push(
    joint(`shoulder${side}`, "chest", [0.5 * s, 0.5, 0]),
    joint(`elbow${side}`, `shoulder${side}`, [0.34 * s, -1.05, 0]),
    joint(`wrist${side}`, `elbow${side}`, [0.3 * s, -0.95, 0]),
    joint(`fingers${side}`, `wrist${side}`, [0.03 * s, -0.33, 0]),
    joint(`thumb${side}`, `wrist${side}`, [-0.06 * s, -0.12, 0.03]),
    joint(`hip${side}`, "hips", [0.26 * s, -0.1, 0]),
    joint(`knee${side}`, `hip${side}`, [0.03 * s, -1.45, 0]),
    joint(`ankle${side}`, `knee${side}`, [0, -1.3, 0]),
  );
}
export const IONA_RIG: PerformanceRig = {
  id: "iona-v1",
  joints,
  limbs: {
    armR: { base: "shoulderR", middle: "elbowR", tip: "wristR" },
    armL: { base: "shoulderL", middle: "elbowL", tip: "wristL" },
    legR: { base: "hipR", middle: "kneeR", tip: "ankleR" },
    legL: { base: "hipL", middle: "kneeL", tip: "ankleL" },
  },
};
