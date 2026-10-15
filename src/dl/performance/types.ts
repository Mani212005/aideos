/**
 * File Description: Renderer-independent contracts for sparse constrained performances.
 * Inputs and outputs: rig and action records -> absolute-frame pose and contact records.
 * Used by: performance evaluator, receive fixture, retargeter, character rigs, numerical critique and preview harness.
 */

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
export interface Transform {
  position: Vec3;
  rotation: Quat;
}
export interface JointDefinition {
  id: string;
  parent: string | null;
  offset: Vec3;
}
export interface LimbDefinition {
  base: string;
  middle: string;
  tip: string;
}
export type Expression = "neutral" | "surprised" | "determined" | "relieved";
export interface ExpressionKey {
  frame: number;
  name: Expression;
}
export interface ExpressionBlend {
  a: Expression;
  b: Expression;
  t: number;
}
export interface PerformanceRig {
  id: string;
  joints: readonly JointDefinition[];
  limbs: Readonly<Record<string, LimbDefinition>>;
  /** Present on character rigs: the critique then also measures reach, bend and rotation limits. */
  limits?: RigLimits;
}
/** A semantic attachment point in one joint's local space. */
export interface Socket {
  joint: string;
  offset: Vec3;
}
export interface RigLimits {
  /** Largest fraction of a two-bone limb's chain length an action may extend it to. */
  reach: number;
  /** Hinge flexion range in radians (0 is straight) per limb kind. */
  bend: { arm: readonly [number, number]; leg: readonly [number, number] };
  /** Euler XYZ limits for directly rotated joints. */
  rotation: Readonly<Record<string, { min: Vec3; max: Vec3 }>>;
}
/** A humanoid rig derived from a character spec: joints, the four limbs, sockets and limits. */
export interface CharacterRig extends PerformanceRig {
  limits: RigLimits;
  sockets: { gripL: Socket; gripR: Socket; soleL: Socket; soleR: Socket };
}
export interface VectorKey {
  frame: number;
  value: Vec3;
}
export type VectorTrack = readonly VectorKey[];
export type Phase =
  | "setup"
  | "anticipation"
  | "intercept"
  | "contact"
  | "recoil"
  | "settle";
export interface PhaseAnchor {
  phase: Phase;
  frame: number;
}
export interface LimbConstraint {
  limb: string;
  /** Targets and bend directions are in action root space. The wrist is the grip-path effector. */
  target: VectorTrack;
  pole: VectorTrack;
  planted: boolean;
  /** Overrides the tip's local rotation (wrists) or locks its world rotation (feet). */
  tipRotation?: VectorTrack;
}
export interface ReceiveAction {
  id: string;
  rigId: string;
  fps: number;
  fromFrame: number;
  toFrame: number;
  anchors: readonly PhaseAnchor[];
  root: { position: VectorTrack; rotation: VectorTrack };
  positions: Readonly<Record<string, VectorTrack>>;
  rotations: Readonly<Record<string, VectorTrack>>;
  constraints: readonly LimbConstraint[];
  secondary: Readonly<Record<string, VectorTrack>>;
  expressions: readonly ExpressionKey[];
  contact: {
    frame: number;
    joint: string;
    gripOffset: Vec3;
    propOffset: Vec3;
    propScale: number;
    propRotation: Quat;
    flightRotation: Quat;
    flight: readonly [Vec3, Vec3];
  };
  /** Deliberate settled hold, excluded only from the frozen-motion check. */
  holdFromFrame: number;
}
export interface PerformanceState {
  frame: number;
  phase: Phase;
  root: Transform;
  joints: Record<string, Transform>;
  local: Record<string, Transform>;
  targets: Record<string, Vec3>;
  secondary: Record<string, Vec3>;
  expression: ExpressionBlend;
  prop: Transform & { scale: number };
  contact: { mode: "airborne" | "attached"; point: Vec3; propPoint: Vec3 };
}
export type PerformanceEvaluator = (frame: number) => PerformanceState;
