// File Description: Locates the ffmpeg and ffprobe binaries the crate drives as subprocesses.
// Inputs and outputs: the AIDEOS_FFMPEG and AIDEOS_FFPROBE environment variables (or the bare names on PATH) -> a `Tools` value.
// Used by: src/encode.rs, src/audio.rs, src/main.rs, tests/encode.rs.

use std::path::PathBuf;

/// The two external programs this crate runs; both are subprocesses, never linked libraries.
#[derive(Clone, Debug)]
pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

impl Tools {
    /// Reads AIDEOS_FFMPEG and AIDEOS_FFPROBE, defaulting to `ffmpeg` and `ffprobe` on PATH.
    pub fn from_env() -> Tools {
        let pick = |var: &str, fallback: &str| std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(fallback));
        Tools { ffmpeg: pick("AIDEOS_FFMPEG", "ffmpeg"), ffprobe: pick("AIDEOS_FFPROBE", "ffprobe") }
    }
}

impl Default for Tools {
    /// Same as `from_env`.
    fn default() -> Tools {
        Tools::from_env()
    }
}
