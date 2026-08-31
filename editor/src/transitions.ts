/**
 * File Description: Defines visual transition presets, types, and duration helper utilities for video scene boundaries.
 */

export type TransitionType =
  | "paper-rip"
  | "zoom-morph"
  | "matrix-glitch"
  | "whip-pan"
  | "film-burn";

export interface TransitionPreset {
  id: TransitionType;
  name: string;
  description: string;
  icon: string;
  minDurationSec: number;
  maxDurationSec: number;
  defaultDurationSec: number;
}

export const TRANSITION_PRESETS: Record<TransitionType, TransitionPreset> = {
  "paper-rip": {
    id: "paper-rip",
    name: "Paper Rip",
    description: "Tear the current scene away to reveal the next.",
    icon: "📄",
    minDurationSec: 0.1,
    maxDurationSec: 2.0,
    defaultDurationSec: 0.5,
  },
  "zoom-morph": {
    id: "zoom-morph",
    name: "Zoom Morph",
    description: "High-speed camera warp into the subsequent shot.",
    icon: "🔍",
    minDurationSec: 0.1,
    maxDurationSec: 1.5,
    defaultDurationSec: 0.4,
  },
  "matrix-glitch": {
    id: "matrix-glitch",
    name: "Matrix Glitch",
    description: "Digital pixel displacement and chromatic aberration burst.",
    icon: "⚡",
    minDurationSec: 0.1,
    maxDurationSec: 1.0,
    defaultDurationSec: 0.3,
  },
  "whip-pan": {
    id: "whip-pan",
    name: "Whip Pan",
    description: "Directional motion-blurred camera snap.",
    icon: "💨",
    minDurationSec: 0.1,
    maxDurationSec: 1.2,
    defaultDurationSec: 0.35,
  },
  "film-burn": {
    id: "film-burn",
    name: "Film Burn",
    description: "Warm optical exposure leak and film flash.",
    icon: "🔥",
    minDurationSec: 0.1,
    maxDurationSec: 2.0,
    defaultDurationSec: 0.6,
  },
};

// Converts seconds duration to integer frame count based on video frame rate.
export function getTransitionFrames(durationSec: number, fps: number): number {
  return Math.round(durationSec * fps);
}
