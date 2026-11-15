/**
 * File Description: Behavioural tests of the Three stage in the Render IR (`aideos.render/2`, P4.1) on the real iona-receive fixture film: the emitted document validates and survives a JSON round trip; for every frame of the film, the world vertices posed from the IR (mesh file plus graph and channels, through the reference pose in stage3d.ts) equal the posed vertices prepareStageFacts measures, bit for bit in f32; the stage sits between the ground and foreground planes; two emits are byte-identical; and nativeSupport accepts the cel films (one performer, and the three-character J5 film of P4.3) and the dots-v1 film (P4.4: the dots look itself is tested in dots.test.ts). The three-character film is checked the same way, performer by performer.
 * Inputs and outputs: the iona-receive fixture package and the journey-three-characters, pixels-stage-pip and pixels-stage-marlo packages built through buildDesign in the test videos directory, a fake measurer -> asserted IR values and vertex bits.
 * Used by: npm test (Node test runner).
 */

import "../testSupport/fixtureVideosDir";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3, type Mesh } from "three";
import { buildDesign } from "../designSpec/build";
import { readFilm } from "../pipeline/filmStore";
import { loadSceneAssets } from "../scene/loadSceneAssets";
import { prepareStageFacts } from "../../src/dl/scene/stageFacts";
import { meshIsDrawn } from "../../src/dl/scene/stageGeometry";
import type { Scene } from "../../src/dl/scene/types";
import type { Film } from "../../src/dl/schema";
import { fakeMeasurer } from "../testSupport/nativeSceneFilm";
import { buildCharacterFilm, type CharacterFilmSlug } from "../testSupport/characterFilms";
import { emitRenderIr, nativeSupport, NativeUnsupportedError, type EmitResult, type NativeFormat } from "./emit";
import { decodeMesh } from "./mesh";
import { RENDER_IR_VERSION_2, type MeshAsset, type Stage3dNode } from "./schema";
import { poseStage3d, worldVertices } from "./stage3d";
import { parseRenderIr } from "./validate";

let built: Film | undefined;
// Builds the fixture film once (the real buildDesign, as the journeys do) and returns a fresh copy.
function ionaFilm(): Film {
  if (!built) {
    const result = buildDesign("iona-receive", "hand-built");
    assert.equal(result.state, "passed", JSON.stringify(result).slice(0, 2000));
    built = readFilm("iona-receive")!;
  }
  return structuredClone(built);
}

const characterFilms = new Map<CharacterFilmSlug, Film>();
// Builds a character film once (Pip, Marlo or the three-character J5 film, through the real buildDesign) and returns a fresh copy.
function characterFilm(slug: CharacterFilmSlug): Film {
  let film = characterFilms.get(slug);
  if (!film) characterFilms.set(slug, film = buildCharacterFilm(slug));
  return structuredClone(film);
}

// Emits one format of a film exactly as the render path does (no development allowance: nativeSupport must accept it).
function emit(film: Film, format: NativeFormat): EmitResult {
  const svgSources = loadSceneAssets(film.scene as unknown as Scene).svgSources;
  return emitRenderIr({ film, format, svgSources, measure: fakeMeasurer(), resolvePath: (p) => `/repo/${p}` });
}

// The stage3d node of an emitted document.
function stageOf(result: EmitResult): Stage3dNode {
  const node = result.ir.stage.find((n) => n.kind === "stage3d");
  assert.ok(node && node.kind === "stage3d", "no stage3d node");
  return node;
}

// The mesh file bytes an emit wrote.
function meshBytes(result: EmitResult): Uint8Array {
  const file = result.files.find((f) => "bytes" in f);
  assert.ok(file && "bytes" in file, "no mesh file");
  return file.bytes;
}

test("a Three film emits a valid aideos.render/2 document that survives a JSON round trip", () => {
  const result = emit(ionaFilm(), "long");
  assert.equal(result.ir.schema, RENDER_IR_VERSION_2);
  const again = parseRenderIr(JSON.stringify(result.ir));
  assert.ok(again.ok, JSON.stringify(again.ok ? "" : again.error).slice(0, 2000));
  assert.deepEqual(again.ir, result.ir);
  const mesh = result.ir.assets.find((a) => a.kind === "mesh");
  assert.ok(mesh && mesh.path === "meshes/stage.mesh");
  assert.ok(result.files.some((f) => f.path === mesh.path && "bytes" in f));
});

// Checks that, at each given frame, the world vertices posed from the IR equal the posed vertices prepareStageFacts measures, bit for bit in f32, for every drawn mesh of every performer.
function assertPosedVerticesMatch(film: Film, frames: number[], minVertices: number): void {
  const scene = film.scene as unknown as Scene;
  const result = emit(film, "long");
  // The document goes through JSON text, as the renderer reads it.
  const parsed = parseRenderIr(JSON.stringify(result.ir));
  assert.ok(parsed.ok);
  const stage = parsed.ir.stage.find((n): n is Stage3dNode => n.kind === "stage3d")!;
  const asset = parsed.ir.assets.find((a): a is MeshAsset => a.kind === "mesh")!;
  const parts = new Map(decodeMesh(meshBytes(result), asset).map((p) => [p.id, p]));
  const facts = prepareStageFacts(scene, 1920, 1080);
  try {
    // The glider stays hidden until a performance first places it, so drawn meshes are counted on a posed frame.
    facts.at(0);
    const entries = facts.materials.map((entry) => {
      const performance = facts.performances.find((p) => p.actor === entry.actor);
      assert.ok(performance, `no performance for ${entry.actor}`);
      return { owners: [entry.actor, performance.prop], meshes: entry.meshes.filter(meshIsDrawn) };
    });
    const meshes = entries.flatMap((e) => e.meshes);
    assert.equal(meshes.length, stage.drawables.length, "every drawn mesh is one drawable");
    // Each measured mesh's drawable: ids are `<cast>.mesh.<mesh name>`; names are unique within one performer and its prop.
    const drawableOf = new Map(entries.flatMap(({ owners, meshes: own }) => own.map((mesh) => {
      const found = stage.drawables.filter((d) => owners.some((o) => d.id === `${o}.mesh.${mesh.name}`));
      assert.equal(found.length, 1, `mesh ${mesh.name} of ${owners.join("/")}`);
      return [mesh, found[0]] as const;
    })));
    assert.equal(new Set(drawableOf.values()).size, stage.drawables.length, "no two meshes share a drawable");
    const point = new Vector3();
    let checked = 0;
    for (const frame of frames) {
      facts.at(frame);
      const world = poseStage3d(stage, frame);
      for (const mesh of meshes) {
        const drawable = drawableOf.get(mesh)!;
        const local = parts.get(drawable.part)!;
        const position = (mesh as Mesh).geometry.getAttribute("position");
        assert.equal(local.positions.length, position.count * 3, `${drawable.id} vertex count`);
        const expected = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) {
          point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
          expected[i * 3] = point.x; expected[i * 3 + 1] = point.y; expected[i * 3 + 2] = point.z;
        }
        const got = worldVertices(world.get(drawable.node)!, local.positions);
        const a = new Uint32Array(got.buffer), b = new Uint32Array(expected.buffer);
        const first = a.findIndex((bits, i) => bits !== b[i]);
        assert.equal(first, -1, `frame ${frame} ${drawable.id}: component ${first} is ${got[first]}, prepareStageFacts has ${expected[first]}`);
        checked += position.count;
      }
    }
    assert.ok(checked > minVertices, `only ${checked} vertices were compared`);
  } finally {
    facts.dispose();
  }
}

test("for every frame, the IR-posed world vertices equal prepareStageFacts' posed vertices bit for bit in f32", () => {
  const film = ionaFilm();
  const scene = film.scene as unknown as Scene;
  assertPosedVerticesMatch(film, Array.from({ length: scene.durationFrames }, (_, frame) => frame), scene.durationFrames * 10_000);
});

test("three performers, each with a glider (the J5 film), are posed from the IR exactly as prepareStageFacts poses them", () => {
  const film = characterFilm("journey-three-characters");
  const scene = film.scene as unknown as Scene;
  assert.equal(scene.performances!.length, 3);
  // Every fifth frame, plus the last, covers the approach, the catch and the hold of all three performers.
  const frames = Array.from({ length: scene.durationFrames }, (_, frame) => frame).filter((frame) => frame % 5 === 0 || frame === scene.durationFrames - 1);
  assertPosedVerticesMatch(film, frames, frames.length * 30_000);
});

test("a several-performer film emits one stage with every performer's own objects, face and glider", () => {
  const film = characterFilm("journey-three-characters");
  for (const format of ["long", "reel"] as const) {
    assert.deepEqual(nativeSupport(film, format), []);
    const result = emit(film, format);
    const stage = stageOf(result);
    assert.deepEqual(stage.faceTextures.map((f) => f.id), ["iona.face", "pip.face", "marlo.face"]);
    for (const owner of ["iona", "pip", "marlo", "glider-iona", "glider-pip", "glider-marlo"]) {
      assert.ok(stage.drawables.some((d) => d.id.startsWith(`${owner}.mesh.`)), `${owner} has no drawable`);
    }
    // Ids are unique across performers, and every performer's face paints its own programs.
    assert.equal(new Set(stage.drawables.map((d) => d.id)).size, stage.drawables.length);
    assert.equal(new Set(stage.nodes.map((n) => n.id)).size, stage.nodes.length);
    for (const face of stage.faceTextures) assert.equal(face.programs.length, stage.sampleFrames, `${face.id} programs`);
    // A mirrored left and right part share one geometry, so the file holds exactly the parts the drawables name, each once.
    const mesh = result.ir.assets.find((a): a is MeshAsset => a.kind === "mesh")!;
    assert.deepEqual(mesh.parts.map((p) => p.id).sort(), [...new Set(stage.drawables.map((d) => d.part))].sort());
  }
  // The one-performer films of Pip and Marlo are accepted too, with their own mesh and a single face.
  for (const slug of ["pixels-stage-pip", "pixels-stage-marlo"] as const) {
    const one = characterFilm(slug);
    assert.deepEqual(nativeSupport(one, "long"), []);
    assert.equal(stageOf(emit(one, "long")).faceTextures.length, 1);
  }
});

test("the stage sits between the ground plane and the foreground, holds its last sample, and two emits are byte-identical", () => {
  const film = ionaFilm();
  const first = emit(film, "reel");
  const second = emit(film, "reel");
  assert.equal(JSON.stringify(first.ir), JSON.stringify(second.ir));
  assert.deepEqual(meshBytes(first), meshBytes(second));
  assert.deepEqual(first.ir.stage.map((n) => n.kind), ["group", "stage3d"]);
  assert.equal(first.ir.stage[0].id, "ground-plane");
  const stage = stageOf(first);
  const scene = film.scene as unknown as Scene;
  assert.ok(stage.sampleFrames <= scene.durationFrames && stage.sampleFrames <= first.ir.film.durationFrames);
  // Both formats share one evaluated stage.
  assert.deepEqual(stageOf(emit(film, "long")), stage);
});

test("nativeSupport accepts the cel Three film with one performer and with several (P4.3) and the dots-v1 film (P4.4), and still refuses what no step draws", () => {
  const film = ionaFilm();
  for (const format of ["long", "reel"] as const) {
    assert.deepEqual(nativeSupport(film, format), []);
    // The render path emits it with no development allowance.
    assert.equal(stageOf(emit(film, format)).kind, "stage3d");
  }

  // P4.4: the dots-v1 treatment is carried and drawn, so a dots film is accepted and emitted with its dots look.
  const dots = structuredClone(film);
  (dots.scene as unknown as Scene).treatment = "dots-v1";
  for (const cast of (dots.scene as unknown as Scene).cast ?? []) delete cast.treatment;
  assert.deepEqual(nativeSupport(dots, "reel"), []);
  assert.equal(stageOf(emit(dots, "reel")).treatment, "dots-v1");

  // A Three stage with nothing to draw is still refused, with its reason.
  const empty = structuredClone(film);
  (empty.scene as unknown as Scene).performances = [];
  assert.ok(nativeSupport(empty, "reel").some((r) => r.includes("no performances")));
  assert.throws(() => emit(empty, "reel"), (e: unknown) => e instanceof NativeUnsupportedError && e.reasons.some((r) => r.includes("no performances")));
});
