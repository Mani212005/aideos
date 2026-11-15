//! File Description: Reads the Render IR's binary mesh file (the `mesh` asset of `aideos.render/2`): little-endian, magic `AIDMESH` plus format byte 1, a part count, one header per part (vertices, indices, flags: bit 0 = has uv, bit 4 = a dot sample field, bit 5 = line segment end points; neither of the last two = triangles; bits 1 to 3 and 6 up are unknown and refused), then each triangle part's f32 positions, f32 normals, optional f32 uvs and u32 indices, each points part's f32 positions, normals and ranks (no indices) and each lines part's f32 positions (no indices, an even vertex count). Checks the file against the parts the IR declares, its exact length, finite floats and index bounds. The TypeScript twin (reader and writer) is backend/renderIr/mesh.ts; both are tested against the same fixture file.
//! Inputs and outputs: mesh file bytes and the declared `MeshAsset` -> the parts' geometry, or a `MeshError` naming the defect.
//! Used by: the native renderer (P4.2, when it draws the stage3d node) and native/aideos-render-ir/tests/mesh.rs.

use std::fmt;

use crate::types::{MeshAsset, MeshPartKind};

/// The 8-byte file signature: ASCII `AIDMESH` and the format number 1.
pub const MESH_MAGIC: [u8; 8] = *b"AIDMESH\x01";
/// Flag bit set when a part carries texture coordinates.
const FLAG_UV: u32 = 1;
/// Flag bit set when a part is a dot sample field (positions, normals, ranks).
const FLAG_POINTS: u32 = 16;
/// Flag bit set when a part is line segment end points (positions only).
const FLAG_LINES: u32 = 32;

/// One part's geometry, exactly as the file stores it.
#[derive(Debug, Clone, PartialEq)]
pub struct MeshPartData {
    pub id: String,
    pub kind: MeshPartKind,
    pub positions: Vec<f32>,
    /// Triangles and points; empty for lines.
    pub normals: Vec<f32>,
    /// Two per vertex, when the part has texture coordinates.
    pub uvs: Option<Vec<f32>>,
    /// One per point, for a points part.
    pub ranks: Option<Vec<f32>>,
    /// Empty for points and lines.
    pub indices: Vec<u32>,
}

/// A part kind in the words the documents use.
fn kind_name(kind: MeshPartKind) -> &'static str {
    match kind {
        MeshPartKind::Triangles => "triangles",
        MeshPartKind::Points => "points",
        MeshPartKind::Lines => "lines",
    }
}

/// The floats a part stores per vertex given its flags (triangles 6 or 8, points 7, lines 3).
fn floats_per_vertex(flags: u32) -> u64 {
    if flags & FLAG_POINTS != 0 {
        7
    } else if flags & FLAG_LINES != 0 {
        3
    } else if flags & FLAG_UV != 0 {
        8
    } else {
        6
    }
}

/// Why mesh bytes were refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeshError(pub String);

impl fmt::Display for MeshError {
    /// Writes the defect.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for MeshError {}

/// A little-endian cursor over the file that refuses to read past its end.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    /// Reads the next four bytes.
    fn word(&mut self) -> Result<[u8; 4], MeshError> {
        let end = self.at + 4;
        let slice = self
            .bytes
            .get(self.at..end)
            .ok_or_else(|| MeshError("the file ends early".into()))?;
        self.at = end;
        Ok([slice[0], slice[1], slice[2], slice[3]])
    }

    /// Reads a u32.
    fn u32(&mut self) -> Result<u32, MeshError> {
        Ok(u32::from_le_bytes(self.word()?))
    }

    /// Reads `n` finite f32 values.
    fn floats(
        &mut self,
        n: usize,
        what: &str,
        mesh: &str,
        part: &str,
    ) -> Result<Vec<f32>, MeshError> {
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let v = f32::from_le_bytes(self.word()?);
            if !v.is_finite() {
                return Err(MeshError(format!(
                    "mesh {mesh} part {part}: {what} {i} is not finite"
                )));
            }
            out.push(v);
        }
        Ok(out)
    }
}

/// Decodes a mesh file and checks it against the mesh asset the IR declares for it.
pub fn decode_mesh(bytes: &[u8], asset: &MeshAsset) -> Result<Vec<MeshPartData>, MeshError> {
    let id = asset.id.as_str();
    if bytes.len() < MESH_MAGIC.len() + 4 || bytes[..MESH_MAGIC.len()] != MESH_MAGIC {
        return Err(MeshError(format!(
            "mesh {id}: not an AIDMESH format 1 file"
        )));
    }
    let mut r = Reader {
        bytes,
        at: MESH_MAGIC.len(),
    };
    let count = r.u32()? as usize;
    if count != asset.parts.len() {
        return Err(MeshError(format!(
            "mesh {id}: the file holds {count} parts, the IR declares {}",
            asset.parts.len()
        )));
    }
    if bytes.len() < r.at + count * 12 {
        return Err(MeshError(format!(
            "mesh {id}: the file ends inside the part headers"
        )));
    }
    let mut headers = Vec::with_capacity(count);
    for declared in &asset.parts {
        let (vertices, indices, flags) = (r.u32()?, r.u32()?, r.u32()?);
        if flags & !(FLAG_UV | FLAG_POINTS | FLAG_LINES) != 0 {
            return Err(MeshError(format!(
                "mesh {id} part {}: unknown flags {flags}",
                declared.id
            )));
        }
        let kind_bits = flags & (FLAG_POINTS | FLAG_LINES);
        if kind_bits == FLAG_POINTS | FLAG_LINES {
            return Err(MeshError(format!(
                "mesh {id} part {}: flags {flags} name two kinds",
                declared.id
            )));
        }
        if kind_bits != 0 && flags & FLAG_UV != 0 {
            return Err(MeshError(format!(
                "mesh {id} part {}: a points or lines part has no uvs",
                declared.id
            )));
        }
        let kind = if flags & FLAG_POINTS != 0 {
            MeshPartKind::Points
        } else if flags & FLAG_LINES != 0 {
            MeshPartKind::Lines
        } else {
            MeshPartKind::Triangles
        };
        let uv = flags & FLAG_UV != 0;
        if vertices != declared.vertices.0
            || indices != declared.indices.0
            || uv != declared.uv
            || kind != declared.kind()
        {
            let note = if kind == declared.kind() {
                String::new()
            } else {
                format!(
                    " (the file's part is {}, the IR's is {})",
                    kind_name(kind),
                    kind_name(declared.kind())
                )
            };
            return Err(MeshError(format!(
                "mesh {id} part {}: the file holds {vertices} vertices, {indices} indices, uv {uv}; the IR declares {}, {}, {}{note}",
                declared.id, declared.vertices.0, declared.indices.0, declared.uv
            )));
        }
        if kind != MeshPartKind::Triangles && indices != 0 {
            return Err(MeshError(format!(
                "mesh {id} part {}: a {} part has no indices",
                declared.id,
                kind_name(kind)
            )));
        }
        if kind == MeshPartKind::Lines && vertices % 2 != 0 {
            return Err(MeshError(format!(
                "mesh {id} part {}: a lines part holds whole segments",
                declared.id
            )));
        }
        headers.push((
            declared.id.as_str(),
            vertices as usize,
            indices as usize,
            kind,
            flags,
        ));
    }
    let expected = headers
        .iter()
        .fold(r.at as u64, |sum, (_, v, i, _, flags)| {
            sum + 4 * (*v as u64 * floats_per_vertex(*flags) + *i as u64)
        });
    if bytes.len() as u64 != expected {
        return Err(MeshError(format!(
            "mesh {id}: the file is {} bytes, its headers describe {expected}",
            bytes.len()
        )));
    }
    headers
        .into_iter()
        .map(|(part, vertices, count, kind, flags)| {
            let positions = r.floats(vertices * 3, "position", id, part)?;
            let normals = if kind == MeshPartKind::Lines {
                Vec::new()
            } else {
                r.floats(vertices * 3, "normal", id, part)?
            };
            let uvs = if flags & FLAG_UV != 0 {
                Some(r.floats(vertices * 2, "uv", id, part)?)
            } else {
                None
            };
            let ranks = if kind == MeshPartKind::Points {
                Some(r.floats(vertices, "rank", id, part)?)
            } else {
                None
            };
            let mut indices = Vec::with_capacity(count);
            for i in 0..count {
                let index = r.u32()?;
                if index as usize >= vertices {
                    return Err(MeshError(format!(
                        "mesh {id} part {part}: index {i} points at vertex {index} of {vertices}"
                    )));
                }
                indices.push(index);
            }
            Ok(MeshPartData {
                id: part.to_string(),
                kind,
                positions,
                normals,
                uvs,
                ranks,
                indices,
            })
        })
        .collect()
}
