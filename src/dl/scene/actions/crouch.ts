/**
 * File Description: Crouch action definition with downward hip translation and knee flexion.
 * Pure parameterized sparse keyframe generator.
 */

import type { ActionDefinition, ActionParams } from "./index";

export const crouchAction: ActionDefinition = {
  actionId: "crouch",
  description: "Lower torso, bend legs, hold",
  affectedJoints: ["legs", "torso"],
  generate(params: ActionParams) {
    const intensity = Math.max(0, Math.min(1, params.intensity ?? 1.0));
    const legBend = -35.0 * intensity;
    const torsoLean = 15.0 * intensity;

    return {
      legs: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: legBend },
        { t: 0.75, value: legBend },
        { t: 1.0, value: 0 },
      ],
      torso: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: torsoLean },
        { t: 0.75, value: torsoLean },
        { t: 1.0, value: 0 },
      ],
    };
  },
};
