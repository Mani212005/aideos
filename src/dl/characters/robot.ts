/**
 * File Description: Pure TypeScript vector rig for the Cyber AI Robot character.
 * Features a friendly floating AI companion with glowing accent visor, antenna, and articulated mechanical arms.
 */

import type { CharacterRig } from "./types";

/** Cyber AI Robot character vector rig with semantic token slots. */
export const robotRig: CharacterRig = {
  id: "robot",
  name: "Cyber AI Bot",
  description: "Floating AI companion with glowing visor and articulated limbs",
  viewBox: "0 0 400 600",
  defaultScale: 1,
  groups: [
    {
      id: "legs",
      name: "Hover Thruster",
      pivot: { x: 200, y: 390 },
      paths: [
        // Thruster Cone
        {
          d: "M170 380 L160 440 L240 440 L230 380 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Glowing Thruster Ring
        {
          d: "M150 440 L250 440 L245 455 L155 455 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Energy Pulse Plume
        {
          d: "M175 455 Q200 510 200 530 Q200 510 225 455 Z",
          fill: "accent",
          stroke: "hairline",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "torso",
      name: "Chassis & Core",
      pivot: { x: 200, y: 320 },
      paths: [
        // Main Robot Chassis Pod
        {
          d: "M130 220 Q200 205 270 220 L280 370 Q200 395 120 370 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 5,
        },
        // Chest Glowing Core Reactor
        {
          d: "M175 275 Q200 260 225 275 Q225 315 200 325 Q175 315 175 275 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Data Wave Indicator Lines
        {
          d: "M150 345 L250 345",
          fill: "none",
          stroke: "hairline",
          strokeWidth: 3,
        },
        {
          d: "M165 355 L235 355",
          fill: "none",
          stroke: "muted",
          strokeWidth: 2,
        },
      ],
    },
    {
      id: "head",
      name: "Head & Visor Screen",
      parent: "torso",
      pivot: { x: 200, y: 170 },
      paths: [
        // Antenna Mast
        {
          d: "M198 100 L198 70 L202 70 L202 100 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 2,
        },
        // Antenna Glowing Beaming Orb
        {
          d: "M190 60 A 10 10 0 1 0 210 60 A 10 10 0 1 0 190 60 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Robot Head Shell
        {
          d: "M130 110 Q200 95 270 110 Q285 195 270 205 Q200 215 130 205 Q115 195 130 110 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 5,
        },
        // Digital Screen Display Face
        {
          d: "M145 125 Q200 120 255 125 L250 190 Q200 195 150 190 Z",
          fill: "canvas",
          stroke: "ink",
          strokeWidth: 3,
        },
        // Glowing Digital Eye 1
        {
          d: "M168 150 A 9 9 0 1 0 186 150 A 9 9 0 1 0 168 150 Z",
          fill: "accent",
          stroke: "none",
        },
        // Glowing Digital Eye 2
        {
          d: "M214 150 A 9 9 0 1 0 232 150 A 9 9 0 1 0 214 150 Z",
          fill: "accent",
          stroke: "none",
        },
        // Friendly Digital Smile Arc
        {
          d: "M185 174 Q200 182 215 174",
          fill: "none",
          stroke: "accent",
          strokeWidth: 3,
        },
      ],
    },
    {
      id: "leftArm",
      name: "Left Mechanical Arm",
      parent: "torso",
      pivot: { x: 125, y: 235 },
      paths: [
        // Shoulder Joint
        {
          d: "M110 235 A 15 15 0 1 0 140 235 A 15 15 0 1 0 110 235 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 2,
        },
        // Arm Link
        {
          d: "M120 240 L90 320 L115 330 L135 245 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Forearm Link
        {
          d: "M90 320 L60 380 L85 390 L110 325 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Magnetic Claw Hand
        {
          d: "M55 385 Q45 405 60 415 L70 405 Q65 395 75 390 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
    {
      id: "rightArm",
      name: "Right Mechanical Arm",
      parent: "torso",
      pivot: { x: 275, y: 235 },
      paths: [
        // Shoulder Joint
        {
          d: "M260 235 A 15 15 0 1 0 290 235 A 15 15 0 1 0 260 235 Z",
          fill: "ink",
          stroke: "ink",
          strokeWidth: 2,
        },
        // Arm Link
        {
          d: "M280 240 L310 320 L285 330 L265 245 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Forearm Link
        {
          d: "M310 320 L340 380 L315 390 L290 325 Z",
          fill: "surface",
          stroke: "ink",
          strokeWidth: 4,
        },
        // Magnetic Claw Hand
        {
          d: "M345 385 Q355 405 340 415 L330 405 Q335 395 325 390 Z",
          fill: "accent",
          stroke: "ink",
          strokeWidth: 3,
        },
      ],
    },
  ],
};
