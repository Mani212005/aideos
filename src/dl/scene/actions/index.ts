/**
 * File Description: Action registry and action definition interface for the Aideos Motion Vocabulary.
 * Exposes action lookup and affected joint mappings for validation and compilation.
 */

import type { ScheduledAction } from "../types";

export interface ActionParams {
  durationFrames: number; // integer > 0
  intensity: number; // 0.0 - 1.0, scales rotation magnitude about rest
  side?: "left" | "right";
}

export interface ActionDefinition {
  actionId: string;
  description: string;
  affectedJoints: string[];
  generate(params: ActionParams): Record<string, Array<{ t: number; value: number }>>;
}

/** Static metadata describing the 8 standard actions and their affected joints. */
export const ACTION_METADATA: Record<string, { description: string; affectedJoints: (side?: "left" | "right") => string[] }> = {
  idle: {
    description: "Rest posture with minimal breathing sway",
    affectedJoints: () => ["torso", "head"],
  },
  walk: {
    description: "Cyclic leg and arm swing; loops if duration exceeds one cycle",
    affectedJoints: () => ["legs", "leftArm", "rightArm", "torso"],
  },
  wave: {
    description: "Raise one arm and oscillate",
    affectedJoints: (side = "right") => [side === "left" ? "leftArm" : "rightArm"],
  },
  point: {
    description: "Extend one arm toward a direction",
    affectedJoints: (side = "right") => [side === "left" ? "leftArm" : "rightArm", "torso", "head"],
  },
  jump: {
    description: "Crouch, extend, land",
    affectedJoints: () => ["legs", "torso", "leftArm", "rightArm"],
  },
  crouch: {
    description: "Lower torso, bend legs, hold",
    affectedJoints: () => ["legs", "torso"],
  },
  turn: {
    description: "Rotate torso and head to face the other direction",
    affectedJoints: () => ["torso", "head"],
  },
  reach: {
    description: "Extend one arm upward and forward",
    affectedJoints: (side = "right") => [side === "left" ? "leftArm" : "rightArm", "torso"],
  },
};

/** Returns the list of affected joint IDs for an action invocation. */
export function getAffectedJointsForAction(action: ScheduledAction): string[] {
  const meta = ACTION_METADATA[action.actionId];
  if (!meta) return [];
  return meta.affectedJoints(action.side);
}
