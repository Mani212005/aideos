/**
 * File Description: Mathematical finite-difference continuity verifier for motion trajectories.
 * Measures first-derivative velocity jumps at interior keyframe knots to detect C0 kinks.
 */

export interface KnotDiscontinuity {
  t: number;
  leftVelocity: number;
  rightVelocity: number;
  discontinuityMagnitude: number;
  isC1Continuous: boolean;
}

export interface ContinuityReport {
  isC1Continuous: boolean;
  maxDiscontinuity: number;
  knots: KnotDiscontinuity[];
}

/**
 * Numerically verifies C1 velocity continuity across interior keyframe knots using finite differences.
 * @param evaluateFn Function evaluating scalar trajectory at normalized timestamp t in [0, 1].
 * @param knotTimestamps Array of interior knot timestamps in (0, 1).
 * @param epsilon Finite difference step delta (default 1e-4).
 * @param tolerance Maximum allowed velocity discontinuity threshold (default 1e-2).
 */
export function verifyTrajectoryC1Continuity(
  evaluateFn: (t: number) => number,
  knotTimestamps: number[],
  epsilon: number = 1e-4,
  tolerance: number = 0.05
): ContinuityReport {
  const knots: KnotDiscontinuity[] = [];
  let maxDiscontinuity = 0;
  let isC1Continuous = true;

  for (const t of knotTimestamps) {
    if (t <= epsilon || t >= 1 - epsilon) continue;

    // Left finite difference derivative v^-(t)
    const yLeft = evaluateFn(t - epsilon);
    const yCenter = evaluateFn(t);
    const vLeft = (yCenter - yLeft) / epsilon;

    // Right finite difference derivative v^+(t)
    const yRight = evaluateFn(t + epsilon);
    const vRight = (yRight - yCenter) / epsilon;

    const discontinuity = Math.abs(vRight - vLeft);
    if (discontinuity > maxDiscontinuity) {
      maxDiscontinuity = discontinuity;
    }

    const knotContinuous = discontinuity <= tolerance;
    if (!knotContinuous) {
      isC1Continuous = false;
    }

    knots.push({
      t,
      leftVelocity: vLeft,
      rightVelocity: vRight,
      discontinuityMagnitude: discontinuity,
      isC1Continuous: knotContinuous,
    });
  }

  return {
    isC1Continuous,
    maxDiscontinuity,
    knots,
  };
}
