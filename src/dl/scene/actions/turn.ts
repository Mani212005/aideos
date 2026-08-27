/**
 * File Description: Turn action definition rotating torso and head to face opposing horizon.
 * Pure parameterized sparse keyframe generator.
 */

import type { ActionDefinition, ActionParams } from "./index";

export const turnAction: ActionDefinition = {
  actionId: "turn",
  description: "Rotate torso and head to face the other direction",
  affectedJoints: ["torso", "head"],
  generate(params: ActionParams) {
    const intensity = Math.max(0, Math.min(1, params.intensity ?? 1.0));
    const torsoRot = 18.0 * intensity;
    const headRot = 30.0 * intensity;

    return {
      torso: [
        { t: 0.0, value: 0 },
        { t: 0.3, value: torsoRot },
        { t: 0.7, value: torsoRot },
        { t: 1.0, value: 0 },
      ],
      head: [
        { t: 0.0, value: 0 },
        { t: 0.3, value: headRot },
        { t: 0.7, value: headRot },
        { t: 1.0, value: 0 },
      ],
    };
  },
};
