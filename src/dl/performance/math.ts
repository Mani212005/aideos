/**
 * File Description: Small immutable vector, quaternion and analytic limb math for performances.
 * Inputs and outputs: finite vectors, transforms and bone dimensions -> constrained transforms.
 * Used by: performance evaluator and numerical critique; no renderer or Node dependencies.
 */
import type { Quat, Transform, Vec3, VectorTrack } from "./types";

// Adds two vectors without mutating either input.
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
// Subtracts the second vector from the first.
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
// Multiplies a vector by a scalar.
export const scale = (a: Vec3, s: number): Vec3 => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];
// Returns the scalar product of two vectors.
export const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Returns the right-handed vector product.
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
// Measures a vector's Euclidean length.
export const length = (a: Vec3): number => Math.hypot(...a);
// Measures the distance between two points.
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
// Normalizes a vector, rejecting an undefined direction.
export function unit(a: Vec3): Vec3 {
  const n = length(a);
  if (!Number.isFinite(n) || n < 1e-12)
    throw new Error("Undefined zero-length direction.");
  return scale(a, 1 / n);
}
// Normalizes a quaternion to keep rotations rigid.
export function normalizeQ(q: Quat): Quat {
  const n = Math.hypot(...q);
  if (!Number.isFinite(n) || n < 1e-12)
    throw new Error("Undefined zero-length quaternion.");
  return q.map((v) => v / n) as unknown as Quat;
}
// Composes two unit quaternion rotations in parent-to-child order.
export function multiply(a: Quat, b: Quat): Quat {
  const [x, y, z, w] = a,
    [X, Y, Z, W] = b;
  return normalizeQ([
    w * X + x * W + y * Z - z * Y,
    w * Y - x * Z + y * W + z * X,
    w * Z + x * Y - y * X + z * W,
    w * W - x * X - y * Y - z * Z,
  ]);
}
// Inverts a unit quaternion.
export const inverse = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
// Rotates a vector by a unit quaternion.
export function rotate(v: Vec3, q: Quat): Vec3 {
  const xyz: Vec3 = [q[0], q[1], q[2]],
    t = scale(cross(xyz, v), 2);
  return add(v, add(scale(t, q[3]), cross(xyz, t)));
}
// Converts XYZ Euler angles to a unit quaternion, matching the approved rig.
export function euler(v: Vec3): Quat {
  const [x, y, z] = v.map((a) => a / 2),
    c1 = Math.cos(x),
    c2 = Math.cos(y),
    c3 = Math.cos(z),
    s1 = Math.sin(x),
    s2 = Math.sin(y),
    s3 = Math.sin(z);
  return normalizeQ([
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ]);
}
// Returns a rotation between directions, with a deterministic antiparallel fallback.
export function between(a: Vec3, b: Vec3): Quat {
  const u = unit(a),
    v = unit(b),
    d = dot(u, v);
  if (d < -1 + 1e-10) {
    const axis = unit(cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(u, v);
  return normalizeQ([c[0], c[1], c[2], 1 + d]);
}
// Interpolates rotations along their shortest quaternion arc.
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let cosine = a.reduce((n, v, i) => n + v * b[i], 0);
  const end = cosine < 0 ? (b.map((v) => -v) as unknown as Quat) : b;
  cosine = Math.abs(cosine);
  if (cosine > 0.9995)
    return normalizeQ(a.map((v, i) => v + (end[i] - v) * t) as unknown as Quat);
  const theta = Math.acos(Math.min(1, cosine)),
    s = Math.sin(theta);
  return normalizeQ(
    a.map(
      (v, i) =>
        (v * Math.sin((1 - t) * theta) + end[i] * Math.sin(t * theta)) / s,
    ) as unknown as Quat,
  );
}
// Transforms a point from local to parent space.
export const point = (t: Transform, v: Vec3): Vec3 =>
  add(t.position, rotate(v, t.rotation));
// Samples sparse vector anchors with C1 smoothstep and stable endpoint holds.
export function sample(track: VectorTrack, frame: number): Vec3 {
  if (frame <= track[0].frame) return [...track[0].value];
  for (let i = 1; i < track.length; i++) {
    const b = track[i],
      a = track[i - 1];
    if (frame < b.frame) {
      const u = (frame - a.frame) / (b.frame - a.frame),
        w = u * u * (3 - 2 * u);
      return add(a.value, scale(sub(b.value, a.value), w));
    }
  }
  return [...track[track.length - 1].value];
}
// Solves a fixed-length two-bone limb, clamping unreachable targets without stretching.
export function solveTwoBone(
  base: Vec3,
  target: Vec3,
  pole: Vec3,
  upper: number,
  lower: number,
): { middle: Vec3; tip: Vec3 } {
  if (
    [base, target, pole].some(
      (v) => v.length !== 3 || !v.every(Number.isFinite),
    )
  )
    throw new Error("IK vectors must be finite three-component values.");
  if (![upper, lower].every((n) => Number.isFinite(n) && n > 0))
    throw new Error("Bone lengths must be finite and positive.");
  const delta = sub(target, base),
    axis = length(delta) > 1e-12 ? unit(delta) : ([0, -1, 0] as Vec3);
  const d = Math.min(
    upper + lower - 1e-7,
    Math.max(Math.abs(upper - lower) + 1e-7, length(delta)),
  );
  let bend = sub(pole, scale(axis, dot(pole, axis)));
  if (length(bend) < 1e-10)
    bend = cross(axis, Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  const along = (upper * upper - lower * lower + d * d) / (2 * d),
    height = Math.sqrt(Math.max(0, upper * upper - along * along));
  return {
    middle: add(base, add(scale(axis, along), scale(unit(bend), height))),
    tip: add(base, scale(axis, d)),
  };
}
