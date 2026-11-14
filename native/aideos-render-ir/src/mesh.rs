//! File Description: Reads the Render IR's binary mesh file (the `mesh` asset of `aideos.render/2`): little-endian, magic `AIDMESH` plus format byte 1, a part count, one header per part (vertices, indices, flags with bit 0 = has uv), then each part's f32 positions, f32 normals, optional f32 uvs and u32 indices. Checks the file against the parts the IR declares, its exact length, finite floats and index bounds. The TypeScript twin (reader and writer) is backend/renderIr/mesh.ts; both are tested against the same fixture file.
//! Inputs and outputs: mesh file bytes and the declared `MeshAsset` -> the parts' geometry, or a `MeshError` naming the defect.
//! Used by: the native renderer (P4.2, when it draws the stage3d node) and native/aideos-render-ir/tests/mesh.rs.

use std::fmt;

use crate::types::MeshAsset;

/// The 8-byte file signature: ASCII `AIDMESH` and the format number 1.
pub const MESH_MAGIC: [u8; 8] = *b"AIDMESH\x01";
/// Flag bit set when a part carries texture coordinates.
const FLAG_UV: u32 = 1;

/// One part's geometry, exactly as the file stores it.
#[derive(Debug, Clone, PartialEq)]
pub struct MeshPartData {
    pub id: String,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    /// Two per vertex, when the part has texture coordinates.
    pub uvs: Option<Vec<f32>>,
    pub indices: Vec<u32>,
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
        let slice = self.bytes.get(self.at..end).ok_or_else(|| MeshError("the file ends early".into()))?;
        self.at = end;
        Ok([slice[0], slice[1], slice[2], slice[3]])
    }

    /// Reads a u32.
    fn u32(&mut self) -> Result<u32, MeshError> {
        Ok(u32::from_le_bytes(self.word()?))
    }

    /// Reads `n` finite f32 values.
    fn floats(&mut self, n: usize, what: &str, mesh: &str, part: &str) -> Result<Vec<f32>, MeshError> {
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let v = f32::from_le_bytes(self.word()?);
            if !v.is_finite() {
                return Err(MeshError(format!("mesh {mesh} part {part}: {what} {i} is not finite")));
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
        return Err(MeshError(format!("mesh {id}: not an AIDMESH format 1 file")));
    }
    let mut r = Reader { bytes, at: MESH_MAGIC.len() };
    let count = r.u32()? as usize;
    if count != asset.parts.len() {
        return Err(MeshError(format!("mesh {id}: the file holds {count} parts, the IR declares {}", asset.parts.len())));
    }
    if bytes.len() < r.at + count * 12 {
        return Err(MeshError(format!("mesh {id}: the file ends inside the part headers")));
    }
    let mut headers = Vec::with_capacity(count);
    for declared in &asset.parts {
        let (vertices, indices, flags) = (r.u32()?, r.u32()?, r.u32()?);
        if flags & !FLAG_UV != 0 {
            return Err(MeshError(format!("mesh {id} part {}: unknown flags {flags}", declared.id)));
        }
        let uv = flags & FLAG_UV != 0;
        if vertices != declared.vertices.0 || indices != declared.indices.0 || uv != declared.uv {
            return Err(MeshError(format!(
                "mesh {id} part {}: the file holds {vertices} vertices, {indices} indices, uv {uv}; the IR declares {}, {}, {}",
                declared.id, declared.vertices.0, declared.indices.0, declared.uv
            )));
        }
        headers.push((declared.id.as_str(), vertices as usize, indices as usize, uv));
    }
    let expected = headers.iter().fold(r.at as u64, |sum, (_, v, i, uv)| sum + 4 * (*v as u64 * if *uv { 8 } else { 6 } + *i as u64));
    if bytes.len() as u64 != expected {
        return Err(MeshError(format!("mesh {id}: the file is {} bytes, its headers describe {expected}", bytes.len())));
    }
    headers
        .into_iter()
        .map(|(part, vertices, count, uv)| {
            let positions = r.floats(vertices * 3, "position", id, part)?;
            let normals = r.floats(vertices * 3, "normal", id, part)?;
            let uvs = if uv { Some(r.floats(vertices * 2, "uv", id, part)?) } else { None };
            let mut indices = Vec::with_capacity(count);
            for i in 0..count {
                let index = r.u32()?;
                if index as usize >= vertices {
                    return Err(MeshError(format!("mesh {id} part {part}: index {i} points at vertex {index} of {vertices}")));
                }
                indices.push(index);
            }
            Ok(MeshPartData { id: part.to_string(), positions, normals, uvs, indices })
        })
        .collect()
}
