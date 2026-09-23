/**
 * File Description: Exhaustive unit and invariant test suite for the Agent Director compilation engine.
 * Validates that long scripts (67+ beats across >12 sections) satisfy all 19 cinematic invariants
 * in src/dl/schema.ts without runtime crashes or heuristic repetition.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileFilmFromScreenplayAsync } from "./design";
import type { SegmentAudioInfo } from "../audio";
import { parseFilm } from "../../src/dl/schema";

test("Agent Director: compiles 67-beat script across 16 sections without invariant violations", async () => {
  // Generate a realistic 67-beat script spanning 16 sections (13*4 + 3*5 = 67)
  const numSections = 16;
  const beatsPerSection = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5];
  const sectionTitles = [
    "Introduction to Distributed State",
    "Consensus Fundamentals",
    "Paxos vs Raft Comparison",
    "Leader Election Mechanism",
    "Log Replication Cycle",
    "Commit Index Progression",
    "Network Partition Scenarios",
    "Split Brain Prevention",
    "Joint Consensus Reconfiguration",
    "Snapshotting Large State",
    "Log Compaction Strategies",
    "Client Request Handling",
    "Read-Index Optimization",
    "Lease Read Guarantees",
    "Failure Recovery Protocol",
    "Conclusion and Best Practices",
  ];

  const scriptParts: string[] = [];
  let beatCount = 0;

  for (let s = 0; s < numSections; s++) {
    const sTitle = sectionTitles[s];
    const sId = `section-${s + 1}`;
    scriptParts.push(`## [${sId}] ${sTitle}`);
    const bCount = beatsPerSection[s];

    for (let b = 0; b < bCount; b++) {
      beatCount++;
      const isParallel = b % 2 === 0;
      const isScaling = b % 3 === 0;
      const isMatrix = b % 5 === 0;

      const visual =
        b === 0
          ? `[VISUAL: b-roll of glowing server racks]`
          : isParallel
            ? `[VISUAL: batch of parallel tokens entering cluster]`
            : `[VISUAL: network node graph]`;

      const onscreen = `[ON SCREEN: Key Insight ${beatCount}: Distributed Coordination]`;
      const narration = isParallel
        ? `[NARRATION: In step ${beatCount}, all five replicas execute the transaction in parallel across the cluster with seventy percent throughput.]`
        : isScaling
          ? `[NARRATION: Throughput scales linearly as we add sixty nodes to the processing cluster.]`
          : isMatrix
            ? `[NARRATION: The state transition matrix maps incoming logs to memory positions.]`
            : `[NARRATION: Next, the leader heartbeat confirms active quorum membership across the nodes.]`;

      scriptParts.push(visual);
      scriptParts.push(onscreen);
      scriptParts.push(narration);
      scriptParts.push("");
    }
  }

  const scriptText = scriptParts.join("\n");

  // Mock narration audio info and durations
  const shotDurations: number[] = [];
  const narration: SegmentAudioInfo[] = [];

  for (let i = 0; i < 67; i++) {
    const dur = 3.5 + (i % 4) * 1.5; // durations between 3.5s and 8.0s
    shotDurations.push(dur);
    narration.push({
      text: `Narration beat ${i + 1}`,
      duration: dur,
      startOffset: shotDurations.slice(0, i).reduce((a, b) => a + b, 0),
      words: [],
      utterances: [],
    });
  }

  assert.equal(shotDurations.length, 67, "Precondition: exactly 67 shots");

  // Compile film with GEMINI_API_KEY explicitly cleared to prove zero cloud dependency
  const origKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;

  let result;
  try {
    result = await compileFilmFromScreenplayAsync(scriptText, narration, shotDurations, {
      title: "Distributed Consensus Deep Dive",
      slug: "distributed-consensus",
      fps: 30,
    }, { apiKey: "" });
  } finally {
    if (origKey) process.env.GEMINI_API_KEY = origKey;
  }

  const { film } = result;

  // 1. Validate full parseFilm conformance (19 cinematic invariants)
  const validated = parseFilm(film);
  assert.ok(validated, "Film passes parseFilm with zero schema errors");

  // 2. Invariant: Chapter cap (<= 12)
  assert.ok(
    film.chapters.length >= 1 && film.chapters.length <= 12,
    `Chapters must be between 1 and 12, got: ${film.chapters.length}`,
  );

  // 3. Invariant: Canvas node bounds (2 <= nodes <= 24)
  assert.ok(
    film.canvas.nodes.length >= 2 && film.canvas.nodes.length <= 24,
    `Canvas nodes must be between 2 and 24, got: ${film.canvas.nodes.length}`,
  );

  // 4. Invariant: Canvas edge bounds (1 <= edges <= 48)
  assert.ok(
    film.canvas.edges.length >= 1 && film.canvas.edges.length <= 48,
    `Canvas edges must be between 1 and 48, got: ${film.canvas.edges.length}`,
  );

  // 5. Invariant: First shot cut
  assert.equal(film.shots[0].move, "cut", "First shot must have move: 'cut'");

  // 6. Invariant: Chapter cuts alignment
  const cutShots = film.shots.filter((s) => s.move === "cut");
  assert.equal(
    cutShots.length,
    film.chapters.length,
    `Number of cut shots (${cutShots.length}) must equal number of chapters (${film.chapters.length})`,
  );

  // 7. Invariant: Device rotation (no device follows itself)
  let lastDevice: string | null = null;
  film.shots.forEach((shot, idx) => {
    const device = shot.blocks.find((b) =>
      [
        "MatrixGrid",
        "Distribution",
        "TokenStrip",
        "AttentionArcs",
        "VectorSpace",
        "LayerStack",
        "ScaleBar",
        "AnalogyInset",
        "Plot",
      ].includes(b.c as any),
    );

    if (device) {
      assert.notEqual(
        device.c,
        lastDevice,
        `Shot ${idx} (${shot.id}): device "${device.c}" follows itself without spine or beat in between`,
      );
      assert.ok(
        shot.dur <= 25,
        `Shot ${idx} (${shot.id}): device "${device.c}" duration ${shot.dur}s exceeds 25s limit`,
      );
      lastDevice = device.c;
    } else if (shot.stage === "none" || shot.stage === "frame") {
      lastDevice = null;
    }
  });

  // 8. Invariant: Periodic spine breathing and text beats
  let sinceCanvas = 0;
  let sinceBeat = 0;
  film.shots.forEach((shot, idx) => {
    sinceCanvas = shot.stage === "none" ? 0 : sinceCanvas + shot.dur;
    sinceBeat = shot.stage === "frame" ? 0 : sinceBeat + shot.dur;

    assert.ok(
      sinceCanvas <= 90,
      `Shot ${idx} (${shot.id}): ${sinceCanvas}s away from canvas spine (limit 90s)`,
    );
    assert.ok(
      sinceBeat <= 90,
      `Shot ${idx} (${shot.id}): ${sinceBeat}s without text beat (limit 90s)`,
    );
  });

  // 9. Invariant: Audio Sync. DIRECTOR_GUIDE.md's directing discipline asserts this in prose
  // ("Every shot duration locks to the measured narration audio timing, +-50ms") but nothing in
  // this suite checked it: every other invariant here is about the film's own shape, not about
  // it staying locked to the narration spine that was actually measured and handed in.
  film.shots.forEach((shot, idx) => {
    assert.ok(
      Math.abs(shot.dur - shotDurations[idx]) <= 0.05,
      `Shot ${idx} (${shot.id}): dur ${shot.dur}s drifted from the measured narration ` +
        `duration ${shotDurations[idx]}s by more than the 50ms audio-sync budget`,
    );
  });
});

test("Agent Director: handles boundary case of 1 section (satisfying min 2 nodes schema invariant)", async () => {
  const scriptText = `
## [intro] Single Concept Video
[VISUAL: overview diagram]
[ON SCREEN: Single Focus]
[NARRATION: Everything revolves around this one fundamental insight.]
[ON SCREEN: Deep Dive]
[NARRATION: We explore the mechanics in full detail.]
`;
  const durations = [5.5, 6.0];
  const narration: SegmentAudioInfo[] = durations.map((dur, i) => ({
    text: `Narration beat ${i + 1}`,
    duration: dur,
    words: [],
    utterances: [],
    startOffset: durations.slice(0, i).reduce((a, b) => a + b, 0),
  }));

  const { film } = await compileFilmFromScreenplayAsync(scriptText, narration, durations, {
    title: "Single Focus Film",
    slug: "single-focus",
  }, { apiKey: "" });

  const validated = parseFilm(film);
  assert.ok(validated);
  assert.ok(film.canvas.nodes.length >= 2, "Must create at least 2 nodes");
  assert.equal(film.chapters.length, 1);
});

test("Agent Director: handles boundary case of 32 sections (capping nodes to 24 and chapters to 12)", async () => {
  const lines: string[] = [];
  const durations: number[] = [];
  const narration: SegmentAudioInfo[] = [];

  for (let s = 1; s <= 32; s++) {
    lines.push(`## [sec-${s}] Section Title ${s}`);
    lines.push(`[ON SCREEN: Section Point ${s}]`);
    lines.push(`[NARRATION: Narration for section number ${s} in this long sequence.]`);
    const dur = 4.0;
    durations.push(dur);
    narration.push({
      text: `Narration for section ${s}`,
      duration: dur,
      words: [],
      utterances: [],
      startOffset: (s - 1) * 4.0,
    });
  }

  const { film } = await compileFilmFromScreenplayAsync(lines.join("\n"), narration, durations, {
    title: "Large Scale Multi-Section Film",
    slug: "large-scale",
  }, { apiKey: "" });

  const validated = parseFilm(film);
  assert.ok(validated);
  assert.ok(film.chapters.length <= 12, `Chapters must be <= 12, got ${film.chapters.length}`);
  assert.ok(film.canvas.nodes.length <= 24, `Nodes must be <= 24, got ${film.canvas.nodes.length}`);
  assert.ok(film.canvas.edges.length <= 48, `Edges must be <= 48, got ${film.canvas.edges.length}`);
});
