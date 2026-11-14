/**
 * File Description: The reference meaning of a `stage3d` node's graph and channels: which sample a frame reads, each node's local transform at that sample, and its world matrix and world vertices, with three.js r180's exact f64 arithmetic (Matrix4.compose, Matrix4.multiplyMatrices, Vector3.applyMatrix4) written out so the Rust rasterizer can mirror it operation for operation. World vertices round to f32 at the end, as the GPU sees them. Browser-safe (no Node imports, no three import).
 * Inputs and outputs: a validated Stage3dNode and a film frame -> world matrices per graph node; a world matrix and f32 local positions -> f32 world positions.
 * Used by: backend/renderIr/stage3d.test.ts (the bit-exact check against prepareStageFacts), docs/RENDER_IR.md, and the P4.2 rasterizer as its specification.
 */

import type { Stage3dNode } from "./schema";

/** A column-major 4x4 matrix, three.js `Matrix4.elements` order. */
export type Matrix = Float64Array;

/** One graph node's local transform at a sample. */
export interface LocalTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
}

/** The sample a film frame reads: the frame itself, held at the last sample after the channels end. */
export function sampleIndex(stage: Pick<Stage3dNode, "sampleFrames">, frame: number): number {
  if (!Number.isInteger(frame) || frame < 0) throw new Error(`frame ${frame} is not a whole, non-negative frame`);
  return Math.min(frame, stage.sampleFrames - 1);
}

/** Builds a local matrix from a position, a quaternion (x, y, z, w) and a uniform scale, as three's `Matrix4.compose`. */
export function compose(t: LocalTransform): Matrix {
  const [x, y, z, w] = t.quaternion;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = t.scale, sy = t.scale, sz = t.scale;
  const te = new Float64Array(16);
  te[0] = (1 - (yy + zz)) * sx;
  te[1] = (xy + wz) * sx;
  te[2] = (xz - wy) * sx;
  te[3] = 0;
  te[4] = (xy - wz) * sy;
  te[5] = (1 - (xx + zz)) * sy;
  te[6] = (yz + wx) * sy;
  te[7] = 0;
  te[8] = (xz + wy) * sz;
  te[9] = (yz - wx) * sz;
  te[10] = (1 - (xx + yy)) * sz;
  te[11] = 0;
  te[12] = t.position[0];
  te[13] = t.position[1];
  te[14] = t.position[2];
  te[15] = 1;
  return te;
}

/** Multiplies `a * b`, as three's `Matrix4.multiplyMatrices` (the parent's world matrix times the child's local one). */
export function multiply(ae: Matrix, be: Matrix): Matrix {
  const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
  const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
  const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
  const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
  const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
  const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
  const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
  const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
  const te = new Float64Array(16);
  te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
  te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
  te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
  te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
  return te;
}

/** Every graph node's local transform at one sample: its static fields, with each channel present replaced by that sample. */
export function localTransforms(stage: Stage3dNode, sample: number): Map<string, LocalTransform> {
  const channels = new Map(stage.channels.map((c) => [c.node, c]));
  const out = new Map<string, LocalTransform>();
  for (const node of stage.nodes) {
    const c = channels.get(node.id);
    const p = c?.position, q = c?.quaternion, s = c?.scale;
    out.set(node.id, {
      position: p ? [p[sample * 3], p[sample * 3 + 1], p[sample * 3 + 2]] : [...node.position],
      quaternion: q ? [q[sample * 4], q[sample * 4 + 1], q[sample * 4 + 2], q[sample * 4 + 3]] : [...node.quaternion],
      scale: s ? s[sample] : node.scale,
    });
  }
  return out;
}

/** World matrices of every graph node at a film frame: a root's world is its local matrix, a child's is parent world times local. */
export function poseStage3d(stage: Stage3dNode, frame: number): Map<string, Matrix> {
  const locals = localTransforms(stage, sampleIndex(stage, frame));
  const world = new Map<string, Matrix>();
  for (const node of stage.nodes) {
    const local = compose(locals.get(node.id)!);
    if (node.parent === undefined) world.set(node.id, local);
    else {
      const parent = world.get(node.parent);
      if (!parent) throw new Error(`stage3d node ${node.id}: parent ${node.parent} is not listed before it`);
      world.set(node.id, multiply(parent, local));
    }
  }
  return world;
}

/** Applies a world matrix to f32 local positions with three's `Vector3.applyMatrix4` (including its w divide) and rounds each result to f32. */
export function worldVertices(e: Matrix, positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    out[i] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    out[i + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    out[i + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
  }
  return out;
}
