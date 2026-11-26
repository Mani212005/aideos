/**
 * File Description: Behavioural tests of the node-graph canvas emitter (native renderer Phase 2, P2.2b) through the public emitter: a node-graph film stays on Remotion unless the canvas is opted in, and a 3D camera angle is refused even then; opted in, the flat fixture film emits a valid `aideos.render/5` document whose camera puts every card where `camera.ts`'s `projectBox` puts it on every story frame; a card is ghosted before its node arrives, lit (accent border, lit background, 2% lift) once its shot has held on it, and resting again after; and a label too wide for its card wraps onto a second line with its tag chip on whole units.
 * Inputs and outputs: test_fixtures/packages/node-graph-flat and the fake measurer -> asserted IR values and canvas SVG.
 * Used by: npm test (Node test runner).
 */

import "../testSupport/fixtureVideosDir";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTimeline, camAt, projectBox, nodeBox } from "../../src/dl/camera";
import { deliveryTimeline } from "../../src/dl/delivery";
import { frames } from "../../src/dl/motion";
import type { Film } from "../../src/dl/schema";
import { emitRenderIr, nativeSupport, sampleTrack, type EmitResult, type NativeFormat } from "./emit";
import type { ColorKeyframe, Keyframe, Node } from "./schema";
import { validateRenderIr } from "./validate";
import { fakeMeasurer } from "../testSupport/nativeSceneFilm";

const FIXTURE = path.resolve(__dirname, "../../test_fixtures/packages/node-graph-flat/film.json");

/** The synthetic flat node-graph film. */
function film(): Film {
  return JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Film;
}

/** Emits one format with the node-graph canvas opted in. */
function emit(f: Film, format: NativeFormat = "long"): EmitResult {
  return emitRenderIr({ film: f, format, svgSources: {}, measure: fakeMeasurer(), resolvePath: (p) => `/repo/${p}`, nodeGraphCanvas: true });
}

/** The canvas svg node of a document. */
function canvas(result: EmitResult): Extract<Node, { kind: "svg" }> {
  const node = result.ir.stage.find((n) => n.id === "canvas");
  assert.ok(node && node.kind === "svg", "the stage holds the canvas svg node");
  return node;
}

/** An element track's value at a frame (or the fallback when the element has none). */
function elementAt(node: Extract<Node, { kind: "svg" }>, target: string, property: string, frame: number, fallback: number): number {
  const t = node.elementTracks.find((k) => k.target === target && k.property === property);
  return t ? sampleTrack(t.keyframes as Keyframe[], frame) : fallback;
}

/** A colour track's colour at a frame (hold keyframes, as the emitter writes them). */
function colorAt(node: Extract<Node, { kind: "svg" }>, target: string, property: "fill" | "stroke", frame: number): string {
  const t = node.colorTracks?.find((k) => k.target === target && k.property === property);
  assert.ok(t, `no ${property} track on ${target}`);
  let c: ColorKeyframe = t.keyframes[0];
  for (const k of t.keyframes) if (k.frame <= frame) c = k;
  return c.color;
}

test("a node-graph film stays on Remotion unless the canvas is opted in, and a 3D camera angle is refused even then", () => {
  const f = film();
  assert.ok(nativeSupport(f, "long").some((r) => r.includes("node-graph films") && r.includes("P2.2c")), nativeSupport(f, "long").join("\n"));
  assert.deepEqual(nativeSupport(f, "long", { nodeGraphCanvas: true }), []);
  const isometric = { ...f, theme: { ...f.theme, cameraAngle: "isometric" } } as Film;
  assert.ok(nativeSupport(isometric, "reel", { nodeGraphCanvas: true }).some((r) => r.includes('camera angle "isometric"')));
});

test("the canvas emits a valid /5 document whose camera places every card where camera.ts does", () => {
  // No drift, so the frame scale is 1 through the story and the projection is camera.ts's alone.
  const f = { ...film(), shots: film().shots.map((s) => ({ ...s, drift: false })) } as Film;
  for (const format of ["long", "reel"] as const) {
    const result = emit(f, format);
    assert.equal(result.ir.schema, "aideos.render/5");
    assert.ok(validateRenderIr(result.ir).ok);
    assert.ok(result.files.some((file) => file.path === "visuals/canvas.svg" && "text" in file));
    const size = format === "long" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
    assert.deepEqual(result.ir.scene, size, "the scene is the format, so the cover fit is 1");
    const timeline = buildTimeline(f);
    const story = deliveryTimeline(f, format, { timeline }).storyFrames;
    const cam = result.ir.camera!;
    for (let frame = 0; frame < story; frame++) {
      const c = { x: sampleTrack(cam.centerX, frame), y: sampleTrack(cam.centerY, frame), zoom: sampleTrack(cam.zoom, frame) };
      const want = camAt(f, timeline, frame, size);
      for (const node of f.canvas.nodes) {
        const box = projectBox(nodeBox(node), want, size);
        const x = size.width / 2 + (node.x - c.x) * c.zoom;
        const y = size.height / 2 + (node.y - c.y) * c.zoom;
        assert.ok(Math.abs(x - box.x) < 1e-6 && Math.abs(y - box.y) < 1e-6 && Math.abs(node.w * c.zoom - box.w) < 1e-6, `${format} frame ${frame}: ${node.id} at (${x}, ${y}), camera.ts (${box.x}, ${box.y})`);
      }
    }
  }
});

test("a card is ghosted before its node arrives, lit once its shot holds on it, and resting again after", () => {
  const f = film();
  const node = canvas(emit(f));
  const index = f.canvas.nodes.findIndex((n) => n.id === "unet-bottleneck");
  const k = `node-${index}`;
  const timeline = buildTimeline(f);
  const lit = timeline.find((t) => t.shot.id === "bottleneck")!;
  const after = timeline.find((t) => t.shot.id === "attention")!;
  // Before its first shot the card is ghosted at 0.35 with the dim white border.
  assert.equal(elementAt(node, k, "opacity", 0, 1), 0.35);
  assert.equal(colorAt(node, `${k}-border`, "stroke", 0), "#FFFFFF14");
  // Held on alone past the 700 ms light-up: the accent border, the lit background and the 2% lift.
  const held = lit.from + Math.ceil(frames(700, f.fps));
  assert.equal(colorAt(node, `${k}-border`, "stroke", held), "#635BFF");
  assert.equal(elementAt(node, `${k}-bg-live`, "opacity", held, 0), 1);
  assert.equal(elementAt(node, `${k}-bg`, "opacity", held, 1), 0);
  assert.equal(elementAt(node, k, "scale", held, 1), 1.02);
  assert.equal(elementAt(node, k, "opacity", held, 1), 1, "it has arrived");
  // Two shots later it rests: no lift, the resting background, a white border.
  const rest = after.from + Math.ceil(frames(700, f.fps));
  assert.equal(elementAt(node, k, "scale", rest, 0), 1);
  assert.equal(elementAt(node, `${k}-bg`, "opacity", rest, 0), 1);
  assert.equal(colorAt(node, `${k}-border`, "stroke", rest), "#FFFFFF29");
});

test("a label too wide for its card wraps onto a second line, and the tag chip sits on whole units", () => {
  const f = film();
  const svg = emit(f).files.find((file) => file.path === "visuals/canvas.svg");
  assert.ok(svg && "text" in svg);
  const index = f.canvas.nodes.findIndex((n) => n.id === "unet-bottleneck");
  const label = new RegExp(`<g id="node-${index}-label"[^>]*>(.*?)</g>`).exec(svg.text);
  assert.ok(label, "the label group");
  const lines = [...label[1].matchAll(/<text x="[^"]+" y="([^"]+)">([^<]+)<\/text>/g)];
  assert.deepEqual(lines.map((m) => m[2]), ["Multiscale", "Bottleneck"]);
  assert.ok(lines.every((m) => Number.isInteger(Number(m[1]))), "baselines on whole units");
  const chip = new RegExp(`<rect id="node-${index}-chip" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`).exec(svg.text);
  assert.ok(chip && chip.slice(1).every((v) => Number.isInteger(Number(v))), "the chip box is snapped to whole units");
});
