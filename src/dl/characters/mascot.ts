/**
 * File Description: Pure TypeScript vector rig for the Geometric Minimalist Mascot character.
 * Features clean rounded geometric forms, expressive animated eye pill, and floating companion style.
 */

import type { CharacterRig } from "./types";

/** Geometric Minimalist Mascot vector rig with semantic token slots. */
export const mascotRig: CharacterRig = {
  id: "mascot",
  name: "Geometric Bot",
  description: "Minimalist geometric companion with animated expressive eye visor",
  viewBox: "0 0 400 600",
  defaultScale: 1,
  groups: [
    {
      id: "legs",
      name: "Hover Base Pod",
      pivot: { x: 200, y: 400 },
      paths: [
        // Hover Pod
        {
          d: "M160 390 Q200 420 240 390 L230 430 Q200 450 170 430 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Accent Glow Glow Pill
        {
          d: "M175 440 L225 440 L220 455 L180 455 Z",
          fill: "accent",
          stroke: "none",
        },
      ],
    },
    {
      id: "torso",
      name: "Sphere Body & Badge",
      pivot: { x: 200, y: 310 },
      paths: [
        // Main Geometric Rounded Sphere Body
        {
          d: "M140 230 Q200 200 260 230 Q280 340 250 380 Q200 410 150 380 Q120 340 140 230 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Chest Accent Emblem
        {
          d: "M185 290 L215 290 L200 320 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "head",
      name: "Head & Eye Visor",
      parent: "torso",
      pivot: { x: 200, y: 155 },
      paths: [
        // Head Dome
        {
          d: "M135 120 Q200 85 265 120 Q280 200 250 220 Q200 235 150 220 Q120 200 135 120 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Visor Pill Screen
        {
          d: "M155 140 Q200 135 245 140 L240 185 Q200 190 160 185 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Left Eye Dot
        {
          d: "M175 160 A 8 8 0 1 0 191 160 A 8 8 0 1 0 175 160 Z",
          fill: "accent",
          stroke: "none",
        },
        // Right Eye Dot
        {
          d: "M209 160 A 8 8 0 1 0 225 160 A 8 8 0 1 0 209 160 Z",
          fill: "accent",
          stroke: "none",
        },
      ],
    },
    {
      id: "leftArm",
      name: "Left Floating Orb Arm",
      parent: "torso",
      pivot: { x: 130, y: 230 },
      paths: [
        // Upper Arm
        {
          d: "M130 225 L90 300 L115 310 L145 235 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Floating Hand Orb
        {
          d: "M70 340 A 18 18 0 1 0 106 340 A 18 18 0 1 0 70 340 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
    {
      id: "rightArm",
      name: "Right Floating Orb Arm",
      parent: "torso",
      pivot: { x: 270, y: 230 },
      paths: [
        // Upper Arm
        {
          d: "M270 225 L310 300 L285 310 L255 235 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Floating Hand Orb
        {
          d: "M294 340 A 18 18 0 1 0 330 340 A 18 18 0 1 0 294 340 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
  ],
};
