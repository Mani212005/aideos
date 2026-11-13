//! File Description: Behavioural tests of whole-film rendering (`aideos-render video` and `render_video`): the mp4 has exactly the requested frames at the format's size with the delivery tags, a decoded frame matches the CPU reference still, a frame range starts at its first frame, the IR's audio clip is mixed in for the clip's span, a broken audio clip is refused before encoding, and the RGBA to I420 conversion lands on limited-range BT.709 values.
//! Inputs and outputs: the fixture package copied to scratch directories, ffmpeg and ffprobe on PATH -> asserted mp4 facts, pixels and errors.
//! Used by: `cargo test --manifest-path native/Cargo.toml`.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use aideos_encode::{BackendChoice, Backend, Profile};
use aideos_render::video::{render_video, rgba_to_i420, VideoOptions};
use aideos_render::Format;
use aideos_render_ir::types::{Asset, AudioAsset, AudioClip, Keyframe, Whole, Ease};

/// Options for a deterministic software encode of some frames.
fn options(format: Format, frames: Option<(u32, u32)>) -> VideoOptions {
    VideoOptions {
        format,
        frames,
        profile: Profile::Final,
        backend: BackendChoice::Exactly(Backend::Software),
        threads: 3,
        encoder_threads: Some(2),
        cancel: Arc::new(AtomicBool::new(false)),
        on_progress: None,
    }
}

/// Copies the fixture package into a scratch directory so a test can add files to it.
fn scratch_package(name: &str) -> PathBuf {
    let dir = common::scratch_dir(name);
    for sub in ["fonts", "visuals"] {
        std::fs::create_dir_all(dir.join(sub)).expect("create package dir");
        for entry in std::fs::read_dir(common::package_dir().join(sub)).expect("read fixture dir") {
            let entry = entry.expect("fixture entry");
            std::fs::copy(entry.path(), dir.join(sub).join(entry.file_name())).expect("copy fixture file");
        }
    }
    dir
}

/// Writes a mono 16-bit 48 kHz WAV of a sine tone.
fn write_tone(path: &Path, seconds: f64) {
    let rate = 48_000u32;
    let n = (seconds * f64::from(rate)) as u32;
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + n * 2).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(n * 2).to_le_bytes());
    for i in 0..n {
        let v = (0.5 * (2.0 * std::f64::consts::PI * 440.0 * f64::from(i) / f64::from(rate)).sin() * 32767.0) as i16;
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    std::fs::write(path, bytes).expect("write tone");
}

/// Writes the fixture IR into `dir`, optionally adding a narration clip, and returns its path.
fn write_ir(dir: &Path, audio: Option<AudioClip>) -> PathBuf {
    let mut ir = common::tiny_scene();
    ir.audio.clear();
    ir.assets.retain(|a| !matches!(a, Asset::Audio(_)));
    if let Some(clip) = audio {
        ir.assets.push(Asset::Audio(AudioAsset {
            id: clip.asset.clone(),
            path: "audio/tone.wav".into(),
            sha256: None,
        }));
        ir.audio.push(clip);
    }
    let path = dir.join("film.json");
    std::fs::write(&path, serde_json::to_string(&ir).expect("serialize IR")).expect("write IR");
    path
}

/// Reads one ffprobe entry list as `key=value` lines.
fn probe(file: &Path, args: &[&str]) -> String {
    let out = Command::new("ffprobe")
        .args(["-v", "error"])
        .args(args)
        .args(["-of", "default=noprint_wrappers=1"])
        .arg(file)
        .output()
        .expect("run ffprobe");
    assert!(out.status.success(), "ffprobe failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// The PSNR in dB between frame `n` of an mp4 and a PNG, compared in RGB.
fn psnr(mp4: &Path, n: u32, png: &Path) -> f64 {
    let out = Command::new("ffmpeg")
        .args(["-v", "info", "-i"])
        .arg(mp4)
        .arg("-i")
        .arg(png)
        .args([
            "-lavfi",
            &format!("[0:v]select=eq(n\\,{n}),format=rgb24[a];[1:v]format=rgb24[b];[a][b]psnr"),
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
        ])
        .output()
        .expect("run ffmpeg");
    let text = String::from_utf8_lossy(&out.stderr);
    let at = text.rfind("average:").expect("ffmpeg printed a PSNR");
    text[at + 8..].split_whitespace().next().unwrap().parse().expect("a PSNR number")
}

/// A whole-format render has every frame, the reel's size and the delivery colour tags, and its pixels are the reference still's.
#[test]
fn a_rendered_reel_has_every_frame_and_matches_the_reference_still() {
    let dir = scratch_package("video-reel");
    let ir = write_ir(&dir, None);
    let out = dir.join("reel.mp4");
    let report = render_video(&ir, None, &out, options(Format::Reel, None)).expect("render the reel");
    assert_eq!((report.frames, report.width, report.height), (90, 1080, 1920));
    assert_eq!(report.encoder, "libx264");
    let facts = probe(&out, &["-select_streams", "v:0", "-count_frames", "-show_entries", "stream=codec_name,width,height,pix_fmt,color_range,color_space,color_primaries,color_transfer,nb_read_frames"]);
    for expected in ["codec_name=h264", "width=1080", "height=1920", "pix_fmt=yuv420p", "color_range=tv", "color_space=bt709", "color_primaries=bt709", "color_transfer=bt709", "nb_read_frames=90"] {
        assert!(facts.contains(expected), "{expected} missing from {facts}");
    }
    let still = dir.join("still-45.png");
    let status = Command::new(env!("CARGO_BIN_EXE_aideos-render"))
        .arg(&ir)
        .args(["--frame", "45", "--format", "reel", "--out"])
        .arg(&still)
        .status()
        .expect("render the still");
    assert!(status.success());
    let db = psnr(&out, 45, &still);
    assert!(db > 38.0, "frame 45 of the video is {db} dB from the reference still");
}

/// A frame range renders only those frames, starting at the range's first frame.
#[test]
fn a_frame_range_starts_at_its_first_frame() {
    let dir = scratch_package("video-range");
    let ir = write_ir(&dir, None);
    let out = dir.join("range.mp4");
    let report = render_video(&ir, None, &out, options(Format::Long, Some((60, 74)))).expect("render the range");
    assert_eq!((report.first_frame, report.last_frame, report.frames), (60, 74, 15));
    let facts = probe(&out, &["-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames,width,height"]);
    assert!(facts.contains("nb_read_frames=15") && facts.contains("width=1920"), "{facts}");
    let still = dir.join("still-60.png");
    let status = Command::new(env!("CARGO_BIN_EXE_aideos-render"))
        .arg(&ir)
        .args(["--frame", "60", "--format", "long", "--out"])
        .arg(&still)
        .status()
        .expect("render the still");
    assert!(status.success());
    let db = psnr(&out, 0, &still);
    assert!(db > 38.0, "the range's first frame is {db} dB from frame 60");
}

/// The IR's audio clip is mixed in: the file has an AAC stereo track as long as the picture.
#[test]
fn the_ir_audio_clip_is_mixed_into_the_video() {
    let dir = scratch_package("video-audio");
    std::fs::create_dir_all(dir.join("audio")).expect("audio dir");
    write_tone(&dir.join("audio/tone.wav"), 2.0);
    let key = |frame: u32, value: f64, ease: Option<Ease>| Keyframe { frame: Whole(frame), value, ease };
    let ir = write_ir(
        &dir,
        Some(AudioClip {
            id: "voice".into(),
            asset: "tone".into(),
            start_frame: Whole(15),
            duration_frames: Whole(60),
            source_start_ms: 0.0,
            gain: 1.0,
            gain_envelope: vec![key(15, 0.0, Some(Ease::Linear)), key(21, 1.0, None)],
        }),
    );
    let out = dir.join("with-audio.mp4");
    let report = render_video(&ir, None, &out, options(Format::Long, None)).expect("render with audio");
    assert_eq!(report.audio_clips, 1);
    let facts = probe(&out, &["-select_streams", "a:0", "-show_entries", "stream=codec_name,channels,sample_rate,duration"]);
    assert!(facts.contains("codec_name=aac") && facts.contains("channels=2") && facts.contains("sample_rate=48000"), "{facts}");
    let duration: f64 = facts.lines().find_map(|l| l.strip_prefix("duration=")).expect("a duration").parse().expect("a number");
    assert!((duration - 3.0).abs() < 0.05, "the audio track lasts {duration} s, the picture 3 s");
    // Silence before the clip starts at 0.5 s, the tone inside it.
    let level = |start: f64| -> f64 {
        let out = Command::new("ffmpeg")
            .args(["-v", "info", "-ss", &start.to_string(), "-t", "0.3", "-i"])
            .arg(&out)
            .args(["-af", "volumedetect", "-vn", "-f", "null", "-"])
            .output()
            .expect("run ffmpeg");
        let text = String::from_utf8_lossy(&out.stderr).into_owned();
        let at = text.find("mean_volume:").expect("a mean volume");
        text[at + 12..].split_whitespace().next().unwrap().parse().unwrap()
    };
    assert!(level(0.05) < -60.0, "before the clip the track is silent");
    assert!(level(1.2) > -15.0, "inside the clip the tone plays");
}

/// An audio clip that names a missing file is refused before anything is encoded.
#[test]
fn a_missing_audio_file_is_refused_before_encoding() {
    let dir = scratch_package("video-missing-audio");
    let ir = write_ir(
        &dir,
        Some(AudioClip {
            id: "voice".into(),
            asset: "tone".into(),
            start_frame: Whole(0),
            duration_frames: Whole(30),
            source_start_ms: 0.0,
            gain: 1.0,
            gain_envelope: Vec::new(),
        }),
    );
    let out = dir.join("never.mp4");
    let err = render_video(&ir, None, &out, options(Format::Long, None)).expect_err("a missing audio file is refused");
    assert!(err.contains("audio asset \"tone\""), "{err}");
    assert!(!out.exists(), "no output is left behind");
}

/// The CLI renders a range, prints progress lines and a JSON report, and exits 2 on a usage mistake.
#[test]
fn the_video_command_reports_progress_and_its_result() {
    let dir = scratch_package("video-cli");
    let ir = write_ir(&dir, None);
    let out = dir.join("cli.mp4");
    let run = Command::new(env!("CARGO_BIN_EXE_aideos-render"))
        .arg("video")
        .arg(&ir)
        .args(["--format", "reel", "--frames", "0-39", "--profile", "draft", "--backend", "software", "--threads", "2", "--out"])
        .arg(&out)
        .output()
        .expect("run the CLI");
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let stdout = String::from_utf8_lossy(&run.stdout);
    assert!(stdout.contains("frames 40/40"), "{stdout}");
    let report: serde_json::Value = serde_json::from_str(&stdout[stdout.find('{').expect("a JSON report")..]).expect("the report is JSON");
    assert_eq!(report["frames"], 40);
    assert_eq!(report["encoder"], "libx264");
    assert!(out.exists());
    let usage = Command::new(env!("CARGO_BIN_EXE_aideos-render"))
        .args(["video", "film.json", "--out", "x.mp4"])
        .output()
        .expect("run the CLI");
    assert_eq!(usage.status.code(), Some(2), "a missing --format is a usage error");
}

/// White, black and pure red land on the limited-range BT.709 values.
#[test]
fn rgba_converts_to_limited_range_bt709_i420() {
    let convert = |rgb: [u8; 3]| -> (u8, u8, u8) {
        let px: Vec<u8> = (0..4).flat_map(|_| [rgb[0], rgb[1], rgb[2], 255]).collect();
        let mut out = vec![0u8; 6];
        rgba_to_i420(&px, 2, 2, &mut out);
        assert!(out[..4].iter().all(|&y| y == out[0]), "uniform luma");
        (out[0], out[4], out[5])
    };
    assert_eq!(convert([255, 255, 255]), (235, 128, 128));
    assert_eq!(convert([0, 0, 0]), (16, 128, 128));
    assert_eq!(convert([255, 0, 0]), (63, 102, 240));
}
