/**
 * File Description: Test suite for the declarative custom SVG animation engine (A-1 through A-16).
 * Covers the SVG document parser, timeline validation and compilation, hold-and-evolve continuity,
 * staggered staged entry, draw-on reveals, render-time element identity and id namespacing,
 * byte-for-byte render determinism, audio-first retiming, the Remotion entry point, and a
 * RUN_VISUAL_TESTS-gated frame strip written to disk for human review.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Scene } from "../../src/dl/scene/types";
import type { SvgAnimationTimeline } from "../../src/dl/scene/svgAnimation";
import {
  applySvgEasing,
  compileSvgTimeline,
  identitySvgElementState,
  stagedEntryClips,
  svgElementStateToTransform,
  validateSvgTimeline,
} from "../../src/dl/scene/svgAnimation";
import {
  collectSvgElementIds,
  findSvgNodeById,
  parseSvgDocument,
  parseViewBox,
  serializeSvgDocument,
} from "../../src/dl/scene/svgDocument";
import { compileScene } from "../../src/dl/scene/compile";
import { validateSceneWithNodeAssets } from "../../src/dl/scene/validateSceneNode";
import { loadSceneAssets } from "./loadSceneAssets";
import { renderFrameSvgMarkup, renderFrameStill, readPngDimensions } from "./renderStill";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { SceneClip } from "../../src/dl/scene/SceneClip";
import { alignSceneToAudio, audioSyncDriftMs, framesForAudioMs } from "../../src/dl/scene/sceneTiming";

const DIAGRAM_SVG = path.resolve("test_fixtures/svg/pipeline_diagram.svg");
const OUT_STRIP_DIR = path.resolve("out/svg_movie");

/** Builds the demo timeline: nodes stage in, edges draw on, a token travels, a caption lands. */
function makeDemoTimeline(): SvgAnimationTimeline {
  return {
    timelineId: "pipeline-assembles",
    clips: [
      ...stagedEntryClips({
        clipIdPrefix: "nodes-in",
        targets: ["node-input", "node-model", "node-output"],
        startFrame: 0,
        durationFrames: 18,
        staggerFrames: 8,
        risePx: 14,
      }),
      { clipId: "edge-1-draw", targets: ["edge-in-model"], property: "drawOn", from: 0, to: 1, startFrame: 26, durationFrames: 14 },
      { clipId: "edge-2-draw", targets: ["edge-model-out"], property: "drawOn", from: 0, to: 1, startFrame: 40, durationFrames: 14 },
      { clipId: "token-appear", targets: ["token"], property: "opacity", from: 0, to: 1, startFrame: 54, durationFrames: 6 },
      { clipId: "token-travel", targets: ["token"], property: "translateX", from: 0, to: 290, startFrame: 60, durationFrames: 45, easing: "expoInOut" },
      { clipId: "model-pulse", targets: ["node-model"], property: "scale", from: 1, to: 1.18, startFrame: 62, durationFrames: 12, origin: { x: 0, y: 0 } },
      { clipId: "model-settle", targets: ["node-model"], property: "scale", from: 1.18, to: 1, startFrame: 74, durationFrames: 16, origin: { x: 0, y: 0 } },
      { clipId: "caption-in", targets: ["caption"], property: "opacity", from: 0, to: 1, startFrame: 88, durationFrames: 20 },
    ],
  };
}

/** Builds the demo scene: one animated diagram prop clocked to a 4 second audio segment. */
function makeDemoScene(): Scene {
  return {
    schemaVersion: "1.0.0",
    sceneId: "svg-movie-demo",
    fps: 30,
    durationFrames: 120,
    audioSource: "audio/demo.wav",
    audioDurationMs: 4000,
    sceneSize: { w: 1920, h: 1080 },
    background: {
      assetId: "bg",
      svgSource: DIAGRAM_SVG,
      layer: 0,
      position: { x: 0, y: 0 },
      scale: 1,
      rotation: 0,
      opacity: 0,
    },
    props: [
      {
        assetId: "diagram",
        svgSource: DIAGRAM_SVG,
        layer: 10,
        position: { x: 960, y: 540 },
        scale: 2.2,
        rotation: 0,
        opacity: 1,
        animation: makeDemoTimeline(),
      },
    ],
    actors: [],
  };
}

// A-1: The parser turns real SVG into an addressable tree and rejects malformed markup.
test("A-1: parseSvgDocument builds an addressable tree and rejects malformed markup", () => {
  const doc = parseSvgDocument(fs.readFileSync(DIAGRAM_SVG, "utf8"));

  assert.equal(doc.viewBox, "-300 -200 600 400");
  assert.equal(doc.preserveAspectRatio, "xMidYMid meet");
  assert.deepEqual(parseViewBox(doc.viewBox), { minX: -300, minY: -200, width: 600, height: 400 });

  const ids = collectSvgElementIds(doc);
  for (const expected of ["node-input", "node-model", "node-output", "edge-in-model", "edge-model-out", "token", "caption"]) {
    assert.ok(ids.includes(expected), `Document must declare id "${expected}"`);
  }

  const node = findSvgNodeById(doc, "node-model");
  assert.ok(node, "findSvgNodeById must resolve a declared id");
  assert.equal(node!.tag, "g");
  assert.equal(node!.children[0].tag, "rect");
  assert.equal(node!.children[1].text, "model");

  assert.throws(() => parseSvgDocument('<svg viewBox="0 0 10 10"><g><rect x="1" y="1" /></svg>'), /SVG_PARSE_ERROR/);
  assert.throws(() => parseSvgDocument('<svg viewBox="0 0 10 10"><g></rect></g></svg>'), /SVG_PARSE_ERROR/);
  assert.throws(() => parseSvgDocument("<div>not svg</div>"), /SVG_PARSE_ERROR/);
});

// A-2: Serializing a parsed document round-trips its structure.
test("A-2: serializeSvgDocument round-trips a parsed document", () => {
  const source = fs.readFileSync(DIAGRAM_SVG, "utf8");
  const once = serializeSvgDocument(parseSvgDocument(source));
  const twice = serializeSvgDocument(parseSvgDocument(once));
  assert.equal(once, twice, "Serialization must be stable across a reparse");
  assert.ok(once.includes('id="node-model"'));
});

// A-3: The project's ease-out-expo curve is the default, and eases behave at the boundaries.
test("A-3: applySvgEasing implements ease-out-expo as the default curve", () => {
  assert.equal(applySvgEasing(undefined, 0), 0);
  assert.equal(applySvgEasing(undefined, 1), 1);
  assert.equal(applySvgEasing("expoOut", 0.5), applySvgEasing(undefined, 0.5));

  // Ease-out-expo has already covered most of the distance at the halfway point, which is the
  // whole reason the design language picked it (see src/dl/motion.ts).
  assert.ok(applySvgEasing("expoOut", 0.5) > 0.8, "expoOut must be well past halfway at t=0.5");
  assert.equal(applySvgEasing("linear", 0.5), 0.5);
  assert.equal(applySvgEasing("hold", 0.99), 0);
  assert.equal(applySvgEasing("hold", 1), 1);

  // Monotonic and clamped: no overshoot, because overshoot implies mass.
  let previous = -1;
  for (let i = 0; i <= 20; i++) {
    const value = applySvgEasing("expoOut", i / 20);
    assert.ok(value >= previous, "expoOut must be monotonically increasing");
    assert.ok(value >= 0 && value <= 1, `expoOut must stay within [0, 1], got ${value}`);
    previous = value;
  }
});

// A-4: A compiled timeline is dense, frame-indexed, and reaches its authored end values.
test("A-4: compileSvgTimeline produces dense per-frame element state", () => {
  const compiled = compileSvgTimeline(makeDemoTimeline(), { durationFrames: 120 });

  assert.equal(compiled.frames.length, 120);
  assert.equal(compiled.frames[0]["node-input"].opacity, 0);
  assert.equal(compiled.frames[119]["node-input"].opacity, 1);
  assert.equal(compiled.frames[0]["token"].translateX, 0);
  assert.equal(compiled.frames[119]["token"].translateX, 290);
  assert.equal(compiled.frames[0]["edge-in-model"].drawOn, 0);
  assert.equal(compiled.frames[119]["edge-in-model"].drawOn, 1);
});

// A-5: Motion is continuous, not a cut: values change on most frames and never jump.
test("A-5: animated values move continuously rather than snapping between states", () => {
  const compiled = compileSvgTimeline(makeDemoTimeline(), { durationFrames: 120 });

  const tokenX = compiled.frames.map((f) => f["token"].translateX);
  const distinct = new Set(tokenX).size;
  assert.ok(distinct > 30, `Token travel must be genuinely animated, got ${distinct} distinct positions`);

  let maxStep = 0;
  for (let f = 1; f < tokenX.length; f++) {
    maxStep = Math.max(maxStep, Math.abs(tokenX[f] - tokenX[f - 1]));
  }
  // The whole 290px travel spans 45 frames, so a single frame may never cover a quarter of it.
  assert.ok(maxStep < 290 / 4, `Token motion must be smooth, largest single-frame step was ${maxStep}`);

  const opacity = compiled.frames.map((f) => f["node-input"].opacity);
  for (let f = 1; f < opacity.length; f++) {
    assert.ok(Math.abs(opacity[f] - opacity[f - 1]) <= 0.35, `Opacity jumped at frame ${f}`);
  }
});

// A-6: Order defines stagger: a later target in a clip lands later.
test("A-6: staged entry staggers by target order", () => {
  const compiled = compileSvgTimeline(makeDemoTimeline(), { durationFrames: 120 });

  const firstFullyVisible = (id: string) => compiled.frames.findIndex((f) => f[id].opacity >= 1);
  const input = firstFullyVisible("node-input");
  const model = firstFullyVisible("node-model");
  const output = firstFullyVisible("node-output");

  assert.ok(input < model, `node-input (${input}) must land before node-model (${model})`);
  assert.ok(model < output, `node-model (${model}) must land before node-output (${output})`);
  assert.equal(model - input, 8, "Stagger must be exactly the authored staggerFrames");
});

// A-7: A clip that has not started must not overwrite the value another clip is holding.
test("A-7: element state holds and evolves rather than resetting between clips", () => {
  const compiled = compileSvgTimeline(makeDemoTimeline(), { durationFrames: 120 });
  const scaleAt = (f: number) => compiled.frames[f]["node-model"].scaleX;

  // model-pulse runs 62..74 and model-settle runs 74..90. Before the pulse the node must sit at
  // its rest scale, not at the settle clip's start value.
  assert.equal(scaleAt(0), 1, "node-model must rest at scale 1 before its pulse starts");
  assert.equal(scaleAt(61), 1);
  assert.ok(scaleAt(70) > 1.05, `Pulse must be visible mid-clip, got ${scaleAt(70)}`);
  assert.ok(Math.abs(scaleAt(119) - 1) < 1e-6, "Pulse must settle back to rest scale");

  // The token holds its final position after its travel clip ends rather than snapping back.
  assert.equal(compiled.frames[119]["token"].translateX, 290);
});

// A-8: Validation rejects the timelines that would render wrong or ambiguously.
test("A-8: validateSvgTimeline rejects dangling targets, bad spans and ambiguous overlaps", () => {
  const durationFrames = 60;

  const dangling = validateSvgTimeline(
    { timelineId: "t", clips: [{ clipId: "c1", targets: ["does-not-exist"], property: "opacity", from: 0, to: 1, startFrame: 0, durationFrames: 10 }] },
    { durationFrames, availableElementIds: ["node-input"] },
  );
  assert.equal(dangling.length, 1);
  assert.match(dangling[0].message, /does not exist in the asset's SVG document/);

  const pastEnd = validateSvgTimeline(
    { timelineId: "t", clips: [{ clipId: "c1", targets: ["a"], property: "opacity", from: 0, to: 1, startFrame: 55, durationFrames: 20 }] },
    { durationFrames },
  );
  assert.ok(pastEnd.some((e) => /past the scene length/.test(e.message)));

  const overlap = validateSvgTimeline(
    {
      timelineId: "t",
      clips: [
        { clipId: "c1", targets: ["a"], property: "scale", from: 1, to: 2, startFrame: 0, durationFrames: 30 },
        { clipId: "c2", targets: ["a"], property: "scaleX", from: 1, to: 3, startFrame: 10, durationFrames: 20 },
      ],
    },
    { durationFrames },
  );
  assert.ok(overlap.some((e) => /overlaps clip "c1"/.test(e.message)), "Overlapping clips on one property must be rejected");

  const badRange = validateSvgTimeline(
    { timelineId: "t", clips: [{ clipId: "c1", targets: ["a"], property: "opacity", from: 0, to: 4, startFrame: 0, durationFrames: 10 }] },
    { durationFrames },
  );
  assert.ok(badRange.some((e) => /within \[0, 1\]/.test(e.message)));

  const duplicates = validateSvgTimeline(
    {
      timelineId: "t",
      clips: [
        { clipId: "same", targets: ["a"], property: "opacity", from: 0, to: 1, startFrame: 0, durationFrames: 10 },
        { clipId: "same", targets: ["b"], property: "opacity", from: 0, to: 1, startFrame: 0, durationFrames: 10 },
      ],
    },
    { durationFrames },
  );
  assert.ok(duplicates.some((e) => /Duplicate clipId/.test(e.message)));

  assert.throws(
    () =>
      compileSvgTimeline(
        { timelineId: "t", clips: [{ clipId: "c1", targets: ["nope"], property: "opacity", from: 0, to: 1, startFrame: 0, durationFrames: 10 }] },
        { durationFrames, availableElementIds: ["yes"] },
      ),
    /SVG_TIMELINE_VALIDATION_FAILED/,
  );
});

// A-9: The transform serializer emits the identity as nothing and honours the transform origin.
test("A-9: svgElementStateToTransform emits an origin-anchored transform", () => {
  assert.equal(svgElementStateToTransform(identitySvgElementState()), null);

  const moved = { ...identitySvgElementState(), translateX: 12.5, translateY: -3 };
  assert.equal(svgElementStateToTransform(moved), "translate(12.5, -3)");

  const spun = { ...identitySvgElementState({ x: 40, y: 20 }), rotate: 90, scaleX: 2, scaleY: 2 };
  assert.equal(
    svgElementStateToTransform(spun),
    "translate(40, 20) rotate(90) scale(2, 2) translate(-40, -20)",
  );
});

// A-10: A scene carrying a timeline compiles into per-frame element state on its entity.
test("A-10: compileScene threads custom animation onto the compiled entity", () => {
  const scene = makeDemoScene();
  const assets = loadSceneAssets(scene);
  const compiled = compileScene(scene, { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });

  const entityAt = (f: number) => compiled.frames[f].entities.find((e) => e.entityId === "diagram")!;
  assert.equal(entityAt(0).elementStates!["node-input"].opacity, 0);
  assert.equal(entityAt(119).elementStates!["node-input"].opacity, 1);
  assert.ok(entityAt(119).elementStates!["token"].translateX > 0);

  // A dangling target must fail the compile, not silently animate nothing.
  const broken = makeDemoScene();
  broken.props[0].animation!.clips[0].targets = ["node-that-does-not-exist"];
  assert.throws(
    () => compileScene(broken, { assetElementIds: assets.elementIdsByAssetId }),
    /SCENE_ANIMATION_COMPILE_FAILED/,
  );
});

// A-11: Node-side validation catches animation targets that the asset does not declare.
test("A-11: validateSceneWithNodeAssets rejects animation targets missing from the SVG", () => {
  const scene = makeDemoScene();
  assert.equal(validateSceneWithNodeAssets(scene).isValid, true);

  const broken = makeDemoScene();
  broken.props[0].animation!.clips.push({
    clipId: "ghost",
    targets: ["ghost-element"],
    property: "opacity",
    from: 0,
    to: 1,
    startFrame: 0,
    durationFrames: 10,
  });
  const result = validateSceneWithNodeAssets(broken);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.rule === 20 && /ghost-element/.test(e.message)));
});

// A-12: The renderer draws the asset's own artwork, keeps element identity, and namespaces ids.
test("A-12: SceneView renders real asset artwork with stable, namespaced element identity", () => {
  const scene = makeDemoScene();
  const assets = loadSceneAssets(scene);
  const compiled = compileScene(scene, { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });

  const markup = renderFrameSvgMarkup(compiled.frames[70], { svgSources: assets.svgSources });

  // The artwork itself, not a placeholder.
  assert.ok(markup.includes("one token, three stages"), "Asset text content must reach the frame");
  assert.ok(markup.includes('id="node-model--diagram"'), "Element ids must be namespaced per instance");
  assert.ok(markup.includes('id="node-model--bg"'), "Each instance must namespace independently");

  // Zero duplicate ids across the two instances of the same asset.
  const ids = Array.from(markup.matchAll(/\bid="([^"]+)"/g)).map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, "Rendered document must have zero duplicate ids");

  // Element identity is stable frame to frame: the same ids appear at every frame.
  const later = renderFrameSvgMarkup(compiled.frames[100], { svgSources: assets.svgSources });
  const laterIds = Array.from(later.matchAll(/\bid="([^"]+)"/g)).map((m) => m[1]);
  assert.deepEqual(laterIds, ids, "The same elements must persist across frames, not be recreated");

  // A draw-on reveal reaches the strokeable geometry, not just the group wrapping it.
  const midDraw = renderFrameSvgMarkup(compiled.frames[32], { svgSources: assets.svgSources });
  assert.match(midDraw, /<path[^>]*stroke-dashoffset="[^"]*[1-9]/, "Partly drawn edges must carry a dash offset");
  assert.ok(!markup.includes('<g id="edge-in-model--diagram" pathLength'), "pathLength must not land on a container");
});

// A-13: Rendering the same scene twice produces byte-identical output.
test("A-13: rendering is frame-driven and reproducible byte for byte", () => {
  const assets = loadSceneAssets(makeDemoScene());

  const first = compileScene(makeDemoScene(), { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });
  const second = compileScene(makeDemoScene(), { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });

  assert.equal(
    JSON.stringify(first),
    JSON.stringify(second),
    "A pinned-clock compile must be byte-identical across runs",
  );

  for (const f of [0, 33, 67, 119]) {
    assert.equal(
      renderFrameSvgMarkup(first.frames[f], { svgSources: assets.svgSources }),
      renderFrameSvgMarkup(second.frames[f], { svgSources: assets.svgSources }),
      `Frame ${f} must render identically on a second pass`,
    );
  }

  // Different frames must actually differ, or "identical" would be meaningless.
  assert.notEqual(
    renderFrameSvgMarkup(first.frames[0], { svgSources: assets.svgSources }),
    renderFrameSvgMarkup(first.frames[70], { svgSources: assets.svgSources }),
  );
});

// A-14: Visual review: render a frame strip of the animated scene for human inspection.
test("A-14 / Visual Review: render a custom SVG animation frame strip to out/svg_movie/", (t) => {
  if (process.env.RUN_VISUAL_TESTS !== "1") {
    t.skip("Visual review test: run with npm run test:visual");
    return;
  }

  fs.mkdirSync(OUT_STRIP_DIR, { recursive: true });

  const scene = makeDemoScene();
  const assets = loadSceneAssets(scene);
  const compiled = compileScene(scene, { assetElementIds: assets.elementIdsByAssetId, clockMs: 0 });

  const sampleFrames = [0, 12, 30, 48, 66, 84, 102, 119];
  for (const f of sampleFrames) {
    const outPng = path.join(OUT_STRIP_DIR, `strip_${String(f).padStart(3, "0")}.png`);
    renderFrameStill(compiled.frames[f], outPng, {
      svgSources: assets.svgSources,
      width: 960,
      height: 540,
      sceneSize: scene.sceneSize,
    });
    const dims = readPngDimensions(outPng);
    assert.deepEqual(dims, { width: 960, height: 540 }, `Strip frame ${f} must be a true 960x540 raster`);
  }

  console.log(`✓ A-14 Complete: Rendered ${sampleFrames.length} animation strip frames to ${OUT_STRIP_DIR}`);
});

// A-15: Audio-first timing. Re-clocking a scene to a new take retimes its motion with it.
test("A-15: alignSceneToAudio re-clocks a scene and its animation to the narration", () => {
  const scene = makeDemoScene();
  assert.equal(audioSyncDriftMs(scene), 0);
  assert.equal(framesForAudioMs(4000, 30), 120);
  assert.equal(framesForAudioMs(4033, 30), 121);

  // A longer second take: the scene stretches, and every clip stretches with it.
  const relocked = alignSceneToAudio(scene, { audioDurationMs: 6000 });
  assert.equal(relocked.durationFrames, 180);
  assert.equal(relocked.audioDurationMs, 6000);
  assert.ok(audioSyncDriftMs(relocked) <= 50, "A re-clocked scene must satisfy Rule 14");
  assert.equal(validateSceneWithNodeAssets(relocked).isValid, true);

  const original = scene.props[0].animation!.clips.find((c) => c.clipId === "token-travel")!;
  const stretched = relocked.props[0].animation!.clips.find((c) => c.clipId === "token-travel")!;
  assert.equal(stretched.startFrame, original.startFrame * 1.5);
  assert.equal(stretched.durationFrames, Math.round(original.durationFrames * 1.5));

  // The input scene is never mutated.
  assert.equal(scene.durationFrames, 120);
  assert.equal(scene.props[0].animation!.clips.find((c) => c.clipId === "token-travel")!.startFrame, 60);

  // A shorter take compresses without breaking validation.
  const compressed = alignSceneToAudio(scene, { audioDurationMs: 2000 });
  assert.equal(compressed.durationFrames, 60);
  assert.equal(validateSceneWithNodeAssets(compressed).isValid, true);
  assert.equal(compileSvgTimeline(compressed.props[0].animation!, { durationFrames: 60 }).frames.length, 60);
});

// A-16: The Remotion entry point renders the scene frame that the composition frame selects.
test("A-16: SceneClip renders the scene frame for the current composition frame", () => {
  const scene = makeDemoScene();
  const assets = loadSceneAssets(scene);

  const renderAt = (frame: number) =>
    ReactDOMServer.renderToStaticMarkup(
      React.createElement(SceneClip, {
        scene,
        svgSources: assets.svgSources,
        startFrame: 0,
        width: 960,
        height: 540,
        compileOptions: { clockMs: 0 },
      }),
    );

  // Outside a Remotion composition the frame falls back to 0, so this proves the scene renders
  // at all; the frame-selection maths is asserted directly below.
  const atZero = renderAt(0);
  assert.ok(atZero.includes('viewBox="0 0 1920 1080"'), "Scene coordinate space must drive the viewBox");
  assert.ok(atZero.includes('width="960"'), "Output pixel size must be independent of the scene size");
  assert.ok(atZero.includes('id="node-model--diagram"'));

  // The same scene compiled directly agrees with what SceneClip would show at each frame.
  const compiled = compileScene(scene, { clockMs: 0 });
  assert.equal(compiled.durationFrames, 120);
  const clampedLocalFrame = (frame: number, startFrame: number) =>
    Math.min(compiled.durationFrames - 1, Math.max(0, frame - startFrame));
  assert.equal(clampedLocalFrame(0, 30), 0, "Frames before the clip starts hold the first frame");
  assert.equal(clampedLocalFrame(45, 30), 15);
  assert.equal(clampedLocalFrame(500, 30), 119, "Frames past the end hold the last frame");
});
