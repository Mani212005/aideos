//! File Description: The native renderer of aideos (Phase 1 of the native renderer plan): evaluates a Render IR `aideos.render/1` as a pure function of the frame number and draws the frame with Skia. Skia's CPU rasterizer is the deterministic reference; an optional GPU path (feature `gpu`) draws the same frame through an EGL OpenGL context. `video` renders a whole film through the R3 encoder (`aideos-encode`) and `measure` gives the TypeScript emitter the raster's own text metrics.
//! Inputs and outputs: a Render IR file and its package directory -> rendered frames (RGBA pixels, PNG) or an encoded mp4; a measure request -> text widths and line metrics.
//! Used by: the `aideos-render` CLI (src/main.rs), the crate's tests, and backend/nativeRenderer.ts through the CLI.

pub mod eval;
#[cfg(feature = "gpu")]
pub mod gpu;
pub mod measure;
pub mod raster;
pub mod renderer;
pub mod svg;
pub mod video;

pub use eval::Format;
pub use renderer::{RenderError, RenderedFrame, Renderer};
