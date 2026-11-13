// File Description: Library root of the native encode and audio mux crate: raw frames from any FrameSource plus an audio plan in, a BT.709 limited-range H.264 and AAC mp4 out, through an ffmpeg subprocess.
// Inputs and outputs: a FrameSource, an optional AudioPlan and an output path -> an mp4 and an EncodeReport (see encode::encode).
// Used by: the aideos-encode binary (src/main.rs), tests/encode.rs, and the native renderer (R2's evaluator implements FrameSource).

pub mod audio;
pub mod encode;
pub mod frames;
pub mod probe;
pub mod profile;
pub mod tools;

pub use audio::{AudioClip, AudioPlan, MixSettings, Role};
pub use encode::{encode, resolve_backend, EncodeError, EncodeOptions, EncodeReport, Progress};
pub use frames::{Fps, FrameSource, FrameSpec, PixelFormat, PngSequenceSource, RawStreamSource, SourceError, SyntheticSource};
pub use profile::{Backend, BackendChoice, Profile};
pub use tools::Tools;
