/**
 * File Description: Pure TypeScript vector rig for the Astro Guide character.
 * Features an illustrated space explorer suit with helmet visor accent, seamless limb silhouettes,
 * and calibrated skeletal joint pivots.
 */

import type { CharacterRig } from "./types";

/** Astro Guide character vector rig with semantic token slots. */
export const astronautRig: CharacterRig = {
  id: "astronaut",
  name: "Astro Guide",
  viewBox: "0 0 400 600",
  defaultScale: 1,
  groups: [
    {
      id: "legs",
      name: "Legs and Boots",
      pivot: { x: 200, y: 390 },
      paths: [
        // Left Leg
        {
          d: "M160 380 L150 490 L130 520 L170 520 L180 480 L185 380 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Right Leg
        {
          d: "M240 380 L250 490 L270 520 L230 520 L220 480 L215 380 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Left Boot accent sole
        {
          d: "M125 520 L175 520 L175 532 L125 532 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 2,
        },
        // Right Boot accent sole
        {
          d: "M225 520 L275 520 L275 532 L225 532 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 2,
        },
        // Left Knee patch
        {
          d: "M148 435 Q165 430 180 435 L178 452 Q165 456 150 452 Z",
          fill: "muted",
          stroke: "hairline",
          strokeWidth: 2,
        },
        // Right Knee patch
        {
          d: "M220 435 Q235 430 252 435 L250 452 Q235 456 222 452 Z",
          fill: "muted",
          stroke: "hairline",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "torso",
      name: "Spacesuit Torso",
      pivot: { x: 200, y: 280 },
      paths: [
        // Backpack Life Support Unit
        {
          d: "M130 200 L270 200 L275 370 L125 370 Z",
          fill: "muted",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Main Torso Body
        {
          d: "M145 195 Q200 185 255 195 L260 385 Q200 395 140 385 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 5,
        },
        // Chest Control Panel
        {
          d: "M170 240 L230 240 L230 295 L170 295 Z",
          fill: "ink",
          stroke: "hairline",
          strokeWidth: 2,
        },
        // Chest Indicator Dial 1 (Accent)
        {
          d: "M180 255 A8 8 0 1 1 180 271 A8 8 0 1 1 180 255 Z",
          fill: "accent",
        },
        // Chest Indicator Dial 2
        {
          d: "M205 255 A8 8 0 1 1 205 271 A8 8 0 1 1 205 255 Z",
          fill: "muted",
        },
        // Belt line
        {
          d: "M142 355 L258 355 L257 375 L143 375 Z",
          fill: "ink",
          stroke: "hairline",
          strokeWidth: 2,
        },
        // Belt Buckle (Accent)
        {
          d: "M185 352 L215 352 L215 378 L185 378 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "head",
      name: "Helmet and Visor",
      parent: "torso",
      pivot: { x: 200, y: 190 },
      paths: [
        // Helmet Dome
        {
          d: "M135 145 C135 75, 265 75, 265 145 C265 190, 245 205, 200 205 C155 205, 135 190, 135 145 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 5,
        },
        // Helmet Collar Base
        {
          d: "M150 190 Q200 180 250 190 L245 208 Q200 216 155 208 Z",
          fill: "ink",
          stroke: "hairline",
          strokeWidth: 2,
        },
        // Golden/Accent Reflective Visor
        {
          d: "M152 140 C152 95, 248 95, 248 140 C248 175, 235 182, 200 182 C165 182, 152 175, 152 140 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Visor Light Reflection Sheen
        {
          d: "M165 115 Q190 105 215 110 Q190 118 165 115 Z",
          fill: "surface",
        },
      ],
    },
    {
      id: "leftArm",
      name: "Left Arm and Glove",
      parent: "torso",
      pivot: { x: 145, y: 220 },
      paths: [
        // Seamless Upper Arm & Forearm Limb Path
        {
          d: "M145 205 L105 295 L80 375 L115 385 L135 305 L165 220 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Glove Cuff
        {
          d: "M75 365 L120 375 L116 395 L72 385 Z",
          fill: "ink",
          stroke: "hairline",
          strokeWidth: 2,
        },
        // Glove Hand
        {
          d: "M76 390 C65 405, 80 430, 95 425 C110 420, 115 400, 112 390 Z",
          fill: "muted",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
    {
      id: "rightArm",
      name: "Right Arm and Glove",
      parent: "torso",
      pivot: { x: 255, y: 220 },
      paths: [
        // Seamless Upper Arm & Forearm Limb Path
        {
          d: "M255 205 L295 295 L320 375 L285 385 L265 305 L235 220 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Glove Cuff
        {
          d: "M280 375 L325 365 L328 385 L284 395 Z",
          fill: "ink",
          stroke: "hairline",
          strokeWidth: 2,
        },
        // Glove Hand
        {
          d: "M288 390 C285 400, 290 420, 305 425 C320 430, 335 405, 324 390 Z",
          fill: "muted",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
  ],
};
