/**
 * File Description: Retargets the receive action across character proportions and enforces the target rig's limits.
 * Inputs and outputs: reference receive, its source rig and a target character rig -> target-rig receive plus warnings, or a named ReceiveRetargetError.
 * Used by: backend/performance/bindReceive.ts (design compile), stage tests and the character property tests.
 */
import { createPerformanceEvaluator, validatePerformance } from "./evaluate";
import { limbBones, limbRange } from "./limits";
import { add, distance, inverse, rotate, scale, sub } from "./math";
import type { CharacterRig, PerformanceRig, PerformanceState, ReceiveAction, Transform, Vec3, VectorTrack } from "./types";

/** What to do when the target rig cannot perform the action within its limits. */
export type ReachPolicy = "fail" | "clamp";
export interface RetargetWarning {
  kind: "reach" | "bend" | "rotation";
  /** Spec field whose limit was applied. */
  field: string;
  message: string;
}
/** A retarget that the target rig cannot honour; `field` names the spec field to change. */
export class ReceiveRetargetError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ReceiveRetargetError";
    this.field = field;
  }
}

const EPSILON = 1e-9;
const CLAMP_MARGIN = 1e-4;
const CLAMP_ITERATIONS = 40;

// Converts a world point into the action root space of the given root transform.
const toRoot = (root: Transform, p: Vec3): Vec3 => rotate(sub(p, root.position), inverse(root.rotation));
// Reads one joint's bind offset.
const offsetOf = (rig: PerformanceRig, id: string): Vec3 => {
  const joint = rig.joints.find((j) => j.id === id);
  if (!joint) throw new ReceiveRetargetError("skeleton", `rig ${rig.id} has no joint ${id}`);
  return joint.offset;
};
// Measures one limb's two bone lengths, naming the missing limb as a retarget error.
const bones = (rig: PerformanceRig, limb: string): { upper: number; lower: number } => {
  if (!rig.limbs[limb]) throw new ReceiveRetargetError("skeleton", `rig ${rig.id} has no ${limb} limb`);
  return limbBones(rig, limb);
};
// Sums one limb's chain length.
const chain = (rig: PerformanceRig, limb: string): number => bones(rig, limb).upper + bones(rig, limb).lower;
// Returns rest-pose joint positions relative to the rig root.
function rest(rig: PerformanceRig): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const j of rig.joints) out[j.id] = add(j.parent === null ? [0, 0, 0] : out[j.parent], j.offset);
  return out;
}
// Reports whether two rigs share every joint, offset and contact socket the receive reads.
function sameRig(a: CharacterRig, b: CharacterRig): boolean {
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  return same(a.joints, b.joints) && same(a.limbs, b.limbs) && same(a.sockets.gripR, b.sockets.gripR) && same(a.sockets.soleL, b.sockets.soleL) && same(a.sockets.soleR, b.sockets.soleR);
}
// Lists the integer frames plus every key frame of a track that a limit must hold at.
function checkFrames(action: ReceiveAction, track: VectorTrack): number[] {
  const frames = new Set<number>(track.map((k) => k.frame));
  for (let f = Math.ceil(action.fromFrame); f <= action.holdFromFrame; f++) frames.add(f);
  return [...frames].filter((f) => f >= action.fromFrame && f <= action.holdFromFrame).sort((a, b) => a - b);
}

// Retargets the receive's body, plant and grip channels from the source proportions to the target's.
function retargetProportions(reference: ReceiveAction, source: CharacterRig, target: CharacterRig): ReceiveAction {
  const action: ReceiveAction = { ...structuredClone(reference), rigId: target.id };
  const restT = rest(target);
  const kLeg = (chain(target, "legL") + chain(target, "legR")) / (chain(source, "legL") + chain(source, "legR"));
  const hipsS = offsetOf(source, "hips"), hipsT = offsetOf(target, "hips");
  const positions: Record<string, VectorTrack> = {};
  for (const [id, track] of Object.entries(reference.positions)) {
    if (id !== "hips") throw new ReceiveRetargetError(`positions.${id}`, "only the hips translation retargets across proportions");
    // The crouch and sway scale with leg length so knees bend through the same angles.
    positions[id] = track.map((k) => ({ frame: k.frame, value: add(hipsT, scale(sub(k.value, hipsS), kLeg)) }));
  }
  action.positions = positions;
  action.contact = { ...action.contact, joint: target.sockets.gripR.joint, gripOffset: [...target.sockets.gripR.offset] as Vec3 };
  action.constraints = reference.constraints.map((c) => {
    if (!c.planted) return structuredClone(c);
    const ankle = target.limbs[c.limb].tip, side = ankle.endsWith("L") ? "soleL" : "soleR";
    // A planted foot stands where the target's rest stance puts it, with its sole socket on the ground.
    return { ...structuredClone(c), target: [{ frame: c.target[0].frame, value: [restT[ankle][0], -target.sockets[side].offset[1], restT[ankle][2]] as Vec3 }] };
  });
  const sourceAt = createPerformanceEvaluator(source, reference);
  const provisionalAt = createPerformanceEvaluator(target, action);
  action.constraints = action.constraints.map((c) => {
    if (c.planted) return c;
    const base = target.limbs[c.limb].base;
    const k = chain(target, c.limb) / chain(source, c.limb);
    // Grip targets keep their offset from the moving shoulder, scaled to the target arm's reach.
    const target_ = c.target.map((key) => {
      const s = sourceAt(key.frame), t = provisionalAt(key.frame);
      const shoulderS = toRoot(s.root, s.joints[source.limbs[c.limb].base].position), shoulderT = toRoot(t.root, t.joints[base].position);
      return { frame: key.frame, value: add(shoulderT, scale(sub(key.value, shoulderS), k)) };
    });
    return { ...c, target: target_ };
  });
  // The glider keeps its flight shape and arrives at the target's own contact grip.
  const shift = sub(createPerformanceEvaluator(target, action)(action.contact.frame).prop.position, sourceAt(reference.contact.frame).prop.position);
  action.contact = { ...action.contact, flight: [add(action.contact.flight[0], shift), add(action.contact.flight[1], shift)] };
  return action;
}

// Clamps or rejects directly rotated joints outside the target's Euler limits.
function enforceRotations(action: ReceiveAction, rig: CharacterRig, policy: ReachPolicy, warnings: RetargetWarning[]): void {
  const tracks: Array<[string, VectorTrack, (next: VectorTrack) => void]> = [
    ...Object.entries(action.rotations).map(([id, track]): [string, VectorTrack, (next: VectorTrack) => void] => [id, track, (next) => { (action.rotations as Record<string, VectorTrack>)[id] = next; }]),
    ...action.constraints.flatMap((c, i): Array<[string, VectorTrack, (next: VectorTrack) => void]> => c.tipRotation ? [[rig.limbs[c.limb].tip, c.tipRotation, (next) => { action.constraints = action.constraints.map((x, j) => (j === i ? { ...x, tipRotation: next } : x)); }]] : []),
  ];
  for (const [joint, track, write] of tracks) {
    const limit = rig.limits.rotation[joint];
    if (!limit) continue;
    let excess = 0;
    const next = track.map((key) => ({ frame: key.frame, value: key.value.map((v, axis) => {
      const clamped = Math.min(limit.max[axis], Math.max(limit.min[axis], v));
      if (Math.abs(clamped - v) > EPSILON) {
        if (policy === "fail") throw new ReceiveRetargetError(`limits.rotation.${joint}`, `the receive turns ${joint} to ${v.toFixed(3)} rad about ${"xyz"[axis]} at frame ${key.frame.toFixed(1)}, outside the allowed [${limit.min[axis]}, ${limit.max[axis]}]`);
        excess = Math.max(excess, Math.abs(clamped - v));
      }
      return clamped;
    }) as unknown as Vec3 }));
    if (excess > 0) {
      write(next);
      warnings.push({ kind: "rotation", field: `limits.rotation.${joint}`, message: `${joint} rotation clamped by up to ${excess.toFixed(3)} rad to stay inside its limits` });
    }
  }
}

// Measures one IK limb's distance from its base to its target at a frame.
const limbDistance = (state: PerformanceState, rig: CharacterRig, limb: string): number => distance(state.joints[rig.limbs[limb].base].position, state.targets[limb]);

// Keeps every IK limb inside its reach and hinge range, pulling sparse grip keys in (clamp) or failing with the limb and frame.
function enforceReach(action: ReceiveAction, rig: CharacterRig, policy: ReachPolicy, warnings: RetargetWarning[]): ReceiveAction {
  let current = action;
  const moved = new Map<string, { amount: number; first: number; last: number; kind: "reach" | "bend" }>();
  for (let iteration = 0; iteration <= CLAMP_ITERATIONS; iteration++) {
    const evaluate = createPerformanceEvaluator(rig, current);
    let violated = false;
    const nextConstraints = current.constraints.map((c) => {
      const range = limbRange(rig, c.limb);
      const ratios: Array<{ frame: number; ratio: number }> = [];
      for (const frame of checkFrames(current, c.target)) {
        const d = limbDistance(evaluate(frame), rig, c.limb);
        if (d <= range.max + EPSILON && d >= range.min - EPSILON) continue;
        const kind = d > range.max && range.max >= range.reachMax - EPSILON ? "reach" : "bend";
        const field = kind === "reach" ? "limits.reach" : `limits.bend.${c.limb.startsWith("arm") ? "arm" : "leg"}`;
        if (policy === "fail" || c.planted || iteration === CLAMP_ITERATIONS) {
          const why = iteration === CLAMP_ITERATIONS ? " and clamping did not converge" : c.planted ? "; a planted foot cannot move, so change the proportions or the action" : "";
          throw new ReceiveRetargetError(field, `${c.limb} needs ${d.toFixed(4)} rig units from ${rig.limbs[c.limb].base} to its target at frame ${frame.toFixed(1)}, outside the allowed ${range.min.toFixed(4)} to ${range.max.toFixed(4)}${why}`);
        }
        const goal = d > range.max ? range.max * (1 - CLAMP_MARGIN) : range.min * (1 + CLAMP_MARGIN);
        ratios.push({ frame, ratio: goal / d });
        const entry = moved.get(c.limb) ?? { amount: 0, first: frame, last: frame, kind };
        moved.set(c.limb, { amount: Math.max(entry.amount, Math.abs(d - goal)), first: Math.min(entry.first, frame), last: Math.max(entry.last, frame), kind: entry.kind });
      }
      if (!ratios.length) return c;
      violated = true;
      // Each sparse key absorbs the strongest correction among frames it influences, so motion stays smooth.
      const target = c.target.map((key, i) => {
        const lo = i > 0 ? c.target[i - 1].frame : -Infinity, hi = i + 1 < c.target.length ? c.target[i + 1].frame : Infinity;
        const near = ratios.filter((r) => r.frame > lo && r.frame < hi);
        if (!near.length) return key;
        const ratio = near.reduce((best, r) => (Math.abs(Math.log(r.ratio)) > Math.abs(Math.log(best)) ? r.ratio : best), 1);
        const state = evaluate(key.frame), shoulder = toRoot(state.root, state.joints[rig.limbs[c.limb].base].position);
        return { frame: key.frame, value: add(shoulder, scale(sub(key.value, shoulder), ratio)) };
      });
      return { ...c, target };
    });
    if (!violated) break;
    current = { ...current, constraints: nextConstraints };
  }
  for (const [limb, m] of moved) warnings.push({ kind: m.kind, field: m.kind === "reach" ? "limits.reach" : `limits.bend.${limb.startsWith("arm") ? "arm" : "leg"}`, message: `${limb} target clamped by up to ${m.amount.toFixed(4)} rig units between frames ${m.first.toFixed(0)} and ${m.last.toFixed(0)} to stay within the character's limits` });
  return current;
}

/**
 * Retargets a receive authored on `source` onto `target`, adds the authored root-space grip offset,
 * and enforces the target's reach, hinge and rotation limits. Retargeting onto the source rig itself
 * returns the reference unchanged. Under "fail" a limit violation throws ReceiveRetargetError naming
 * the field, limb and frame; under "clamp" sparse keys are edited (never per frame) and reported.
 */
export function retargetReceive(
  reference: ReceiveAction,
  source: CharacterRig,
  target: CharacterRig,
  options: { targetOffset?: Vec3; policy?: ReachPolicy } = {},
): { action: ReceiveAction; warnings: RetargetWarning[] } {
  const policy = options.policy ?? "fail";
  validatePerformance(source, reference);
  for (const limb of ["armL", "armR", "legL", "legR"]) if (!target.limbs[limb]) throw new ReceiveRetargetError("skeleton", `the receive needs a ${limb} limb`);
  if (target.sockets.gripR.joint !== target.limbs.armR.tip) throw new ReceiveRetargetError("sockets.gripR.joint", `the receive grips with ${target.limbs.armR.tip}`);
  const offset = options.targetOffset ?? [0, 0, 0];
  if (!offset.every(Number.isFinite)) throw new ReceiveRetargetError("targetOffset", "needs three finite numbers");
  let action = sameRig(source, target) ? { ...structuredClone(reference), rigId: target.id } : retargetProportions(reference, source, target);
  const grip = action.constraints.findIndex((c) => !c.planted && target.limbs[c.limb]?.tip === action.contact.joint);
  if (grip < 0) throw new ReceiveRetargetError("constraints", "the receive has no grip constraint for its contact joint");
  action = { ...action, constraints: action.constraints.map((c, i) => (i === grip ? { ...c, target: c.target.map((k) => ({ ...k, value: add(k.value, offset) })) } : c)) };
  const warnings: RetargetWarning[] = [];
  enforceRotations(action, target, policy, warnings);
  action = enforceReach(action, target, policy, warnings);
  validatePerformance(target, action);
  return { action, warnings };
}
