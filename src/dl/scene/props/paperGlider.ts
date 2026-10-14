/**
 * File Description: The approved folded-paper glider prop and its absolute per-frame placement.
 * Inputs and outputs: none -> independent glider meshes; PerformanceState prop transform -> placed, visible glider.
 * Used by: ThreeStage, stage facts and the character sheet page; registered as prop asset paper-glider-v1.
 */
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshToonMaterial, type Material } from "three";
import type { PerformanceState } from "../../performance/types";
import { celRamp } from "../characters/build";

/** The prop asset ids the stage can build. */
export const PROP_ASSETS = ["paper-glider-v1"] as const;
export type PropAsset = (typeof PROP_ASSETS)[number];

export interface PropArt {
  asset: PropAsset;
  root: Group;
  meshes: Record<string, Mesh>;
  dispose: () => void;
}

const CREAM = 0xf2e8d0, RUST = 0xb5532f;

// Builds the folded-paper dart with a ridge and keel crease.
function gliderGeometry(): BufferGeometry {
  const v: Record<string, number[]> = { n: [0, 0, .95], l: [-.62, .06, -.45], r: [.62, .06, -.45], t: [0, .02, -.5], k: [0, -.2, -.38], a: [0, .12, -.1] };
  const F = [["n", "l", "a"], ["n", "a", "r"], ["a", "l", "t"], ["a", "t", "r"], ["n", "l", "k"], ["n", "k", "r"], ["l", "t", "k"], ["r", "k", "t"]];
  const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(F.flat().flatMap((c) => v[c]), 3)); g.computeVertexNormals(); return g;
}

// Builds one independent glider; it stays hidden until a performance places it.
export function buildProp(asset: PropAsset): PropArt {
  if (asset !== "paper-glider-v1") throw new Error(`unknown prop asset ${String(asset)}`);
  const ramp = celRamp();
  const root = new Group(); root.name = "glider";
  root.scale.setScalar(.85); root.rotation.set(.2, .3, 0); root.visible = false;
  const paper = new Mesh(gliderGeometry(), new MeshToonMaterial({ color: CREAM, gradientMap: ramp, side: DoubleSide })); paper.name = "gliderPaper";
  const tipG = new BufferGeometry(); tipG.setAttribute("position", new Float32BufferAttribute([-.62, .075, -.45, -.434, .058, -.015, -.434, .065, -.465], 3)); tipG.computeVertexNormals();
  const tip = new Mesh(tipG, new MeshToonMaterial({ color: RUST, gradientMap: ramp, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); tip.name = "gliderTip";
  root.add(paper, tip);
  return {
    asset, root, meshes: { gliderPaper: paper, gliderTip: tip },
    dispose: () => { for (const mesh of [paper, tip]) { mesh.geometry.dispose(); (mesh.material as Material).dispose(); } ramp.dispose(); },
  };
}

// Places the prop at the evaluator's solved world transform; attachment was already solved numerically, so it is never reparented.
export function applyProp(prop: PropArt, state: PerformanceState): void {
  prop.root.position.fromArray(state.prop.position);
  prop.root.quaternion.fromArray(state.prop.rotation);
  prop.root.scale.setScalar(state.prop.scale);
  prop.root.visible = true;
  prop.root.updateMatrixWorld(true);
}
