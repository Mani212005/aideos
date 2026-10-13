/**
 * File Description: P0 behavior tests for late spans, strict stage contracts, resources, posed projection and editor persistence.
 * Inputs and outputs: disposable fixture package and defective designs -> observable compile/check/save outcomes.
 * Used by: npm test. Lossless browser pixels are separately captured from the real editor Player.
 */
import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { OrthographicCamera, Vector3 } from "three";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { parseFilm } from "../../src/dl/schema";
import { designSpecSchema, stageDesignSchema } from "../designSpec/spec";
import { compileDesign } from "../designSpec/compile";
import { checkFilmDesign } from "../designCheck/designCheck";
import { buildDesign } from "../designSpec/build";
import { readFilm, writeFilm } from "../pipeline/filmStore";
import { createReceiveAction } from "../../src/dl/performance/receive";
import { shiftReceive } from "../../src/dl/performance/span";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import { IONA_RIG } from "../../src/dl/performance/iona";
import { bindReceiveSpan } from "./bindReceive";
import { validateStageResources } from "./resources";
import { validateScene } from "../../src/dl/scene/validateScene";
import { validateStageSvgResources } from "../../src/dl/scene/validateStage";
import { receiveSchema } from "../../src/dl/scene/stageContract";
import { prepareStageFacts, stageEvidence } from "../../src/dl/scene/stageFacts";
import { projectStagePoint, stageViewport } from "../../src/dl/scene/projection";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../../src/dl/convertFilm";
import { generateWordsFromFilm } from "../../src/dl/captionsParser";
import type { ReceiveAction } from "../../src/dl/performance/types";
import type { Scene } from "../../src/dl/scene/types";

const pkg = resolvePackageDir("iona-receive");
// Reads a disposable fixture's serialized contract.
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(pkg, file), "utf8"));
// Compiles the same v2 design consumed by production builds.
function compiled() {
  const result = compileDesign(parseFilm(read("film.json")), designSpecSchema.parse(read("design/design.json")), read("voiceover_words.json").words, "hand-built");
  assert.deepEqual(result.errors, []);
  return result.film!;
}
// Enumerates every time-bearing field independently of the span implementation.
function times(a: ReceiveAction): number[] {
  return [a.fromFrame, a.toFrame, a.holdFromFrame, a.contact.frame, ...a.anchors.map((k) => k.frame), ...a.expressions.map((k) => k.frame), ...[a.root.position, a.root.rotation, ...Object.values(a.positions), ...Object.values(a.rotations), ...Object.values(a.secondary), ...a.constraints.flatMap((c) => [c.target, c.pole, ...(c.tipRotation ? [c.tipRotation] : [])])].flatMap((track) => track.map((k) => k.frame))];
}

test("late receive shifts every timed channel, keeps recovery, and holds outside its span", () => {
  const local = createReceiveAction(69), before = structuredClone(local);
  const shifted = shiftReceive(local, 300);
  assert.deepEqual(times(shifted), times(local).map((f) => f + 300));
  assert.deepEqual(local, before);
  const late = bindReceiveSpan(369, 300, 600);
  const a = createPerformanceEvaluator(IONA_RIG, local), b = createPerformanceEvaluator(IONA_RIG, late);
  for (const frame of [0, 68.5, 69, 111, 150, 69, 0]) {
    const state = b(frame + 300);
    assert.deepEqual({ ...state, frame: state.frame - 300 }, a(frame));
  }
  assert.equal(late.toFrame - late.contact.frame, 81);
  assert.throws(() => bindReceiveSpan(369, 300, 400), /ends before/);
  assert.throws(() => bindReceiveSpan(301, 300, 600), /preparation/);
});

test("strict serialization preserves performance and rejects unknown v2 fields and legacy actors", () => {
  const film = compiled();
  assert.deepEqual(parseFilm(JSON.parse(JSON.stringify(film))).scene, film.scene);
  const caption = generateWordsFromFilm(film as unknown as Record<string, unknown>).find((w) => w.text === "catches");
  assert.equal(caption?.startFrame, film.scene!.performances![0].decisive.frame);
  assert.throws(() => parseFilm({ ...film, scene: { ...film.scene, poseHistory: [] } }));
  assert.throws(() => stageDesignSchema.parse({ ...read("design/design.json"), mixer: {} }));
  const data = film.scene!.performances![0].data;
  for (const value of [[], [1, 2], [1, 2, 3, 4], [1, 2, NaN], [1, 2, Infinity], ["1", 2, 3]]) {
    assert.throws(() => receiveSchema.parse({ ...data, root: { ...data.root, position: [{ frame: 0, value }] } }));
  }
  for (const propRotation of [[], [0, 0, 0], [0, 0, 0, 1, 2], [0, 0, 0, NaN], [0, 0, 0, Infinity], [0, 0, 0, "1"]]) {
    assert.throws(() => receiveSchema.parse({ ...data, contact: { ...data.contact, propRotation } }));
  }
  for (const flight of [[], [data.contact.flight[0]], [...data.contact.flight, [0, 0, 0]], [[0, 0], [0, 0, 0]]]) {
    assert.throws(() => receiveSchema.parse({ ...data, contact: { ...data.contact, flight } }));
  }
  const actorScene = { ...film.scene, actors: [{ instanceId: "legacy" }] } as unknown as Scene;
  assert.equal(validateScene(actorScene).errors[0].rule, 21);
  assert.equal(validateScene({ ...film.scene, renderer: "svg" } as Scene).isValid, false);
});

test("missing or changed approved resources fail, and unsupported secondary channels never disappear silently", () => {
  assert.deepEqual(validateStageResources(), []);
  assert.match(validateStageResources(() => { throw new Error("missing"); }).join(" "), /missing or unreadable/);
  assert.match(validateStageResources(() => new Uint8Array([0])).join(" "), /hash differs/);
  const film = compiled(), scene = structuredClone(film.scene!) as Scene;
  assert.match(validateStageSvgResources(scene, {}).join(" "), /missing SVG resource/);
  assert.deepEqual(validateStageSvgResources(scene, { [scene.background.svgSource]: "<svg/>" }), []);
  scene.performances![0].data.secondary.wings = scene.performances![0].data.secondary.coat;
  assert.match(validateScene(scene).errors.map((e) => e.message).join(" "), /secondary channel/);
  scene.performances![0].data.fps = 60;
  assert.match(validateScene(scene).errors.map((e) => e.message).join(" "), /FPS mismatch/);
});

test("projection agrees with actual orthographic camera matrices in both crops, including rotation and zoom", () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) for (const pose of [{ center: { x: 960, y: 960 }, zoom: 1, rotation: 0 }, { center: { x: 810, y: 910 }, zoom: 1.4, rotation: 21 }]) {
    const vp = stageViewport(width, height), cam = new OrthographicCamera(-vp.halfWidth / pose.zoom, vp.halfWidth / pose.zoom, vp.halfHeight / pose.zoom, -vp.halfHeight / pose.zoom, 0.1, 10000);
    cam.position.set(pose.center.x - 960, 960 - pose.center.y, 2000); cam.rotation.z = pose.rotation * Math.PI / 180; cam.updateMatrixWorld(true);
    for (const p of [{ x: 0, y: 420 }, { x: 1920, y: 1500 }, { x: 420, y: 0 }, { x: 1500, y: 1920 }, { x: 960, y: 960 }]) {
      const v = new Vector3(p.x - 960, 960 - p.y, 0).project(cam), projected = projectStagePoint(p, pose, width, height);
      assert.ok(Math.abs(projected.x - (v.x + 1) * width / 2) < 1e-8);
      assert.ok(Math.abs(projected.y - (1 - v.y) * height / 2) < 1e-8);
    }
  }
});

test("cold, reverse and repeated contact geometry agrees, and cropped poses fail the design gate", () => {
  const film = compiled(), scene = film.scene as Scene, contact = scene.performances![0].decisive.frame;
  const warm = prepareStageFacts(scene, 1080, 1920), cold = prepareStageFacts(scene, 1080, 1920);
  try {
    const expected = cold.at(contact);
    for (const frame of [0, contact, 299, contact - 1, contact, 0, ...Array.from({ length: 30 }, (_, i) => contact + 15 - i), contact]) {
      const actual = warm.at(frame);
      if (frame === contact) assert.deepEqual(actual, expected);
    }
    assert.equal(expected[0].ownership, "attached");
    const report = checkFilmDesign(film);
    assert.equal(report.ok, true, JSON.stringify(report.findings));
    assert.ok(report.findings.some((f) => f.message.includes("unmeasured")));
    const wrong = structuredClone(film); const actor = wrong.scene!.cast!.find((c) => c.kind === "character")!;
    if (actor.kind === "character") actor.position = [1490, 1300];
    assert.equal(checkFilmDesign(wrong).ok, false);
    assert.equal(stageEvidence(scene, [90, 180]).reel.performances[0].visualQuality, "unmeasured");
  } finally { warm.dispose(); cold.dispose(); }
});

test("editor layer conversion, save and reload retain the identical compiled performance", () => {
  const film = compiled(), layered = convertFilmToLayeredFilm(film);
  const converted = convertLayeredFilmToFilm(layered, film);
  writeFilm(film.id, converted);
  assert.deepEqual(readFilm(film.id)!.scene, film.scene);
  assert.equal(buildDesign(film.id, "hand-built").state, "passed");
});

test("hidden scene and muted narration flags survive save/reload without stripping the stage", () => {
  const film = compiled(), layered = convertFilmToLayeredFilm(film);
  const sceneLane = layered.clips.find((c) => c.kind === "animation")!.layerId;
  const voiceLane = layered.clips.find((c) => c.kind === "audio")!.layerId;
  const changed = { ...layered, layers: layered.layers.map((l) => ({ ...l, hidden: l.id === sceneLane, muted: l.id === voiceLane })) };
  writeFilm(film.id, convertLayeredFilmToFilm(changed, film));
  const loaded = readFilm(film.id)!;
  assert.deepEqual(loaded.scene, film.scene);
  const reopened = convertFilmToLayeredFilm(loaded);
  assert.equal(reopened.layers.find((l) => l.id === sceneLane)!.hidden, true);
  assert.equal(reopened.layers.find((l) => l.id === voiceLane)!.muted, true);
  const muted = { ...reopened, clips: reopened.clips.map((c) => c.layerId === voiceLane ? { ...c, volume: 0 } : c) };
  const renderFilm = convertLayeredFilmToFilm(muted, loaded);
  assert.equal(renderFilm.voiceover?.volume, 0);
  assert.deepEqual(renderFilm.scene, film.scene);
});
