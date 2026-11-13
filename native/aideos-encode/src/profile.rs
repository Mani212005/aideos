// File Description: The encode policy: draft, review and final profiles, plus software and hardware backends and how each is chosen.
// Inputs and outputs: a profile name and a backend preference -> the settings the encoder passes to ffmpeg.
// Used by: src/encode.rs, src/main.rs, tests/encode.rs, docs/NATIVE_ENCODE.md.

use serde::Serialize;
use std::fmt;

/// A render profile. The three share one quality policy and differ in which encoder is allowed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    /// Quick look while authoring; may use a hardware encoder.
    Draft,
    /// Frames rendered for review (design check, Gemini review); may use a hardware encoder.
    Review,
    /// The deliverable; always x264.
    Final,
}

impl Profile {
    /// Parses the CLI spelling.
    pub fn parse(text: &str) -> Option<Profile> {
        match text {
            "draft" => Some(Profile::Draft),
            "review" => Some(Profile::Review),
            "final" => Some(Profile::Final),
            _ => None,
        }
    }

    /// The policy values, identical for every profile today.
    pub fn policy(self) -> Policy {
        Policy { crf: 16, audio_bitrate: 320_000 }
    }

    /// True when the profile allows a hardware encoder (the plan's decision: x264 for final export, hardware for drafts and review renders).
    pub fn allows_hardware(self) -> bool {
        !matches!(self, Profile::Final)
    }

    /// The x264 preset: medium for the deliverable (the measured SSIM 0.9987), veryfast when a draft or review render falls back to software (measured 0.9985 at twice the speed).
    pub fn x264_preset(self) -> &'static str {
        match self {
            Profile::Final => "medium",
            Profile::Draft | Profile::Review => "veryfast",
        }
    }
}

impl fmt::Display for Profile {
    /// Writes the lowercase profile name.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Profile::Draft => "draft",
            Profile::Review => "review",
            Profile::Final => "final",
        })
    }
}

/// The shared output policy: H.264, yuv420p, limited range, BT.709 tags, AAC.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Policy {
    /// x264 constant rate factor.
    pub crf: u32,
    /// AAC bit rate in bits per second.
    pub audio_bitrate: u32,
}

/// Constant quantizer the VAAPI encoder uses (the value the plan measured: SSIM 0.9977 against 0.9987 for x264).
pub const VAAPI_QP: u32 = 18;

/// An encoder implementation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    /// libx264 on the CPU: the reference, the only one allowed for a final export.
    Software,
    /// h264_vaapi on Linux (Intel and AMD GPUs).
    Vaapi,
    /// h264_videotoolbox on macOS.
    VideoToolbox,
}

impl Backend {
    /// The ffmpeg encoder name.
    pub fn encoder(self) -> &'static str {
        match self {
            Backend::Software => "libx264",
            Backend::Vaapi => "h264_vaapi",
            Backend::VideoToolbox => "h264_videotoolbox",
        }
    }

    /// True for the hardware encoders.
    pub fn is_hardware(self) -> bool {
        !matches!(self, Backend::Software)
    }

    /// The hardware encoder worth trying on this operating system, if any.
    pub fn native_hardware() -> Option<Backend> {
        if cfg!(target_os = "linux") {
            Some(Backend::Vaapi)
        } else if cfg!(target_os = "macos") {
            Some(Backend::VideoToolbox)
        } else {
            None
        }
    }
}

impl fmt::Display for Backend {
    /// Writes the lowercase backend name.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Backend::Software => "software",
            Backend::Vaapi => "vaapi",
            Backend::VideoToolbox => "videotoolbox",
        })
    }
}

/// What the caller asked for: a named backend, or the best one the profile allows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BackendChoice {
    /// Hardware when the profile allows it and the machine passes the conformance probe, else software.
    Auto,
    /// Exactly this backend; failing to run it is an error, never a silent fallback.
    Exactly(Backend),
}

impl BackendChoice {
    /// Parses the CLI spelling.
    pub fn parse(text: &str) -> Option<BackendChoice> {
        match text {
            "auto" => Some(BackendChoice::Auto),
            "software" => Some(BackendChoice::Exactly(Backend::Software)),
            "vaapi" => Some(BackendChoice::Exactly(Backend::Vaapi)),
            "videotoolbox" => Some(BackendChoice::Exactly(Backend::VideoToolbox)),
            _ => None,
        }
    }
}
