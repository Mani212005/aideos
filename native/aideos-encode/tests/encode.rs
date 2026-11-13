// File Description: Behavioural tests of the native encode and audio mux crate: they run the public library API and the aideos-encode binary on short synthetic frames and audio, then probe and decode the mp4 with ffprobe and ffmpeg to check codec, pixel format, range, colour tags, frame count, duration, audio stream, pixel values, ducking levels, backend policy, cancellation and cleanup.
// Inputs and outputs: synthetic frames, PNG directories and generated WAV files in a temporary directory -> pass or fail.
// Used by: cargo test --locked --manifest-path native/Cargo.toml, scripts/ci.ts (the "native" step), the CI unit job.

use aideos_encode::audio::{measure_speech, mix_plan, speech_gain, AudioClip, AudioError, AudioPlan, EnvelopePoint, MixSettings, Role, SpeechInterval, SAMPLE_RATE};
use aideos_encode::encode::{probe_backend, resolve_backend};
use aideos_encode::frames::{Pattern, SourceError};
use aideos_encode::probe::{probe, MediaFacts};
use aideos_encode::{encode, Backend, BackendChoice, EncodeError, EncodeOptions, Fps, FrameSource, FrameSpec, PixelFormat, PngSequenceSource, Profile, RawStreamSource, SyntheticSource, Tools};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

static NEXT_DIR: AtomicU32 = AtomicU32::new(0);

/// A temporary directory that deletes itself.
struct TempDir(PathBuf);

impl TempDir {
    /// Creates a fresh directory under the system temp dir.
    fn new(label: &str) -> TempDir {
        let n = NEXT_DIR.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("aideos-encode-test-{label}-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    /// A path inside the directory.
    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    /// Names of the entries left in the directory, sorted.
    fn listing(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }
}

impl Drop for TempDir {
    /// Removes the directory and everything in it.
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// The ffmpeg tools of this machine.
fn tools() -> Tools {
    Tools::from_env()
}

/// A spec for synthetic frames at 30 fps.
fn spec(width: u32, height: u32, frames: u64, pixel_format: PixelFormat) -> FrameSpec {
    FrameSpec { width, height, fps: Fps { num: 30, den: 1 }, pixel_format, frame_count: frames }
}

/// Encodes synthetic frames with the given profile and options tweak, returning the report.
fn encode_synthetic(out: &Path, spec: FrameSpec, pattern: Pattern, opts: &mut EncodeOptions, audio: Option<&AudioPlan>) -> Result<aideos_encode::EncodeReport, EncodeError> {
    let mut source = SyntheticSource::new(spec, pattern).unwrap();
    encode(&mut source, audio, out, opts)
}

/// Probes a file, panicking with the reason when ffprobe cannot read it.
fn facts(path: &Path) -> MediaFacts {
    probe(&tools().ffprobe, path).unwrap()
}

/// Asserts the delivery format every profile promises: H.264 High, yuv420p, limited range, BT.709 on all four tags.
fn assert_delivery_format(facts: &MediaFacts, width: u32, height: u32, frames: u64) {
    let v = facts.video().expect("a video stream");
    assert_eq!(v.codec_name, "h264");
    assert_eq!(v.pix_fmt.as_deref(), Some("yuv420p"));
    assert_eq!(v.color_range.as_deref(), Some("tv"), "limited range");
    assert_eq!(v.color_space.as_deref(), Some("bt709"));
    assert_eq!(v.color_primaries.as_deref(), Some("bt709"));
    assert_eq!(v.color_transfer.as_deref(), Some("bt709"));
    assert_eq!((v.width, v.height), (Some(width), Some(height)));
    assert_eq!(v.nb_frames, Some(frames));
}

/// Decodes every frame of the mp4 to raw I420 bytes.
fn decode_i420(path: &Path, width: usize, height: usize) -> Vec<Vec<u8>> {
    let out = Command::new(&tools().ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-an", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"])
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    out.stdout.chunks_exact(width * height * 3 / 2).map(|c| c.to_vec()).collect()
}

/// The centre pixel's Y, U and V of a decoded I420 frame.
fn centre_yuv(frame: &[u8], width: usize, height: usize) -> [u8; 3] {
    let chroma = (height / 4) * (width / 2) + width / 4;
    [frame[(height / 2) * width + width / 2], frame[width * height + chroma], frame[width * height + (width / 2) * (height / 2) + chroma]]
}

/// Writes mono 16-bit PCM samples as a WAV file.
fn write_pcm16(path: &Path, rate: u32, samples: &[f32]) {
    let data: Vec<u8> = samples.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes()).collect();
    let mut f = fs::File::create(path).unwrap();
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + data.len() as u32).to_le_bytes()).unwrap();
    f.write_all(b"WAVEfmt ").unwrap();
    for part in [16u32.to_le_bytes().to_vec(), 1u16.to_le_bytes().to_vec(), 1u16.to_le_bytes().to_vec(), rate.to_le_bytes().to_vec(), (rate * 2).to_le_bytes().to_vec(), 2u16.to_le_bytes().to_vec(), 16u16.to_le_bytes().to_vec()] {
        f.write_all(&part).unwrap();
    }
    f.write_all(b"data").unwrap();
    f.write_all(&(data.len() as u32).to_le_bytes()).unwrap();
    f.write_all(&data).unwrap();
}

/// A sine at `hz` and amplitude `amp` for `secs`, silent outside the given `[from, to)` bursts (the whole clip when none are given).
fn tone(hz: f64, amp: f32, secs: f64, bursts: &[(f64, f64)]) -> Vec<f32> {
    (0..(secs * SAMPLE_RATE as f64) as usize)
        .map(|i| {
            let t = i as f64 / SAMPLE_RATE as f64;
            let on = bursts.is_empty() || bursts.iter().any(|(a, b)| t >= *a && t < *b);
            if on { amp * (2.0 * std::f64::consts::PI * hz * t).sin() as f32 } else { 0.0 }
        })
        .collect()
}

/// Deterministic white noise, which makes an AAC encoder spend its whole bit budget.
fn noise(amp: f32, secs: f64) -> Vec<f32> {
    let mut state = 12345u32;
    (0..(secs * SAMPLE_RATE as f64) as usize)
        .map(|_| {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            amp * ((state >> 8) as f32 / (1u32 << 23) as f32 - 1.0)
        })
        .collect()
}

/// RMS level in dBFS of the left channel between two film times.
fn level_db(stereo: &[f32], from: f64, to: f64) -> f64 {
    let (a, b) = ((from * SAMPLE_RATE as f64) as usize, (to * SAMPLE_RATE as f64) as usize);
    let power = (a..b).map(|i| (stereo[i * 2] as f64).powi(2)).sum::<f64>() / (b - a) as f64;
    10.0 * power.log10()
}

/// A plan with one clip.
fn one_clip(clip: AudioClip) -> AudioPlan {
    AudioPlan { clips: vec![clip], ..AudioPlan::default() }
}

/// A frame source that fails after a few frames.
struct FailingSource {
    spec: FrameSpec,
    delivered: u64,
    fail_at: u64,
}

impl FrameSource for FailingSource {
    /// The stream description.
    fn spec(&self) -> FrameSpec {
        self.spec
    }

    /// Delivers grey frames, then an error.
    fn next_frame(&mut self, frame: &mut [u8]) -> Result<bool, SourceError> {
        if self.delivered == self.fail_at {
            return Err(SourceError::Frame { file: "frame-3".to_string(), message: "evaluator exploded".to_string() });
        }
        frame.fill(90);
        self.delivered += 1;
        Ok(true)
    }
}

/// A frame source that raises a cancel flag after a few frames.
struct CancellingSource {
    spec: FrameSpec,
    delivered: u64,
    flag: Arc<AtomicBool>,
}

impl FrameSource for CancellingSource {
    /// The stream description.
    fn spec(&self) -> FrameSpec {
        self.spec
    }

    /// Delivers grey frames and raises the flag at frame 3.
    fn next_frame(&mut self, frame: &mut [u8]) -> Result<bool, SourceError> {
        frame.fill(90);
        self.delivered += 1;
        if self.delivered == 3 {
            self.flag.store(true, Ordering::SeqCst);
        }
        Ok(true)
    }
}

// ---------------------------------------------------------------------------------------------
// Delivery format: both aspect ratios, every pixel layout, exact colour handling
// ---------------------------------------------------------------------------------------------

/// A 16:9 final export is H.264 yuv420p, limited range, BT.709, with the frame count and size it was fed and x264's CRF 16.
#[test]
fn final_long_cut_is_x264_crf16_bt709_limited() {
    let dir = TempDir::new("long");
    let out = dir.join("long.mp4");
    let report = encode_synthetic(&out, spec(1920, 1080, 6, PixelFormat::Rgba8), Pattern::Moving, &mut EncodeOptions::new(Profile::Final), None).unwrap();
    assert_eq!(report.backend, Backend::Software);
    assert!(report.fallback_reason.is_none());
    let f = facts(&out);
    assert_delivery_format(&f, 1920, 1080, 6);
    assert_eq!(f.video().unwrap().profile.as_deref(), Some("High"));
    assert!(f.audio().is_none(), "no audio plan, no audio stream");
    let bytes = fs::read(&out).unwrap();
    assert!(bytes.windows(8).any(|w| w == b"crf=16.0"), "x264 records its settings in the stream: CRF 16 expected");
    assert_eq!(dir.listing(), vec!["long.mp4"], "no partial or scratch files left");
}

/// A 9:16 final export in planar I420 input has the same delivery format.
#[test]
fn final_reel_from_i420_frames_is_bt709_limited() {
    let dir = TempDir::new("reel");
    let out = dir.join("reel.mp4");
    encode_synthetic(&out, spec(1080, 1920, 4, PixelFormat::I420), Pattern::Moving, &mut EncodeOptions::new(Profile::Final), None).unwrap();
    assert_delivery_format(&facts(&out), 1080, 1920, 4);
}

/// Black, white and red come out of the file as limited-range BT.709 Y, U, V whichever raw layout was fed (BT.601 would put red's luma near 81, full range white at 255).
#[test]
fn colours_decode_to_limited_range_bt709_values_for_both_pixel_layouts() {
    let cases: [([u8; 3], [i32; 3]); 4] = [([0, 0, 0], [16, 128, 128]), ([255, 255, 255], [235, 128, 128]), ([255, 0, 0], [63, 102, 240]), ([0, 0, 255], [32, 240, 118])];
    for format in [PixelFormat::Rgba8, PixelFormat::I420] {
        for (rgb, want) in cases {
            let dir = TempDir::new("colour");
            let out = dir.join("c.mp4");
            encode_synthetic(&out, spec(128, 72, 3, format), Pattern::Solid(rgb), &mut EncodeOptions::new(Profile::Final), None).unwrap();
            let frames = decode_i420(&out, 128, 72);
            let got = centre_yuv(&frames[1], 128, 72);
            for (g, w) in got.iter().zip(want) {
                assert!((*g as i32 - w).abs() <= 2, "{format:?} rgb {rgb:?}: got {got:?}, want {want:?}");
            }
        }
    }
}

/// An exact fractional frame rate reaches the container unrounded.
#[test]
fn fractional_frame_rate_is_kept_exactly() {
    let dir = TempDir::new("fps");
    let out = dir.join("f.mp4");
    let mut s = spec(128, 72, 30, PixelFormat::Rgba8);
    s.fps = Fps::parse("30000/1001").unwrap();
    encode_synthetic(&out, s, Pattern::Moving, &mut EncodeOptions::new(Profile::Final), None).unwrap();
    let f = facts(&out);
    assert_eq!(f.video().unwrap().r_frame_rate.as_deref(), Some("30000/1001"));
    assert_eq!(f.video().unwrap().nb_frames, Some(30));
}

/// With the thread count pinned, the same frames and audio produce byte-identical files, and the pinned count is what makes that machine independent.
#[test]
fn pinned_threads_give_byte_identical_output() {
    let dir = TempDir::new("det");
    let voice = dir.join("v.wav");
    write_pcm16(&voice, SAMPLE_RATE, &tone(440.0, 0.4, 2.0, &[]));
    let plan = one_clip(AudioClip::new(&voice, Role::Voice));
    let mut hashes = Vec::new();
    for n in 0..2 {
        let out = dir.join(&format!("o{n}.mp4"));
        let mut opts = EncodeOptions::new(Profile::Final);
        opts.threads = Some(2);
        encode_synthetic(&out, spec(320, 180, 60, PixelFormat::Rgba8), Pattern::Moving, &mut opts, Some(&plan)).unwrap();
        hashes.push(fs::read(&out).unwrap());
    }
    assert!(hashes[0] == hashes[1], "two encodes of the same input differ");
}

// ---------------------------------------------------------------------------------------------
// Profiles and backends
// ---------------------------------------------------------------------------------------------

/// A draft with automatic backend choice uses the hardware encoder exactly when the machine passes the conformance probe, and conforms either way.
#[test]
fn draft_uses_hardware_exactly_when_the_machine_passes_the_probe() {
    let dir = TempDir::new("draft");
    let out = dir.join("d.mp4");
    let hardware = Backend::native_hardware().map(|b| (b, probe_backend(&tools(), b)));
    let report = encode_synthetic(&out, spec(320, 180, 12, PixelFormat::Rgba8), Pattern::Moving, &mut EncodeOptions::new(Profile::Draft), None).unwrap();
    match hardware {
        Some((backend, Ok(()))) => {
            assert_eq!(report.backend, backend);
            assert!(report.fallback_reason.is_none());
        }
        Some((_, Err(why))) => {
            assert_eq!(report.backend, Backend::Software);
            assert!(report.fallback_reason.unwrap().contains(&why), "the fallback reason carries the probe's reason");
        }
        None => assert_eq!(report.backend, Backend::Software),
    }
    assert_delivery_format(&facts(&out), 320, 180, 12);
}

/// The software fallback for a review render is also a conforming file.
#[test]
fn review_profile_in_software_conforms() {
    let dir = TempDir::new("review");
    let out = dir.join("r.mp4");
    let mut opts = EncodeOptions::new(Profile::Review);
    opts.backend = BackendChoice::Exactly(Backend::Software);
    let report = encode_synthetic(&out, spec(180, 320, 12, PixelFormat::I420), Pattern::Moving, &mut opts, None).unwrap();
    assert_eq!(report.backend, Backend::Software);
    assert_delivery_format(&facts(&out), 180, 320, 12);
}

/// A final export never uses a hardware encoder, even when asked: the request is refused before any file is made.
#[test]
fn final_export_refuses_a_hardware_encoder() {
    let dir = TempDir::new("policy");
    let mut opts = EncodeOptions::new(Profile::Final);
    opts.backend = BackendChoice::Exactly(Backend::Vaapi);
    let err = encode_synthetic(&dir.join("f.mp4"), spec(128, 72, 3, PixelFormat::Rgba8), Pattern::Moving, &mut opts, None).unwrap_err();
    assert!(matches!(err, EncodeError::Policy(_)), "{err}");
    assert!(dir.listing().is_empty());
    let (backend, _) = resolve_backend(&tools(), Profile::Final, BackendChoice::Auto).unwrap();
    assert_eq!(backend, Backend::Software, "auto picks x264 for final");
}

/// Asking for a hardware encoder this operating system does not have is an error with a reason, never a quiet switch to software.
#[test]
fn an_unavailable_hardware_encoder_is_an_error_not_a_fallback() {
    let dir = TempDir::new("nohw");
    let foreign = if cfg!(target_os = "macos") { Backend::Vaapi } else { Backend::VideoToolbox };
    let mut opts = EncodeOptions::new(Profile::Draft);
    opts.backend = BackendChoice::Exactly(foreign);
    let err = encode_synthetic(&dir.join("x.mp4"), spec(128, 72, 3, PixelFormat::Rgba8), Pattern::Moving, &mut opts, None).unwrap_err();
    assert!(matches!(err, EncodeError::BackendUnavailable { backend, .. } if backend == foreign), "{err}");
    assert!(dir.listing().is_empty());
}

/// A missing ffmpeg is reported as such, naming the binary.
#[test]
fn missing_ffmpeg_is_a_clear_error() {
    let dir = TempDir::new("noffmpeg");
    let mut opts = EncodeOptions::new(Profile::Final);
    opts.tools = Tools { ffmpeg: dir.join("no-such-ffmpeg"), ffprobe: tools().ffprobe };
    let err = encode_synthetic(&dir.join("x.mp4"), spec(128, 72, 3, PixelFormat::Rgba8), Pattern::Moving, &mut opts, None).unwrap_err();
    assert!(matches!(&err, EncodeError::Tool(m) if m.contains("no-such-ffmpeg")), "{err}");
}

// ---------------------------------------------------------------------------------------------
// Audio mux
// ---------------------------------------------------------------------------------------------

/// The muxed track is AAC LC, stereo, 48 kHz, at the 320 kbps the profile table asks for, and as long as the picture.
#[test]
fn audio_is_muxed_as_aac_320k_stereo_48k_matching_the_video_duration() {
    let dir = TempDir::new("mux");
    let voice = dir.join("v.wav");
    write_pcm16(&voice, 44_100, &noise(0.3, 2.0));
    let out = dir.join("m.mp4");
    let report = encode_synthetic(&out, spec(320, 180, 60, PixelFormat::Rgba8), Pattern::Moving, &mut EncodeOptions::new(Profile::Final), Some(&one_clip(AudioClip::new(&voice, Role::Voice)))).unwrap();
    assert!(report.audio.is_some());
    let f = facts(&out);
    let a = f.audio().expect("an audio stream");
    assert_eq!(a.codec_name, "aac");
    assert_eq!(a.profile.as_deref(), Some("LC"));
    assert_eq!((a.sample_rate, a.channels), (Some(48_000), Some(2)));
    let kbps = a.bit_rate.unwrap() as f64 / 1000.0;
    // ffmpeg's native AAC encoder treats the rate as a ceiling: full-band noise lands near 260 kbps, far above the 128 kbps it uses when no rate is set.
    assert!((200.0..=340.0).contains(&kbps), "AAC rate {kbps} kbps shows the 320k setting was not applied");
    let video = f.video().unwrap().duration_sec.unwrap();
    assert!((a.duration_sec.unwrap() - video).abs() < 0.06, "audio {:?} against video {video}", a.duration_sec);
    assert_delivery_format(&f, 320, 180, 60);
}

/// A clip longer than the picture is cut to the film's length, and a shorter one leaves silence after it: the audio track always matches the video.
#[test]
fn audio_is_cut_or_padded_to_the_film_length() {
    let dir = TempDir::new("len");
    let long = dir.join("long.wav");
    write_pcm16(&long, SAMPLE_RATE, &tone(300.0, 0.3, 4.0, &[]));
    let out = dir.join("o.mp4");
    encode_synthetic(&out, spec(128, 72, 30, PixelFormat::Rgba8), Pattern::Moving, &mut EncodeOptions::new(Profile::Final), Some(&one_clip(AudioClip::new(&long, Role::Voice)))).unwrap();
    let f = facts(&out);
    assert!((f.audio().unwrap().duration_sec.unwrap() - 1.0).abs() < 0.06);
    let short = dir.join("short.wav");
    write_pcm16(&short, SAMPLE_RATE, &tone(300.0, 0.3, 0.5, &[]));
    let out2 = dir.join("o2.mp4");
    encode_synthetic(&out2, spec(128, 72, 60, PixelFormat::Rgba8), Pattern::Moving, &mut EncodeOptions::new(Profile::Final), Some(&one_clip(AudioClip::new(&short, Role::Voice)))).unwrap();
    assert!((facts(&out2).audio().unwrap().duration_sec.unwrap() - 2.0).abs() < 0.06);
}

/// The mixer puts a clip on the sample it asks for, applies static gain, keyframed gain and equal-power fades, and truncates at the film's end.
#[test]
fn mixer_places_clips_sample_exactly_with_gain_envelope_and_fades() {
    let dir = TempDir::new("mixer");
    let src = dir.join("tone.wav");
    write_pcm16(&src, SAMPLE_RATE, &tone(1000.0, 0.8, 3.0, &[]));
    let mut clip = AudioClip::new(&src, Role::Effect);
    clip.start_sec = 1.0;
    clip.gain = 0.5;
    clip.fade_in_sec = 0.5;
    clip.gain_envelope = vec![EnvelopePoint { time_sec: 2.0, gain: 1.0 }, EnvelopePoint { time_sec: 3.0, gain: 0.0 }];
    let mixed = mix_plan(&tools(), &one_clip(clip), 3.5, dir.0.as_path()).unwrap();
    assert_eq!(mixed.samples.len(), (3.5 * SAMPLE_RATE as f64) as usize * 2, "exactly the film's length");
    let first = mixed.samples.iter().position(|s| s.abs() > 1e-6).unwrap();
    assert!(first / 2 >= SAMPLE_RATE as usize && first / 2 < SAMPLE_RATE as usize + 60, "first sound at sample {}", first / 2);
    let rms_of_unit = 0.8 / 2f64.sqrt();
    let expect = |gain: f64| 20.0 * (rms_of_unit * 0.5 * gain).log10();
    let near = |got: f64, want: f64, what: &str| assert!((got - want).abs() < 0.35, "{what}: {got:.2} dB against {want:.2} dB");
    near(level_db(&mixed.samples, 1.245, 1.255), expect(2f64.sqrt() / 2.0), "equal-power fade at its midpoint");
    near(level_db(&mixed.samples, 1.7, 1.8), expect(1.0), "after the fade, envelope held at 1 before its first keyframe");
    near(level_db(&mixed.samples, 2.495, 2.505), expect(0.5), "envelope halfway down");
    assert!(level_db(&mixed.samples, 3.2, 3.5) < -120.0, "the envelope is 0 from 3.0 s, so the clip is silent although its source runs to 4.0 s");
}

/// Music under measured narration sits at the committed ducking levels: -18 dB while it speaks, -10 dB in a pause, -8 dB before the first and after the last phrase.
#[test]
fn music_ducks_to_the_documented_levels_under_measured_narration() {
    let dir = TempDir::new("duck");
    let voice = dir.join("voice.wav");
    let music = dir.join("music.wav");
    write_pcm16(&voice, SAMPLE_RATE, &tone(440.0, 0.5, 5.0, &[(1.0, 1.5), (3.0, 3.5)]));
    write_pcm16(&music, SAMPLE_RATE, &tone(220.0, 0.5, 5.0, &[]));
    let mut voice_clip = AudioClip::new(&voice, Role::Voice);
    voice_clip.gain = 0.0; // silent, but still measured: the music alone is what the test listens to
    let mut music_clip = AudioClip::new(&music, Role::Music);
    music_clip.duck_under_voice = true;
    let plan = AudioPlan { clips: vec![voice_clip, music_clip], ..AudioPlan::default() };
    let mixed = mix_plan(&tools(), &plan, 5.0, dir.0.as_path()).unwrap();
    assert_eq!(mixed.speech.len(), 2, "two phrases 1.5 s apart stay two intervals: {:?}", mixed.speech);
    for (found, want) in mixed.speech.iter().zip([(1.0, 1.5), (3.0, 3.5)]) {
        assert!((found.start_sec - want.0).abs() < 0.03 && (found.end_sec - want.1).abs() < 0.03, "{found:?} against {want:?}");
    }
    let full = 20.0 * (0.5f64 / 2f64.sqrt()).log10();
    let near = |from: f64, to: f64, down: f64, what: &str| {
        let got = level_db(&mixed.samples, from, to);
        assert!((got - (full + down)).abs() < 0.3, "{what}: {got:.2} dB, expected {:.2} dB", full + down);
    };
    near(0.1, 0.6, -8.0, "before the first phrase (music only)");
    near(1.1, 1.4, -18.0, "inside a phrase");
    near(2.1, 2.5, -10.0, "in the pause between phrases");
    near(3.1, 3.4, -18.0, "inside the second phrase");
    near(4.3, 4.9, -8.0, "after the last phrase (music only)");
    let mid_release = level_db(&mixed.samples, 1.79, 1.81) - full;
    assert!(mid_release < -10.0 && mid_release > -18.0, "release 0.3 s after speech is mid-ramp, got {mid_release:.2} dB");
}

/// Narration spans measured elsewhere (the TypeScript pipeline caches them) are used as given, merged when closer than 0.6 s, and no voice clip is needed.
#[test]
fn given_speech_intervals_drive_the_ducking_without_a_voice_clip() {
    let dir = TempDir::new("given");
    let music = dir.join("music.wav");
    write_pcm16(&music, SAMPLE_RATE, &tone(220.0, 0.5, 4.0, &[]));
    let mut clip = AudioClip::new(&music, Role::Music);
    clip.duck_under_voice = true;
    let plan = AudioPlan {
        clips: vec![clip],
        speech: Some(vec![SpeechInterval { start_sec: 1.0, end_sec: 1.4 }, SpeechInterval { start_sec: 1.8, end_sec: 2.2 }]),
        mix: MixSettings { duck_db: -20.0, ..MixSettings::default() },
    };
    let mixed = mix_plan(&tools(), &plan, 4.0, dir.0.as_path()).unwrap();
    assert_eq!(mixed.speech.len(), 1, "a 0.4 s gap is closed");
    let full = 20.0 * (0.5f64 / 2f64.sqrt()).log10();
    assert!((level_db(&mixed.samples, 1.5, 1.7) - (full - 20.0)).abs() < 0.3, "the closed gap stays ducked at the configured -20 dB");
}

/// Rejects speech and story-end times that would otherwise distort ducking outside the film timeline.
#[test]
fn audio_plan_rejects_out_of_timeline_ducking_times() {
    let dir = TempDir::new("audio-plan-times");
    let invalid_plans = [
        AudioPlan { speech: Some(vec![SpeechInterval { start_sec: -2.0, end_sec: 0.5 }]), ..AudioPlan::default() },
        AudioPlan { speech: Some(vec![SpeechInterval { start_sec: 1.0, end_sec: 5.1 }]), ..AudioPlan::default() },
        AudioPlan { speech: Some(vec![SpeechInterval { start_sec: 4.0, end_sec: 1.0 }]), ..AudioPlan::default() },
        AudioPlan { speech: Some(vec![SpeechInterval { start_sec: 0.5, end_sec: 0.5 }]), ..AudioPlan::default() },
        AudioPlan { mix: MixSettings { story_end_sec: Some(-1.0), ..MixSettings::default() }, ..AudioPlan::default() },
        AudioPlan { mix: MixSettings { story_end_sec: Some(5.1), ..MixSettings::default() }, ..AudioPlan::default() },
    ];
    for plan in invalid_plans {
        assert!(matches!(mix_plan(&tools(), &plan, 5.0, dir.0.as_path()), Err(AudioError::Plan(_))));
    }
    let valid = AudioPlan {
        speech: Some(vec![SpeechInterval { start_sec: 0.0, end_sec: 5.0 }]),
        mix: MixSettings { story_end_sec: Some(5.0), ..MixSettings::default() },
        ..AudioPlan::default()
    };
    assert!(matches!(mix_plan(&tools(), &valid, 5.0, dir.0.as_path()), Ok(_)));
}

/// The speech detector and gain curve behave as the TypeScript originals document, checked on small known inputs.
#[test]
fn speech_detection_and_gain_curve_follow_the_documented_rules() {
    let mut stereo = vec![0f32; SAMPLE_RATE as usize * 2];
    for s in stereo[SAMPLE_RATE as usize / 2..SAMPLE_RATE as usize].iter_mut() {
        *s = 0.02; // -34 dBFS, above the -40 dB threshold
    }
    for s in stereo[..SAMPLE_RATE as usize / 4].iter_mut() {
        *s = 0.005; // -46 dBFS, below it
    }
    let found = measure_speech(&stereo, 10.0);
    assert_eq!(found.len(), 1);
    assert!((found[0].start_sec - 10.25).abs() < 0.011 && (found[0].end_sec - 10.5).abs() < 0.011, "{found:?}");
    let speech = [SpeechInterval { start_sec: 1.0, end_sec: 2.0 }, SpeechInterval { start_sec: 5.0, end_sec: 6.0 }];
    let mix = MixSettings::default();
    let db = |t: f64| 20.0 * speech_gain(t, &speech, &mix).log10();
    assert!((db(1.5) + 18.0).abs() < 1e-9);
    assert!((db(0.0) + 8.0).abs() < 1e-9, "before the first phrase");
    assert!((db(3.6) + 10.0).abs() < 1e-9, "in a long pause");
    assert!((db(2.3) - (-18.0 + 8.0 * 0.5)).abs() < 1e-9, "release is linear in dB over 0.6 s: halfway at 0.3 s");
    assert!((db(4.875) - (-18.0 + 8.0 * 0.5)).abs() < 1e-9, "attack is linear in dB over 0.25 s: halfway at 0.125 s before");
    assert!((db(7.0) + 8.0).abs() < 1e-9, "after the last phrase");
}

/// Two loud clips that sum past full scale are clamped and the report says so, instead of wrapping or silently distorting.
#[test]
fn clipping_is_clamped_and_reported() {
    let dir = TempDir::new("clip");
    let src = dir.join("loud.wav");
    write_pcm16(&src, SAMPLE_RATE, &tone(500.0, 0.8, 1.0, &[]));
    let plan = AudioPlan { clips: vec![AudioClip::new(&src, Role::Voice), AudioClip::new(&src, Role::Effect)], ..AudioPlan::default() };
    let mixed = mix_plan(&tools(), &plan, 1.0, dir.0.as_path()).unwrap();
    assert!(mixed.peak > 1.5 && mixed.peak < 1.7, "peak {}", mixed.peak);
    assert!(mixed.clipped_samples > 1000);
    assert!(mixed.samples.iter().all(|s| s.abs() <= 1.0));
}

/// A plan with a bad number, a missing file or a file with no audio is refused with a message naming the problem.
#[test]
fn invalid_audio_plans_are_refused_with_the_reason() {
    let dir = TempDir::new("badplan");
    let src = dir.join("ok.wav");
    write_pcm16(&src, SAMPLE_RATE, &tone(500.0, 0.3, 0.5, &[]));
    let text = dir.join("not-audio.txt");
    fs::write(&text, "hello").unwrap();
    let mut loud = AudioClip::new(&src, Role::Voice);
    loud.gain = 5.0;
    let err = mix_plan(&tools(), &one_clip(loud), 1.0, dir.0.as_path()).unwrap_err();
    assert!(matches!(&err, AudioError::Plan(m) if m.contains("gain 5")), "{err}");
    let err = mix_plan(&tools(), &one_clip(AudioClip::new("missing.wav", Role::Voice)), 1.0, dir.0.as_path()).unwrap_err();
    assert!(matches!(&err, AudioError::Source { path, .. } if path.ends_with("missing.wav")), "{err}");
    let err = mix_plan(&tools(), &one_clip(AudioClip::new(&text, Role::Voice)), 1.0, dir.0.as_path()).unwrap_err();
    assert!(matches!(&err, AudioError::Source { path, .. } if path.ends_with("not-audio.txt")), "{err}");
}

// ---------------------------------------------------------------------------------------------
// Frame sources
// ---------------------------------------------------------------------------------------------

/// Writes an RGBA or RGB PNG with one flat colour.
fn write_png(path: &Path, width: u32, height: u32, rgba: [u8; 4], with_alpha: bool) {
    let file = fs::File::create(path).unwrap();
    let mut encoder = png::Encoder::new(file, width, height);
    encoder.set_color(if with_alpha { png::ColorType::Rgba } else { png::ColorType::Rgb });
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    let pixel: Vec<u8> = if with_alpha { rgba.to_vec() } else { rgba[..3].to_vec() };
    writer.write_image_data(&pixel.repeat((width * height) as usize)).unwrap();
}

/// PNG frames are read in natural order (f2 before f10), both RGB and RGBA files work, and the decoded picture follows that order.
#[test]
fn png_sequence_is_encoded_in_natural_file_order() {
    let dir = TempDir::new("png");
    let frames = dir.join("frames");
    fs::create_dir_all(&frames).unwrap();
    for i in 1..=12u32 {
        let grey = (30 + i * 15) as u8;
        write_png(&frames.join(format!("f{i}.png")), 128, 72, [grey, grey, grey, 255], i % 2 == 0);
    }
    let mut source = PngSequenceSource::open(&frames, Fps { num: 30, den: 1 }).unwrap();
    assert_eq!(source.spec().frame_count, 12);
    let out = dir.join("png.mp4");
    encode(&mut source, None, &out, &mut EncodeOptions::new(Profile::Final)).unwrap();
    assert_delivery_format(&facts(&out), 128, 72, 12);
    let luma: Vec<i32> = decode_i420(&out, 128, 72).iter().map(|f| centre_yuv(f, 128, 72)[0] as i32).collect();
    for pair in luma.windows(2) {
        assert!(pair[1] > pair[0], "luma must rise frame by frame, got {luma:?}");
    }
    let want_first = 16.0 + 219.0 * 45.0 / 255.0;
    assert!((luma[0] as f64 - want_first).abs() < 3.0, "first frame luma {} against {want_first}", luma[0]);
}

/// Transparent PNG pixels are composited over black rather than leaking their hidden colour.
#[test]
fn transparent_png_pixels_become_black() {
    let dir = TempDir::new("alpha");
    let frames = dir.join("frames");
    fs::create_dir_all(&frames).unwrap();
    write_png(&frames.join("a.png"), 128, 72, [255, 255, 255, 0], true);
    let mut source = PngSequenceSource::open(&frames, Fps { num: 30, den: 1 }).unwrap();
    let out = dir.join("a.mp4");
    encode(&mut source, None, &out, &mut EncodeOptions::new(Profile::Final)).unwrap();
    let y = centre_yuv(&decode_i420(&out, 128, 72)[0], 128, 72)[0];
    assert!((y as i32 - 16).abs() <= 2, "transparent white should read as black, luma {y}");
}

/// A bad frame directory is refused before any encoding, with a message that names the offending file or reason.
#[test]
fn bad_png_directories_are_refused_naming_the_file() {
    let dir = TempDir::new("badpng");
    let empty = dir.join("empty");
    fs::create_dir_all(&empty).unwrap();
    assert!(matches!(PngSequenceSource::open(&empty, Fps { num: 30, den: 1 }), Err(SourceError::Spec(m)) if m.contains("no .png")));
    let mixed = dir.join("mixed");
    fs::create_dir_all(&mixed).unwrap();
    write_png(&mixed.join("f1.png"), 128, 72, [9, 9, 9, 255], false);
    write_png(&mixed.join("f2.png"), 64, 36, [9, 9, 9, 255], false);
    let err = PngSequenceSource::open(&mixed, Fps { num: 30, den: 1 }).err().unwrap();
    assert!(matches!(&err, SourceError::Frame { file, message } if file == "f2.png" && message.contains("64x36")), "{err}");
    let odd = dir.join("odd");
    fs::create_dir_all(&odd).unwrap();
    write_png(&odd.join("f1.png"), 127, 72, [9, 9, 9, 255], false);
    let err = PngSequenceSource::open(&odd, Fps { num: 30, den: 1 }).err().unwrap();
    assert!(err.to_string().contains("even"), "{err}");
    let corrupt = dir.join("corrupt");
    fs::create_dir_all(&corrupt).unwrap();
    write_png(&corrupt.join("f1.png"), 128, 72, [9, 9, 9, 255], false);
    fs::write(corrupt.join("f2.png"), "not a png").unwrap();
    let err = PngSequenceSource::open(&corrupt, Fps { num: 30, den: 1 }).err().unwrap();
    assert!(err.to_string().contains("f2.png"), "{err}");
}

/// A raw stream that ends early is an error stating how many frames arrived, and no output is left.
#[test]
fn truncated_raw_stream_is_an_error_with_counts() {
    let dir = TempDir::new("raw");
    let s = spec(128, 72, 5, PixelFormat::Rgba8);
    let bytes = vec![80u8; s.frame_bytes() * 2 + 100];
    let mut source = RawStreamSource::new(s, std::io::Cursor::new(bytes)).unwrap();
    let err = encode(&mut source, None, &dir.join("r.mp4"), &mut EncodeOptions::new(Profile::Final)).unwrap_err();
    assert!(matches!(err, EncodeError::Source(SourceError::Ended { expected: 5, got: 2 })), "{err}");
    assert!(dir.listing().is_empty());
}

/// Sizes yuv420p cannot carry are refused up front.
#[test]
fn odd_sizes_and_empty_videos_are_refused() {
    assert!(SyntheticSource::new(spec(127, 72, 3, PixelFormat::Rgba8), Pattern::Moving).is_err());
    assert!(SyntheticSource::new(spec(128, 72, 0, PixelFormat::Rgba8), Pattern::Moving).is_err());
    assert!(Fps::parse("0").is_err() && Fps::parse("30/0").is_err() && Fps::parse("abc").is_err());
}

/// The CLI value parsers accept only the documented names for pixel formats and backends.
#[test]
fn cli_value_parsers_reject_extra_aliases() {
    assert_eq!(PixelFormat::parse("i420"), Some(PixelFormat::I420));
    assert_eq!(PixelFormat::parse("yuv420p"), None);
    assert_eq!(BackendChoice::parse("software"), Some(BackendChoice::Exactly(Backend::Software)));
    assert_eq!(BackendChoice::parse("x264"), None);
}

// ---------------------------------------------------------------------------------------------
// Failure, cancellation, progress
// ---------------------------------------------------------------------------------------------

/// A source failure cleans up owned scratch files without changing pre-existing user files.
#[test]
fn a_failing_source_leaves_nothing_behind() {
    let dir = TempDir::new("fail");
    let voice = dir.join("voice.wav");
    write_pcm16(&voice, SAMPLE_RATE, &tone(300.0, 0.3, 1.0, &[]));
    let old_partial = dir.join("out.mp4.partial");
    let old_audio = dir.join(".out.mp4.audio.wav");
    fs::write(&old_partial, b"existing partial").unwrap();
    fs::write(&old_audio, b"existing audio scratch").unwrap();
    let keep = dir.listing();
    let mut source = FailingSource { spec: spec(128, 72, 30, PixelFormat::Rgba8), delivered: 0, fail_at: 3 };
    let out = dir.join("out.mp4");
    let err = encode(&mut source, Some(&one_clip(AudioClip::new(&voice, Role::Voice))), &out, &mut EncodeOptions::new(Profile::Final)).unwrap_err();
    assert!(matches!(&err, EncodeError::Source(SourceError::Frame { message, .. }) if message == "evaluator exploded"), "{err}");
    assert_eq!(dir.listing(), keep, "pre-existing files remain and owned scratch files are removed");
    assert_eq!(fs::read(old_partial).unwrap(), b"existing partial");
    assert_eq!(fs::read(old_audio).unwrap(), b"existing audio scratch");
}

/// Raising the cancel flag stops a long encode promptly, kills ffmpeg and removes every partial file.
#[test]
fn cancelling_stops_the_encode_and_cleans_up() {
    let dir = TempDir::new("cancel");
    let flag = Arc::new(AtomicBool::new(false));
    let mut source = CancellingSource { spec: spec(1920, 1080, 100_000, PixelFormat::Rgba8), delivered: 0, flag: flag.clone() };
    let mut opts = EncodeOptions::new(Profile::Final);
    opts.cancel = Some(flag);
    let started = std::time::Instant::now();
    let err = encode(&mut source, None, &dir.join("c.mp4"), &mut opts).unwrap_err();
    assert!(matches!(err, EncodeError::Cancelled), "{err}");
    assert!(started.elapsed().as_secs() < 30, "cancel must not run the remaining 100000 frames");
    assert!(source.delivered < 10, "stopped right after the flag was raised, delivered {}", source.delivered);
    assert!(dir.listing().is_empty());
}

/// The progress callback sees every frame once, in order.
#[test]
fn progress_reports_every_frame_in_order() {
    let dir = TempDir::new("progress");
    let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let mut opts = EncodeOptions::new(Profile::Final);
    let sink = seen.clone();
    opts.on_progress = Some(Box::new(move |p| sink.borrow_mut().push((p.frames_done, p.frames_total))));
    encode_synthetic(&dir.join("p.mp4"), spec(128, 72, 9, PixelFormat::Rgba8), Pattern::Moving, &mut opts, None).unwrap();
    assert_eq!(*seen.borrow(), (1..=9).map(|n| (n, 9)).collect::<Vec<_>>());
}

// ---------------------------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------------------------

/// Runs the aideos-encode binary.
fn cli(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_aideos-encode")).args(args).stdin(Stdio::null()).output().unwrap()
}

/// The CLI encodes a PNG directory plus narration and music into a conforming mp4 with an audio stream and prints a JSON report.
#[test]
fn cli_encodes_a_png_directory_with_narration_and_music() {
    let dir = TempDir::new("cli-png");
    let frames = dir.join("frames");
    fs::create_dir_all(&frames).unwrap();
    for i in 1..=15u32 {
        write_png(&frames.join(format!("frame-{i:04}.png")), 192, 108, [(i * 10) as u8, 40, 90, 255], false);
    }
    let voice = dir.join("voice.wav");
    let music = dir.join("music.wav");
    write_pcm16(&voice, SAMPLE_RATE, &tone(440.0, 0.4, 1.0, &[(0.2, 0.6)]));
    write_pcm16(&music, SAMPLE_RATE, &tone(220.0, 0.4, 3.0, &[]));
    let out = dir.join("o.mp4");
    let run = cli(&["--frames", frames.to_str().unwrap(), "--fps", "30", "--voiceover", voice.to_str().unwrap(), "--music", music.to_str().unwrap(), "--out", out.to_str().unwrap(), "--profile", "final", "--json"]);
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let report: serde_json::Value = serde_json::from_slice(&run.stdout).unwrap();
    assert_eq!(report["backend"], "software");
    assert_eq!(report["frames"], 15);
    assert_eq!(report["audio"]["speech_intervals"], 1);
    let f = facts(&out);
    assert_delivery_format(&f, 192, 108, 15);
    assert!((f.audio().unwrap().duration_sec.unwrap() - 0.5).abs() < 0.06);
}

/// The CLI reads raw RGBA frames from stdin (how R2's evaluator can stream to it) and honours a plan file whose relative paths resolve against the plan's folder.
#[test]
fn cli_reads_raw_frames_from_stdin_and_an_audio_plan_file() {
    let dir = TempDir::new("cli-raw");
    let ignored_flag = cli(&["--raw-stdin", "--size", "128x72", "--frame-count", "20", "--audio-plan", "missing-plan.json", "--no-duck", "--out", dir.join("ignored.mp4").to_str().unwrap()]);
    assert_eq!(ignored_flag.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&ignored_flag.stderr).contains("--no-duck"));
    write_pcm16(&dir.join("a.wav"), SAMPLE_RATE, &tone(330.0, 0.3, 1.0, &[]));
    fs::write(dir.join("plan.json"), r#"{ "clips": [ { "path": "a.wav", "role": "voice", "gain": 0.5, "startSec": 0.2 } ] }"#).unwrap();
    let out = dir.join("raw.mp4");
    let mut child = Command::new(env!("CARGO_BIN_EXE_aideos-encode"))
        .args(["--raw-stdin", "--size", "128x72", "--frame-count", "20", "--pixel-format", "rgba", "--audio-plan"])
        .arg(dir.join("plan.json"))
        .arg("--out")
        .arg(&out)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let writer = std::thread::spawn(move || {
        let frame = vec![120u8; 128 * 72 * 4];
        for _ in 0..20 {
            stdin.write_all(&frame).unwrap();
        }
    });
    let run = child.wait_with_output().unwrap();
    writer.join().unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let f = facts(&out);
    assert_delivery_format(&f, 128, 72, 20);
    assert!(f.audio().is_some());
}

/// Usage mistakes exit with code 2 and a message; encode failures exit 1; PNG frame input encodes successfully.
#[test]
fn cli_exit_codes_and_png_frame_input() {
    let dir = TempDir::new("cli-misc");
    assert_eq!(cli(&["--out", dir.join("x.mp4").to_str().unwrap()]).status.code(), Some(2), "no frame source");
    assert_eq!(cli(&["--frames", dir.0.to_str().unwrap(), "--profile", "nonsense", "--out", dir.join("x.mp4").to_str().unwrap()]).status.code(), Some(2));
    assert_eq!(cli(&["--frames", dir.0.to_str().unwrap(), "--raw-stdin", "--size", "128x72", "--frame-count", "3", "--out", dir.join("x.mp4").to_str().unwrap()]).status.code(), Some(2), "two frame sources");
    let odd_frames = dir.join("odd");
    fs::create_dir_all(&odd_frames).unwrap();
    write_png(&odd_frames.join("frame.png"), 127, 72, [0, 0, 0, 255], false);
    let odd = cli(&["--frames", odd_frames.to_str().unwrap(), "--out", dir.join("x.mp4").to_str().unwrap()]);
    assert_eq!(odd.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&odd.stderr).contains("even"));
    let frames = dir.join("frames");
    fs::create_dir_all(&frames).unwrap();
    for i in 0..3 {
        write_png(&frames.join(format!("frame-{i}.png")), 128, 72, [i * 40, 0, 0, 255], false);
    }
    let failed = cli(&["--frames", frames.to_str().unwrap(), "--voiceover", dir.join("missing.wav").to_str().unwrap(), "--out", dir.join("x.mp4").to_str().unwrap()]);
    assert_eq!(failed.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&failed.stderr).contains("missing.wav"));
    assert!(!dir.join("x.mp4").exists(), "a failed run leaves no output file");
    let ok = cli(&["--frames", frames.to_str().unwrap(), "--out", dir.join("ok.mp4").to_str().unwrap()]);
    assert!(ok.status.success(), "{}", String::from_utf8_lossy(&ok.stderr));
    assert_delivery_format(&facts(&dir.join("ok.mp4")), 128, 72, 3);
}
