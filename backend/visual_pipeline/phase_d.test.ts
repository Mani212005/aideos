/**
 * File Description: Phase D Unit & Regression Test Suite.
 * Asserts tests D-1 through D-7 and named negative cases for reasoned visual intent selection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VISUAL_BLOCK_REGISTRY,
  METAPHOR_REGISTRY,
  selectShotVisualIntent,
} from "../ideation/visualSelector";
import { buildBriefFromSegmentFallback } from "../ideation/segmentSync";
import { validateFilmAudioAndAssets } from "../../src/dl/validateFilm";
import { DEVICE_BLOCKS, type Film, type MetaphorContent } from "../../src/dl/schema";

const baseFilm: Film = {
  id: "test-film-d",
  title: "Phase D Reasoned Visual Selection Test",
  fps: 30,
  chapters: ["chapter-1", "chapter-2"],
  canvas: {
    nodes: [
      { id: "node-1", label: "chapter-1", x: 100, y: 200, w: 190, h: 62 },
      { id: "node-2", label: "chapter-2", x: 500, y: 200, w: 190, h: 62 },
    ],
    edges: [{ from: "node-1", to: "node-2", dashed: false }],
  },
  shots: [
    {
      id: "shot-1",
      dur: 6,
      stage: "frame",
      look: "node-1",
      move: "cut",
      drift: false,
      zoom: 1,
      visualDirection: "Astro Guide introduces the atmospheric loss mechanism on Mars",
      blocks: [
        {
          c: "TextReveal",
          text: "Why Mars Has No Liquid Water",
          size: "headline",
        },
      ],
    },
    {
      id: "shot-2",
      dur: 6,
      stage: "frame",
      look: "node-2",
      move: "pan",
      drift: false,
      zoom: 1,
      visualDirection: "ScaleBar comparing atmospheric density between Earth and Mars",
      blocks: [
        {
          c: "ScaleBar",
          ticks: ["0.1%", "1%", "10%", "100%"],
          value: 0.35,
        },
      ],
    },
  ],
};

test("D-1: The keyword matcher is deleted; no code selects a visual from lexical triggers", () => {
  const testInputs = [
    "An HTTP request reaches Google edge reverse proxy which load balances traffic",
    "Liquid water cannot exist on the surface of Mars due to low atmospheric pressure",
    "Every token looks back in time at every previous token in the sequence",
  ];

  for (const sentence of testInputs) {
    const brief = buildBriefFromSegmentFallback(sentence, "shot-test");
    assert.ok(
      !brief.visualDirection.startsWith('Visual representation of narration segment: "'),
      `visualDirection must be reasoned rationale, not template string for: "${sentence}"`
    );
  }
});

test("D-2: Given browser shot-4 ('load balances traffic'), selector does NOT return balance-scale", async () => {
  const narration = "An HTTP request reaches Google's edge reverse proxy, which load balances traffic to backend clusters.";
  const decision = await selectShotVisualIntent({
    shotId: "shot-4",
    narration,
    prevNarration: "Next, your browser establishes a TCP handshake and negotiates TLS encryption.",
  });

  assert.notEqual(
    decision.metaphor?.kind,
    "balance-scale",
    `Selector must NOT return balance-scale on narration containing 'balances'. Returned: ${decision.metaphor?.kind || decision.blockType}`
  );
  assert.ok(decision.rationale.length > 10, "Selector must provide a specific rationale");
});

test("D-3: Given a shot with no clear visual need, selector returns 'none' (first-class typography)", async () => {
  const conceptualNarration = "Why does distributed consensus matter in modern cloud systems?";
  const decision = await selectShotVisualIntent({
    shotId: "shot-intro",
    narration: conceptualNarration,
  });

  assert.equal(
    decision.blockType,
    "none",
    "Selector must return 'none' for conceptual rhetorical questions"
  );
  assert.ok(
    decision.rationale.toLowerCase().includes("typography") || decision.rationale.toLowerCase().includes("narrative"),
    "Rationale must justify clean typography choice"
  );
});

test("D-4: Rule M4 rejects a film containing the template visualDirection string", () => {
  const templateFilm: Film = {
    ...baseFilm,
    shots: [
      {
        id: "shot-1",
        dur: 6,
        stage: "frame",
        look: "node-1",
        move: "cut",
        drift: false,
        zoom: 1,
        visualDirection: 'Visual representation of narration segment: "Why Mars Has No Liquid Water"',
        blocks: [{ c: "TextReveal", text: "Why Mars Has No Liquid Water", size: "headline" }],
      },
      {
        id: "shot-2",
        dur: 6,
        stage: "frame",
        look: "node-2",
        move: "pan",
        drift: false,
        zoom: 1,
        visualDirection: "Valid reasoned rationale",
        blocks: [{ c: "TextReveal", text: "Valid headline", size: "headline" }],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(templateFilm),
    /TEMPLATE_VISUAL_DIRECTION/,
    "validateFilm must reject template visualDirection string (Rule M4)"
  );
});

test("D-5: Rule M5 rejects a 5-shot film using one metaphor 4 times (the Mars case)", () => {
  const overuseFilm: Film = {
    ...baseFilm,
    shots: [
      {
        id: "shot-1",
        dur: 5,
        stage: "frame",
        look: "node-1",
        move: "cut",
        drift: false,
        zoom: 1,
        visualDirection: "Mars atmospheric overview",
        metaphor: "liquid-bucket",
        blocks: [{ c: "TextReveal", text: "Mars Oceans Lost", size: "headline" }],
      },
      {
        id: "shot-2",
        dur: 5,
        stage: "frame",
        look: "node-1",
        move: "pan",
        drift: false,
        zoom: 1,
        visualDirection: "Interleaved text beat",
        blocks: [{ c: "TextReveal", text: "Low Pressure Regimes", size: "headline" }],
      },
      {
        id: "shot-3",
        dur: 5,
        stage: "frame",
        look: "node-2",
        move: "cut",
        drift: false,
        zoom: 1,
        visualDirection: "Triple point comparison",
        metaphor: "liquid-bucket",
        blocks: [{ c: "TextReveal", text: "Triple Point Below Surface", size: "headline" }],
      },
      {
        id: "shot-4",
        dur: 5,
        stage: "frame",
        look: "node-2",
        move: "pan",
        drift: false,
        zoom: 1,
        visualDirection: "Interleaved text beat",
        blocks: [{ c: "TextReveal", text: "Direct Sublimation", size: "headline" }],
      },
      {
        id: "shot-5",
        dur: 5,
        stage: "frame",
        look: "node-2",
        move: "cut",
        drift: false,
        zoom: 1,
        visualDirection: "Subsurface reservoirs",
        metaphor: "liquid-bucket",
        blocks: [{ c: "TextReveal", text: "Subsurface Ice Sheets", size: "headline" }],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(overuseFilm),
    /METAPHOR_OVERUSE_VIOLATION/,
    "validateFilm must reject metaphor used in 3 of 5 shots (60% > 40%) (Rule M5)"
  );
});

test("D-6: Rule M6 rejects two consecutive identical metaphors", () => {
  const consecutiveFilm: Film = {
    ...baseFilm,
    shots: [
      {
        id: "shot-1",
        dur: 6,
        stage: "frame",
        look: "node-1",
        move: "cut",
        drift: false,
        zoom: 1,
        visualDirection: "Reasoned direction 1",
        metaphor: "balance-scale",
        blocks: [{ c: "TextReveal", text: "Compute Tradeoff", size: "headline" }],
      },
      {
        id: "shot-2",
        dur: 6,
        stage: "frame",
        look: "node-2",
        move: "pan",
        drift: false,
        zoom: 1,
        visualDirection: "Reasoned direction 2",
        metaphor: "balance-scale",
        blocks: [{ c: "TextReveal", text: "Memory Tradeoff", size: "headline" }],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(consecutiveFilm),
    /CONSECUTIVE_METAPHOR_VIOLATION/,
    "validateFilm must reject two consecutive balance-scale metaphors (Rule M6)"
  );
});

test("D-7: Visual and Metaphor registries contain all registered schema blocks and kinds", () => {
  const registeredBlockTypes = new Set(VISUAL_BLOCK_REGISTRY.map((b) => b.blockType));
  for (const devBlock of DEVICE_BLOCKS) {
    assert.ok(
      registeredBlockTypes.has(devBlock),
      `VISUAL_BLOCK_REGISTRY must contain schema DEVICE_BLOCK "${devBlock}"`
    );
  }

  const registeredMetaphors = new Set(METAPHOR_REGISTRY.map((m) => m.kind));
  const expectedMetaphors: Array<MetaphorContent["kind"]> = [
    "balance-scale",
    "liquid-bucket",
    "clock-gears",
    "spider-web",
    "character-throw",
    "typing-cursor-quote",
    "glowing-cluster",
  ];

  for (const kind of expectedMetaphors) {
    assert.ok(
      registeredMetaphors.has(kind),
      `METAPHOR_REGISTRY must contain metaphor kind "${kind}"`
    );
  }
});

test("Phase D Negative Case 1: Mars 4x liquid-bucket mapping fails Rule M5", () => {
  const marsOveruseFilm: Film = {
    ...baseFilm,
    shots: [
      {
        id: "shot-1",
        dur: 5,
        stage: "frame",
        look: "node-1",
        move: "cut",
        drift: false,
        zoom: 1,
        visualDirection: "Mars shot 1",
        metaphor: "liquid-bucket",
        blocks: [{ c: "TextReveal", text: "Mars shot 1", size: "headline" }],
      },
      {
        id: "shot-2",
        dur: 5,
        stage: "frame",
        look: "node-1",
        move: "pan",
        drift: false,
        zoom: 1,
        visualDirection: "Mars shot 2",
        blocks: [{ c: "TextReveal", text: "Mars shot 2", size: "headline" }],
      },
      {
        id: "shot-3",
        dur: 5,
        stage: "frame",
        look: "node-2",
        move: "cut",
        drift: false,
        zoom: 1,
        visualDirection: "Mars shot 3",
        metaphor: "liquid-bucket",
        blocks: [{ c: "TextReveal", text: "Mars shot 3", size: "headline" }],
      },
      {
        id: "shot-4",
        dur: 5,
        stage: "frame",
        look: "node-2",
        move: "pan",
        drift: false,
        zoom: 1,
        visualDirection: "Mars shot 4",
        blocks: [{ c: "TextReveal", text: "Mars shot 4", size: "headline" }],
      },
      {
        id: "shot-5",
        dur: 5,
        stage: "frame",
        look: "node-2",
        move: "cut",
        drift: false,
        zoom: 1,
        visualDirection: "Mars shot 5",
        metaphor: "liquid-bucket",
        blocks: [{ c: "TextReveal", text: "Mars shot 5", size: "headline" }],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(marsOveruseFilm),
    /METAPHOR_OVERUSE_VIOLATION/
  );
});

test("Phase D Negative Case 2: Template visualDirection fails Rule M4", () => {
  const templateFilm: Film = {
    ...baseFilm,
    shots: [
      {
        id: "shot-1",
        dur: 6,
        stage: "frame",
        look: "node-1",
        move: "cut",
        drift: false,
        zoom: 1,
        visualDirection: 'Visual representation of narration segment: "Why Mars Has No Liquid Water"',
        blocks: [{ c: "TextReveal", text: "Why Mars Has No Liquid Water", size: "headline" }],
      },
      {
        id: "shot-2",
        dur: 6,
        stage: "frame",
        look: "node-2",
        move: "pan",
        drift: false,
        zoom: 1,
        visualDirection: "Valid non-template direction",
        blocks: [{ c: "TextReveal", text: "Valid Text", size: "headline" }],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(templateFilm),
    /TEMPLATE_VISUAL_DIRECTION/
  );
});
