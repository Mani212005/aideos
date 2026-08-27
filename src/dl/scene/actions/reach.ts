/**
 * File Description: Reach action definition extending arm upward and forward with torso stretch.
 * Pure parameterized sparse keyframe generator.
 */

import type { ActionDefinition, ActionParams } from "./index";

export const reachAction: ActionDefinition = {
  actionId: "reach",
  description: "Extend one arm upward and forward",
  affectedJoints: ["leftArm", "rightArm", "torso"],
  generate(params: ActionParams) {
    const intensity = Math.max(0, Math.min(1, params.intensity ?? 1.0));
    const side = params.side === "left" ? "leftArm" : "rightArm";
    const sign = params.side === "left" ? 1 : -1;
    const armReach = sign * 90.0 * intensity;
    const torsoStretch = 8.0 * intensity;

    return {
      [side]: [
        { t: 0.0, value: 0 },
        { t: 0.35, value: armReach },
        { t: 0.65, value: armReach },
        { t: 1.0, value: 0 },
      ],
      torso: [
        { t: 0.0, value: 0 },
        { t: 0.35, value: torsoStretch },
        { t: 0.65, value: torsoStretch },
        { t: 1.0, value: 0 },
      ],
    };
  },
};
