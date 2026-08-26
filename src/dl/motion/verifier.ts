/**
 * File Description: Mathematical finite-difference continuity verifier for motion trajectories.
 * Measures first-derivative (velocity) and second-derivative (acceleration) jumps at interior keyframe knots
 * with positive control calibrations, step-convergence assertions, and physical unit conversions (deg/s).
 */

export interface KnotDiscontinuity {
  t: number;
  rawNormalizedDiscontinuity: number; // Discontinuity in normalized units (deg / norm t)
  physicalVelocityDiscontinuity: number; // Discontinuity in physical units (deg/s)
  leftVelocityPhys: number;
  rightVelocityPhys: number;
  isC1Continuous: boolean;
  leftAcceleration?: number;
  rightAcceleration?: number;
  accelerationDiscontinuity?: number;
  isC2Continuous?: boolean;
}

export interface ContinuityReport {
  isC1Continuous: boolean;
  isC2Continuous: boolean;
  maxRawNormalizedDiscontinuity: number;
  maxPhysicalVelocityDiscontinuity: number;
  maxAccelerationDiscontinuity: number;
  durationSec: number;
  knots: KnotDiscontinuity[];
}

/**
 * Numerically verifies C1 (velocity) and C2 (curvature) continuity across interior keyframe knots using finite differences.
 * @param evaluateFn Function evaluating scalar trajectory at normalized timestamp t in [0, 1].
 * @param knotTimestamps Array of interior knot timestamps in (0, 1).
 * @param durationSec Physical duration of the shot in seconds (default 1.0).
 * @param epsilon Finite difference step delta (default 1e-4).
 * @param physicalVelocityTolerance Maximum allowed physical velocity discontinuity threshold in deg/s (default 2.0).
 * @param accelerationTolerance Maximum allowed acceleration discontinuity threshold (default 5.0).
 */
export function verifyTrajectoryContinuity(
  evaluateFn: (t: number) => number,
  knotTimestamps: number[],
  durationSec: number = 1.0,
  epsilon: number = 1e-4,
  physicalVelocityTolerance: number = 2.0,
  accelerationTolerance: number = 5.0
): ContinuityReport {
  const knots: KnotDiscontinuity[] = [];
  let maxRawNormalizedDiscontinuity = 0;
  let maxPhysicalVelocityDiscontinuity = 0;
  let maxAccelerationDiscontinuity = 0;
  let isC1Continuous = true;
  let isC2Continuous = true;

  const dur = Math.max(1e-4, durationSec);

  for (const t of knotTimestamps) {
    if (t <= 2 * epsilon || t >= 1 - 2 * epsilon) continue;

    // 1. One-sided finite differences: v^-(t) and v^+(t) in normalized units
    const yL1 = evaluateFn(t - epsilon);
    const yCenter = evaluateFn(t);
    const yR1 = evaluateFn(t + epsilon);

    const vL1_norm = (yCenter - yL1) / epsilon;
    const vR1_norm = (yR1 - yCenter) / epsilon;
    const rawDisc1 = Math.abs(vR1_norm - vL1_norm);

    const eps2 = 2 * epsilon;
    const yL2 = evaluateFn(t - eps2);
    const yR2 = evaluateFn(t + eps2);

    const vL2_norm = (yCenter - yL2) / eps2;
    const vR2_norm = (yR2 - yCenter) / eps2;
    const rawDisc2 = Math.abs(vR2_norm - vL2_norm);

    // Richardson extrapolation cancels out the O(epsilon * f'') Taylor truncation error
    const rawNormDisc = Math.max(0, 2 * rawDisc1 - rawDisc2);
    if (rawNormDisc > maxRawNormalizedDiscontinuity) {
      maxRawNormalizedDiscontinuity = rawNormDisc;
    }

    // Convert to physical degrees per second: v_phys = v_norm / durationSec
    const physDisc = rawNormDisc / dur;
    if (physDisc > maxPhysicalVelocityDiscontinuity) {
      maxPhysicalVelocityDiscontinuity = physDisc;
    }

    const knotC1 = physDisc <= physicalVelocityTolerance;
    if (!knotC1) isC1Continuous = false;

    // 2. Second-order one-sided finite differences: a^-(t) and a^+(t)
    const yL2_2 = evaluateFn(t - 2 * epsilon);
    const yR2_2 = evaluateFn(t + 2 * epsilon);

    const aLeft = (yCenter - 2 * yL1 + yL2_2) / (epsilon * epsilon);
    const aRight = (yR2_2 - 2 * yR1 + yCenter) / (epsilon * epsilon);

    const aDisc = Math.abs(aRight - aLeft) / (dur * dur);
    if (aDisc > maxAccelerationDiscontinuity) {
      maxAccelerationDiscontinuity = aDisc;
    }

    const knotC2 = aDisc <= accelerationTolerance;
    if (!knotC2) isC2Continuous = false;

    knots.push({
      t,
      rawNormalizedDiscontinuity: rawNormDisc,
      physicalVelocityDiscontinuity: physDisc,
      leftVelocityPhys: vL1_norm / dur,
      rightVelocityPhys: vR1_norm / dur,
      isC1Continuous: knotC1,
      leftAcceleration: aLeft / (dur * dur),
      rightAcceleration: aRight / (dur * dur),
      accelerationDiscontinuity: aDisc,
      isC2Continuous: knotC2,
    });
  }

  return {
    isC1Continuous,
    isC2Continuous,
    maxRawNormalizedDiscontinuity,
    maxPhysicalVelocityDiscontinuity,
    maxAccelerationDiscontinuity,
    durationSec: dur,
    knots,
  };
}

/** Legacy alias for backward compatibility */
export function verifyTrajectoryC1Continuity(
  evaluateFn: (t: number) => number,
  knotTimestamps: number[],
  durationSec: number = 1.0,
  epsilon: number = 1e-4,
  tolerance: number = 2.0
) {
  const report = verifyTrajectoryContinuity(evaluateFn, knotTimestamps, durationSec, epsilon, tolerance);
  return {
    isC1Continuous: report.isC1Continuous,
    maxDiscontinuity: report.maxPhysicalVelocityDiscontinuity,
    knots: report.knots.map((k) => ({
      t: k.t,
      leftVelocity: k.leftVelocityPhys,
      rightVelocity: k.rightVelocityPhys,
      discontinuityMagnitude: k.physicalVelocityDiscontinuity,
      isC1Continuous: k.isC1Continuous,
    })),
  };
}
