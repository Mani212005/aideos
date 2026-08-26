/**
 * File Description: Pure TypeScript vector rig for the Academic Educator & Tutor character.
 * Features a cozy cardigan vest, teacher spectacles, and friendly welcoming presentation gestures.
 */

import type { CharacterRig } from "./types";

/** Academic Educator character vector rig with semantic token slots. */
export const educatorRig: CharacterRig = {
  id: "educator",
  name: "Academic Tutor",
  description: "Friendly educator with cardigan vest, glasses, and step-by-step teaching gestures",
  viewBox: "0 0 400 600",
  defaultScale: 1,
  groups: [
    {
      id: "legs",
      name: "Trousers & Loafers",
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
        // Loafers
        {
          d: "M120 520 L170 520 L170 532 L120 532 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 2,
        },
        {
          d: "M230 520 L280 520 L280 532 L230 532 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "torso",
      name: "Cardigan & Collar",
      pivot: { x: 200, y: 310 },
      paths: [
        // Inner Oxford Shirt
        {
          d: "M170 205 L230 205 L225 365 L175 365 Z",
          fill: "surface",
          stroke: "hairline",
          strokeWidth: 2,
        },
        // Cardigan Vest Left Panel
        {
          d: "M130 200 L180 215 L190 350 L160 375 L120 360 Z",
          fill: "muted",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Cardigan Vest Right Panel
        {
          d: "M270 200 L220 215 L210 350 L240 375 L280 360 Z",
          fill: "muted",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Accent Button Row
        {
          d: "M195 245 A 3 3 0 1 0 205 245 A 3 3 0 1 0 195 245 Z",
          fill: "accent",
          stroke: "none",
        },
        {
          d: "M195 285 A 3 3 0 1 0 205 285 A 3 3 0 1 0 195 285 Z",
          fill: "accent",
          stroke: "none",
        },
        {
          d: "M195 325 A 3 3 0 1 0 205 325 A 3 3 0 1 0 195 325 Z",
          fill: "accent",
          stroke: "none",
        },
      ],
    },
    {
      id: "head",
      name: "Head & Spectacles",
      parent: "torso",
      pivot: { x: 200, y: 155 },
      paths: [
        // Hair
        {
          d: "M145 135 Q200 85 255 135 L255 160 Q200 120 145 160 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Face
        {
          d: "M155 130 Q200 125 245 130 L240 185 Q200 205 160 185 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Round Tortoise Glasses Frame
        {
          d: "M165 145 A 14 14 0 1 0 193 145 A 14 14 0 1 0 165 145 Z",
          fill: "none",
          stroke: "ink",
          strokeWidth: 2,
        },
        {
          d: "M207 145 A 14 14 0 1 0 235 145 A 14 14 0 1 0 207 145 Z",
          fill: "none",
          stroke: "ink",
          strokeWidth: 2,
        },
        {
          d: "M193 145 L207 145",
          fill: "none",
          stroke: "ink",
          strokeWidth: 2,
        },
        // Eyes
        {
          d: "M175 145 A 3 3 0 1 0 181 145 A 3 3 0 1 0 175 145 Z",
          fill: "ink",
          stroke: "none",
        },
        {
          d: "M219 145 A 3 3 0 1 0 225 145 A 3 3 0 1 0 219 145 Z",
          fill: "ink",
          stroke: "none",
        },
        // Warm Smile
        {
          d: "M188 174 Q200 182 212 174",
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
        // Shirt Sleeve
        {
          d: "M130 205 L90 295 L118 305 L150 225 Z",
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
      name: "Right Sleeve & Pointer Hand",
      parent: "torso",
      pivot: { x: 270, y: 215 },
      paths: [
        // Shirt Sleeve
        {
          d: "M270 205 L310 295 L282 305 L250 225 Z",
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
