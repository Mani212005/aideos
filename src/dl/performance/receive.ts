/**
 * File Description: Sparse receive choreography recovered from the approved five-second Iona catch.
 * Inputs and outputs: resolved decisive frame and target offset -> typed constrained action data.
 * Used by: backend/performance/bindReceive.ts, the retargeter, character compatibility checks, tests and isolated fixture preview.
 */
import { add, euler, multiply } from "./math";
import type { ReceiveAction, Vec3, VectorTrack } from "./types";

/** Expressions the receive plays; a character must have a preset for each. */
export const RECEIVE_EXPRESSIONS = ["neutral", "surprised", "determined", "relieved"] as const;
/**
 * Secondary channels the receive drives. Each is a semantic follow-through signal a character binds
 * its own swinging pieces to: coat trails from the hips (coat tails, skirt, tail), tuft trails behind
 * the head (ponytail, ears), side swings beside the head (side lock, earring).
 */
export const RECEIVE_SECONDARY_CHANNELS = ["coat", "tuft", "side"] as const;

// The reference is in seconds; retiming preserves its sparse anchors around the decisive contact.
const REFERENCE: Record<string, readonly (readonly [number, Vec3])[]> = {
  hipsPos: [
    [0, [0, 0.03, 0]],
    [0.7, [0, 0.07, -0.02]],
    [1.5, [0.1, 0.24, -0.08]],
    [2.3, [-0.1, 0.13, 0.1]],
    [2.65, [-0.08, 0.14, 0.1]],
    [3.7, [-0.04, 0.1, 0.04]],
  ],
  hipsRot: [
    [0, [0, 0, 0]],
    [1.5, [0.05, 0.14, -0.03]],
    [2.3, [-0.02, -0.12, 0.03]],
    [3.7, [0.03, -0.06, -0.05]],
  ],
  spine: [
    [0, [0, 0, 0]],
    [0.7, [-0.07, -0.1, 0.03]],
    [1.5, [0.12, -0.42, 0.06]],
    [2.3, [0.2, 0.32, -0.05]],
    [2.65, [0.24, 0.38, -0.08]],
    [3.3, [0.13, 0.2, 0.06]],
    [3.7, [0.12, 0.16, 0.1]],
  ],
  neck: [
    [0, [0, 0, 0]],
    [0.7, [-0.04, -0.1, 0]],
    [1.5, [0.04, -0.08, 0]],
    [2.3, [-0.02, -0.1, 0]],
    [3.2, [0.03, 0.05, -0.02]],
    [3.7, [0.04, 0.14, -0.04]],
  ],
  head: [
    [0, [-0.02, -0.05, 0.01]],
    [0.7, [-0.14, -0.3, 0.04]],
    [1.5, [0.02, -0.2, 0.02]],
    [2.3, [0, -0.25, -0.02]],
    [2.75, [0.05, -0.1, 0]],
    [3.7, [0.06, 0.32, -0.08]],
  ],
  wR: [
    [0, [-1.1, 3.25, 0.2]],
    [0.7, [-1.05, 3.55, 0.35]],
    [1.5, [-1.2, 4.5, -0.9]],
    [2.3, [-1.45, 5.6, 1.95]],
    [2.55, [-1.5, 5.65, 2]],
    [3.2, [-0.55, 4.55, 0.9]],
    [3.7, [-0.42, 4.4, 0.82]],
  ],
  wL: [
    [0, [1.1, 3.25, 0.2]],
    [0.7, [1.2, 3.65, 0.3]],
    [1.5, [1.45, 4.1, 0.1]],
    [2.3, [1.55, 4.55, -0.55]],
    [2.65, [1.5, 4.5, -0.4]],
    [3.3, [0.5, 4.1, 0.7]],
    [3.7, [0.3, 4, 0.78]],
  ],
  // Elbow poles. The in-between keys roll each elbow at an even rate between the approved keys:
  // the original poles passed within a few degrees of the arm's own axis, which flipped the left
  // elbow's bend plane by about 160 degrees in two frames during the reach and again in the recoil
  // (a visible snap), and whipped the right elbow at 29 degrees per frame. Approved keys are unchanged.
  poleR: [
    [0, [-0.6, -0.3, -0.7]],
    [1.5, [-1, 0.4, -0.6]],
    [1.6, [-0.11, 1.14, -0.35]],
    [1.7, [0.24, 0.91, -0.74]],
    [1.8, [0.13, 0.65, -1]],
    [1.9, [-0.36, 0.32, -1.1]],
    [2, [-0.82, 0, -0.88]],
    [2.1, [-1.01, -0.23, -0.61]],
    [2.2, [-1.04, -0.44, -0.41]],
    [2.3, [-0.7, -0.6, -0.4]],
    [3.1, [-1, -0.7, -0.2]],
  ],
  poleL: [
    [0, [0.6, -0.3, -0.7]],
    [1.5, [1, -0.2, -0.6]],
    [1.7, [0.72, 0.96, 0.02]],
    [1.9, [0.69, 0.55, 0.81]],
    [2.1, [0.5, -0.28, 1.06]],
    [2.3, [1, -0.5, -0.5]],
    [2.45, [0.38, -0.55, 1]],
    [2.6, [0.59, 0.03, 1.04]],
    [2.75, [0.69, 0.58, 0.79]],
    [2.9, [0.78, 0.9, 0.18]],
    [3, [0.92, 0.69, -0.32]],
    [3.1, [1, -0.7, -0.2]],
  ],
  wrR: [
    [0, [0.16, 0, -0.1]],
    [1.5, [-0.35, 0, -0.2]],
    [2.3, [0.5, 0, -0.1]],
    [3.1, [0.25, 0.2, 0]],
  ],
  wrL: [
    [0, [0.1, 0, 0.08]],
    [2.3, [0.2, 0, 0.1]],
    [3.5, [0.4, -0.2, 0.1]],
  ],
  coat: [
    [0, [0.03, 0, 0]],
    [0.7, [0.12, 0.02, 0]],
    [1.5, [0.2, 0.05, 0]],
    [2.3, [-0.1, -0.03, 0]],
    [2.7, [0.38, 0.1, 0]],
    [3.1, [-0.12, -0.06, 0]],
    [3.45, [0.1, 0.03, 0]],
    [3.7, [0.04, 0.02, 0]],
  ],
  tuft: [
    [0, [0, 0, 0]],
    [0.7, [0.22, 0.04, 0]],
    [1.5, [0.1, -0.02, 0]],
    [2.3, [-0.18, 0, 0]],
    [2.75, [0.4, 0.1, 0]],
    [3.2, [-0.12, -0.05, 0]],
    [3.55, [0.07, 0.02, 0]],
    [3.7, [0.05, 0, 0]],
  ],
  side: [
    [0, [0, 0, 0]],
    [0.8, [-0.1, 0.1, 0]],
    [2.4, [0.12, -0.12, 0]],
    [2.9, [-0.15, 0.1, 0]],
    [3.7, [0, 0, 0]],
  ],
};

// Builds the first action with contact at a resolved narration frame and optional root-space reach offset.
export function createReceiveAction(
  contactFrame: number,
  fps = 30,
  targetOffset: Vec3 = [0, 0, 0],
): ReceiveAction {
  if (
    !Number.isFinite(fps) ||
    fps <= 0 ||
    !Number.isInteger(contactFrame) ||
    contactFrame <= 0 ||
    !targetOffset.every(Number.isFinite)
  ) {
    throw new Error(
      "Receive needs positive fps, a positive integer contact frame and a finite target offset.",
    );
  }
  // Maps authored seconds to absolute frames with a shared contact anchor.
  const frameAt = (seconds: number): number =>
    Number(
      (seconds <= 2.3
        ? (seconds / 2.3) * contactFrame
        : contactFrame + (seconds - 2.3) * fps
      ).toFixed(9),
    );
  // Converts one reference channel into an independent sparse vector path.
  const track = (name: string): VectorTrack =>
    REFERENCE[name].map(([seconds, value]) => ({
      frame: frameAt(seconds),
      value: [...value],
    }));
  const rightGrip = track("wR").map((key) => ({
    ...key,
    value: add(key.value, targetOffset),
  }));
  return {
    id: "receive",
    rigId: "iona-v1",
    fps,
    fromFrame: 0,
    toFrame: contactFrame + 2.7 * fps,
    anchors: [
      { phase: "setup", frame: 0 },
      { phase: "anticipation", frame: frameAt(0.7) },
      { phase: "intercept", frame: frameAt(1.5) },
      { phase: "contact", frame: contactFrame },
      { phase: "recoil", frame: frameAt(2.65) },
      { phase: "settle", frame: frameAt(3.7) },
    ],
    root: {
      position: [{ frame: 0, value: [1.9, 0, 0] }],
      rotation: [{ frame: 0, value: [0, -0.62, 0] }],
    },
    positions: {
      hips: track("hipsPos").map((key) => ({
        ...key,
        value: [key.value[0], 3.2 - key.value[1], key.value[2]],
      })),
    },
    rotations: {
      hips: track("hipsRot"),
      spine: track("spine"),
      neck: track("neck"),
      head: track("head"),
      fingersR: [
        { frame: frameAt(2.25), value: [-0.1, 0, 0] },
        { frame: frameAt(2.45), value: [-0.9, 0, 0] },
      ],
      thumbR: [
        { frame: frameAt(2.25), value: [-0.05, 0, 0] },
        { frame: frameAt(2.45), value: [-0.5, 0, 0] },
      ],
      fingersL: [{ frame: 0, value: [-0.35, 0, 0] }],
      thumbL: [{ frame: 0, value: [-0.2, 0, 0] }],
    },
    constraints: [
      {
        limb: "legL",
        target: [{ frame: 0, value: [0.29, 0.35, 0] }],
        pole: [{ frame: 0, value: [0, 0, 1] }],
        planted: true,
      },
      {
        limb: "legR",
        target: [{ frame: 0, value: [-0.29, 0.35, 0] }],
        pole: [{ frame: 0, value: [0, 0, 1] }],
        planted: true,
      },
      {
        limb: "armL",
        target: track("wL"),
        pole: track("poleL"),
        tipRotation: track("wrL"),
        planted: false,
      },
      {
        limb: "armR",
        target: rightGrip,
        pole: track("poleR"),
        tipRotation: track("wrR"),
        planted: false,
      },
    ],
    expressions: [
      { frame: frameAt(0), name: "neutral" },
      { frame: frameAt(0.5), name: "neutral" },
      { frame: frameAt(0.85), name: "surprised" },
      { frame: frameAt(1.2), name: "surprised" },
      { frame: frameAt(1.6), name: "determined" },
      { frame: frameAt(2.6), name: "determined" },
      { frame: frameAt(3.1), name: "relieved" },
    ],
    secondary: {
      coat: track("coat"),
      tuft: track("tuft"),
      side: track("side"),
    },
    contact: {
      frame: contactFrame,
      joint: "wristR",
      gripOffset: [0, -0.4, 0.09],
      propOffset: [0, -0.2, -0.38],
      propScale: 0.85,
      propRotation: IONA_CONTACT_ROTATION,
      flightRotation: IONA_FLIGHT_ROTATION,
      flight: [
        [-5.2, 6.15, 0.45],
        [-3.4, 6.75, 0.45],
      ],
    },
    holdFromFrame: frameAt(3.7),
  };
}

// Keeps the reference glider's YXZ orientation without adding a renderer dependency.
export const IONA_CONTACT_ROTATION = multiply(
  euler([0, 1.5, 0]),
  euler([-0.12, 0, 0.14]),
);
export const IONA_FLIGHT_ROTATION = multiply(
  euler([0, 1.45, 0]),
  euler([0.12, 0, 0.3]),
);
