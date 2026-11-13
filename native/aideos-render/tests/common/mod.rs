//! File Description: Shared helpers for the native renderer's integration tests: fixture paths, loading the fixture Render IR, fresh scratch package directories under cargo's test temp dir, and pixel access.
//! Inputs and outputs: none -> paths, a loaded `RenderIr`, scratch directories and pixel values.
//! Used by: tests/evaluator.rs, tests/render.rs, tests/cli.rs, tests/gpu.rs.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use aideos_render::RenderedFrame;
use aideos_render_ir::types::RenderIr;

/// The fixture package (fonts, artwork and IR documents).
pub fn package_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/package")
}

/// The fixture IR file.
pub fn tiny_scene_path() -> PathBuf {
    package_dir().join("tiny-scene.json")
}

/// The fixture IR, loaded through the R1 loader.
pub fn tiny_scene() -> RenderIr {
    aideos_render_ir::load_from_path(tiny_scene_path()).expect("the fixture IR loads")
}

/// A fresh, empty scratch directory unique to this test process and call.
pub fn scratch_dir(name: &str) -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("{name}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the scratch dir");
    dir
}

/// The RGBA value of one pixel.
pub fn pixel(frame: &RenderedFrame, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * frame.width + x) * 4) as usize;
    [
        frame.rgba[i],
        frame.rgba[i + 1],
        frame.rgba[i + 2],
        frame.rgba[i + 3],
    ]
}

/// Whether two colours match within `tol` on every channel.
pub fn close(a: [u8; 4], b: [u8; 4], tol: u8) -> bool {
    a.iter().zip(b.iter()).all(|(x, y)| x.abs_diff(*y) <= tol)
}

/// The width and height recorded in a PNG's IHDR chunk.
pub fn png_size(bytes: &[u8]) -> (u32, u32) {
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "not a PNG");
    let be = |i: usize| u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    (be(16), be(20))
}
