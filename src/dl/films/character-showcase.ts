/**
 * File Description: Showcase film demonstrating the automated SVG character system.
 * Highlights the Astro Guide and Tech Architect characters in dual-mode (frame & anchor)
 * across multiple pose presets and smooth keyframe transitions.
 */

import type { Film } from "../schema";

export const characterShowcaseFilm: Film = {
  id: "character-showcase",
  title: "SVG Character System Showcase",
  fps: 30,
  accent: "#635BFF",
  theme: {
    background: "smooth-dark",
    fontFamily: "geist",
    storyStyle: "script-metaphor",
    cameraAngle: "isometric",
    accent: "#635BFF",
  },
  chapters: ["Welcome", "Explaining Concept", "Architecture Review", "Canvas Overview", "Final Payoff"],
  canvas: {
    nodes: [
      {
        id: "intro-node",
        label: "Welcome Guide",
        x: -220,
        y: -120,
        w: 240,
        h: 70,
      },
      {
        id: "concept-node",
        label: "Core Mechanism",
        x: 180,
        y: -120,
        w: 240,
        h: 70,
      },
      {
        id: "arch-node",
        label: "Architecture Lead",
        x: 180,
        y: 160,
        w: 240,
        h: 70,
      },
      {
        id: "payoff-node",
        label: "Milestone Reached",
        x: -220,
        y: 160,
        w: 240,
        h: 70,
      },
    ],
    edges: [
      { from: "intro-node", to: "concept-node", dashed: false },
      { from: "concept-node", to: "arch-node", dashed: false },
      { from: "arch-node", to: "payoff-node", dashed: true },
    ],
  },
  shots: [
    // Shot 1: Astro Guide welcoming the audience with wave -> neutral
    {
      id: "shot-intro",
      dur: 8,
      look: "intro-node",
      move: "cut",
      stage: "anchor",
      zoom: 1,
      drift: true,
      blocks: [
        {
          c: "TextReveal",
          text: "Meet the Vector Character System",
          size: "headline",
          accentWord: "Character",
        },
        {
          c: "CharacterBeat",
          characterId: "astronaut",
          poses: [
            {
              t: 0,
              groups: {
                torso: { rotate: 2 },
                head: { rotate: 6 },
                leftArm: { rotate: -5 },
                rightArm: { rotate: -125 },
              },
            },
            {
              t: 0.6,
              groups: {
                torso: { rotate: 0 },
                head: { rotate: 0 },
                leftArm: { rotate: 0 },
                rightArm: { rotate: 0 },
              },
            },
          ],
        },
      ],
    },
    // Shot 2: Text beat with stats (resets device rotation)
    {
      id: "shot-concept",
      dur: 10,
      look: "concept-node",
      move: "pan",
      stage: "frame",
      zoom: 1.1,
      drift: true,
      blocks: [
        {
          c: "TextReveal",
          text: "Zero Network Latency & 60 FPS Posing",
          size: "headline",
        },
        {
          c: "StatCounter",
          to: 60,
          label: "Frames Per Second",
          format: "plain",
          suffix: " FPS",
        },
      ],
    },
    // Shot 3: Tech Architect presenting architecture with think -> present-right
    {
      id: "shot-arch",
      dur: 12,
      look: "arch-node",
      move: "pan",
      stage: "anchor",
      zoom: 1.05,
      drift: true,
      blocks: [
        {
          c: "TextReveal",
          text: "Hierarchical Skeletal Transforms",
          size: "headline",
        },
        {
          c: "CharacterBeat",
          characterId: "developer",
          poses: [
            {
              t: 0,
              groups: {
                torso: { rotate: -4 },
                head: { rotate: -12 },
                leftArm: { rotate: 15 },
                rightArm: { rotate: -105 },
              },
            },
            {
              t: 0.5,
              groups: {
                torso: { rotate: 3 },
                head: { rotate: 5 },
                leftArm: { rotate: -10 },
                rightArm: { rotate: -65 },
              },
            },
          ],
        },
      ],
    },
    // Shot 4: Spine return to wide canvas view (resets device rotation)
    {
      id: "shot-spine",
      dur: 6,
      look: "all",
      move: "zoom-out",
      stage: "none",
      zoom: 0.85,
      drift: true,
      blocks: [],
    },
    // Shot 5: Astro Guide celebrating the final payoff
    {
      id: "shot-payoff",
      dur: 8,
      look: "payoff-node",
      move: "pan",
      stage: "frame",
      zoom: 1,
      drift: false,
      blocks: [
        {
          c: "TextReveal",
          text: "Seamless 6-Color Palette Harmony",
          size: "headline",
        },
        {
          c: "CharacterBeat",
          characterId: "astronaut",
          poses: [
            {
              t: 0,
              groups: {
                torso: { rotate: 0 },
                head: { rotate: -4 },
                leftArm: { rotate: 110 },
                rightArm: { rotate: -110 },
              },
            },
          ],
        },
      ],
    },
  ],
};
