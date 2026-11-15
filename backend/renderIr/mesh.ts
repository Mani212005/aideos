/**
 * File Description: Writes and reads the Render IR's binary mesh file (the `mesh` asset of `aideos.render/2`): little-endian, magic `AIDMESH` plus format byte 1, a part count, one header per part (vertices, indices, flags: bit 0 = has uv, bit 4 = a dot sample field, bit 5 = line segment end points; neither of the last two = triangles; bits 1 to 3 and 6 up are unknown and refused), then each triangle part's f32 positions, f32 normals, optional f32 uvs and u32 indices, each points part's f32 positions, f32 normals and f32 ranks (no indices), and each lines part's f32 positions (no indices, an even vertex count). Reading checks the file against the parts the IR declares, its exact length, finite floats and index bounds. The Rust twin is native/aideos-render-ir/src/mesh.rs. Browser-safe (no Node imports).
 * Inputs and outputs: part arrays -> file bytes; file bytes plus the declared mesh asset -> part arrays, or a MeshFileError naming the defect.
 * Used by: backend/renderIr/emitStage3d.ts (writer), backend/renderIr/stage3d.test.ts and backend/renderIr/mesh.test.ts (reader).
 */

import type { MeshAsset } from "./schema";

/** The 8-byte file signature: ASCII `AIDMESH` and the format number 1. */
export const MESH_MAGIC = new Uint8Array([0x41, 0x49, 0x44, 0x4d, 0x45, 0x53, 0x48, 0x01]);
/** Flag bit set when a part carries texture coordinates. */
const FLAG_UV = 1;
/** Flag bit set when a part is a dot sample field (positions, normals, ranks). */
const FLAG_POINTS = 16;
/** Flag bit set when a part is line segment end points (positions only). */
const FLAG_LINES = 32;

/** What a part holds; absent on a `MeshPartData` means triangles. */
export type MeshPartKind = "triangles" | "points" | "lines";

/** One part's geometry, exactly as the file stores it. */
export interface MeshPartData {
  id: string;
  /** Absent means triangles. */
  kind?: MeshPartKind;
  positions: Float32Array;
  /** Triangles and points only; lines carry none (an empty array). */
  normals: Float32Array;
  /** Present when the part has texture coordinates (two per vertex). */
  uvs?: Float32Array;
  /** One per point, for a points part. */
  ranks?: Float32Array;
  /** Empty for points and lines. */
  indices: Uint32Array;
}

// Returns the flag bits that name a part's kind and uv.
function flagsOf(part: Pick<MeshPartData, "kind" | "uvs">): number {
  return (part.kind === "points" ? FLAG_POINTS : part.kind === "lines" ? FLAG_LINES : 0) | (part.uvs ? FLAG_UV : 0);
}

// Floats a part stores per vertex given its flags (triangles 6 or 8, points 7, lines 3).
function floatsPerVertex(flags: number): number {
  if (flags & FLAG_POINTS) return 7;
  if (flags & FLAG_LINES) return 3;
  return flags & FLAG_UV ? 8 : 6;
}

/** Raised when mesh bytes do not match the format or the IR's declaration. */
export class MeshFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeshFileError";
  }
}

// Throws a MeshFileError unless the condition holds.
function need(condition: boolean, message: string): asserts condition {
  if (!condition) throw new MeshFileError(message);
}

/** Encodes parts into the mesh file format; the parts' order is the file's order. */
export function encodeMesh(parts: MeshPartData[]): Uint8Array {
  need(parts.length > 0, "a mesh file holds at least one part");
  let size = MESH_MAGIC.length + 4 + parts.length * 12;
  for (const part of parts) {
    const v = part.positions.length / 3;
    const kind = part.kind ?? "triangles";
    need(Number.isInteger(v) && v > 0, `part ${part.id}: positions are not whole xyz triples`);
    if (kind === "triangles") {
      need(part.normals.length === v * 3, `part ${part.id}: ${part.normals.length / 3} normals for ${v} vertices`);
      need(part.uvs === undefined || part.uvs.length === v * 2, `part ${part.id}: uvs do not match ${v} vertices`);
      need(part.indices.length > 0 && part.indices.length % 3 === 0, `part ${part.id}: indices are not whole triangles`);
      need(part.ranks === undefined, `part ${part.id}: ranks belong to a points part`);
    } else {
      need(part.indices.length === 0, `part ${part.id}: a ${kind} part has no indices`);
      need(part.uvs === undefined, `part ${part.id}: a ${kind} part has no uvs`);
      if (kind === "points") {
        need(part.normals.length === v * 3, `part ${part.id}: ${part.normals.length / 3} normals for ${v} points`);
        need(part.ranks !== undefined && part.ranks.length === v, `part ${part.id}: a points part needs one rank per point`);
      } else {
        need(v % 2 === 0, `part ${part.id}: a lines part holds whole segments (an even number of end points)`);
        need(part.normals.length === 0 && part.ranks === undefined, `part ${part.id}: a lines part holds positions only`);
      }
    }
    size += 4 * (v * floatsPerVertex(flagsOf(part)) + part.indices.length);
  }
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(MESH_MAGIC, 0);
  let at = MESH_MAGIC.length;
  view.setUint32(at, parts.length, true);
  at += 4;
  for (const part of parts) {
    view.setUint32(at, part.positions.length / 3, true);
    view.setUint32(at + 4, part.indices.length, true);
    view.setUint32(at + 8, flagsOf(part), true);
    at += 12;
  }
  for (const part of parts) {
    for (const block of [part.positions, part.normals, ...(part.uvs ? [part.uvs] : []), ...(part.ranks ? [part.ranks] : [])]) {
      for (const value of block) {
        view.setFloat32(at, value, true);
        at += 4;
      }
    }
    for (const index of part.indices) {
      view.setUint32(at, index, true);
      at += 4;
    }
  }
  return bytes;
}

/** Decodes a mesh file and checks it against the mesh asset the IR declares for it. */
export function decodeMesh(bytes: Uint8Array, asset: Pick<MeshAsset, "id" | "parts">): MeshPartData[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  need(bytes.length >= MESH_MAGIC.length + 4 && MESH_MAGIC.every((b, i) => bytes[i] === b), `mesh ${asset.id}: not an AIDMESH format 1 file`);
  let at = MESH_MAGIC.length;
  const count = view.getUint32(at, true);
  at += 4;
  need(count === asset.parts.length, `mesh ${asset.id}: the file holds ${count} parts, the IR declares ${asset.parts.length}`);
  need(bytes.length >= at + count * 12, `mesh ${asset.id}: the file ends inside the part headers`);
  const headers = asset.parts.map((declared, i) => {
    const vertices = view.getUint32(at + i * 12, true);
    const indices = view.getUint32(at + i * 12 + 4, true);
    const flags = view.getUint32(at + i * 12 + 8, true);
    need((flags & ~(FLAG_UV | FLAG_POINTS | FLAG_LINES)) === 0, `mesh ${asset.id} part ${declared.id}: unknown flags ${flags}`);
    const kindBits = flags & (FLAG_POINTS | FLAG_LINES);
    need(kindBits !== (FLAG_POINTS | FLAG_LINES), `mesh ${asset.id} part ${declared.id}: flags ${flags} name two kinds`);
    need(kindBits === 0 || (flags & FLAG_UV) === 0, `mesh ${asset.id} part ${declared.id}: a points or lines part has no uvs`);
    const kind: MeshPartKind = flags & FLAG_POINTS ? "points" : flags & FLAG_LINES ? "lines" : "triangles";
    const uv = (flags & FLAG_UV) !== 0;
    need(vertices === declared.vertices && indices === declared.indices && uv === declared.uv && kind === (declared.kind ?? "triangles"),
      `mesh ${asset.id} part ${declared.id}: the file holds ${vertices} vertices, ${indices} indices, uv ${uv}; the IR declares ${declared.vertices}, ${declared.indices}, ${declared.uv}${kind === (declared.kind ?? "triangles") ? "" : ` (the file's part is ${kind}, the IR's is ${declared.kind ?? "triangles"})`}`);
    need(kind === "triangles" || indices === 0, `mesh ${asset.id} part ${declared.id}: a ${kind} part has no indices`);
    need(kind !== "lines" || vertices % 2 === 0, `mesh ${asset.id} part ${declared.id}: a lines part holds whole segments`);
    return { id: declared.id, vertices, indices, uv, kind, flags };
  });
  at += count * 12;
  const expected = at + headers.reduce((sum, h) => sum + 4 * (h.vertices * floatsPerVertex(h.flags) + h.indices), 0);
  need(bytes.length === expected, `mesh ${asset.id}: the file is ${bytes.length} bytes, its headers describe ${expected}`);
  // Reads `n` little-endian f32 values, refusing any that are not finite.
  const floats = (n: number, what: string, part: string): Float32Array => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++, at += 4) {
      out[i] = view.getFloat32(at, true);
      need(Number.isFinite(out[i]), `mesh ${asset.id} part ${part}: ${what} ${i} is not finite`);
    }
    return out;
  };
  return headers.map((h) => {
    const positions = floats(h.vertices * 3, "position", h.id);
    const normals = h.kind === "lines" ? new Float32Array(0) : floats(h.vertices * 3, "normal", h.id);
    const uvs = h.uv ? floats(h.vertices * 2, "uv", h.id) : undefined;
    const ranks = h.kind === "points" ? floats(h.vertices, "rank", h.id) : undefined;
    const indices = new Uint32Array(h.indices);
    for (let i = 0; i < h.indices; i++, at += 4) {
      indices[i] = view.getUint32(at, true);
      need(indices[i] < h.vertices, `mesh ${asset.id} part ${h.id}: index ${i} points at vertex ${indices[i]} of ${h.vertices}`);
    }
    return { id: h.id, ...(h.kind !== "triangles" ? { kind: h.kind } : {}), positions, normals, ...(uvs ? { uvs } : {}), ...(ranks ? { ranks } : {}), indices };
  });
}
