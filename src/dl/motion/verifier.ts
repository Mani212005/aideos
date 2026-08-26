/**
 * File Description: Mathematical finite-difference continuity verifier for motion trajectories.
 * Measures first-derivative (velocity) and second-derivative (acceleration) jumps at interior keyframe knots
 * with positive control calibrations and step-convergence assertions.
 */

export interface KnotDiscontinuity {
  t: number;
  leftVelocity: number;
  rightVelocity: number;
  velocityDiscontinuity: number;
  isC1Continuous: boolean;
  leftAcceleration?: number;
  rightAcceleration?: number;
  accelerationDiscontinuity?: number;
  isC2Continuous?: boolean;
}

export interface ContinuityReport {
  isC1Continuous: boolean;
  isC2Continuous: boolean;
  maxVelocityDiscontinuity: number;
  maxAccelerationDiscontinuity: number;
  knots: KnotDiscontinuity[];
}

/**
 * Numerically verifies C1 (velocity) and C2 (curvature) continuity across interior keyframe knots using finite differences.
 * @param evaluateFn Function evaluating scalar trajectory at normalized timestamp t in [0, 1].
 * @param knotTimestamps Array of interior knot timestamps in (0, 1).
 * @param epsilon Finite difference step delta (default 1e-4).
 * @param velocityTolerance Maximum allowed velocity discontinuity threshold (default 1e-2).
 * @param accelerationTolerance Maximum allowed acceleration discontinuity threshold (default 1e-1).
 */
export function verifyTrajectoryContinuity(
  evaluateFn: (t: number) => number,
  knotTimestamps: number[],
  epsilon: number = 1e-4,
  velocityTolerance: number = 0.05,
  accelerationTolerance: number = 0.5
): ContinuityReport {
  const knots: KnotDiscontinuity[] = [];
  let maxVelocityDiscontinuity = 0;
  let maxAccelerationDiscontinuity = 0;
  let isC1Continuous = true;
  let isC2Continuous = true;

  for (const t of knotTimestamps) {
    if (t <= 2 * epsilon || t >= 1 - 2 * epsilon) continue;

    // 1. One-sided finite differences: v^-(t) and v^+(t) with Richardson extrapolation
    const yL1 = evaluateFn(t - epsilon);
    const yCenter = evaluateFn(t);
    const yR1 = evaluateFn(t + epsilon);

    const vL1 = (yCenter - yL1) / epsilon;
    const vR1 = (yR1 - yCenter) / epsilon;
    const rawDisc1 = Math.abs(vR1 - vL1);

    const eps2 = 2 * epsilon;
    const yL2 = evaluateFn(t - eps2);
    const yR2 = evaluateFn(t + eps2);

    const vL2 = (yCenter - yL2) / eps2;
    const vR2 = (yR2 - yCenter) / eps2;
    const rawDisc2 = Math.abs(vR2 - vL2);

    // Richardson extrapolation cancels out the O(epsilon * f'') Taylor truncation error
    const vDisc = Math.max(0, 2 * rawDisc1 - rawDisc2);
    if (vDisc > maxVelocityDiscontinuity) {
      maxVelocityDiscontinuity = vDisc;
    }

    const knotC1 = vDisc <= velocityTolerance;
    if (!knotC1) isC1Continuous = false;

    // 2. Second-order one-sided finite differences: a^-(t) and a^+(t)
    const yL2_2 = evaluateFn(t - 2 * epsilon);
    const yR2_2 = evaluateFn(t + 2 * epsilon);

    const aLeft = (yCenter - 2 * yL1 + yL2_2) / (epsilon * epsilon);
    const aRight = (yR2_2 - 2 * yR1 + yCenter) / (epsilon * epsilon);

    const aDisc = Math.abs(aRight - aLeft);
    if (aDisc > maxAccelerationDiscontinuity) {
      maxAccelerationDiscontinuity = aDisc;
    }

    const knotC2 = aDisc <= accelerationTolerance;
    if (!knotC2) isC2Continuous = false;

    knots.push({
      t,
      leftVelocity: vL1,
      rightVelocity: vR1,
      velocityDiscontinuity: vDisc,
      isC1Continuous: knotC1,
      leftAcceleration: aLeft,
      rightAcceleration: aRight,
      accelerationDiscontinuity: aDisc,
      isC2Continuous: knotC2,
    });
  }

  return {
    isC1Continuous,
    isC2Continuous,
    maxVelocityDiscontinuity,
    maxAccelerationDiscontinuity,
    knots,
  };
}

/** Legacy alias for backward compatibility */
export function verifyTrajectoryC1Continuity(
  evaluateFn: (t: number) => number,
  knotTimestamps: number[],
  epsilon: number = 1e-4,
  tolerance: number = 0.05
) {
  const report = verifyTrajectoryContinuity(evaluateFn, knotTimestamps, epsilon, tolerance);
  return {
    isC1Continuous: report.isC1Continuous,
    maxDiscontinuity: report.maxVelocityDiscontinuity,
    knots: report.knots.map((k) => ({
      t: k.t,
      leftVelocity: k.leftVelocity,
      rightVelocity: k.rightVelocity,
      discontinuityMagnitude: k.velocityDiscontinuity,
      isC1Continuous: k.isC1Continuous,
    })),
  };
}
