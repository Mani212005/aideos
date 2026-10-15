/**
 * File Description: Numerical performance obligations, measured independently from the solved targets.
 * Inputs and outputs: rig, action, expected cue and evaluator -> measured checks with explicit failures.
 * Used by: receive regression fixtures, character rigs and npm run performance:check; no image-quality claim.
 */
import { limbRange, rotationExcess } from "./limits";
import { distance, dot, euler, length, point, rotate, sample, scale, sub } from "./math";
import type {
  PerformanceEvaluator,
  PerformanceRig,
  PerformanceState,
  Quat,
  ReceiveAction,
  Vec3,
} from "./types";

export interface PerformanceCheck {
  id: string;
  passed: boolean;
  measured: number;
  limit: number;
  unit: string;
}
export interface PerformanceCritique {
  passed: boolean;
  samples: number;
  checks: PerformanceCheck[];
  visualQuality: "unmeasured";
}

/** Smallest sine of the angle between a limb's pole and its base-to-target axis (about 7 degrees). */
export const POLE_CLEARANCE = 0.12;

// Measures the shortest rotation angle between two orientations.
function angle(a: Quat, b: Quat): number {
  const dot = Math.abs(a.reduce((n, v, i) => n + v * b[i], 0));
  return 2 * Math.acos(Math.max(-1, Math.min(1, dot)));
}
// Lists root, joints and prop transforms for continuity checks.
function transforms(s: PerformanceState) {
  return [s.root, ...Object.values(s.joints), s.prop];
}
// Measures rotational velocity in quaternion tangent space with sign-aligned coordinates.
function rotationalVelocity(
  a: Quat,
  b: Quat,
  reference: Quat,
  seconds: number,
): readonly number[] {
  const signA = a.reduce((n, v, i) => n + v * reference[i], 0) < 0 ? -1 : 1;
  const signB = b.reduce((n, v, i) => n + v * reference[i], 0) < 0 ? -1 : 1;
  return a.map((v, i) => (2 * (signB * b[i] - signA * v)) / seconds);
}
// Measures vector differences without relying on the evaluator's reported errors.
function vectorGap(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(...a.map((v, i) => v - b[i]));
}
// Collects every interpolation seam, including path keys and the contact/hold boundaries.
function seamFrames(action: ReceiveAction): number[] {
  const tracks = [
    action.root.position,
    action.root.rotation,
    ...Object.values(action.positions),
    ...Object.values(action.rotations),
    ...Object.values(action.secondary),
    ...action.constraints.flatMap((c) => [
      c.target,
      c.pole,
      ...(c.tipRotation ? [c.tipRotation] : []),
    ]),
  ];
  return [
    ...new Set([
      action.contact.frame,
      action.holdFromFrame,
      ...action.anchors.map((a) => a.frame),
      ...tracks.flatMap((t) => t.map((k) => k.frame)),
    ]),
  ]
    .filter((f) => f > action.fromFrame && f < action.toFrame)
    .sort((a, b) => a - b);
}
// Checks output transforms and points for invalid numbers before numerical comparisons.
function finiteState(s: PerformanceState, rig: PerformanceRig): boolean {
  return (
    rig.joints.every((j) => Boolean(s.joints[j.id])) &&
    transforms(s).every(
      (t) =>
        t.position.length === 3 &&
        t.rotation.length === 4 &&
        [...t.position, ...t.rotation].every(Number.isFinite) &&
        Math.abs(Math.hypot(...t.rotation) - 1) < 1e-8,
    ) &&
    Number.isFinite(s.prop.scale) &&
    s.prop.scale > 0
  );
}
// Evaluates independent geometry, timing, seam, seek and active-motion checks over an action.
export function critiquePerformance(
  rig: PerformanceRig,
  action: ReceiveAction,
  evaluate: PerformanceEvaluator,
  expectedContactFrame: number,
): PerformanceCritique {
  if (!Number.isInteger(expectedContactFrame))
    throw new Error(
      "Critique requires an independently resolved integer cue frame.",
    );
  const frames = Array.from(
    { length: Math.ceil(action.toFrame - action.fromFrame) + 1 },
    (_, i) => Math.min(action.toFrame, action.fromFrame + i),
  );
  const states = frames.map(evaluate),
    checks: PerformanceCheck[] = [];
  // Records a measured obligation and its published tolerance.
  const check = (
    id: string,
    measured: number,
    limit: number,
    unit: string,
  ): void => {
    checks.push({
      id,
      measured,
      limit,
      unit,
      passed: Number.isFinite(measured) && measured <= limit,
    });
  };
  if (!states.every((s) => finiteState(s, rig))) {
    check("finite-pose", 1, 0, "invalid states");
    return {
      passed: false,
      samples: states.length,
      checks,
      visualQuality: "unmeasured",
    };
  }
  check("finite-pose", 0, 0, "invalid states");
  const joints = new Map(rig.joints.map((j) => [j.id, j]));
  let bone = 0,
    feet = 0,
    grip = 0,
    attachment = 0,
    timing = Math.abs(action.contact.frame - expectedContactFrame);
  const plantRoot = {
    position: sample(action.root.position, action.fromFrame),
    rotation: euler(sample(action.root.rotation, action.fromFrame)),
  };
  for (const s of states) {
    for (const joint of rig.joints) {
      if (joint.parent !== null) {
        const expected = length(joints.get(joint.id)!.offset);
        bone = Math.max(
          bone,
          Math.abs(
            distance(
              s.joints[joint.parent].position,
              s.joints[joint.id].position,
            ) - expected,
          ) / (expected || 1),
        );
      }
    }
    const authoredRoot = {
      position: sample(
        action.root.position,
        Math.min(s.frame, action.holdFromFrame),
      ),
      rotation: euler(
        sample(action.root.rotation, Math.min(s.frame, action.holdFromFrame)),
      ),
    };
    for (const c of action.constraints) {
      const target = point(
        c.planted ? plantRoot : authoredRoot,
        sample(c.target, Math.min(s.frame, action.holdFromFrame)),
      );
      const gap = distance(s.joints[rig.limbs[c.limb].tip].position, target);
      if (c.planted) feet = Math.max(feet, gap);
      else grip = Math.max(grip, gap);
    }
    if (
      s.contact.mode !==
      (s.frame >= expectedContactFrame ? "attached" : "airborne")
    )
      timing = Math.max(timing, 1 + Math.abs(s.frame - expectedContactFrame));
    if (s.contact.mode === "attached") {
      const hand = point(
          s.joints[action.contact.joint],
          action.contact.gripOffset,
        ),
        propGrip = point(
          s.prop,
          scale(action.contact.propOffset, s.prop.scale),
        );
      attachment = Math.max(attachment, distance(hand, propGrip));
    }
  }
  // Explicitly probe both sides of the cue even when it lies between sampled action frames.
  if (
    evaluate(expectedContactFrame - 1e-4).contact.mode !== "airborne" ||
    evaluate(expectedContactFrame).contact.mode !== "attached"
  )
    timing = Math.max(timing, 1);
  check("bone-length", bone, 1e-8, "relative error");
  check("planted-feet", feet, 1e-6, "world units");
  check("grip-path", grip, 1e-6, "world units");
  check("attachment", attachment, 1e-6, "world units");
  check("contact-cue", timing, 0, "frames");
  let poseGap = 0,
    rotationGap = 0,
    velocityGap = 0;
  const epsilon = 1e-4,
    seconds = epsilon / action.fps;
  for (const seam of seamFrames(action)) {
    const left = transforms(evaluate(seam - epsilon)),
      center = transforms(evaluate(seam)),
      right = transforms(evaluate(seam + epsilon));
    for (let i = 0; i < center.length; i++) {
      poseGap = Math.max(
        poseGap,
        distance(left[i].position, right[i].position),
      );
      rotationGap = Math.max(
        rotationGap,
        angle(left[i].rotation, right[i].rotation),
      );
      const before: Vec3 = scale(
          sub(center[i].position, left[i].position),
          1 / seconds,
        ),
        after: Vec3 = scale(
          sub(right[i].position, center[i].position),
          1 / seconds,
        );
      velocityGap = Math.max(
        velocityGap,
        distance(before, after),
        vectorGap(
          rotationalVelocity(
            left[i].rotation,
            center[i].rotation,
            center[i].rotation,
            seconds,
          ),
          rotationalVelocity(
            center[i].rotation,
            right[i].rotation,
            center[i].rotation,
            seconds,
          ),
        ),
      );
    }
  }
  check("pose-seams", poseGap, 1e-3, "world units");
  check("rotation-seams", rotationGap, 1e-3, "radians");
  check("velocity-seams", velocityGap, 0.05, "units or radians per second");
  const reference = new Map(
    frames.map((f, i) => [f, JSON.stringify(states[i])]),
  );
  const reordered = [...frames].reverse().concat(
    frames.filter((_, i) => i % 2 === 0),
    frames.filter((_, i) => i % 2 === 1),
  );
  check(
    "seek-order",
    reordered.reduce(
      (mismatch, f) =>
        mismatch + Number(JSON.stringify(evaluate(f)) !== reference.get(f)),
      0,
    ),
    0,
    "unequal poses",
  );
  let frozen = 0;
  const window = Math.max(2, Math.ceil(action.fps * 0.5));
  for (
    let i = 0;
    i + window < states.length &&
    states[i + window].frame < action.holdFromFrame;
    i++
  ) {
    const first = states[i];
    let motion = 0;
    for (let k = i + 1; k <= i + window; k++) {
      for (const j of rig.joints)
        motion = Math.max(
          motion,
          distance(
            first.joints[j.id].position,
            states[k].joints[j.id].position,
          ),
          angle(first.joints[j.id].rotation, states[k].joints[j.id].rotation),
        );
    }
    if (motion < 1e-4) frozen++;
  }
  check("frozen-pose", frozen, 0, "active half-second windows");
  // A pole nearly parallel to its limb's axis leaves the bend plane undefined, so the elbow or knee
  // can swing round it in a frame or two even though every seam is smooth.
  let clearance = 1;
  for (const s of states) for (const c of action.constraints) {
    const axis = sub(s.targets[c.limb], s.joints[rig.limbs[c.limb].base].position), pole = rotate(sample(c.pole, s.frame), s.root.rotation);
    const along = length(axis) > 1e-9 ? dot(pole, axis) / length(axis) : 0;
    clearance = Math.min(clearance, Math.sqrt(Math.max(0, dot(pole, pole) - along * along)) / length(pole));
  }
  check("pole-clearance", Math.max(0, POLE_CLEARANCE - clearance), 0, `sine short of the ${POLE_CLEARANCE} pole-to-axis minimum`);
  const limits = rig.limits;
  if (limits) {
    // Character rigs also prove every solved limb stayed inside its reach and hinge range.
    let excess = 0;
    for (const [limb, def] of Object.entries(rig.limbs)) {
      const range = limbRange({ ...rig, limits }, limb);
      for (const s of states) {
        const d = distance(s.joints[def.base].position, s.joints[def.tip].position);
        excess = Math.max(excess, d - range.max, range.min - d);
      }
    }
    check("reach-limit", Math.max(0, excess), 1e-9, "rig units");
    check("joint-limits", Math.max(0, rotationExcess({ ...rig, limits }, action)), 1e-12, "radians");
  }
  return {
    passed: checks.every((c) => c.passed),
    samples: states.length,
    checks,
    visualQuality: "unmeasured",
  };
}
