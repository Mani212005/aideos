/**
 * File Description: Pure TypeScript vector rig for the AI Researcher & Lab Scientist character.
 * Features a modern research lab coat, round smart glasses, credentials lanyard badge, and articulated limbs.
 */

import type { CharacterRig } from "./types";

/** AI Researcher character vector rig with semantic token slots. */
export const scientistRig: CharacterRig = {
  id: "scientist",
  name: "AI Researcher",
  description: "Lab researcher with white coat, round glasses, and research credentials badge",
  viewBox: "0 0 400 600",
  defaultScale: 1,
  groups: [
    {
      id: "legs",
      name: "Trousers & Shoes",
      pivot: { x: 200, y: 400 },
      paths: [
        // Left Leg
        {
          d: "M160 390 L150 500 L125 525 L165 525 L180 490 L185 390 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Right Leg
        {
          d: "M240 390 L250 500 L275 525 L235 525 L220 490 L215 390 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Shoes
        {
          d: "M120 525 L170 525 L170 535 L120 535 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 2,
        },
        {
          d: "M230 525 L280 525 L280 535 L230 535 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "torso",
      name: "Lab Coat & Shirt",
      pivot: { x: 200, y: 320 },
      paths: [
        // Inner Research Shirt
        {
          d: "M160 210 L240 210 L240 370 L160 370 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Accent Tie / Collar
        {
          d: "M190 215 L210 215 L205 285 L195 285 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 2,
        },
        // Lab Coat Left Flap
        {
          d: "M130 210 L185 220 L175 420 L120 390 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Lab Coat Right Flap
        {
          d: "M270 210 L215 220 L225 420 L280 390 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Research Badge Lanyard
        {
          d: "M180 215 L180 280 L195 280 L195 215 Z",
          fill: "hairline",
          stroke: "accent",
          strokeWidth: 2,
        },
        // Research Pass Card
        {
          d: "M175 280 L200 280 L200 305 L175 305 Z",
          fill: "surface",
          stroke: "accent",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "head",
      name: "Head & Glasses",
      parent: "torso",
      pivot: { x: 200, y: 160 },
      paths: [
        // Hair & Brain Outline
        {
          d: "M145 140 Q200 85 255 140 Q260 170 250 190 Q200 210 150 190 Q140 170 145 140 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Face
        {
          d: "M155 130 Q200 120 245 130 L240 185 Q200 205 160 185 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Left Glasses Lens Frame
        {
          d: "M165 145 A 14 14 0 1 0 193 145 A 14 14 0 1 0 165 145 Z",
          fill: "none",
          stroke: "accent",
          strokeWidth: 3,
        },
        // Right Glasses Lens Frame
        {
          d: "M207 145 A 14 14 0 1 0 235 145 A 14 14 0 1 0 207 145 Z",
          fill: "none",
          stroke: "accent",
          strokeWidth: 3,
        },
        // Glasses Bridge
        {
          d: "M193 145 L207 145",
          fill: "none",
          stroke: "accent",
          strokeWidth: 3,
        },
        // Eyes
        {
          d: "M175 145 A 3 3 0 1 0 181 145 A 3 3 0 1 0 175 145 Z",
          fill: "ink",
          stroke: "none",
        },
        {
          d: "M217 145 A 3 3 0 1 0 223 145 A 3 3 0 1 0 217 145 Z",
          fill: "ink",
          stroke: "none",
        },
        // Smile
        {
          d: "M188 175 Q200 182 212 175",
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
      pivot: { x: 130, y: 220 },
      paths: [
        // Lab Coat Left Sleeve
        {
          d: "M130 215 L85 300 L115 310 L150 230 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Forearm
        {
          d: "M85 300 L65 375 L90 380 L110 305 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Hand
        {
          d: "M60 375 Q50 395 70 400 Q80 390 85 375 Z",
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
      pivot: { x: 270, y: 220 },
      paths: [
        // Lab Coat Right Sleeve
        {
          d: "M270 215 L315 300 L285 310 L250 230 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Forearm
        {
          d: "M315 300 L335 375 L310 380 L290 305 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Hand
        {
          d: "M340 375 Q350 395 330 400 Q320 390 315 375 Z",
          fill: "muted",
          stroke: "ink",
          strokeWidth: 2,
        },
      ],
    },
  ],
};
