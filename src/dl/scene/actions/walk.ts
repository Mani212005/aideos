/**
 * File Description: Walk action definition with cyclic leg and arm swing kinematics.
 * Pure parameterized sparse keyframe generator.
 */

import type { ActionDefinition, ActionParams } from "./index";

export const walkAction: ActionDefinition = {
  actionId: "walk",
  description: "Cyclic leg and arm swing; loops if duration exceeds one cycle",
  affectedJoints: ["legs", "leftArm", "rightArm", "torso"],
  generate(params: ActionParams) {
    const intensity = Math.max(0, Math.min(1, params.intensity ?? 1.0));
    const legAmp = 25.0 * intensity;
    const armAmp = 20.0 * intensity;
    const torsoAmp = 2.0 * intensity;

    return {
      legs: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: legAmp },
        { t: 0.5, value: 0 },
        { t: 0.75, value: -legAmp },
        { t: 1.0, value: 0 },
      ],
      leftArm: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: -armAmp },
        { t: 0.5, value: 0 },
        { t: 0.75, value: armAmp },
        { t: 1.0, value: 0 },
      ],
      rightArm: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: armAmp },
        { t: 0.5, value: 0 },
        { t: 0.75, value: -armAmp },
        { t: 1.0, value: 0 },
      ],
      torso: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: torsoAmp },
        { t: 0.5, value: 0 },
        { t: 0.75, value: -torsoAmp },
        { t: 1.0, value: 0 },
      ],
    };
  },
};
