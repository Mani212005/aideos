/**
 * File Description: Production Film Definition for "Transformers vs. Mamba: The Linear State Space Revolution".
 * Audio-first locked timing spine (41.44s), dual cast (data-engineer + robot),
 * and compliant device block transitions. (Axiom 1: pure data).
 */

import type { Film } from "../schema";

export const transformersVsMambaFilm: Film = {
  id: "transformers-vs-mamba",
  title: "Transformers vs. Mamba: Linear State Spaces",
  fps: 30,
  accent: "#FF6B00",
  theme: {
    background: "smooth-dark",
    fontFamily: "geist",
    storyStyle: "script-metaphor",
    cameraAngle: "isometric",
    accent: "#FF6B00",
  },
  audio: {
    src: "voiceover.wav",
    ducking: true,
  },
  captions: `WEBVTT

00:00:00.160 --> 00:00:08.660
Transformers conquer natural language processing, but their quadratic attention cost creates a severe computational bottleneck on long sequences.

00:00:09.346 --> 00:00:15.686
As context expands to millions of tokens, standard key value caching consumes massive high bandwidth memory.

00:00:16.047 --> 00:00:20.307
Mamba introduces selective state space models with time varying discretization.

00:00:21.266 --> 00:00:28.806
Instead of comparing every token to all previous tokens, it compresses historical context into a constant size hidden state.

00:00:29.170 --> 00:00:34.550
Hardware associative scans compute the state in linear time directly inside fast SRAM registers.

00:00:35.090 --> 00:00:41.030
The result is 5x higher inference throughput and infinite context scaling without memory explosion.`,
  chapters: [
    "Quadratic Bottleneck",
    "KV-Cache Memory Bloat",
    "Selective State Spaces",
    "Constant-Size Compression",
    "Hardware-Aware Scans",
    "5x Throughput Payoff",
  ],
  canvas: {
    nodes: [
      {
        id: "quadratic-wall",
        label: "Quadratic Complexity",
        x: -400,
        y: -200,
        w: 260,
        h: 90,
      },
      {
        id: "kv-cache",
        label: "KV-Cache Memory Bloat",
        x: 400,
        y: -200,
        w: 260,
        h: 90,
      },
      {
        id: "mamba-ssm",
        label: "Selective SSM Engine",
        x: 400,
        y: 200,
        w: 260,
        h: 90,
      },
      {
        id: "constant-hidden",
        label: "Constant Hidden State",
        x: -400,
        y: 200,
        w: 260,
        h: 90,
      },
      {
        id: "hardware-scan",
        label: "Fast SRAM Linear Scan",
        x: 0,
        y: 0,
        w: 280,
        h: 90,
      },
      {
        id: "payoff",
        label: "5x Inference Payoff",
        x: 0,
        y: 400,
        w: 280,
        h: 90,
      },
    ],
    edges: [
      { from: "quadratic-wall", to: "kv-cache", dashed: false },
      { from: "kv-cache", to: "mamba-ssm", dashed: false },
      { from: "mamba-ssm", to: "constant-hidden", dashed: false },
      { from: "constant-hidden", to: "hardware-scan", dashed: false },
      { from: "hardware-scan", to: "payoff", dashed: true },
    ],
  },
  shots: [
    {
      id: "shot-1",
      dur: 8.99,
      look: "quadratic-wall",
      move: "cut",
      stage: "anchor",
      visualDirection: "Systems Architect explains quadratic attention bottleneck",
      blocks: [
        {
          c: "TextReveal",
          text: "The Quadratic Attention Problem",
          size: "headline",
          accentWord: "Quadratic",
        },
        {
          c: "CharacterBeat",
          characterId: "data-engineer",
          poses: [
            { t: 0.0, groups: { torso: { rotate: 0 }, rightArm: { rotate: -20 }, leftArm: { rotate: 20 } } },
            { t: 0.4, groups: { torso: { rotate: 5 }, rightArm: { rotate: -70 }, leftArm: { rotate: 0 } } },
            { t: 0.8, groups: { torso: { rotate: -3 }, rightArm: { rotate: -30 }, leftArm: { rotate: 10 } } },
            { t: 1.0, groups: { torso: { rotate: 0 }, rightArm: { rotate: 0 }, leftArm: { rotate: 0 } } },
          ],
        },
      ],
    },
    {
      id: "shot-2",
      dur: 6.86,
      look: "kv-cache",
      move: "pan",
      stage: "anchor",
      visualDirection: "Layer stack showing expanding KV-Cache memory consumption",
      blocks: [
        {
          c: "LayerStack",
          count: 12,
          bottomLabel: "Tokens (1k -> 1M)",
          topLabel: "KV-Cache (GBs)",
        },
      ],
    },
    {
      id: "shot-3",
      dur: 5.06,
      look: "mamba-ssm",
      move: "cut",
      stage: "anchor",
      visualDirection: "Cyber AI Bot introduces selective state spaces with time-varying discretization",
      blocks: [
        {
          c: "TextReveal",
          text: "Selective State Spaces",
          size: "headline",
          accentWord: "Selective",
        },
        {
          c: "CharacterBeat",
          characterId: "robot",
          poses: [
            { t: 0.0, groups: { torso: { rotate: 0 }, rightArm: { rotate: -30 }, leftArm: { rotate: 30 }, legs: { rotate: 0 } } },
            { t: 0.5, groups: { torso: { rotate: -5 }, rightArm: { rotate: -70 }, leftArm: { rotate: -70 }, legs: { rotate: 12 } } },
            { t: 1.0, groups: { torso: { rotate: 0 }, rightArm: { rotate: 0 }, leftArm: { rotate: 0 }, legs: { rotate: 0 } } },
          ],
        },
      ],
    },
    {
      id: "shot-4",
      dur: 7.98,
      look: "constant-hidden",
      move: "pan",
      stage: "anchor",
      visualDirection: "Token strip compressing continuous sequence into fixed hidden dimension",
      blocks: [
        {
          c: "TextReveal",
          text: "Fixed-Size Recurrent State Space",
          size: "headline",
          accentWord: "Recurrent",
        },
        {
          c: "TokenStrip",
          tokens: ["x0", "x1", "x2", "x3", "x4", "h_t"],
          lit: [5],
          caption: "Continuous Compression into State h_t",
        },
      ],
    },
    {
      id: "shot-5",
      dur: 6.0,
      look: "hardware-scan",
      move: "cut",
      stage: "anchor",
      visualDirection: "Linear scaling comparison in SRAM hardware associative scans",
      blocks: [
        {
          c: "ScaleBar",
          ticks: ["1k", "10k", "100k", "1M"],
          value: 0.9,
        },
      ],
    },
    {
      id: "shot-6",
      dur: 6.55,
      look: "payoff",
      move: "pan",
      stage: "anchor",
      visualDirection: "Systems Architect celebrates 5x throughput with infinite context",
      blocks: [
        {
          c: "TextReveal",
          text: "5x Faster Inference & Infinite Context",
          size: "headline",
          accentWord: "5x",
        },
        {
          c: "CharacterBeat",
          characterId: "data-engineer",
          poses: [
            { t: 0.0, groups: { torso: { rotate: 0 }, head: { rotate: 0 }, leftArm: { rotate: 0 }, rightArm: { rotate: 0 } } },
            { t: 0.25, groups: { torso: { rotate: 0 }, head: { rotate: -4 }, leftArm: { rotate: 110 }, rightArm: { rotate: -110 } } },
            { t: 0.85, groups: { torso: { rotate: 0 }, head: { rotate: -4 }, leftArm: { rotate: 110 }, rightArm: { rotate: -110 } } },
            { t: 1.0, groups: { torso: { rotate: 0 }, head: { rotate: 0 }, leftArm: { rotate: 0 }, rightArm: { rotate: 0 } } },
          ],
        },
      ],
    },
  ],
};
