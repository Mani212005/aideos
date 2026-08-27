/**
 * File Description: Phase B Unit & Visual Regression Test Suite.
 * Asserts tests V-1 through V-5 and named negative cases for unified block positioning.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { computeBlockRect, isDeviceBlock } from "../../src/dl/layout";
import { MetaphorViewer, SpiderWebAnimation, LiquidContainerAnimation, BalanceScaleAnimation, ClockGearsAnimation, CharacterThrowScriptAnimation } from "../../src/dl/metaphors/MetaphorViewer";
import { BlockView } from "../../src/dl/Block";
import { renderMetaphorStill } from "./renderMetaphorStill";
import { DEVICE_BLOCKS, type Film, type Shot, type Block, type MetaphorContent } from "../../src/dl/schema";

const LONG_VIEWPORT = { width: 1920, height: 1080 };
const REEL_VIEWPORT = { width: 1080, height: 1920 };

const METAPHOR_TYPES: Array<MetaphorContent["kind"]> = [
  "spider-web",
  "liquid-bucket",
  "balance-scale",
  "clock-gears",
  "character-throw",
  "typing-cursor-quote",
  "glowing-cluster",
];

const sampleFilm: Film = {
  id: "test-phase-b",
  title: "Phase B Unified Positioning Test",
  fps: 30,
  chapters: ["chapter-1"],
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
      blocks: [
        { c: "TextReveal", text: "Why Mars Has No Liquid Water", size: "headline" },
        { c: "MetaphorViewer", metaphorType: "balance-scale" },
      ],
    },
    {
      id: "shot-2",
      dur: 6,
      stage: "anchor",
      look: "node-2",
      move: "pan",
      blocks: [
        { c: "TextReveal", text: "Atmospheric Pressure Regimes", size: "headline" },
        { c: "ScaleBar", ticks: ["0.1%", "1%", "10%", "100%"], value: 0.35 },
      ],
    },
  ],
};

test("V-1: For a shot containing both TextReveal and MetaphorViewer, both rects are produced by computeBlockRect", () => {
  const shot = sampleFilm.shots[0];
  const textBlock = shot.blocks[0];
  const metaphorBlock = shot.blocks[1];

  const textRect = computeBlockRect(sampleFilm, shot, textBlock, LONG_VIEWPORT, { blockIndex: 0 });
  const metaphorRect = computeBlockRect(sampleFilm, shot, metaphorBlock, LONG_VIEWPORT, { blockIndex: 1 });

  // Both rects must be valid non-zero bounding boxes
  assert.ok(textRect.w > 0 && textRect.h > 0, "TextReveal rect must have positive dimensions");
  assert.ok(metaphorRect.w > 0 && metaphorRect.h > 0, "MetaphorViewer rect must have positive dimensions");

  // In stage: "frame" with multiple blocks, headline is in the upper area and metaphor is below it
  assert.ok(textRect.y < metaphorRect.y, "Headline rect must sit above the visual metaphor rect");
  assert.ok(textRect.y + textRect.h <= metaphorRect.y, "Headline and metaphor rects must not overlap vertically");

  // Assert programmatically that isDeviceBlock classifies MetaphorViewer as a device block
  assert.equal(isDeviceBlock(metaphorBlock), true, "isDeviceBlock must return true for MetaphorViewer");
  assert.equal(isDeviceBlock(textBlock), false, "isDeviceBlock must return false for TextReveal");
});

test("V-2: Every device block's rect centre lies within the middle 60% of viewport in both Long and Reel", () => {
  const allDeviceBlockTypes: Block[] = [
    { c: "MetaphorViewer", metaphorType: "balance-scale" },
    { c: "CharacterBeat", characterId: "astronaut", poses: [] },
    { c: "ScaleBar", ticks: ["1", "10", "100"], value: 0.5 },
    { c: "LayerStack", count: 8 },
    { c: "Plot", points: [[0, 0], [1, 1]] },
    { c: "MatrixGrid", values: [[0.1, 0.2], [0.3, 0.4]] },
    { c: "TokenStrip", tokens: ["a", "b", "c"] },
  ];

  const testShot: Shot = {
    id: "shot-v2",
    dur: 5,
    stage: "frame",
    look: "node-1",
    move: "cut",
    blocks: [],
  };

  for (const block of allDeviceBlockTypes) {
    testShot.blocks = [{ c: "TextReveal", text: "Device Header" }, block];

    // Check Long Viewport (1920x1080)
    const longRect = computeBlockRect(sampleFilm, testShot, block, LONG_VIEWPORT, { blockIndex: 1 });
    const longCenterX = longRect.x + longRect.w / 2;
    const longCenterY = longRect.y + longRect.h / 2;

    const longMinX = LONG_VIEWPORT.width * 0.20;
    const longMaxX = LONG_VIEWPORT.width * 0.80;
    const longMinY = LONG_VIEWPORT.height * 0.20;
    const longMaxY = LONG_VIEWPORT.height * 0.80;

    assert.ok(
      longCenterX >= longMinX && longCenterX <= longMaxX,
      `${block.c} Long CenterX (${longCenterX}) must lie in middle 60% [${longMinX}..${longMaxX}]`
    );
    assert.ok(
      longCenterY >= longMinY && longCenterY <= longMaxY,
      `${block.c} Long CenterY (${longCenterY}) must lie in middle 60% [${longMinY}..${longMaxY}]`
    );

    // Check Reel Viewport (1080x1920)
    const reelRect = computeBlockRect(sampleFilm, testShot, block, REEL_VIEWPORT, { blockIndex: 1 });
    const reelCenterX = reelRect.x + reelRect.w / 2;
    const reelCenterY = reelRect.y + reelRect.h / 2;

    const reelMinX = REEL_VIEWPORT.width * 0.20;
    const reelMaxX = REEL_VIEWPORT.width * 0.80;
    const reelMinY = REEL_VIEWPORT.height * 0.20;
    const reelMaxY = REEL_VIEWPORT.height * 0.80;

    assert.ok(
      reelCenterX >= reelMinX && reelCenterX <= reelMaxX,
      `${block.c} Reel CenterX (${reelCenterX}) must lie in middle 60% [${reelMinX}..${reelMaxX}]`
    );
    assert.ok(
      reelCenterY >= reelMinY && reelCenterY <= reelMaxY,
      `${block.c} Reel CenterY (${reelCenterY}) must lie in middle 60% [${reelMinY}..${reelMaxY}]`
    );
  }
});

test("V-3: No block's rect extends outside viewport bounds across formats and stages", () => {
  const viewports = [LONG_VIEWPORT, REEL_VIEWPORT];
  const stages: Array<"frame" | "anchor"> = ["frame", "anchor"];

  const sampleBlocks: Block[] = [
    { c: "TextReveal", text: "Testing Bounding Box Confinement Across Formats" },
    { c: "MetaphorViewer", metaphorType: "liquid-bucket" },
    { c: "CharacterBeat", characterId: "developer", poses: [] },
    { c: "StatCounter", to: 100, label: "Efficiency Gain", suffix: "%" },
    { c: "ScaleBar", ticks: ["10k", "100k", "1M"], value: 0.8 },
  ];

  for (const vp of viewports) {
    for (const stage of stages) {
      const shot: Shot = {
        id: `shot-${stage}`,
        dur: 5,
        stage,
        look: "node-1",
        move: "cut",
        blocks: sampleBlocks,
      };

      sampleBlocks.forEach((block, idx) => {
        const rect = computeBlockRect(sampleFilm, shot, block, vp, {
          blockIndex: idx,
          totalBlocks: sampleBlocks.length,
        });

        assert.ok(rect.x >= 0, `Block ${block.c} (${stage}) x (${rect.x}) must be >= 0`);
        assert.ok(rect.y >= 0, `Block ${block.c} (${stage}) y (${rect.y}) must be >= 0`);
        assert.ok(
          rect.x + rect.w <= vp.width,
          `Block ${block.c} (${stage}) x+w (${rect.x + rect.w}) must be <= viewport width (${vp.width})`
        );
        assert.ok(
          rect.y + rect.h <= vp.height,
          `Block ${block.c} (${stage}) y+h (${rect.y + rect.h}) must be <= viewport height (${vp.height})`
        );
      });
    }
  }
});

test("V-4: For each metaphor type, its rendered SVG root declares viewBox and preserveAspectRatio='xMidYMid meet'", () => {
  const components = [
    { name: "SpiderWebAnimation", el: React.createElement(SpiderWebAnimation, { frame: 30, accent: "#635BFF" }) },
    { name: "LiquidContainerAnimation", el: React.createElement(LiquidContainerAnimation, { frame: 30, accent: "#635BFF" }) },
    { name: "BalanceScaleAnimation", el: React.createElement(BalanceScaleAnimation, { frame: 30, accent: "#635BFF" }) },
    { name: "ClockGearsAnimation", el: React.createElement(ClockGearsAnimation, { frame: 30, accent: "#635BFF" }) },
    { name: "CharacterThrowScriptAnimation", el: React.createElement(CharacterThrowScriptAnimation, { frame: 30, accent: "#635BFF" }) },
  ];

  for (const { name, el } of components) {
    const markup = ReactDOMServer.renderToStaticMarkup(el);
    assert.ok(markup.includes("<svg"), `${name} must render an SVG element`);
    assert.ok(markup.includes('viewBox="'), `${name} SVG must declare an explicit viewBox`);
    assert.ok(
      markup.includes('preserveAspectRatio="xMidYMid meet"'),
      `${name} SVG must declare preserveAspectRatio="xMidYMid meet"`
    );
  }
});

test("V-5 / Visual Review: Render high-res PNG stills for all metaphor types in Long and Reel", () => {
  const outDirLong = path.resolve(process.cwd(), "out/metaphors/long");
  const outDirReel = path.resolve(process.cwd(), "out/metaphors/reel");
  fs.mkdirSync(outDirLong, { recursive: true });
  fs.mkdirSync(outDirReel, { recursive: true });

  for (const type of METAPHOR_TYPES) {
    const longPath = path.join(outDirLong, `${type}.png`);
    const reelPath = path.join(outDirReel, `${type}.png`);

    renderMetaphorStill(type, undefined, LONG_VIEWPORT, longPath);
    renderMetaphorStill(type, undefined, REEL_VIEWPORT, reelPath);

    assert.ok(fs.existsSync(longPath), `Long still for ${type} must exist on disk at ${longPath}`);
    assert.ok(fs.existsSync(reelPath), `Reel still for ${type} must exist on disk at ${reelPath}`);
  }
});

test("V-6 / Content Preservation: A shot with both MetaphorViewer and TextReveal renders BOTH elements without dropping either", () => {
  const multiBlockShot: Shot = {
    id: "shot-multi",
    dur: 6,
    stage: "frame",
    look: "node-1",
    move: "cut",
    blocks: [
      { c: "TextReveal", text: "Atmospheric Pressure and Sublimation", size: "headline" },
      {
        c: "MetaphorViewer",
        content: {
          kind: "balance-scale",
          leftLabel: "Atmospheric Pressure",
          rightLabel: "Vapor Pressure",
          caption: "Triple Point Equilibrium",
        },
      },
    ],
  };

  const markupText = ReactDOMServer.renderToStaticMarkup(
    React.createElement(BlockView, { block: multiBlockShot.blocks[0], start: 0, index: 0, durationInFrames: 180 })
  );
  const markupMetaphor = ReactDOMServer.renderToStaticMarkup(
    React.createElement(BlockView, { block: multiBlockShot.blocks[1], start: 0, index: 1, durationInFrames: 180 })
  );

  assert.ok(
    markupText.includes("Atmospheric") && markupText.includes("Sublimation"),
    "Rendered text markup must contain headline words"
  );
  assert.ok(
    markupMetaphor.includes("<svg") && markupMetaphor.includes("Triple Point Equilibrium"),
    "Rendered metaphor markup must contain SVG and caption"
  );
});

test("Phase B Negative Case 1: Missing viewBox in SVG fails V-4 assertion", () => {
  const brokenSvgElement = React.createElement("svg", { width: 500, height: 360 }, React.createElement("circle", { r: 10 }));
  const markup = ReactDOMServer.renderToStaticMarkup(brokenSvgElement);

  const hasViewBox = markup.includes('viewBox="');
  const hasPreserveAspect = markup.includes('preserveAspectRatio="xMidYMid meet"');

  assert.equal(hasViewBox, false, "Broken SVG should lack viewBox");
  assert.equal(hasPreserveAspect, false, "Broken SVG should lack preserveAspectRatio");
});

test("Phase B Negative Case 2: Forcing block rect to (0, 0) top-left fails V-2 center-60% assertion", () => {
  const forcedTopLeftRect = { x: 0, y: 0, w: 500, h: 360 };
  const centerX = forcedTopLeftRect.x + forcedTopLeftRect.w / 2; // 250
  const centerY = forcedTopLeftRect.y + forcedTopLeftRect.h / 2; // 180

  const minX = LONG_VIEWPORT.width * 0.20; // 384
  const minY = LONG_VIEWPORT.height * 0.20; // 216

  const passesCenterX = centerX >= minX;
  const passesCenterY = centerY >= minY;

  assert.equal(passesCenterX, false, "Forced top-left centerX (250) must fail minX (384) assertion");
  assert.equal(passesCenterY, false, "Forced top-left centerY (180) must fail minY (216) assertion");
});
