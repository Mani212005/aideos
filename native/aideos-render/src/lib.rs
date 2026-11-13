//! File Description: The native frame renderer of aideos (Phase 1, R2 of the native renderer plan): evaluates a Render IR `aideos.render/1` as a pure function of the frame number and draws the frame with Skia. Skia's CPU rasterizer is the deterministic reference; an optional GPU path (feature `gpu`) draws the same frame through an EGL OpenGL context. Encoding and audio (R3) and emitting the IR from film.json (R4) live elsewhere.
//! Inputs and outputs: a Render IR file and its package directory -> rendered frames (RGBA pixels, PNG).
//! Used by: the `aideos-render` CLI (src/main.rs) and the crate's tests; later the encode stage and the RenderJob runner.

pub mod eval;
#[cfg(feature = "gpu")]
pub mod gpu;
pub mod raster;
pub mod renderer;
pub mod svg;

pub use eval::Format;
pub use renderer::{RenderError, RenderedFrame, Renderer};
