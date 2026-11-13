// File Description: Reads container and stream facts from a media file by running ffprobe, so the encoder can verify what it produced and the audio mixer can learn a source's channel layout.
// Inputs and outputs: a media file path -> MediaFacts (per-stream codec, pixel format, range, colour tags, size, rate, channels, duration).
// Used by: src/encode.rs (hardware backend conformance check), src/audio.rs (source channels), src/main.rs (`probe`), tests/encode.rs.

use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::process::Command;

/// One stream of a media file as ffprobe reports it; absent fields are None.
#[derive(Clone, Debug, Default, Serialize)]
pub struct StreamFacts {
    pub codec_type: String,
    pub codec_name: String,
    pub profile: Option<String>,
    pub pix_fmt: Option<String>,
    pub color_range: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub r_frame_rate: Option<String>,
    pub nb_frames: Option<u64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub bit_rate: Option<u64>,
    pub duration_sec: Option<f64>,
}

/// The container and its streams.
#[derive(Clone, Debug, Default, Serialize)]
pub struct MediaFacts {
    pub format_name: String,
    pub duration_sec: Option<f64>,
    pub streams: Vec<StreamFacts>,
}

impl MediaFacts {
    /// The first video stream, if any.
    pub fn video(&self) -> Option<&StreamFacts> {
        self.streams.iter().find(|s| s.codec_type == "video")
    }

    /// The first audio stream, if any.
    pub fn audio(&self) -> Option<&StreamFacts> {
        self.streams.iter().find(|s| s.codec_type == "audio")
    }
}

/// Reads a string field.
fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

/// Reads a number that ffprobe may print as a JSON number or a quoted string.
fn number(v: &Value, key: &str) -> Option<f64> {
    match v.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// Runs `ffprobe` (the given binary) on `path` and parses its JSON.
pub fn probe(ffprobe: &Path, path: &Path) -> Result<MediaFacts, String> {
    let output = Command::new(ffprobe)
        .args(["-v", "error", "-show_streams", "-show_format", "-of", "json"])
        .arg(path)
        .output()
        .map_err(|e| format!("cannot run {}: {e}", ffprobe.display()))?;
    if !output.status.success() {
        return Err(format!("ffprobe failed on {}: {}", path.display(), String::from_utf8_lossy(&output.stderr).trim()));
    }
    let doc: Value = serde_json::from_slice(&output.stdout).map_err(|e| format!("ffprobe printed invalid JSON: {e}"))?;
    let streams = doc["streams"]
        .as_array()
        .map(|list| {
            list.iter()
                .map(|s| StreamFacts {
                    codec_type: text(s, "codec_type").unwrap_or_default(),
                    codec_name: text(s, "codec_name").unwrap_or_default(),
                    profile: text(s, "profile"),
                    pix_fmt: text(s, "pix_fmt"),
                    color_range: text(s, "color_range"),
                    color_space: text(s, "color_space"),
                    color_transfer: text(s, "color_transfer"),
                    color_primaries: text(s, "color_primaries"),
                    width: number(s, "width").map(|n| n as u32),
                    height: number(s, "height").map(|n| n as u32),
                    r_frame_rate: text(s, "r_frame_rate"),
                    nb_frames: number(s, "nb_frames").map(|n| n as u64),
                    sample_rate: number(s, "sample_rate").map(|n| n as u32),
                    channels: number(s, "channels").map(|n| n as u32),
                    bit_rate: number(s, "bit_rate").map(|n| n as u64),
                    duration_sec: number(s, "duration"),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(MediaFacts {
        format_name: text(&doc["format"], "format_name").unwrap_or_default(),
        duration_sec: number(&doc["format"], "duration"),
        streams,
    })
}
