/**
 * File Description: Behavioural tests of the Three stage in the Render IR (`aideos.render/2`, P4.1) on the real iona-receive fixture film: the emitted document validates and survives a JSON round trip; for every frame of the film, the world vertices posed from the IR (mesh file plus graph and channels, through the reference pose in stage3d.ts) equal the posed vertices prepareStageFacts measures, bit for bit in f32; the stage sits between the ground and foreground planes; two emits are byte-identical; and nativeSupport accepts the one-performer cel film while refusing several performers and dots-v1.
 * Inputs and outputs: the iona-receive fixture package built through buildDesign in the test videos directory, a fake measurer -> asserted IR values and vertex bits.
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

// Emits one format of a film, allowing what the renderer does not draw yet.
function emit(film: Film, format: NativeFormat, allowUndrawn = true): EmitResult {
  const svgSources = loadSceneAssets(film.scene as unknown as Scene).svgSources;
  return emitRenderIr({ film, format, svgSources, measure: fakeMeasurer(), resolvePath: (p) => `/repo/${p}` }, { allowUndrawn });
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

test("for every frame, the IR-posed world vertices equal prepareStageFacts' posed vertices bit for bit in f32", () => {
  const film = ionaFilm();
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
    const meshes = facts.materials.flatMap((m) => m.meshes).filter(meshIsDrawn);
    assert.equal(meshes.length, stage.drawables.length, "every drawn mesh is one drawable");
    // Each measured mesh's drawable: ids are `<cast>.<mesh name>`, and mesh names are unique on this stage.
    const drawableOf = new Map(meshes.map((mesh) => {
      const found = stage.drawables.filter((d) => d.id.endsWith(`.${mesh.name}`));
      assert.equal(found.length, 1, `mesh ${mesh.name}`);
      return [mesh, found[0]] as const;
    }));
    const point = new Vector3();
    let checked = 0;
    for (let frame = 0; frame < scene.durationFrames; frame++) {
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
    assert.ok(checked > scene.durationFrames * 10_000, `only ${checked} vertices were compared`);
  } finally {
    facts.dispose();
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

test("nativeSupport accepts the one-performer cel Three film (P4.2) and still refuses several performers (P4.3) and dots-v1 (P4.4)", () => {
  const film = ionaFilm();
  for (const format of ["long", "reel"] as const) {
    assert.deepEqual(nativeSupport(film, format), []);
    // The render path emits it with no development allowance.
    assert.equal(stageOf(emit(film, format, false)).kind, "stage3d");
  }

  const several = structuredClone(film);
  const scene = several.scene as unknown as Scene;
  scene.performances = [...scene.performances!, { ...scene.performances![0], id: "second" }];
  const severalReasons = nativeSupport(several, "long");
  assert.ok(severalReasons.some((r) => r.includes("several performers (2)") && r.includes("P4.3")));
  assert.throws(() => emit(several, "long", false), (e: unknown) => e instanceof NativeUnsupportedError && e.reasons.join() === severalReasons.join());

  const dots = structuredClone(film);
  (dots.scene as unknown as Scene).treatment = "dots-v1";
  const dotReasons = nativeSupport(dots, "reel");
  assert.ok(dotReasons.some((r) => r.includes("dots-v1") && r.includes("P4.4")));
  // The IR cannot carry dots yet, so even a development emit refuses it.
  assert.throws(() => emit(dots, "reel"), (e: unknown) => e instanceof NativeUnsupportedError && e.reasons.some((r) => r.includes("dots-v1")));
});
