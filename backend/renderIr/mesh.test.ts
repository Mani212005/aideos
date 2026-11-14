/**
 * File Description: Behavioural tests of the Render IR mesh file codec against the fixture shared with the Rust reader (native/aideos-render-ir/tests/mesh.rs): the writer produces the committed bytes exactly, the reader gives the parts back, and every defect (wrong signature, part count or declaration, length, unknown flags, non-finite float, index out of bounds) is refused with its cause.
 * Inputs and outputs: native/aideos-render-ir/fixtures/mesh/two-parts.{json,mesh} -> pass or fail.
 * Used by: npm test (found by glob), the CI unit job.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { decodeMesh, encodeMesh, MeshFileError, type MeshPartData } from "./mesh";
import type { MeshAsset } from "./schema";

const DIR = path.resolve(__dirname, "../../native/aideos-render-ir/fixtures/mesh");
const spec = JSON.parse(fs.readFileSync(path.join(DIR, "two-parts.json"), "utf8")) as {
  asset: MeshAsset;
  parts: Array<{ id: string; positions: number[]; normals: number[]; uvs?: number[]; indices: number[] }>;
};
const bytes = new Uint8Array(fs.readFileSync(path.join(DIR, "two-parts.mesh")));

// The fixture's parts as typed arrays.
function parts(): MeshPartData[] {
  return spec.parts.map((p) => ({
    id: p.id,
    positions: Float32Array.from(p.positions),
    normals: Float32Array.from(p.normals),
    ...(p.uvs ? { uvs: Float32Array.from(p.uvs) } : {}),
    indices: Uint32Array.from(p.indices),
  }));
}

// A copy of the fixture bytes with one edit applied.
function edited(edit: (view: DataView, copy: Uint8Array) => Uint8Array | void): Uint8Array {
  const copy = bytes.slice();
  return edit(new DataView(copy.buffer), copy) ?? copy;
}

test("the writer produces the committed fixture bytes exactly and the reader gives the parts back", () => {
  assert.deepEqual(encodeMesh(parts()), bytes);
  assert.deepEqual(decodeMesh(bytes, spec.asset), parts());
});

test("every defect of a mesh file is refused with its cause", () => {
  const cases: Array<[string, Uint8Array, MeshAsset, RegExp]> = [
    ["signature", edited((_, c) => { c[7] = 2; }), spec.asset, /not an AIDMESH format 1 file/],
    ["part count", bytes, { ...spec.asset, parts: spec.asset.parts.slice(0, 1) }, /holds 2 parts, the IR declares 1/],
    ["declaration", bytes, { ...spec.asset, parts: [{ ...spec.asset.parts[0], uv: false }, spec.asset.parts[1]] }, /part head: the file holds 3 vertices, 3 indices, uv true/],
    ["length", edited((_, c) => c.slice(0, c.length - 4)), spec.asset, /the file is 260 bytes, its headers describe 264/],
    ["flags", edited((v) => v.setUint32(12 + 8, 3, true)), spec.asset, /part head: unknown flags 3/],
    ["non-finite", edited((v) => v.setFloat32(36 + 4, Number.NaN, true)), spec.asset, /part head: position 1 is not finite/],
    ["index", edited((v) => v.setUint32(bytes.length - 4, 4, true)), spec.asset, /part tip: index 5 points at vertex 4 of 4/],
  ];
  for (const [name, input, asset, message] of cases) {
    assert.throws(() => decodeMesh(input, asset), (e: unknown) => e instanceof MeshFileError && message.test(e.message), name);
  }
});
