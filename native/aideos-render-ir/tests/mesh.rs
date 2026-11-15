//! File Description: Runs the Rust mesh file reader over the fixture shared with the TypeScript codec (backend/renderIr/mesh.test.ts): the committed bytes decode to the declared parts, and every defect (wrong signature, part count or declaration, length, unknown flags, non-finite float, index out of bounds) is refused with its cause.
//! Inputs and outputs: native/aideos-render-ir/fixtures/mesh/two-parts.{json,mesh} and dots-parts.{json,mesh} (P4.4: a point sample field and line segments) -> pass or fail.
//! Used by: cargo test in native/ (the CI unit job).

use std::path::PathBuf;

use aideos_render_ir::mesh::{decode_mesh, MeshPartData};
use aideos_render_ir::types::{MeshAsset, MeshPartKind};
use serde_json::Value;

/// The shared mesh fixture folder.
fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/mesh")
}

/// A fixture's declaration, expected parts and bytes.
fn fixture_named(name: &str) -> (MeshAsset, Vec<MeshPartData>, Vec<u8>) {
    let spec: Value =
        serde_json::from_str(&std::fs::read_to_string(dir().join(format!("{name}.json"))).unwrap())
            .unwrap();
    let mut asset = spec["asset"].clone();
    asset.as_object_mut().unwrap().remove("kind");
    let asset: MeshAsset = serde_json::from_value(asset).unwrap();
    let floats = |v: &Value| {
        v.as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap() as f32)
            .collect::<Vec<f32>>()
    };
    let parts = spec["parts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| MeshPartData {
            id: p["id"].as_str().unwrap().to_string(),
            kind: match p.get("kind").and_then(Value::as_str) {
                Some("points") => MeshPartKind::Points,
                Some("lines") => MeshPartKind::Lines,
                _ => MeshPartKind::Triangles,
            },
            positions: floats(&p["positions"]),
            normals: floats(&p["normals"]),
            uvs: p.get("uvs").map(floats),
            ranks: p.get("ranks").map(floats),
            indices: p["indices"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_u64().unwrap() as u32)
                .collect(),
        })
        .collect();
    (
        asset,
        parts,
        std::fs::read(dir().join(format!("{name}.mesh"))).unwrap(),
    )
}

/// The two-parts fixture's declaration, expected parts and bytes.
fn fixture() -> (MeshAsset, Vec<MeshPartData>, Vec<u8>) {
    fixture_named("two-parts")
}

#[test]
fn the_dots_fixture_decodes_a_sample_field_and_line_segments_and_refuses_their_defects() {
    let (asset, parts, bytes) = fixture_named("dots-parts");
    assert_eq!(decode_mesh(&bytes, &asset).unwrap(), parts);
    assert_eq!(parts[1].kind, MeshPartKind::Points);
    assert_eq!(parts[1].ranks.as_deref(), Some(&[0.125f32, 0.875][..]));
    assert_eq!(parts[2].kind, MeshPartKind::Lines);
    // The file and the IR must agree on the kind; two kind bits, an index on a points part and uvs on a points part are refused.
    let mut as_triangles = asset.clone();
    as_triangles.parts[1].kind = None;
    let err = decode_mesh(&bytes, &as_triangles).unwrap_err().to_string();
    assert!(
        err.contains("the file's part is points, the IR's is triangles"),
        "{err}"
    );
    let mut two_kinds = bytes.clone();
    two_kinds[12 + 12 + 8..12 + 12 + 12].copy_from_slice(&48u32.to_le_bytes());
    assert!(decode_mesh(&two_kinds, &asset)
        .unwrap_err()
        .to_string()
        .contains("name two kinds"));
    let mut uv_points = bytes.clone();
    uv_points[12 + 12 + 8..12 + 12 + 12].copy_from_slice(&17u32.to_le_bytes());
    assert!(decode_mesh(&uv_points, &asset)
        .unwrap_err()
        .to_string()
        .contains("no uvs"));
    let mut odd_lines = asset.clone();
    odd_lines.parts[2].vertices = aideos_render_ir::types::Whole(3);
    assert!(decode_mesh(&bytes, &odd_lines).is_err());
}

#[test]
fn the_shared_fixture_decodes_to_its_declared_parts() {
    let (asset, parts, bytes) = fixture();
    assert_eq!(decode_mesh(&bytes, &asset).unwrap(), parts);
}

#[test]
fn every_defect_of_a_mesh_file_is_refused_with_its_cause() {
    let (asset, _, bytes) = fixture();
    let edit = |f: &dyn Fn(&mut Vec<u8>)| {
        let mut copy = bytes.clone();
        f(&mut copy);
        copy
    };
    let mut one_part = asset.clone();
    one_part.parts.truncate(1);
    let mut wrong_uv = asset.clone();
    wrong_uv.parts[0].uv = false;
    let len = bytes.len();
    let cases: Vec<(&str, Vec<u8>, &MeshAsset, &str)> = vec![
        (
            "signature",
            edit(&|c| c[7] = 2),
            &asset,
            "not an AIDMESH format 1 file",
        ),
        (
            "part count",
            bytes.clone(),
            &one_part,
            "holds 2 parts, the IR declares 1",
        ),
        (
            "declaration",
            bytes.clone(),
            &wrong_uv,
            "part head: the file holds 3 vertices, 3 indices, uv true",
        ),
        (
            "length",
            edit(&|c| c.truncate(len - 4)),
            &asset,
            "the file is 260 bytes, its headers describe 264",
        ),
        (
            "flags",
            edit(&|c| c[20..24].copy_from_slice(&3u32.to_le_bytes())),
            &asset,
            "part head: unknown flags 3",
        ),
        (
            "non-finite",
            edit(&|c| c[40..44].copy_from_slice(&f32::NAN.to_le_bytes())),
            &asset,
            "part head: position 1 is not finite",
        ),
        (
            "index",
            edit(&|c| c[len - 4..].copy_from_slice(&4u32.to_le_bytes())),
            &asset,
            "part tip: index 5 points at vertex 4 of 4",
        ),
    ];
    for (name, input, declared, message) in cases {
        let err = decode_mesh(&input, declared).expect_err(name);
        assert!(err.to_string().contains(message), "{name}: {err}");
    }
}
