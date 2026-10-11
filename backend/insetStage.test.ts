/**
 * File Description: Tests for the inset stage: the SVG geometry the inset rule measures with, the film schema's
 * stage: "inset" rules, and the guarantee that the editor preview and the Remotion export share one render tree.
 * Inputs and outputs: SVG snippets, film fixtures and rendered markup -> inset stage assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { Thumbnail } from "@remotion/player";
import { TEST_VIDEOS_DIR } from "./testSupport/fixtureVideosDir";
import { parseFilm } from "../src/dl/schema";
import { buildTimeline } from "../src/dl/camera";
import { getInsetRegion } from "../src/dl/fullScreenHeroLayout";
import { parseSvgDocument } from "../src/dl/scene/svgDocument";
import { FilmView } from "../src/dl/Film";
import { Video } from "../src/dl/Video";
import { apply, leafBounds, parseTransform } from "./designCheck/svgBounds";

// Parses one SVG element out of a snippet and returns its local bounding box.
function boundsOf(markup: string) {
  const doc = parseSvgDocument(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`);
  return leafBounds(doc.children[0]);
}

// Extracts the panel rectangle from rendered HTML for an inset device container.
function extractInsetRect(html: string): { x: number; y: number; w: number; h: number } | null {
  const match = html.match(
    /style="[^"]*position:absolute;left:([0-9.]+)px;top:([0-9.]+)px;width:([0-9.]+)px;height:([0-9.]+)px;[^"]*background:#141416[^"]*"/,
  );
  if (!match) return null;
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    w: Number(match[3]),
    h: Number(match[4]),
  };
}

test("svg bounds: shapes are measured from their attributes, stroke included", () => {
  assert.deepEqual(boundsOf(`<rect x="10" y="20" width="30" height="40"/>`), { x0: 10, y0: 20, x1: 40, y1: 60 });
  assert.deepEqual(boundsOf(`<circle cx="0" cy="0" r="10" stroke="#F5F5F5" stroke-width="4"/>`), { x0: -12, y0: -12, x1: 12, y1: 12 });
  assert.deepEqual(boundsOf(`<line x1="5" y1="9" x2="-5" y2="1"/>`), { x0: -5, y0: 1, x1: 5, y1: 9 });
});

test("svg bounds: a path is bounded by its endpoints and control points, relative commands included", () => {
  const b = boundsOf(`<path d="M10 10 L20 10 l0 30 h-10 C0 50 0 60 5 70 z"/>`)!;
  assert.deepEqual(b, { x0: 0, y0: 10, x1: 20, y1: 70 });
});

test("svg bounds: text is bounded by its anchor, size and length", () => {
  const b = boundsOf(`<text x="100" y="50" font-size="10" text-anchor="middle">ABCD</text>`)!;
  assert.ok(b.x0 < 100 && b.x1 > 100 && Math.abs(100 - b.x0 - (b.x1 - 100)) < 1e-9, "centred on x");
  assert.ok(b.y0 < 50 && b.y1 > 50);
});

test("svg bounds: transform lists compose left to right", () => {
  const m = parseTransform("translate(10 20) scale(2) rotate(90)");
  const [x, y] = apply(m, 1, 0);
  assert.ok(Math.abs(x - 10) < 1e-9 && Math.abs(y - 22) < 1e-9, `${x},${y}`);
  assert.deepEqual(apply(parseTransform(undefined), 3, 4), [3, 4]);
});

test("film schema: a scene film accepts a one-device inset, and stage still defaults to anchor", () => {
  const film = JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "inset-stage/film.json"), "utf8"));
  assert.equal(parseFilm(film).shots[1].stage, "inset");
  delete film.shots[1].stage;
  film.shots[1].look = "rack";
  assert.equal(parseFilm(film).shots[1].stage, "anchor");
});

test("render tree: the editor preview and the export both render FilmView, and FilmView draws the inset", () => {
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "inset-stage/film.json"), "utf8")));
  const timeline = buildTimeline(film);
  const frameInsideInsetShot = 150;

  for (const [format, width, height] of [["long", 1920, 1080], ["reel", 1080, 1920]] as const) {
    const expected = getInsetRegion(format, width, height);

    const previewHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(Thumbnail as React.ComponentType<any>, {
        component: FilmView,
        compositionWidth: width,
        compositionHeight: height,
        frameToDisplay: frameInsideInsetShot,
        durationInFrames: 300,
        fps: 30,
        inputProps: {
          film,
          timeline,
          accent: film.accent,
          showGrid: false,
          showRail: true,
          includeAudio: false,
        },
      }),
    );

    const exportHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(Thumbnail as React.ComponentType<any>, {
        component: Video,
        compositionWidth: width,
        compositionHeight: height,
        frameToDisplay: frameInsideInsetShot,
        durationInFrames: 300,
        fps: 30,
        inputProps: {
          film,
          timeline,
          accent: film.accent,
          showGrid: false,
          showRail: true,
        },
      }),
    );

    const previewRect = extractInsetRect(previewHtml);
    const exportRect = extractInsetRect(exportHtml);

    assert.ok(previewRect, `Preview must render an inset device panel for format ${format}`);
    assert.ok(exportRect, `Export must render an inset device panel for format ${format}`);

    assert.ok(Math.abs(previewRect.x - expected.x) < 1e-4, `preview x matches getInsetRegion for ${format}`);
    assert.ok(Math.abs(previewRect.y - expected.y) < 1e-4, `preview y matches getInsetRegion for ${format}`);
    assert.ok(Math.abs(previewRect.w - expected.w) < 1e-4, `preview width matches getInsetRegion for ${format}`);
    assert.ok(Math.abs(previewRect.h - expected.h) < 1e-4, `preview height matches getInsetRegion for ${format}`);

    assert.deepEqual(previewRect, exportRect, `Preview and export must produce identical panel geometry for ${format}`);

    for (const [name, html] of [["preview", previewHtml], ["export", exportHtml]] as const) {
      assert.ok(html.includes("<svg") && html.includes('id="entity-rack"'), `${name} must include the scene stage markup`);
      const svgTagIndex = html.indexOf("<svg");
      const immediateSvgContainer = html.slice(Math.max(0, svgTagIndex - 300), svgTagIndex);
      assert.ok(!immediateSvgContainer.includes("opacity:"), `${name} scene stage must not be wrapped in an opacity dimming layer`);

      const margin = format === "reel" ? { left: 64, right: 64, top: 160, bottom: 384 } : { left: 96, right: 96, top: 96, bottom: 96 };
      const targetSafeW = width - margin.left - margin.right;
      const targetSafeH = height - margin.top - margin.bottom;
      assert.ok(
        !html.includes(`left:${margin.left}px;top:${margin.top}px;width:${targetSafeW}px;height:${targetSafeH}px`),
        `${name} must not render a full-frame panel covering the target safe area for ${format}`,
      );
    }
  }
});
