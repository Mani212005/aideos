/**
 * File Description: Phase C Unit & Regression Test Suite.
 * Asserts tests M-1 through M-5 and named negative cases for data-driven metaphor components.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { lintMetaphorSourceFiles, FORBIDDEN_HARDCODED_LABELS } from "./lintMetaphors";
import { MetaphorViewer } from "../../src/dl/metaphors/MetaphorViewer";
import { validateFilmAudioAndAssets } from "../../src/dl/validateFilm";
import type { Film, MetaphorContent } from "../../src/dl/schema";

const baseFilm: Film = {
  id: "test-film-c",
  title: "Phase C Data Driven Test",
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
      blocks: [
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
    },
    {
      id: "shot-2",
      dur: 6,
      stage: "frame",
      look: "node-2",
      move: "pan",
      blocks: [
        {
          c: "TextReveal",
          text: "Subsurface Ice Sheets Discovered",
          size: "headline",
        },
      ],
    },
  ],
};

test("M-1: Source scan asserts no file in src/dl/metaphors contains hardcoded topic-specific labels", () => {
  const result = lintMetaphorSourceFiles();
  assert.equal(result.clean, true, `Metaphor source files must be 100% clean of hardcoded topic terms. Violations: ${result.violations.join("; ")}`);
});

test("M-2: Rendering a metaphor with content A then content B produces different label text", () => {
  const contentA: MetaphorContent = {
    kind: "balance-scale",
    leftLabel: "Compute Latency",
    rightLabel: "Memory Bandwidth",
    caption: "Hardware Trade-Off",
  };

  const contentB: MetaphorContent = {
    kind: "balance-scale",
    leftLabel: "Martian Atmospheric Pressure",
    rightLabel: "Liquid Water Triple Point",
    caption: "Phase Boundary Equilibrium",
  };

  const markupA = ReactDOMServer.renderToStaticMarkup(
    React.createElement(MetaphorViewer, {
      type: "balance-scale",
      content: contentA,
      frame: 30,
      accent: "#635BFF",
    })
  );

  const markupB = ReactDOMServer.renderToStaticMarkup(
    React.createElement(MetaphorViewer, {
      type: "balance-scale",
      content: contentB,
      frame: 30,
      accent: "#635BFF",
    })
  );

  assert.ok(markupA.includes("Compute Latency"), "markupA must render leftLabel from contentA");
  assert.ok(markupA.includes("Memory Bandwidth"), "markupA must render rightLabel from contentA");
  assert.ok(!markupA.includes("Martian Atmospheric Pressure"), "markupA must not contain contentB labels");

  assert.ok(markupB.includes("Martian Atmospheric Pressure"), "markupB must render leftLabel from contentB");
  assert.ok(markupB.includes("Liquid Water Triple Point"), "markupB must render rightLabel from contentB");
  assert.ok(!markupB.includes("Compute Latency"), "markupB must not contain contentA labels");
});

test("M-3: Rule M1 rejects a MetaphorViewer block with no content payload", () => {
  const badFilm: any = {
    ...baseFilm,
    shots: [
      {
        id: "shot-1",
        dur: 6,
        stage: "frame",
        look: "node-1",
        move: "cut",
        blocks: [{ c: "MetaphorViewer", metaphorType: "balance-scale" }],
      },
      {
        id: "shot-2",
        dur: 6,
        stage: "frame",
        look: "node-2",
        move: "pan",
        blocks: [{ c: "TextReveal", text: "Valid Shot 2" }],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(badFilm),
    /METAPHOR_MISSING_CONTENT/,
    "validateFilm must reject MetaphorViewer without content"
  );
});

test("M-4: Rule M3 rejects shot metaphor and content.kind mismatch (the exact E-1 failure)", () => {
  const mismatchedFilm: any = {
    ...baseFilm,
    shots: [
      {
        id: "shot-1",
        dur: 6,
        stage: "frame",
        look: "node-1",
        move: "cut",
        metaphor: "liquid-bucket",
        blocks: [
          {
            c: "MetaphorViewer",
            content: {
              kind: "balance-scale",
              leftLabel: "Left",
              rightLabel: "Right",
              caption: "Scale",
            },
          },
        ],
      },
      {
        id: "shot-2",
        dur: 6,
        stage: "frame",
        look: "node-2",
        move: "pan",
        blocks: [{ c: "TextReveal", text: "Valid Shot 2" }],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(mismatchedFilm),
    /METAPHOR_KIND_MISMATCH/,
    "validateFilm must reject shot with metaphor: liquid-bucket and content.kind: balance-scale"
  );
});

test("M-5: Cross-film check compiles repo films and verifies zero GPU terms appear in non-GPU films", async () => {
  const marsModule = await import("../../src/dl/films/mars-water");
  const browsersModule = await import("../../src/dl/films/how-browsers-work");
  const raftModule = await import("../../src/dl/films/raft-vs-paxos");

  const nonGpuFilms = [
    { name: "mars-water", film: marsModule.marsWaterFilm || marsModule.ACTIVE_FILM },
    { name: "how-browsers-work", film: browsersModule.howBrowsersWorkFilm || browsersModule.ACTIVE_FILM },
    { name: "raft-vs-paxos", film: raftModule.raftVsPaxosFilm || raftModule.ACTIVE_FILM },
  ];

  for (const { name, film } of nonGpuFilms) {
    const validated = validateFilmAudioAndAssets(film);
    const jsonStr = JSON.stringify(validated);

    for (const forbidden of FORBIDDEN_HARDCODED_LABELS) {
      assert.equal(
        jsonStr.includes(forbidden),
        false,
        `Film "${name}" must not contain GPU term "${forbidden}"`
      );
    }
  }
});

test("Phase C Negative Case 1: Re-introducing a hardcoded label fails M-1 source scan lint", () => {
  const tmpMockDir = path.resolve(process.cwd(), "out/.tmp_mock_metaphors");
  fs.mkdirSync(tmpMockDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpMockDir, "MockBrokenMetaphor.tsx"),
    'export const Bad = () => <div>Compute Cost and VRAM Bandwidth</div>;'
  );

  const lintResult = lintMetaphorSourceFiles(tmpMockDir);
  fs.rmSync(tmpMockDir, { recursive: true, force: true });

  assert.equal(lintResult.clean, false, "Lint must catch hardcoded 'Compute Cost' and 'VRAM Bandwidth'");
  assert.ok(lintResult.violations.length >= 2, "Lint must report at least 2 violations");
});

test("Phase C Negative Case 2: Constructing exact E-1 mismatch fails M-4", () => {
  const exactE1Shot: any = {
    id: "shot-mars-1",
    dur: 6,
    stage: "frame",
    look: "node-1",
    move: "cut",
    metaphor: "liquid-bucket",
    blocks: [
      {
        c: "MetaphorViewer",
        content: {
          kind: "balance-scale",
          leftLabel: "Compute Cost",
          rightLabel: "VRAM Bandwidth",
          caption: "Precision Trade-Off Equilibrium",
        },
      },
    ],
  };

  const e1Film: any = {
    ...baseFilm,
    shots: [
      exactE1Shot,
      {
        id: "shot-mars-2",
        dur: 6,
        stage: "frame",
        look: "node-2",
        move: "pan",
        blocks: [{ c: "TextReveal", text: "Valid Shot 2" }],
      },
    ],
  };

  assert.throws(
    () => validateFilmAudioAndAssets(e1Film),
    /METAPHOR_KIND_MISMATCH/
  );
});
