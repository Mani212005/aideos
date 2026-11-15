/**
 * File Description: Behavioural tests of the dots-v1 treatment in the Render IR (`aideos.render/2`, P4.4): the mesh file carries point sample fields and line segments and refuses their defects; the J3 and J4 dots film (Iona in dots-v1 beside a cel Iona) is accepted natively and its stage3d node carries, read back from three's own objects, the paper and ink looks, the sort keys, the frozen sample field and the prop edge lines; a cel film emits none of it; the scene's treatment spans and each cast member's resolved treatment are emitted; and the validator refuses a dots look that names a missing group or a part of the wrong kind, a document with a drawable that has no draw order, and a span that does not fit the film.
 * Inputs and outputs: the iona-receive fixture package and the journey-j3-j4-dots package built through buildDesign in the test videos directory, short synthetic mesh parts -> asserted IR values and refusals.
 * Used by: npm test (Node test runner); the captain asked for the P4.4 dots step and its tests (see the PR's Test changes).
 */

import "../testSupport/fixtureVideosDir";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Color } from "three";
import { buildDesign } from "../designSpec/build";
import { readFilm } from "../pipeline/filmStore";
import { loadSceneAssets } from "../scene/loadSceneAssets";
import { buildProp } from "../../src/dl/scene/props/paperGlider";
import { sampleDotSurface } from "../../src/dl/scene/materials/dotSamples";
import type { Scene } from "../../src/dl/scene/types";
import type { Film } from "../../src/dl/schema";
import { fakeMeasurer } from "../testSupport/nativeSceneFilm";
import { buildCharacterFilm } from "../testSupport/characterFilms";
import { emitRenderIr, nativeSupport, type EmitResult, type NativeFormat } from "./emit";
import { decodeMesh, encodeMesh, MeshFileError, type MeshPartData } from "./mesh";
import type { MeshAsset, Stage3dNode } from "./schema";
import { parseRenderIr } from "./validate";

// Emits one format of a film exactly as the render path does (nativeSupport must accept it).
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

// The mesh asset and the decoded parts of an emitted document.
function meshOf(result: EmitResult): { asset: MeshAsset; parts: MeshPartData[] } {
  const asset = result.ir.assets.find((a): a is MeshAsset => a.kind === "mesh")!;
  const file = result.files.find((f) => "bytes" in f);
  assert.ok(file && "bytes" in file, "no mesh file");
  return { asset, parts: decodeMesh(file.bytes, asset) };
}

let cel: Film | undefined;
// The built iona-receive fixture film (cel), as a fresh copy.
function celFilm(): Film {
  if (!cel) {
    const built = buildDesign("iona-receive", "hand-built");
    assert.equal(built.state, "passed", JSON.stringify(built).slice(0, 1000));
    cel = readFilm("iona-receive")!;
  }
  return structuredClone(cel);
}

let dots: Film | undefined;
// The J3 and J4 dots film, as a fresh copy.
function dotsFilm(): Film {
  if (!dots) dots = buildCharacterFilm("journey-j3-j4-dots");
  return structuredClone(dots);
}

test("the mesh file carries a point sample field and line segments, and refuses their defects", () => {
  const triangle: MeshPartData = { id: "tri", positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]), indices: Uint32Array.from([0, 1, 2]) };
  const points: MeshPartData = { id: "tri.dots", kind: "points", positions: Float32Array.from([0.25, 0.25, 0, 0.5, 0.25, 0]), normals: Float32Array.from([0, 0, 1, 0, 0, 1]), ranks: Float32Array.from([0.125, 0.875]), indices: new Uint32Array(0) };
  const lines: MeshPartData = { id: "tri.edges", kind: "lines", positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array(0), indices: new Uint32Array(0) };
  const asset: MeshAsset = {
    kind: "mesh", id: "m", path: "meshes/m.mesh",
    parts: [
      { id: "tri", vertices: 3, indices: 3, uv: false },
      { id: "tri.dots", kind: "points", vertices: 2, indices: 0, uv: false },
      { id: "tri.edges", kind: "lines", vertices: 4, indices: 0, uv: false },
    ],
  };
  const bytes = encodeMesh([triangle, points, lines]);
  assert.deepEqual(decodeMesh(bytes, asset), [triangle, points, lines]);
  // Two floats per point more than a triangle part without uvs would hold: 3 + 3 + 1 per point, 3 per line end point.
  assert.equal(bytes.length, 8 + 4 + 3 * 12 + 4 * (3 * 6 + 3) + 4 * (2 * 7) + 4 * (4 * 3));

  // The file and the IR must agree on the kind, and a points or lines part has no indices and no uvs.
  assert.throws(() => decodeMesh(bytes, { ...asset, parts: [asset.parts[0], { ...asset.parts[1], kind: undefined, indices: 0 }, asset.parts[2]] }), (e: unknown) => e instanceof MeshFileError && /the file's part is points, the IR's is triangles/.test(e.message));
  assert.throws(() => encodeMesh([{ ...points, indices: Uint32Array.from([0]) }]), /a points part has no indices/);
  assert.throws(() => encodeMesh([{ ...points, ranks: Float32Array.from([0.5]) }]), /one rank per point/);
  assert.throws(() => encodeMesh([{ ...lines, positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0]) }]), /whole segments/);
  const flagged = bytes.slice();
  new DataView(flagged.buffer).setUint32(12 + 12 + 8, 48, true);
  assert.throws(() => decodeMesh(flagged, asset), /name two kinds/);
});

test("the point and line parts match the fixture the Rust reader decodes", () => {
  const dir = path.resolve(__dirname, "../../native/aideos-render-ir/fixtures/mesh");
  const spec = JSON.parse(fs.readFileSync(path.join(dir, "dots-parts.json"), "utf8")) as { asset: MeshAsset; parts: Array<{ id: string; kind?: "points" | "lines"; positions: number[]; normals: number[]; ranks?: number[]; indices: number[] }> };
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, "dots-parts.mesh")));
  const parts: MeshPartData[] = spec.parts.map((p) => ({ id: p.id, ...(p.kind ? { kind: p.kind } : {}), positions: Float32Array.from(p.positions), normals: Float32Array.from(p.normals), ...(p.ranks ? { ranks: Float32Array.from(p.ranks) } : {}), indices: Uint32Array.from(p.indices) }));
  assert.deepEqual(encodeMesh(parts), bytes);
  assert.deepEqual(decodeMesh(bytes, spec.asset), parts);
});

test("the J3 and J4 dots film is accepted natively and its stage carries three's own dots look", () => {
  const film = dotsFilm();
  for (const format of ["long", "reel"] as const) assert.deepEqual(nativeSupport(film, format), [], `${format} is refused`);
  const result = emit(film, "long");
  const stage = stageOf(result);
  const { asset, parts } = meshOf(result);
  assert.ok(parseRenderIr(JSON.stringify(result.ir)).ok, "the emitted document does not validate");

  // Only the first performer's casts have dots art (the second Iona and her glider are cel and never switch), each with its own resolved treatment.
  assert.deepEqual(stage.groups, [{ id: "iona", treatment: "dots-v1" }, { id: "glider", treatment: "cel-v1" }]);
  assert.equal(stage.spans, undefined);
  assert.equal(stage.treatment, "cel-v1");
  const orders = stage.drawables.map((d) => d.order);
  assert.ok(orders.every((o) => Number.isInteger(o)), "every drawable carries its cel draw order");
  assert.equal(new Set(orders).size, orders.length, "draw order keys are unique");
  assert.deepEqual(orders.slice().sort((a, b) => a! - b!), orders, "drawables are listed in their cel draw order");
  for (const d of stage.drawables) {
    const own = d.id.startsWith("iona.") || d.id.startsWith("glider.");
    assert.equal(d.dots !== undefined, own, `${d.id}: dots look present only for the dots performer's casts`);
    assert.equal(d.group, own ? d.id.split(".")[0] : undefined);
  }

  const paper = new Color(0x0a0a0b);
  const kinds = new Map<string, number>();
  for (const d of stage.drawables.filter((x) => x.id.startsWith("iona."))) {
    const look = d.dots!;
    kinds.set(look.material.kind, (kinds.get(look.material.kind) ?? 0) + 1);
    if (d.material.kind === "ink") {
      assert.equal(look.material.kind, "ink");
      assert.ok(look.material.kind === "ink" && look.material.width === (d.material as { width: number }).width, "the hull keeps its width");
      assert.ok(look.material.kind === "ink" && (look.material.color.join() === "1,1,1" || look.material.color.join() === "0,0,0"), "the hull is white, or black behind a light fill");
      assert.equal(look.order, d.order, "the hull's material is not swapped");
      assert.equal(look.samples, undefined);
      continue;
    }
    assert.ok(look.order > d.order!, `${d.id}: the paper is created after the cel material`);
    if (look.material.kind === "faceLuma") {
      assert.equal(look.samples, undefined, "the head carries no dots");
      assert.equal(d.material.kind, "face");
    } else if (look.material.kind === "basic" && look.material.color.join() === "1,1,1") {
      assert.equal(look.samples, undefined, "a light fill carries no dots");
    } else if (look.material.kind === "basic") {
      assert.deepEqual(look.material.color, paper.toArray(), "the paper is 0x0a0a0b in linear light");
      assert.ok(look.samples && look.samples.tone >= 0 && look.samples.tone <= 1);
      assert.equal(look.edges, undefined, "only the prop has edge lines");
    }
  }
  assert.ok((kinds.get("faceLuma") ?? 0) === 1 && (kinds.get("ink") ?? 0) > 10 && (kinds.get("basic") ?? 0) > 10, JSON.stringify([...kinds]));

  // The sample fields are the frozen sampler's own output and carry unit normals and ranks in [0, 1].
  let samples = 0;
  for (const d of stage.drawables) {
    const field = d.dots?.samples;
    if (!field) continue;
    const part = parts.find((p) => p.id === field.part)!;
    assert.equal(part.kind, "points");
    assert.equal(asset.parts.find((p) => p.id === field.part)!.kind, "points");
    assert.ok(part.positions.length / 3 <= 24000);
    for (const r of part.ranks!) assert.ok(r >= 0 && r <= 1);
    for (let i = 0; i < part.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(part.normals[i], part.normals[i + 1], part.normals[i + 2]) - 1) < 1e-5);
    samples += part.positions.length / 3;
  }
  assert.ok(samples > 20000 && samples < 60000, `${samples} dots on one performer`);
  const glider = stage.drawables.filter((d) => d.id.startsWith("glider."));
  const edges = glider.map((d) => d.dots?.edges).filter(Boolean);
  assert.ok(edges.length > 0 && edges.every((e) => e!.color.join() === "1,1,1"), "the glider's mesh has white edge lines");
  const first = glider.find((d) => d.dots?.samples)!;
  const own = buildProp("paper-glider-v1");
  try {
    const meshes: Array<{ name: string; geometry: Parameters<typeof sampleDotSurface>[0] }> = [];
    own.root.traverse((o) => { if ("isMesh" in o && o.isMesh) meshes.push({ name: o.name, geometry: (o as unknown as { geometry: Parameters<typeof sampleDotSurface>[0] }).geometry }); });
    const expected = sampleDotSurface(meshes.find((m) => first.id.endsWith(`.${m.name}`))!.geometry);
    const got = parts.find((p) => p.id === first.dots!.samples!.part)!;
    assert.deepEqual(got.positions, expected.getAttribute("position").array);
    assert.deepEqual(got.ranks, expected.getAttribute("rank").array);
  } finally { own.dispose(); }

  // Two emits are the same bytes, and the reel shares the long format's stage.
  assert.equal(JSON.stringify(emit(film, "long").ir), JSON.stringify(result.ir));
  assert.deepEqual(stageOf(emit(film, "reel")), stage);
});

test("a cel film emits none of the dots fields", () => {
  const result = emit(celFilm(), "long");
  const stage = stageOf(result);
  const text = JSON.stringify(stage);
  for (const field of ['"dots"', '"groups"', '"spans"', '"group"', '"order"']) assert.ok(!text.includes(field), `a cel document says ${field}`);
  assert.equal(stage.treatment, "cel-v1");
  assert.ok(meshOf(result).parts.every((p) => p.kind === undefined), "a cel mesh holds triangle parts only");
});

test("the scene's treatment spans and each cast member's resolved treatment are emitted", () => {
  const film = celFilm();
  const scene = film.scene as unknown as Scene;
  scene.treatment = "dots-v1";
  for (const cast of scene.cast ?? []) delete (cast as { treatment?: unknown }).treatment;
  scene.treatments = [{ startFrame: 60, endFrame: 150, treatment: "cel-v1" }];
  assert.deepEqual(nativeSupport(film, "long"), []);
  const stage = stageOf(emit(film, "long"));
  assert.equal(stage.treatment, "dots-v1");
  assert.deepEqual(stage.spans, [{ startFrame: 60, endFrame: 150, treatment: "cel-v1" }]);
  assert.deepEqual(stage.groups, [{ id: "iona", treatment: "dots-v1" }, { id: "glider", treatment: "dots-v1" }]);
  assert.ok(stage.drawables.every((d) => d.dots && d.group), "every drawable of an all-dots film has its look");

  // A cast member's own treatment wins over the scene's.
  const own = celFilm();
  const ownScene = own.scene as unknown as Scene;
  ownScene.treatment = "dots-v1";
  ownScene.cast!.find((c) => c.id === "glider")!.treatment = "cel-v1";
  delete (ownScene.cast!.find((c) => c.id === "iona")! as { treatment?: unknown }).treatment;
  assert.deepEqual(stageOf(emit(own, "long")).groups, [{ id: "iona", treatment: "dots-v1" }, { id: "glider", treatment: "cel-v1" }]);
});

test("the validator refuses a dots look that points at nothing, at a part of the wrong kind, a missing draw order and a span past the film", () => {
  const film = dotsFilm();
  const good = emit(film, "long").ir;
  const clone = () => structuredClone(good) as unknown as { stage: Array<{ kind: string } & Record<string, unknown>>; film: { durationFrames: number } };
  const stageIndex = good.stage.findIndex((n) => n.kind === "stage3d");
  // Returns the issue codes with their paths of a document edited by `edit`.
  const issues = (edit: (stage: Stage3dNode) => void): Array<[string, string]> => {
    const doc = clone();
    edit(doc.stage[stageIndex] as unknown as Stage3dNode);
    const parsed = parseRenderIr(JSON.stringify(doc));
    assert.equal(parsed.ok, false);
    return parsed.ok ? [] : parsed.error.kind === "invalid_document" ? parsed.error.issues.map((i) => [i.code, i.path] as [string, string]) : [];
  };
  const ionaAt = (stage: Stage3dNode) => stage.drawables.findIndex((d) => d.dots?.samples);
  const sampled = ionaAt(good.stage[stageIndex] as unknown as Stage3dNode);
  assert.deepEqual(issues((s) => { s.drawables[ionaAt(s)].group = "nobody"; }), [["unknown_group", `/stage/${stageIndex}/drawables/${sampled}/group`]]);
  assert.deepEqual(issues((s) => { s.drawables[ionaAt(s)].dots!.samples!.part = s.drawables[0].part; }).map((i) => i[0]), ["part_kind_mismatch"]);
  assert.deepEqual(issues((s) => { delete s.drawables[1].order; }).map((i) => i[0]), ["dots_incomplete"]);
  assert.deepEqual(issues((s) => { delete s.drawables[ionaAt(s)].group; }).map((i) => i[0]), ["dots_incomplete"]);
  assert.deepEqual(issues((s) => { s.spans = [{ startFrame: 10, endFrame: 10, treatment: "cel-v1" }]; }).map((i) => i[0]), ["invalid_span"]);
  assert.deepEqual(issues((s) => { s.spans = [{ startFrame: 0, endFrame: 26_000_000, treatment: "cel-v1" }]; }).map((i) => i[0]), ["invalid_span"]);
  assert.deepEqual(issues((s) => { s.groups = [...s.groups!, s.groups![0]]; }).map((i) => i[0]), ["duplicate_stage3d_id"]);
});
