/**
 * File Description: Applies one absolute performance state to any character built from a spec, assigning every channel in full.
 * Inputs and outputs: CharacterArt and PerformanceState -> root, local joints, swinging pieces and face for exactly that frame.
 * Used by: ThreeStage, stage facts and the character sheet page. No state survives between frames, so seek order never matters.
 */
import { Euler, Quaternion, Vector3 } from "three";
import type { PerformanceState } from "../../performance/types";
import type { CharacterArt } from "./build";

// Rotates one parent-space piece about its frozen pivot without cumulative mutation.
function swing(art: CharacterArt, name: string, pivot: readonly number[], rotation: Euler): void {
  const mesh = art.parts.meshes[name];
  if (!mesh) throw new Error(`character ${art.spec.id}: swing part ${name} does not exist`);
  const p = new Vector3(pivot[0], pivot[1], pivot[2]);
  mesh.rotation.copy(rotation);
  mesh.position.copy(p).sub(p.clone().applyEuler(rotation));
}

// Assigns the root, every joint's local transform, every swing piece and the face from one evaluated state.
export function applyCharacter(art: CharacterArt, state: PerformanceState): void {
  art.rig.root.position.fromArray(state.root.position);
  art.rig.root.quaternion.fromArray(state.root.rotation);
  art.rig.root.scale.setScalar(1);
  for (const [id, pose] of Object.entries(state.local)) {
    const node = art.rig[id];
    if (!node) throw new Error(`character ${art.spec.id}: the performance drives unknown joint ${id}`);
    // The spec's joints and the numerical rig share the identity bind basis; no world rotation is applied here.
    node.position.fromArray(pose.position);
    node.quaternion.copy(new Quaternion(...pose.rotation));
    node.scale.setScalar(1);
    node.visible = true;
  }
  for (const entry of art.spec.secondary) {
    // A channel the action does not drive rests at zero, so the piece returns to its authored pose.
    const c = state.secondary[entry.channel] ?? [0, 0, 0];
    for (const piece of entry.parts) {
      const [gx, gy, gz] = piece.gain, b = piece.bias;
      swing(art, piece.part, piece.pivot, new Euler(
        gx[0] * c[0] + gx[1] * c[1] + gx[2] * c[2] + b[0],
        gy[0] * c[0] + gy[1] * c[1] + gy[2] * c[2] + b[1],
        gz[0] * c[0] + gz[1] * c[1] + gz[2] * c[2] + b[2],
      ));
    }
  }
  art.setExpression(state.expression);
  art.rig.root.updateMatrixWorld(true);
}
