/**
 * File Description: Pure TypeScript vector rig for the Tech Architect character.
 * Features a modern engineering lead with glasses, headset, and clean geometric clothing.
 */

import type { CharacterRig } from "./types";

/** Tech Architect character vector rig with semantic token slots. */
export const developerRig: CharacterRig = {
  id: "developer",
  name: "Tech Architect",
  viewBox: "0 0 400 600",
  defaultScale: 1,
  groups: [
    {
      id: "legs",
      name: "Trousers and Sneakers",
      pivot: { x: 200, y: 385 },
      paths: [
        // Left Leg Trouser
        {
          d: "M160 380 L152 490 L130 520 L172 520 L180 480 L185 380 Z",
          fill: "muted",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Right Leg Trouser
        {
          d: "M240 380 L248 490 L270 520 L228 520 L220 480 L215 380 Z",
          fill: "muted",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Left Sneaker
        {
          d: "M125 515 L175 515 L175 532 L125 532 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Right Sneaker
        {
          d: "M225 515 L275 515 L275 532 L225 532 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Sneaker Accent Stripe
        {
          d: "M135 522 L165 522",
          stroke: "accent",
          strokeWidth: 3,
        },
        {
          d: "M235 522 L265 522",
          stroke: "accent",
          strokeWidth: 3,
        },
      ],
    },
    {
      id: "torso",
      name: "Hoodie Torso and Lanyard",
      pivot: { x: 200, y: 275 },
      paths: [
        // Main Hoodie Body
        {
          d: "M145 195 Q200 185 255 195 L260 385 Q200 395 140 385 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 5,
        },
        // Inner T-Shirt Collar
        {
          d: "M180 190 Q200 215 220 190 Z",
          fill: "ink",
        },
        // Tech Conference Lanyard (Accent)
        {
          d: "M182 195 L196 280 L204 280 L218 195",
          stroke: "accent",
          strokeWidth: 4,
        },
        // Conference Badge Pass
        {
          d: "M188 280 L212 280 L212 315 L188 315 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 2,
        },
        // Badge ID Chip
        {
          d: "M193 290 L207 290",
          stroke: "accent",
          strokeWidth: 3,
        },
        // Hoodie Pocket
        {
          d: "M160 325 L240 325 L232 370 L168 370 Z",
          fill: "hairline",
          stroke: "ink",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "head",
      name: "Head, Hair and Glasses",
      parent: "torso",
      pivot: { x: 200, y: 190 },
      paths: [
        // Neck
        {
          d: "M185 170 L185 200 L215 200 L215 170 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Face Oval
        {
          d: "M155 130 C155 75, 245 75, 245 130 C245 175, 230 185, 200 185 C170 185, 155 175, 155 130 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Modern Styled Hair
        {
          d: "M150 115 C150 65, 250 60, 250 110 C235 90, 210 90, 195 95 C180 90, 160 95, 150 115 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Glasses Frame
        {
          d: "M165 125 L190 125 L190 145 L165 145 Z M210 125 L235 125 L235 145 L210 145 Z M190 133 L210 133",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Glasses Lenses (Subtle Accent Tint)
        {
          d: "M167 127 L188 127 L188 143 L167 143 Z M212 127 L233 127 L233 143 L212 143 Z",
          fill: "hairline",
        },
        // Smile / Friendly Expression
        {
          d: "M188 162 Q200 170 212 162",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
    {
      id: "leftArm",
      name: "Left Arm and Hand",
      parent: "torso",
      pivot: { x: 145, y: 220 },
      paths: [
        // Upper Arm
        {
          d: "M145 205 L105 295 L135 305 L165 220 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Forearm
        {
          d: "M105 295 L80 375 L115 385 L135 305 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Hand
        {
          d: "M76 380 C65 395, 80 420, 95 415 C110 410, 115 390, 112 380 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
    {
      id: "rightArm",
      name: "Right Arm and Hand",
      parent: "torso",
      pivot: { x: 255, y: 220 },
      paths: [
        // Upper Arm
        {
          d: "M255 205 L295 295 L265 305 L235 220 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Forearm
        {
          d: "M295 295 L320 375 L285 385 L265 305 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Hand
        {
          d: "M288 380 C285 390, 290 410, 305 415 C320 420, 335 395, 324 380 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
  ],
};
