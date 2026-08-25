/**
 * File Description: Pre-defined high-production pose templates for 1-click character posing.
 * Contains 8 distinct gestures covering narration, concept introduction, and data presentation.
 */

import type { PosePreset } from "./types";

/** 8 standard pose presets covering essential explainer video moments. */
export const POSE_PRESETS: Record<string, PosePreset> = {
  neutral: {
    id: "neutral",
    name: "Neutral Rest",
    description: "Standard natural standing posture for ambient narration beats",
    groups: {
      torso: { rotate: 0, x: 0, y: 0 },
      head: { rotate: 0 },
      leftArm: { rotate: 0 },
      rightArm: { rotate: 0 },
      legs: { rotate: 0 },
    },
  },
  "present-right": {
    id: "present-right",
    name: "Present Right",
    description: "Right arm extended outward pointing to adjacent data card or chart",
    groups: {
      torso: { rotate: 3 },
      head: { rotate: 5 },
      leftArm: { rotate: -10 },
      rightArm: { rotate: -65 },
      legs: { rotate: 0 },
    },
  },
  "present-left": {
    id: "present-left",
    name: "Present Left",
    description: "Left arm extended pointing to headlines or diagram nodes on the left",
    groups: {
      torso: { rotate: -3 },
      head: { rotate: -5 },
      leftArm: { rotate: 65 },
      rightArm: { rotate: 10 },
      legs: { rotate: 0 },
    },
  },
  think: {
    id: "think",
    name: "Ponder / Analyze",
    description: "Hand near chin with head tilted, ideal for introducing technical problems",
    groups: {
      torso: { rotate: -4 },
      head: { rotate: -12 },
      leftArm: { rotate: 15 },
      rightArm: { rotate: -105 },
      legs: { rotate: 0 },
    },
  },
  shrug: {
    id: "shrug",
    name: "Shrug / Trade-off",
    description: "Both arms bent with palms up and tilted head to depict engineering trade-offs",
    groups: {
      torso: { rotate: 0 },
      head: { rotate: 8 },
      leftArm: { rotate: 45 },
      rightArm: { rotate: -45 },
      legs: { rotate: 0 },
    },
  },
  wave: {
    id: "wave",
    name: "Wave Greeting",
    description: "Friendly wave greeting suitable for the video hook or introductory beat",
    groups: {
      torso: { rotate: 2 },
      head: { rotate: 6 },
      leftArm: { rotate: -5 },
      rightArm: { rotate: -125 },
      legs: { rotate: 0 },
    },
  },
  "crossed-arms": {
    id: "crossed-arms",
    name: "Crossed Arms",
    description: "Confident folded arms posture for authoritative architecture statements",
    groups: {
      torso: { rotate: 0 },
      head: { rotate: 0 },
      leftArm: { rotate: 55 },
      rightArm: { rotate: -55 },
      legs: { rotate: 0 },
    },
  },
  celebrate: {
    id: "celebrate",
    name: "Celebrate / Payoff",
    description: "Both arms raised high with enthusiastic posture for final payoff metrics",
    groups: {
      torso: { rotate: 0 },
      head: { rotate: -4 },
      leftArm: { rotate: 110 },
      rightArm: { rotate: -110 },
      legs: { rotate: 0 },
    },
  },
};

/** Returns an array of all available pose preset templates. */
export const getAllPosePresets = (): PosePreset[] => Object.values(POSE_PRESETS);

/** Resolves a preset by ID or falls back to neutral. */
export const getPosePresetById = (id: string): PosePreset =>
  POSE_PRESETS[id] ?? POSE_PRESETS.neutral;
