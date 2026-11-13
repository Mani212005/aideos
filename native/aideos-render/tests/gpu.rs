//! File Description: Behavioural test of the optional GPU path (built only with `--features gpu`, which needs an EGL driver): the GPU frame matches the CPU reference closely. GPU output is never byte-compared; the CPU raster is the reference.
//! Inputs and outputs: the fixture package -> a GPU and a CPU render of the same frame, compared pixel by pixel.
//! Used by: `cargo test --manifest-path native/Cargo.toml --features gpu`.
#![cfg(feature = "gpu")]

mod common;

use aideos_render::gpu::GpuContext;
use aideos_render::{Format, Renderer};

/// Checks that the gpu frame matches the cpu reference.
#[test]
fn the_gpu_frame_matches_the_cpu_reference() {
    let renderer = Renderer::new(common::tiny_scene(), &common::package_dir()).expect("loads");
    let mut gpu = GpuContext::new().expect("a GPU context (this test needs an EGL driver)");
    for format in [Format::Long, Format::Reel] {
        let g = gpu.render_frame(&renderer, format, 43).expect("gpu render");
        let c = renderer.render_frame(format, 43).expect("cpu render");
        assert_eq!((g.width, g.height), (c.width, c.height));
        let diffs: Vec<u8> = g
            .rgba
            .iter()
            .zip(&c.rgba)
            .map(|(a, b)| a.abs_diff(*b))
            .collect();
        let mean = diffs.iter().map(|d| f64::from(*d)).sum::<f64>() / diffs.len() as f64;
        let far = diffs
            .chunks(4)
            .filter(|px| px.iter().any(|d| *d > 8))
            .count() as f64
            / (diffs.len() / 4) as f64;
        assert!(mean < 1.0, "{format:?}: mean channel difference {mean}");
        assert!(
            far < 0.01,
            "{format:?}: {:.3}% of pixels differ by more than 8",
            far * 100.0
        );
    }
}
