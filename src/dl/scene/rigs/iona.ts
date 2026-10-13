/**
 * File Description: Applies absolute performance state to the approved Iona art with explicit identity bind bases.
 * Inputs and outputs: pure PerformanceState -> complete local rig, accessory, expression and world prop assignment.
 * Used by: ThreeStage and stage geometry facts.
 */
import { Euler, Quaternion, Vector3 } from "three";
import { IONA_RIG } from "../../performance/iona";
import type { PerformanceState } from "../../performance/types";
import { createIonaArt, type IonaArt } from "./iona-art-v1.js";

// Creates a private art instance and verifies the mesh hierarchy agrees with the numerical bind rig.
export function createIona(faceCanvas?: HTMLCanvasElement): IonaArt {
  const art = createIonaArt(faceCanvas);
  for (const joint of IONA_RIG.joints) {
    const node = art.rig[joint.id];
    const parent = joint.parent ? art.rig[joint.parent] : art.rig.root;
    if (!node || node.parent !== parent || node.position.distanceTo(new Vector3(...joint.offset)) > 1e-9) {
      art.dispose();
      throw new Error(`iona-art-v1 bind mismatch at ${joint.id}`);
    }
  }
  return art;
}

// Rotates parent-space artwork about its frozen pivot without cumulative mutation.
function swing(art: IonaArt, names: string[], pivot: Vector3, rotation: Euler): void {
  for (const name of names) {
    const mesh = art.parts.meshes[name];
    mesh.rotation.copy(rotation);
    mesh.position.copy(pivot).sub(pivot.clone().applyEuler(rotation));
  }
}

// Applies every driven and decorative channel, using local transforms once and the solved world prop once.
export function applyIona(art: IonaArt, state: PerformanceState): void {
  art.rig.root.position.fromArray(state.root.position);
  art.rig.root.quaternion.fromArray(state.root.rotation);
  art.rig.root.scale.setScalar(1);
  for (const joint of IONA_RIG.joints) {
    const pose = state.local[joint.id];
    const node = art.rig[joint.id];
    // Approved mesh and pure rig share the identity bind basis; no world rotation is applied here.
    node.position.fromArray(pose.position);
    node.quaternion.copy(new Quaternion(...pose.rotation));
    node.scale.setScalar(1);
    node.visible = true;
  }
  const coat = state.secondary.coat, tuft = state.secondary.tuft, side = state.secondary.side;
  for (const s of [1, -1]) swing(art, [s === 1 ? "coatTailL" : "coatTailR"], new Vector3(0.2 * s, 0, -0.2), new Euler(coat[0] + s * 0.02, 0, s * coat[1]));
  swing(art, ["hair_tuft", "hairHi_tuft"], new Vector3(0, 0.1, -0.55), new Euler(tuft[0], 0, tuft[1]));
  swing(art, ["hair_sideLong", "hairHi_sideLong"], new Vector3(0.38, 0.28, 0.15), new Euler(0, 0, side[1] + side[0] * 0.5));
  const prop = art.rig.glider;
  prop.position.fromArray(state.prop.position);
  prop.quaternion.fromArray(state.prop.rotation);
  prop.scale.setScalar(state.prop.scale);
  prop.visible = true;
  art.setExpression(state.expression);
  art.rig.root.updateMatrixWorld(true);
  prop.updateMatrixWorld(true);
}
