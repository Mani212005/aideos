/**
 * File Description: Pure TypeScript vector rig for the Tech Founder & Executive Presenter character.
 * Features a modern tailored suit jacket, collar, smartwatch accent, and clean keynote presentation gestures.
 */

import type { CharacterRig } from "./types";

/** Tech Founder character vector rig with semantic token slots. */
export const executiveRig: CharacterRig = {
  id: "executive",
  name: "Tech Founder",
  description: "Executive presenter with modern tailored blazer and keynote posture",
  viewBox: "0 0 400 600",
  defaultScale: 1,
  groups: [
    {
      id: "legs",
      name: "Trousers & Dress Shoes",
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
        // Shoes
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
      name: "Blazer & Shirt",
      pivot: { x: 200, y: 310 },
      paths: [
        // Inner Crisp Shirt
        {
          d: "M170 205 L230 205 L225 365 L175 365 Z",
          fill: "surface",
          stroke: "hairline",
          strokeWidth: 2,
        },
        // Pocket Square Accent
        {
          d: "M155 260 L180 260 L175 270 L155 270 Z",
          fill: "accent",
          stroke: "none",
        },
        // Tailored Jacket Left Lapel
        {
          d: "M130 200 L185 210 L195 340 L165 375 L120 360 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Tailored Jacket Right Lapel
        {
          d: "M270 200 L215 210 L205 340 L235 375 L280 360 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
      ],
    },
    {
      id: "head",
      name: "Head & Hair",
      parent: "torso",
      pivot: { x: 200, y: 155 },
      paths: [
        // Sleek Hair
        {
          d: "M145 135 Q200 90 255 135 L255 160 Q200 120 145 160 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Face
        {
          d: "M155 130 Q200 125 245 130 L240 185 Q200 205 160 185 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Confident Eyes
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
        // Confident Smile
        {
          d: "M188 172 Q200 180 212 172",
          fill: "none",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
    {
      id: "leftArm",
      name: "Left Sleeve & Smartwatch",
      parent: "torso",
      pivot: { x: 130, y: 215 },
      paths: [
        // Jacket Sleeve
        {
          d: "M130 205 L90 295 L118 305 L150 225 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Forearm
        {
          d: "M90 295 L70 370 L95 375 L115 300 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Smartwatch Accent Band
        {
          d: "M73 360 L92 364 L90 372 L71 368 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 1,
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
        // Jacket Sleeve
        {
          d: "M270 205 L310 295 L282 305 L250 225 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Forearm
        {
          d: "M310 295 L330 370 L305 375 L285 300 Z",
          fill: "canvas",
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
