/**
 * File Description: Point action definition extending arm forward with torso/head tilt.
 * Pure parameterized sparse keyframe generator.
 */

import type { ActionDefinition, ActionParams } from "./index";

export const pointAction: ActionDefinition = {
  actionId: "point",
  description: "Extend one arm toward a direction",
  affectedJoints: ["leftArm", "rightArm", "torso", "head"],
  generate(params: ActionParams) {
    const intensity = Math.max(0, Math.min(1, params.intensity ?? 1.0));
    const side = params.side === "left" ? "leftArm" : "rightArm";
    const sign = side === "left" ? 1 : -1;
    const armAngle = sign * 75.0 * intensity;
    const torsoAngle = 6.0 * intensity;
    const headAngle = 8.0 * intensity;

    return {
      [side]: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: armAngle },
        { t: 0.75, value: armAngle },
        { t: 1.0, value: 0 },
      ],
      torso: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: torsoAngle },
        { t: 0.75, value: torsoAngle },
        { t: 1.0, value: 0 },
      ],
      head: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: headAngle },
        { t: 0.75, value: headAngle },
        { t: 1.0, value: 0 },
      ],
    };
  },
};
