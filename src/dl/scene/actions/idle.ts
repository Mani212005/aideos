/**
 * File Description: Idle action definition with subtle breathing and posture sway.
 * Pure parameterized sparse keyframe generator.
 */

import type { ActionDefinition, ActionParams } from "./index";

export const idleAction: ActionDefinition = {
  actionId: "idle",
  description: "Rest posture with minimal breathing sway",
  affectedJoints: ["torso", "head"],
  generate(params: ActionParams) {
    const intensity = Math.max(0, Math.min(1, params.intensity ?? 1.0));
    const torsoAmp = 2.0 * intensity;
    const headAmp = -1.0 * intensity;

    return {
      torso: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: torsoAmp },
        { t: 0.5, value: 0 },
        { t: 0.75, value: -torsoAmp * 0.5 },
        { t: 1.0, value: 0 },
      ],
      head: [
        { t: 0.0, value: 0 },
        { t: 0.25, value: headAmp },
        { t: 0.5, value: 0 },
        { t: 0.75, value: -headAmp * 0.5 },
        { t: 1.0, value: 0 },
      ],
    };
  },
};
