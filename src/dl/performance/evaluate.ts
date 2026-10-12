/**
 * File Description: Absolute-frame receive evaluation with rigid limbs, planted feet and prop attachment.
 * Inputs and outputs: validated rig and sparse action -> order-independent pose/contact evaluator.
 * Used by: numerical critique, receive tests and isolated Iona fixture preview.
 */
import {
  add,
  between,
  distance,
  euler,
  inverse,
  length,
  multiply,
  point,
  rotate,
  sample,
  scale,
  slerp,
  solveTwoBone,
  sub,
} from "./math";
import type {
  ExpressionBlend,
  PerformanceEvaluator,
  PerformanceRig,
  PerformanceState,
  ReceiveAction,
  Transform,
  Vec3,
  VectorTrack,
} from "./types";

// Rejects invalid vectors before they can contaminate a pose.
function checkVector(value: readonly number[], size: number): void {
  if (value.length !== size || !value.every(Number.isFinite))
    throw new Error(`Expected a finite ${size}-component vector.`);
}
// Validates ordered sparse tracks and their finite coordinates.
function checkTrack(track: VectorTrack): void {
  if (!track.length) throw new Error("An action track cannot be empty.");
  let previous = -Infinity;
  for (const key of track) {
    checkVector(key.value, 3);
    if (!Number.isFinite(key.frame) || key.frame <= previous)
      throw new Error("Track frames must be finite and strictly increasing.");
    previous = key.frame;
  }
}
// Validates the supported rig topology and receive obligations before preparing an evaluator.
export function validatePerformance(
  rig: PerformanceRig,
  action: ReceiveAction,
): void {
  if (rig.id !== action.rigId)
    throw new Error(`Action requires rig ${action.rigId}, received ${rig.id}.`);
  const ids = new Set<string>();
  for (const joint of rig.joints) {
    checkVector(joint.offset, 3);
    if (
      !joint.id ||
      ids.has(joint.id) ||
      (joint.parent !== null && !ids.has(joint.parent))
    )
      throw new Error(
        "Rig joints must be unique and ordered parent before child.",
      );
    ids.add(joint.id);
  }
  if (!ids.size) throw new Error("Rig has no joints.");
  const byId = new Map(rig.joints.map((j) => [j.id, j]));
  for (const limb of Object.values(rig.limbs)) {
    if (
      !ids.has(limb.base) ||
      byId.get(limb.middle)?.parent !== limb.base ||
      byId.get(limb.tip)?.parent !== limb.middle ||
      length(byId.get(limb.middle)!.offset) <= 0 ||
      length(byId.get(limb.tip)!.offset) <= 0
    )
      throw new Error("A limb must name a connected nonzero two-bone chain.");
  }
  if (
    !Number.isFinite(action.fps) ||
    action.fps <= 0 ||
    !Number.isFinite(action.fromFrame) ||
    !Number.isFinite(action.toFrame) ||
    action.toFrame <= action.fromFrame
  )
    throw new Error("Invalid action frame span or fps.");
  const phases = [
    "setup",
    "anticipation",
    "intercept",
    "contact",
    "recoil",
    "settle",
  ];
  if (
    action.anchors.length !== phases.length ||
    action.anchors.some(
      (anchor, i) =>
        anchor.phase !== phases[i] ||
        !Number.isFinite(anchor.frame) ||
        anchor.frame < action.fromFrame ||
        anchor.frame >= action.toFrame ||
        (i > 0 && anchor.frame <= action.anchors[i - 1].frame),
    ) ||
    action.anchors[0].frame !== action.fromFrame ||
    action.anchors[3].frame !== action.contact.frame ||
    !Number.isInteger(action.contact.frame) ||
    action.holdFromFrame !== action.anchors[5].frame
  )
    throw new Error(
      "Receive needs six ordered phases, cue-bound contact and a settled hold.",
    );
  for (const [id, track] of [
    ...Object.entries(action.positions),
    ...Object.entries(action.rotations),
  ]) {
    if (!ids.has(id)) throw new Error(`Unknown driven joint ${id}.`);
    checkTrack(track);
  }
  checkTrack(action.root.position);
  checkTrack(action.root.rotation);
  for (const track of Object.values(action.secondary)) checkTrack(track);
  if (
    !action.expressions.length ||
    action.expressions.some(
      (k, i) =>
        !Number.isFinite(k.frame) ||
        !["neutral", "surprised", "determined", "relieved"].includes(k.name) ||
        (i > 0 && k.frame <= action.expressions[i - 1].frame),
    )
  )
    throw new Error(
      "Expressions need ordered finite frames and supported names.",
    );
  const driven = new Set<string>();
  for (const c of action.constraints) {
    const limb = rig.limbs[c.limb];
    if (
      !limb ||
      [limb.base, limb.middle, limb.tip].some((id) => driven.has(id))
    )
      throw new Error("Constraints must name separate valid limbs.");
    [limb.base, limb.middle, limb.tip].forEach((id) => driven.add(id));
    if (action.positions[limb.middle] || action.positions[limb.tip])
      throw new Error(
        "A constrained bone cannot override its bind translation.",
      );
    checkTrack(c.target);
    checkTrack(c.pole);
    if (c.tipRotation) checkTrack(c.tipRotation);
    if (
      c.planted &&
      c.target.some((k) => distance(k.value, c.target[0].value) > 1e-12)
    )
      throw new Error("A planted foot needs one fixed target.");
  }
  if (
    !ids.has(action.contact.joint) ||
    !action.constraints.some(
      (c) => rig.limbs[c.limb].tip === action.contact.joint && !c.planted,
    )
  )
    throw new Error("Contact must attach to a constrained grip joint.");
  checkVector(action.contact.gripOffset, 3);
  checkVector(action.contact.propOffset, 3);
  checkVector(action.contact.propRotation, 4);
  checkVector(action.contact.flightRotation, 4);
  if (
    Math.abs(Math.hypot(...action.contact.propRotation) - 1) > 1e-8 ||
    Math.abs(Math.hypot(...action.contact.flightRotation) - 1) > 1e-8 ||
    !Number.isFinite(action.contact.propScale) ||
    action.contact.propScale <= 0
  )
    throw new Error("Prop requires unit rotations and positive scale.");
  action.contact.flight.forEach((v) => checkVector(v, 3));
}

// Rebuilds the hierarchy and solves every constraint without reading any earlier frame.
function poseAt(
  rig: PerformanceRig,
  action: ReceiveAction,
  frame: number,
): Pick<
  PerformanceState,
  "root" | "joints" | "local" | "targets" | "secondary"
> {
  const root: Transform = {
    position: sample(action.root.position, frame),
    rotation: euler(sample(action.root.rotation, frame)),
  };
  const local: Record<string, Transform> = {},
    joints: Record<string, Transform> = {},
    targets: Record<string, Vec3> = {};
  for (const j of rig.joints)
    local[j.id] = {
      position: action.positions[j.id]
        ? sample(action.positions[j.id], frame)
        : [...j.offset],
      rotation: action.rotations[j.id]
        ? euler(sample(action.rotations[j.id], frame))
        : [0, 0, 0, 1],
    };
  // Recomputes world transforms after a solved limb changes its local rotations.
  const update = (): void => {
    for (const j of rig.joints) {
      const parent = j.parent === null ? root : joints[j.parent];
      joints[j.id] = {
        position: point(parent, local[j.id].position),
        rotation: multiply(parent.rotation, local[j.id].rotation),
      };
    }
  };
  update();
  const definitions = new Map(rig.joints.map((j) => [j.id, j]));
  for (const c of action.constraints) {
    const limb = rig.limbs[c.limb],
      a = definitions.get(limb.base)!,
      b = definitions.get(limb.middle)!,
      tip = definitions.get(limb.tip)!;
    // Plant targets stay in world space even when the action root moves.
    const plantRoot: Transform = {
      position: sample(action.root.position, action.fromFrame),
      rotation: euler(sample(action.root.rotation, action.fromFrame)),
    };
    const target = point(c.planted ? plantRoot : root, sample(c.target, frame));
    targets[c.limb] = target;
    const base = joints[limb.base].position,
      solved = solveTwoBone(
        base,
        target,
        rotate(sample(c.pole, frame), root.rotation),
        length(b.offset),
        length(tip.offset),
      );
    const parent = a.parent === null ? root : joints[a.parent];
    local[limb.base].rotation = between(
      b.offset,
      rotate(sub(solved.middle, base), inverse(parent.rotation)),
    );
    const baseRotation = multiply(parent.rotation, local[limb.base].rotation);
    local[limb.middle].rotation = between(
      tip.offset,
      rotate(sub(solved.tip, solved.middle), inverse(baseRotation)),
    );
    const middleRotation = multiply(baseRotation, local[limb.middle].rotation);
    local[limb.tip].rotation = c.tipRotation
      ? euler(sample(c.tipRotation, frame))
      : multiply(
          inverse(middleRotation),
          c.planted ? plantRoot.rotation : root.rotation,
        );
    update();
  }
  return {
    root,
    local,
    joints,
    targets,
    secondary: Object.fromEntries(
      Object.entries(action.secondary).map(([id, track]) => [
        id,
        sample(track, frame),
      ]),
    ),
  };
}

// Samples the approved expression blends using the same absolute action frames as the pose.
function expressionAt(action: ReceiveAction, frame: number): ExpressionBlend {
  const keys = action.expressions;
  if (frame <= keys[0].frame) return { a: keys[0].name, b: keys[0].name, t: 0 };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i];
    if (frame < b.frame) {
      const u = (frame - a.frame) / (b.frame - a.frame);
      return { a: a.name, b: b.name, t: u * u * (3 - 2 * u) };
    }
  }
  return { a: keys[keys.length - 1].name, b: keys[keys.length - 1].name, t: 0 };
}

// Prepares immutable action data and contact attachment, then returns a pure absolute-frame evaluator.
export function createPerformanceEvaluator(
  inputRig: PerformanceRig,
  inputAction: ReceiveAction,
): PerformanceEvaluator {
  const rig = structuredClone(inputRig),
    action = structuredClone(inputAction);
  validatePerformance(rig, action);
  const contactPose = poseAt(rig, action, action.contact.frame),
    wrist = contactPose.joints[action.contact.joint];
  const grip = point(wrist, action.contact.gripOffset),
    rotation = action.contact.propRotation;
  const contactProp: Transform = {
    position: sub(
      grip,
      rotate(
        scale(action.contact.propOffset, action.contact.propScale),
        rotation,
      ),
    ),
    rotation,
  };
  const attachment: Transform = {
    position: rotate(
      sub(contactProp.position, wrist.position),
      inverse(wrist.rotation),
    ),
    rotation: multiply(inverse(wrist.rotation), rotation),
  };
  // Evaluates one clamped frame, including flight or exact wrist-relative attachment.
  return (absoluteFrame: number): PerformanceState => {
    if (!Number.isFinite(absoluteFrame))
      throw new Error("Performance frame must be finite.");
    const frame = Math.max(
        action.fromFrame,
        Math.min(action.toFrame, absoluteFrame),
      ),
      poseFrame = Math.min(frame, action.holdFromFrame),
      pose = poseAt(rig, action, poseFrame);
    const hand = pose.joints[action.contact.joint];
    let prop: Transform;
    if (frame >= action.contact.frame)
      prop = {
        position: point(hand, attachment.position),
        rotation: multiply(hand.rotation, attachment.rotation),
      };
    else {
      const u =
          (frame - action.fromFrame) /
          (action.contact.frame - action.fromFrame),
        e = 1 - (1 - u) ** 2,
        m = 1 - e;
      const [p0, p1] = action.contact.flight,
        p2 = add(contactProp.position, [-1.1, 0.75, 0]);
      const flight = add(
        add(scale(p0, m ** 3), scale(p1, 3 * m * m * e)),
        add(scale(p2, 3 * m * e * e), scale(contactProp.position, e ** 3)),
      );
      prop = {
        position: add(flight, [
          0,
          0.12 * Math.sin(2 * Math.PI * u) * (1 - u),
          0,
        ]),
        rotation: multiply(
          slerp(action.contact.flightRotation, rotation, e),
          euler([-0.3 * Math.sin(Math.PI * u) * u * (1 - u), 0, 0]),
        ),
      };
    }
    let phase = action.anchors[0].phase;
    for (const anchor of action.anchors)
      if (frame >= anchor.frame) phase = anchor.phase;
    return {
      frame,
      phase,
      ...pose,
      expression: expressionAt(action, poseFrame),
      prop: { ...prop, scale: action.contact.propScale },
      contact: {
        mode: frame >= action.contact.frame ? "attached" : "airborne",
        point: point(hand, action.contact.gripOffset),
        propPoint: point(
          prop,
          scale(action.contact.propOffset, action.contact.propScale),
        ),
      },
    };
  };
}
