/**
 * File Description: Production Film Definition for "Distributed Consensus: Raft vs. Paxos in 3 Minutes".
 * Audio-first locked timing spine (33.58s), cast (executive + developer),
 * and compliant device block transitions. (Axiom 1: pure data).
 */

import type { Film } from "../schema";

export const raftVsPaxosFilm: Film = {
  id: "raft-vs-paxos",
  title: "Distributed Consensus: Raft vs. Paxos",
  fps: 30,
  accent: "#635BFF",
  theme: {
    background: "smooth-dark",
    fontFamily: "geist",
    storyStyle: "script-metaphor",
    cameraAngle: "isometric",
    accent: "#635BFF",
  },
  audio: {
    src: "voiceover.wav",
    ducking: true,
  },
  captions: `WEBVTT

00:00:00.160 --> 00:00:05.140
Distributed systems rely on consensus to keep data consistent across unreliable networks.

00:00:05.661 --> 00:00:13.418
Paxos was the original foundation, but its complex dual phase design made real implementations notoriously difficult to reason about.

00:00:13.698 --> 00:00:20.038
Raft decomposes consensus into three clear subproblems: leader election, log replication, and safety.

00:00:20.559 --> 00:00:25.779
A single strong leader coordinates all writes and enforces log continuity across follower quorums.

00:00:26.245 --> 00:00:33.145
By making state transitions strictly understandable, Raft powers modern distributed infrastructure from etcd to Kubernetes.`,
  chapters: [
    "Consensus in Networks",
    "Paxos Complexity",
    "Raft Decomposed Subproblems",
    "Leader Log Quorum",
    "Cloud Infrastructure Payoff",
  ],
  canvas: {
    nodes: [
      {
        id: "consensus-problem",
        label: "State Consistency",
        x: -400,
        y: -150,
        w: 260,
        h: 90,
      },
      {
        id: "paxos-matrix",
        label: "Dual-Phase Paxos",
        x: 400,
        y: -150,
        w: 260,
        h: 90,
      },
      {
        id: "raft-engine",
        label: "Raft State Decomposition",
        x: 400,
        y: 200,
        w: 280,
        h: 90,
      },
      {
        id: "quorum-log",
        label: "Leader Quorum Replication",
        x: -400,
        y: 200,
        w: 260,
        h: 90,
      },
      {
        id: "k8s-payoff",
        label: "etcd & Kubernetes Backbone",
        x: 0,
        y: 380,
        w: 280,
        h: 90,
      },
    ],
    edges: [
      { from: "consensus-problem", to: "paxos-matrix", dashed: false },
      { from: "paxos-matrix", to: "raft-engine", dashed: false },
      { from: "raft-engine", to: "quorum-log", dashed: false },
      { from: "quorum-log", to: "k8s-payoff", dashed: true },
    ],
  },
  shots: [
    {
      id: "shot-1",
      dur: 5.58,
      look: "consensus-problem",
      move: "cut",
      stage: "anchor",
      visualDirection: "Tech Founder explains distributed consistency across unreliable nodes",
      blocks: [
        {
          c: "TextReveal",
          text: "Consensus in Distributed Systems",
          size: "headline",
          accentWord: "Consensus",
        },
        {
          c: "CharacterBeat",
          characterId: "executive",
          poses: [
            { t: 0.0, groups: { torso: { rotate: 0 }, rightArm: { rotate: -20 }, leftArm: { rotate: 20 } } },
            { t: 0.4, groups: { torso: { rotate: 3 }, rightArm: { rotate: -65 }, leftArm: { rotate: -10 } } },
            { t: 1.0, groups: { torso: { rotate: 0 }, rightArm: { rotate: 0 }, leftArm: { rotate: 0 } } },
          ],
        },
      ],
    },
    {
      id: "shot-2",
      dur: 8.04,
      look: "paxos-matrix",
      move: "pan",
      stage: "anchor",
      visualDirection: "Matrix showing multi-phase Paxos messaging complexity",
      blocks: [
        {
          c: "MatrixGrid",
          values: [
            [0.2, 0.4, 0.6, 0.8],
            [0.5, 0.9, 0.3, 0.7],
            [0.8, 0.2, 0.9, 0.4],
            [0.3, 0.7, 0.5, 0.9],
          ],
          rowLabel: "Proposers",
          colLabel: "Acceptors",
        },
      ],
    },
    {
      id: "shot-3",
      dur: 6.86,
      look: "raft-engine",
      move: "cut",
      stage: "anchor",
      visualDirection: "Tech Architect explains Raft 3 decomposed subproblems",
      blocks: [
        {
          c: "TextReveal",
          text: "Raft: Understandable Consensus",
          size: "headline",
          accentWord: "Understandable",
        },
        {
          c: "CharacterBeat",
          characterId: "developer",
          poses: [
            { t: 0.0, groups: { torso: { rotate: 0 }, rightArm: { rotate: -20 }, head: { rotate: 0 } } },
            { t: 0.4, groups: { torso: { rotate: -4 }, rightArm: { rotate: -75 }, head: { rotate: 6 } } },
            { t: 1.0, groups: { torso: { rotate: 0 }, rightArm: { rotate: 0 }, head: { rotate: 0 } } },
          ],
        },
      ],
    },
    {
      id: "shot-4",
      dur: 5.69,
      look: "quorum-log",
      move: "pan",
      stage: "anchor",
      visualDirection: "Token strip showing strong leader log replication across quorum",
      blocks: [
        {
          c: "TextReveal",
          text: "Leader Log Quorum Replication",
          size: "headline",
          accentWord: "Replication",
        },
        {
          c: "TokenStrip",
          tokens: ["Leader", "AppendEntries", "Follower 1", "Follower 2", "Commit"],
          lit: [0, 4],
          caption: "AppendEntries Majority Consensus",
        },
      ],
    },
    {
      id: "shot-5",
      dur: 7.42,
      look: "k8s-payoff",
      move: "pan",
      stage: "anchor",
      visualDirection: "Tech Founder celebrates Raft powering etcd and Kubernetes infrastructure",
      blocks: [
        {
          c: "TextReveal",
          text: "Powers etcd & Kubernetes Globally",
          size: "headline",
          accentWord: "Kubernetes",
        },
        {
          c: "CharacterBeat",
          characterId: "executive",
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
