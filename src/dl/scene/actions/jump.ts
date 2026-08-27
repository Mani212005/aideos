/**
 * File Description: Jump action definition with anticipation crouch, upward extension, and landing compression.
 * Pure parameterized sparse keyframe generator.
 */

import type { ActionDefinition, ActionParams } from "./index";

export const jumpAction: ActionDefinition = {
  actionId: "jump",
  description: "Crouch, extend, land",
  affectedJoints: ["legs", "torso", "leftArm", "rightArm"],
  generate(params: ActionParams) {
    const intensity = Math.max(0, Math.min(1, params.intensity ?? 1.0));
    const crouchLeg = -30.0 * intensity;
    const extendLeg = 10.0 * intensity;
    const crouchTorso = 12.0 * intensity;
    const armSwing = -50.0 * intensity;

    return {
      legs: [
        { t: 0.0, value: 0 },
        { t: 0.2, value: crouchLeg },
        { t: 0.45, value: extendLeg },
        { t: 0.75, value: extendLeg * 0.5 },
        { t: 0.85, value: crouchLeg * 0.5 },
        { t: 1.0, value: 0 },
      ],
      torso: [
        { t: 0.0, value: 0 },
        { t: 0.2, value: crouchTorso },
        { t: 0.45, value: -crouchTorso * 0.5 },
        { t: 0.75, value: 0 },
        { t: 0.85, value: crouchTorso * 0.3 },
        { t: 1.0, value: 0 },
      ],
      leftArm: [
        { t: 0.0, value: 0 },
        { t: 0.2, value: -armSwing * 0.4 },
        { t: 0.45, value: armSwing },
        { t: 0.75, value: armSwing * 0.5 },
        { t: 1.0, value: 0 },
      ],
      rightArm: [
        { t: 0.0, value: 0 },
        { t: 0.2, value: armSwing * 0.4 },
        { t: 0.45, value: -armSwing },
        { t: 0.75, value: -armSwing * 0.5 },
        { t: 1.0, value: 0 },
      ],
    };
  },
};
