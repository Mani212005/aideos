/**
 * File Description: Pure TypeScript vector rig for the Systems Architect & Data Engineer character.
 * Features over-ear headphones, dark tech hoodie, terminal wristband, and systems presenter posture.
 */

import type { CharacterRig } from "./types";

/** Systems Architect character vector rig with semantic token slots. */
export const dataEngineerRig: CharacterRig = {
  id: "data-engineer",
  name: "Systems Architect",
  description: "DevOps lead with headphones, tech hoodie, and distributed systems posture",
  viewBox: "0 0 400 600",
  defaultScale: 1,
  groups: [
    {
      id: "legs",
      name: "Jeans & Sneakers",
      pivot: { x: 200, y: 390 },
      paths: [
        // Left Leg
        {
          d: "M160 380 L150 495 L125 520 L165 520 L180 485 L185 380 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Right Leg
        {
          d: "M240 380 L250 495 L275 520 L235 520 L220 485 L215 380 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Sneakers with Accent Stripe
        {
          d: "M120 520 L170 520 L170 532 L120 532 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 2,
        },
        {
          d: "M230 520 L280 520 L280 532 L230 532 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 2,
        },
        {
          d: "M135 524 L155 524",
          fill: "none",
          stroke: "accent",
          strokeWidth: 2,
        },
        {
          d: "M245 524 L265 524",
          fill: "none",
          stroke: "accent",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "torso",
      name: "Tech Hoodie & Headphones",
      pivot: { x: 200, y: 310 },
      paths: [
        // Dark Tech Hoodie Body
        {
          d: "M135 210 Q200 195 265 210 L275 375 Q200 395 125 375 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Kangaroo Pocket
        {
          d: "M150 310 Q200 300 250 310 L240 365 Q200 375 160 365 Z",
          fill: "canvas",
          stroke: "hairline",
          strokeWidth: 2,
        },
        // Terminal Prompt Icon on Chest
        {
          d: "M160 250 L170 260 L160 270",
          fill: "none",
          stroke: "accent",
          strokeWidth: 3,
        },
        {
          d: "M175 270 L190 270",
          fill: "none",
          stroke: "accent",
          strokeWidth: 3,
        },
        // Headphones Neck Band
        {
          d: "M150 200 Q200 230 250 200",
          fill: "none",
          stroke: "ink",
          strokeWidth: 6,
        },
        // Left Headphone Ear Cup
        {
          d: "M140 185 A 12 16 0 1 0 164 185 A 12 16 0 1 0 140 185 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Right Headphone Ear Cup
        {
          d: "M236 185 A 12 16 0 1 0 260 185 A 12 16 0 1 0 236 185 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
    {
      id: "head",
      name: "Head & Beanie Cap",
      parent: "torso",
      pivot: { x: 200, y: 155 },
      paths: [
        // Beanie Cap
        {
          d: "M145 130 Q200 75 255 130 L255 150 Q200 135 145 150 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Beanie Accent Tag
        {
          d: "M165 140 L175 140 L175 152 L165 152 Z",
          fill: "accent",
          stroke: "none",
        },
        // Face
        {
          d: "M155 135 Q200 130 245 135 L240 185 Q200 205 160 185 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Focused Eyes
        {
          d: "M175 148 A 3 3 0 1 0 181 148 A 3 3 0 1 0 175 148 Z",
          fill: "ink",
          stroke: "none",
        },
        {
          d: "M219 148 A 3 3 0 1 0 225 148 A 3 3 0 1 0 219 148 Z",
          fill: "ink",
          stroke: "none",
        },
        // Smile
        {
          d: "M188 172 Q200 179 212 172",
          fill: "none",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
    {
      id: "leftArm",
      name: "Left Sleeve & Hand",
      parent: "torso",
      pivot: { x: 130, y: 215 },
      paths: [
        // Hoodie Left Sleeve
        {
          d: "M135 210 L90 295 L118 305 L155 225 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Forearm
        {
          d: "M90 295 L70 370 L95 375 L115 300 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Hand
        {
          d: "M65 370 Q55 390 75 395 Q85 385 90 370 Z",
          fill: "muted",
          stroke: "ink",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "rightArm",
      name: "Right Sleeve & Hand",
      parent: "torso",
      pivot: { x: 270, y: 215 },
      paths: [
        // Hoodie Right Sleeve
        {
          d: "M265 210 L310 295 L282 305 L245 225 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Forearm
        {
          d: "M310 295 L330 370 L305 375 L285 300 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Hand
        {
          d: "M335 370 Q345 390 325 395 Q315 385 310 370 Z",
          fill: "muted",
          stroke: "ink",
          strokeWidth: 2,
        },
      ],
    },
  ],
};
