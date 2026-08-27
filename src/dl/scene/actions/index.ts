/**
 * File Description: Action registry and action definition interface for the Aideos Motion Vocabulary.
 * Exposes action definitions, lookup helpers, and affected joint mappings for validation and compilation.
 */

import type { ScheduledAction } from "../types";
import { idleAction } from "./idle";
import { walkAction } from "./walk";
import { waveAction } from "./wave";
import { pointAction } from "./point";
import { jumpAction } from "./jump";
import { crouchAction } from "./crouch";
import { turnAction } from "./turn";
import { reachAction } from "./reach";

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

export { idleAction } from "./idle";
export { walkAction } from "./walk";
export { waveAction } from "./wave";
export { pointAction } from "./point";
export { jumpAction } from "./jump";
export { crouchAction } from "./crouch";
export { turnAction } from "./turn";
export { reachAction } from "./reach";

/** Complete registry map of the 8 standard motion actions. */
export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  idle: idleAction,
  walk: walkAction,
  wave: waveAction,
  point: pointAction,
  jump: jumpAction,
  crouch: crouchAction,
  turn: turnAction,
  reach: reachAction,
};

/** Static metadata describing the 8 standard actions and their affected joints. */
export const ACTION_METADATA: Record<
  string,
  { description: string; affectedJoints: (side?: "left" | "right") => string[] }
> = {
  idle: {
    description: idleAction.description,
    affectedJoints: () => ["torso", "head"],
  },
  walk: {
    description: walkAction.description,
    affectedJoints: () => ["legs", "leftArm", "rightArm", "torso"],
  },
  wave: {
    description: waveAction.description,
    affectedJoints: (side = "right") => [side === "left" ? "leftArm" : "rightArm"],
  },
  point: {
    description: pointAction.description,
    affectedJoints: (side = "right") => [side === "left" ? "leftArm" : "rightArm", "torso", "head"],
  },
  jump: {
    description: jumpAction.description,
    affectedJoints: () => ["legs", "torso", "leftArm", "rightArm"],
  },
  crouch: {
    description: crouchAction.description,
    affectedJoints: () => ["legs", "torso"],
  },
  turn: {
    description: turnAction.description,
    affectedJoints: () => ["torso", "head"],
  },
  reach: {
    description: reachAction.description,
    affectedJoints: (side = "right") => [side === "left" ? "leftArm" : "rightArm", "torso"],
  },
};

/** Returns the ActionDefinition for a given action ID or null if not found. */
export function getActionDefinition(actionId: string): ActionDefinition | null {
  return ACTION_REGISTRY[actionId] ?? null;
}

/** Returns the list of affected joint IDs for an action invocation. */
export function getAffectedJointsForAction(action: ScheduledAction): string[] {
  const meta = ACTION_METADATA[action.actionId];
  if (!meta) return [];
  return meta.affectedJoints(action.side);
}
