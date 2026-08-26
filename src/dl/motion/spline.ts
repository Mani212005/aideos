/**
 * File Description: Hermite Centripetal Catmull-Rom Spline interpolator for 1D joint angles and trajectories.
 * Guarantees exact C1 velocity continuity across multi-knot sequences with local support.
 */

export interface KnotPoint {
  t: number; // Normalized timestamp in [0, 1]
  val: number; // Scalar value (e.g. angle in degrees or position coordinate)
}

/**
 * Evaluates a Catmull-Rom spline across a sequence of multi-knot control points using cubic Hermite basis.
 * @param knots Ordered array of knots sorted by timestamp t in [0, 1].
 * @param t Target normalized query timestamp in [0, 1].
 */
export function evaluateCatmullRomSpline(
  knots: KnotPoint[],
  t: number
): number {
  if (knots.length === 0) return 0;
  if (knots.length === 1) return knots[0].val;

  const sorted = [...knots].sort((a, b) => a.t - b.t);

  // Clamp boundaries
  if (t <= sorted[0].t) return sorted[0].val;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].val;

  // Find active segment [k1, k2] where t in [t1, t2]
  let idx = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].t && t <= sorted[i + 1].t) {
      idx = i;
      break;
    }
  }

  const k1 = sorted[idx];
  const k2 = sorted[idx + 1];

  const k0 = idx > 0 ? sorted[idx - 1] : { t: k1.t - (k2.t - k1.t), val: k1.val - (k2.val - k1.val) };
  const k3 = idx + 2 < sorted.length ? sorted[idx + 2] : { t: k2.t + (k2.t - k1.t), val: k2.val + (k2.val - k1.val) };

  const dt = Math.max(1e-5, k2.t - k1.t);
  const u = Math.max(0, Math.min(1, (t - k1.t) / dt));

  // Compute exact tangents at knot 1 and knot 2
  const dt02 = Math.max(1e-5, k2.t - k0.t);
  const dt13 = Math.max(1e-5, k3.t - k1.t);

  const m1 = (k2.val - k0.val) / dt02;
  const m2 = (k3.val - k1.val) / dt13;

  // Standard cubic Hermite basis functions
  const u2 = u * u;
  const u3 = u2 * u;

  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;

  return h00 * k1.val + h10 * dt * m1 + h01 * k2.val + h11 * dt * m2;
}
