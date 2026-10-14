/**
 * File Description: P0/P2 behavior tests for stage contracts, resources, projected geometry, design gates and editor persistence.
 * Inputs and outputs: disposable fixture package and defective designs -> observable compile/check/save outcomes.
 * Used by: npm test. Lossless browser pixels are separately captured from the real editor Player.
 */
import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BoxGeometry, Color, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
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
import { applyStageCamera, projectStagePoint, stageViewport } from "../../src/dl/scene/projection";
import { projectMeshParts, sampleMeshDepth, undeclaredMaterialColours } from "../../src/dl/scene/stageGeometry";
import { checkThreeStage } from "../designCheck/threeStage";
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

test("P2 production build refuses a reel margin violation and preserves the previous film byte for byte", () => {
  const designFile = path.join(pkg, "design/design.json"), filmFile = path.join(pkg, "film.json");
  const original = fs.readFileSync(designFile, "utf8"), before = fs.readFileSync(filmFile, "utf8");
  try {
    const spec = JSON.parse(original);
    spec.assets[0].position[0] = 940;
    fs.writeFileSync(designFile, JSON.stringify(spec));
    const result = buildDesign("iona-receive", "hand-built");
    assert.equal(result.state, "failed");
    assert.ok(result.findings.some((f) => f.rule === "safe-area" && /shot approach.*reel.*glider/.test(f.where)), JSON.stringify(result));
    assert.equal(fs.readFileSync(filmFile, "utf8"), before);
  } finally { fs.writeFileSync(designFile, original); }
});

test("P2 full silhouettes reject wide captions and reel cropping, with shot and rule diagnostics", () => {
  for (const [position, format] of [[[985, 1290], "long"], [[1490, 1210], "reel"]] as const) {
    const film = compiled(), actor = film.scene!.cast!.find((c) => c.kind === "character")!;
    if (actor.kind === "character") actor.position = [...position];
    const result = checkFilmDesign(film);
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.rule === "safe-area" && f.where.includes(format) && f.where.includes("shot ")));
  }
});

test("P2 clear Three insets pass and a one-frame moving silhouette intersection fails", () => {
  const film = compiled();
  film.shots[2].stage = "inset";
  film.shots[2].blocks = parseFilm(JSON.parse(fs.readFileSync(path.join(resolvePackageDir("inset-stage"), "film.json"), "utf8"))).shots[1].blocks;
  film.shots[2].scriptText = "Three servers share the work.";
  const actor = film.scene!.cast!.find((c) => c.kind === "character")!;
  // Smaller centered cast clears both fixed device rectangles without changing the rig or action.
  if (actor.kind === "character") { actor.unitsToStage = 40; actor.position = [840, 900]; }
  const clear = checkFilmDesign(film);
  assert.equal(clear.ok, true, JSON.stringify(clear.findings));
  assert.equal(clear.findings.some((f) => f.rule === "inset"), false, JSON.stringify(clear.findings));
  if (actor.kind === "character") actor.position = [1000, 1240];
  const overlapping = checkFilmDesign(film);
  assert.ok(overlapping.findings.some((f) => f.rule === "inset" && /shot receipt.*reel/.test(f.where)), JSON.stringify(overlapping.findings));
});

test("P2 camera speed is measured in each output crop and cast focus resolves evaluated geometry", () => {
  const film = compiled(), scene = film.scene as Scene;
  scene.camera = { keyframes: [{ frame: 0, center: { x: 960, y: 960 }, zoom: 1 }, { frame: 299, center: { x: 960, y: 2860 }, zoom: 1 }] };
  const report = checkFilmDesign(film);
  assert.ok(report.findings.some((f) => f.rule === "camera" && /reel/.test(f.where) && /output width/.test(f.message)));
  assert.equal(report.findings.some((f) => f.rule === "camera" && /long/.test(f.where) && /output width/.test(f.message)), false);
  delete scene.camera;
  const focus = checkFilmDesign(film, { cameraTargets: [{ frame: 180, focus: "iona", authoredFocus: "iona" }] });
  assert.equal(focus.findings.some((f) => f.rule === "camera"), false, JSON.stringify(focus.findings));
  const wrong = checkFilmDesign(film, { cameraTargets: [{ frame: 180, focus: "iona", authoredFocus: "glider" }] });
  assert.ok(wrong.findings.some((f) => f.rule === "camera" && /focused cast/.test(f.message)));
});

test("P2 after-state requires two seconds of clear carry and a camera hold", () => {
  const film = compiled(), scene = film.scene as Scene;
  scene.camera = { keyframes: [{ frame: 0, center: { x: 960, y: 960 }, zoom: 1 }, { frame: 299, center: { x: 970, y: 960 }, zoom: 1 }] };
  assert.ok(checkFilmDesign(film).findings.some((f) => f.rule === "carry-over" && /glider/.test(f.where)));
  delete scene.camera;
  scene.durationFrames = 200;
  assert.ok(checkThreeStage(film, scene, {}).some((f) => f.rule === "carry-over"));
});

test("P2 duplicate writers and broken contact seams fail without inventing a second prop", () => {
  const film = compiled(), scene = film.scene as Scene;
  scene.performances!.push({ ...structuredClone(scene.performances![0]), id: "second-writer" });
  assert.ok(checkThreeStage(film, scene, {}).some((f) => f.rule === "continuity" && /duplicate/.test(f.message)));
  scene.performances!.pop();
  scene.performances![0].data.contact.frame++;
  const invalid = checkFilmDesign(film);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.findings.some((f) => /independent cue/.test(f.message)), JSON.stringify(invalid.findings));
});

test("P2 geometry and depth queries are independent of character shape and retain honest provenance", () => {
  const material = new MeshBasicMaterial({ color: "#f5f5f5" });
  const hidden = new Mesh(new PlaneGeometry(10, 10), material), cover = new Mesh(new PlaneGeometry(30, 30), material);
  hidden.name = "parcel"; cover.position.z = 10;
  hidden.updateMatrixWorld(); cover.updateMatrixWorld();
  try {
    assert.equal(sampleMeshDepth([hidden], [hidden, cover]).status, "occluded");
    cover.position.x = 100; cover.updateMatrixWorld();
    const exposed = sampleMeshDepth([hidden], [hidden, cover]);
    assert.equal(exposed.status, "exposed");
    assert.equal(exposed.provenance, "sampled-mesh-depth");
    assert.equal(exposed.rasterVisibility, "unmeasured");
    for (let i = 1; i <= 25; i++) {
      const mesh = new Mesh(new BoxGeometry(i, i * 1.7, i * 0.4), material);
      mesh.rotation.set(i / 9, i / 7, i / 5); mesh.scale.set(i / 4, 1, i / 6); mesh.updateMatrixWorld();
      const pose = { center: { x: 960 - i, y: 960 + i }, zoom: 1 + i / 30, rotation: i * 2 };
      const cam = new OrthographicCamera(); applyStageCamera(cam, pose, 1080, 1920);
      const parts = projectMeshParts([mesh], pose, 1080, 1920, { w: 1920, h: 1920 }, 0.04);
      const vertices = mesh.geometry.getAttribute("position");
      for (let j = 0; j < vertices.count; j++) {
        const p = new Vector3().fromBufferAttribute(vertices, j).applyMatrix4(mesh.matrixWorld).project(cam), b = parts[0].bounds;
        assert.ok((p.x + 1) * 540 >= b.x0 && (p.x + 1) * 540 <= b.x1 && (1 - p.y) * 960 >= b.y0 && (1 - p.y) * 960 <= b.y1);
      }
      mesh.geometry.dispose();
    }
  } finally { hidden.geometry.dispose(); cover.geometry.dispose(); material.dispose(); }
});

test("P2 material palette rejects an undeclared base color and shader outline, including hidden meshes", () => {
  const material = new MeshBasicMaterial({ color: "#f5f5f5" }), mesh: Mesh = new Mesh(new BoxGeometry(), material);
  mesh.name = "coat";
  try {
    assert.deepEqual(undeclaredMaterialColours([mesh], ["#f5f5f5"]), []);
    material.color = new Color("#ff0000"); mesh.visible = false;
    assert.deepEqual(undeclaredMaterialColours([mesh], ["#f5f5f5"]), ["coat: #ff0000"]);
    const shader = new ShaderMaterial({ uniforms: { ink: { value: new Color("#00ff00") } } });
    mesh.material = shader;
    assert.deepEqual(undeclaredMaterialColours([mesh], ["#f5f5f5"]), ["coat: #00ff00"]);
    shader.dispose();
  } finally { mesh.geometry.dispose(); material.dispose(); }
});

test("P2 foreground obstruction blocks carry facts and honors exact element opacity", () => {
  const film = compiled(), scene = film.scene as Scene, file = path.join(pkg, "visuals/p2-obstructor.svg");
  fs.writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1920"><rect id="cover" x="0" y="0" width="1920" height="1920" fill="#0A0A0B"/></svg>');
  try {
    scene.props.push({ assetId: "cover", svgSource: file, plane: "foreground", position: { x: 0, y: 0 }, scale: 1, rotation: 0, opacity: 1 });
    const hidden = checkFilmDesign(film);
    assert.ok(hidden.findings.some((f) => f.rule === "occlusion" && /foreground SVG/.test(f.message)), JSON.stringify(hidden.findings));
    assert.ok(hidden.findings.some((f) => f.rule === "carry-over"));
    scene.props[0].opacity = 0;
    const clear = checkFilmDesign(film);
    assert.equal(clear.findings.some((f) => f.rule === "occlusion" || f.rule === "carry-over"), false, JSON.stringify(clear.findings));
    assert.equal(stageEvidence(scene, [120]).reel.boundaries[0].after[0].propVisibility!.rasterVisibility, "unmeasured");
    scene.props[0].opacity = 1;
    scene.props[0].animation = { timelineId: "one-frame-cover", clips: [
      { clipId: "appear", targets: ["cover"], property: "opacity", from: 0, to: 1, startFrame: 191, durationFrames: 1 },
      { clipId: "disappear", targets: ["cover"], property: "opacity", from: 1, to: 0, startFrame: 192, durationFrames: 1 },
    ] };
    const transient = checkFilmDesign(film);
    assert.ok(transient.findings.some((f) => f.rule === "occlusion" && /frame 192$/.test(f.where)), JSON.stringify(transient.findings));
  } finally { fs.rmSync(file); }
});

test("P2 stage preparation failures return shot and rule diagnostics instead of throwing", () => {
  const film = compiled(), scene = film.scene as Scene;
  scene.cast = [];
  const findings = checkThreeStage(film, scene, {});
  assert.ok(findings.some((f) => f.rule === "scene" && /shot approach/.test(f.where) && /missing actor iona/.test(f.message)));
});

test("P2 missing mesh data and orthographic depth clipping fail with the mesh name", () => {
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial()); mesh.name = "parcel";
  const pose = { center: { x: 960, y: 960 }, zoom: 1, rotation: 0 };
  try {
    mesh.position.z = 2100; mesh.updateMatrixWorld();
    assert.throws(() => projectMeshParts([mesh], pose, 1920, 1080, { w: 1920, h: 1920 }, 0.04), /parcel.*depth clip/);
    mesh.position.z = 0; mesh.updateMatrixWorld(); mesh.geometry.deleteAttribute("position");
    assert.throws(() => projectMeshParts([mesh], pose, 1920, 1080, { w: 1920, h: 1920 }, 0.04), /parcel.*missing position geometry/);
  } finally { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); }
});
