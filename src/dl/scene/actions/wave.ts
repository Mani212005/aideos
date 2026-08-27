/**
 * File Description: Wave action definition with arm raise and oscillatory forearm motion.
 * Pure parameterized sparse keyframe generator.
 */

import type { ActionDefinition, ActionParams } from "./index";

export const waveAction: ActionDefinition = {
  actionId: "wave",
  description: "Raise one arm and oscillate",
  affectedJoints: ["leftArm", "rightArm"],
  generate(params: ActionParams) {
    const intensity = Math.max(0, Math.min(1, params.intensity ?? 1.0));
    const side = params.side === "left" ? "leftArm" : "rightArm";
    const sign = params.side === "left" ? 1 : -1;
    const raise = sign * 110.0 * intensity;
    const osc = 15.0 * intensity;

    const keyframes = [
      { t: 0.0, value: 0 },
      { t: 0.2, value: raise },
      { t: 0.4, value: raise + osc },
      { t: 0.6, value: raise - osc },
      { t: 0.8, value: raise + osc },
      { t: 1.0, value: 0 },
    ];

    return {
      [side]: keyframes,
    };
  },
};
