/**
 * File Description: Damped Harmonic Oscillator Engine for Secondary Motion (Phase 7).
 * Implements physically integrated spring-damper dynamics (x'' = -k(x - target) - c*x')
 * strictly on designated secondary joints (antenna, hair, cloth, badge), leaving primary joints untouched.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINT:
 * Spring-damper output is numerically integrated and history-dependent. It is NOT evaluated
 * by the analytical Catmull-Rom C1 continuity verifier. Continuity verification applies
 * strictly to primary authored skeletal tracks.
 */

import type { CompiledFrame, CompiledScene } from "./compile";

export interface SpringParams {
  stiffness: number; // k (default: 180.0)
  damping: number; // c (default: 15.0)
  mass?: number; // m (default: 1.0)
}

export interface SecondaryJointConfig {
  jointId: string;
  spring: SpringParams;
}

export const DEFAULT_SECONDARY_JOINTS: Record<string, SecondaryJointConfig> = {
  antenna: {
    jointId: "antenna",
    spring: { stiffness: 200.0, damping: 16.0, mass: 1.0 },
  },
  hair: {
    jointId: "hair",
    spring: { stiffness: 150.0, damping: 12.0, mass: 1.0 },
  },
  cloth: {
    jointId: "cloth",
    spring: { stiffness: 120.0, damping: 10.0, mass: 1.0 },
  },
  badge: {
    jointId: "badge",
    spring: { stiffness: 250.0, damping: 20.0, mass: 1.0 },
  },
};

/**
 * Simulates a 1D damped harmonic oscillator across a sequence of target keyframe values.
 * Uses semi-implicit Euler integration at the given FPS.
 * @param targetValues Target values per frame.
 * @param params Spring configuration (stiffness, damping, mass).
 * @param fps Simulation frame rate (default 30).
 * @returns Array of simulated secondary motion values.
 */
export function simulateDampedSpring(
  targetValues: number[],
  params: SpringParams,
  fps: number = 30,
): number[] {
  const dt = 1 / Math.max(1, fps);
  const k = params.stiffness;
  const c = params.damping;
  const m = params.mass || 1.0;

  const count = targetValues.length;
  if (count === 0) return [];

  const output = new Array<number>(count);
  let pos = targetValues[0];
  let vel = 0;

  output[0] = pos;

  for (let f = 1; f < count; f++) {
    const target = targetValues[f];
    // Spring force: F_spring = -k * (x - target)
    const fSpring = -k * (pos - target);
    // Damping force: F_damping = -c * v
    const fDamp = -c * vel;
    // Acceleration: a = (F_spring + F_damping) / m
    const accel = (fSpring + fDamp) / m;

    // Semi-implicit Euler step
    vel += accel * dt;
    pos += vel * dt;

    output[f] = pos;
  }

  return output;
}

/**
 * Post-pass processor that applies secondary spring-damper dynamics to designated secondary joints
 * in a CompiledScene, guaranteeing primary joints remain 100% untouched.
 * @param compiled Compiled scene from Phase 3 compiler.
 * @param secondaryConfigs List of secondary joint configurations.
 * @returns New CompiledScene with secondary motion applied.
 */
export function applySecondaryMotion(
  compiled: CompiledScene,
  secondaryConfigs: SecondaryJointConfig[] = Object.values(DEFAULT_SECONDARY_JOINTS),
): CompiledScene {
  const cloned: CompiledScene = JSON.parse(JSON.stringify(compiled));
  const totalFrames = cloned.frames.length;
  const fps = cloned.fps || 30;

  const secondaryJointIds = new Set(secondaryConfigs.map((c) => c.jointId));

  // Collect actors present in compiled scene
  const actorIds = new Set<string>();
  for (const frame of cloned.frames) {
    for (const ent of frame.entities) {
      if (ent.kind === "actor") actorIds.add(ent.entityId);
    }
  }

  for (const actorId of actorIds) {
    for (const config of secondaryConfigs) {
      const joint = config.jointId;

      // Extract target values across all frames
      const targetValues = new Array<number>(totalFrames);
      let hasJoint = false;

      for (let f = 0; f < totalFrames; f++) {
        const ent = cloned.frames[f].entities.find((e) => e.entityId === actorId);
        if (ent && ent.joints && joint in ent.joints) {
          targetValues[f] = ent.joints[joint];
          hasJoint = true;
        } else {
          targetValues[f] = 0;
        }
      }

      if (!hasJoint) continue;

      // Run physical spring-damper simulation
      const simulated = simulateDampedSpring(targetValues, config.spring, fps);

      // Write back simulated secondary values
      for (let f = 0; f < totalFrames; f++) {
        const ent = cloned.frames[f].entities.find((e) => e.entityId === actorId);
        if (ent && ent.joints) {
          ent.joints[joint] = simulated[f];
        }
      }
    }
  }

  return cloned;
}
