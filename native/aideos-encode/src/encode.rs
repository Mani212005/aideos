// File Description: The encoder: pulls frames from a FrameSource, mixes the audio plan, pipes raw frames into an ffmpeg subprocess and produces a BT.709 limited-range yuv420p mp4 (x264 CRF 16 for final, VAAPI or VideoToolbox for drafts, with a software fallback chosen by a real conformance probe).
// Inputs and outputs: a FrameSource, an optional AudioPlan and an output path -> an mp4 file (written to a .partial file and renamed on success) and an EncodeReport.
// Used by: src/main.rs, tests/encode.rs, and the native renderer's final stage (R2 and R4).

use crate::audio::{mix_plan, write_wav_f32, AudioError, AudioPlan, SAMPLE_RATE};
use crate::frames::{FrameSource, FrameSpec, Pattern, PixelFormat, SourceError, SyntheticSource, Fps};
use crate::probe::probe;
use crate::profile::{Backend, BackendChoice, Profile, VAAPI_QP};
use crate::tools::Tools;
use serde::Serialize;
use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Reported to the progress callback after each frame is handed to ffmpeg.
#[derive(Clone, Copy, Debug)]
pub struct Progress {
    pub frames_done: u64,
    pub frames_total: u64,
}

/// How to run one encode.
pub struct EncodeOptions {
    pub profile: Profile,
    pub backend: BackendChoice,
    pub tools: Tools,
    /// Encoder threads; None lets ffmpeg decide. Pin it when byte-identical output across machines matters, because x264 output depends on its thread count.
    pub threads: Option<u32>,
    /// Set this flag from another thread to stop: ffmpeg is killed, the partial output removed and `EncodeError::Cancelled` returned.
    pub cancel: Option<Arc<AtomicBool>>,
    /// Called after every frame.
    pub on_progress: Option<Box<dyn FnMut(Progress)>>,
    /// Relative audio clip paths resolve against this directory.
    pub audio_base_dir: PathBuf,
}

impl EncodeOptions {
    /// Options for a profile with automatic backend choice, tools from the environment and relative audio paths against the current directory.
    pub fn new(profile: Profile) -> EncodeOptions {
        EncodeOptions {
            profile,
            backend: BackendChoice::Auto,
            tools: Tools::from_env(),
            threads: None,
            cancel: None,
            on_progress: None,
            audio_base_dir: PathBuf::from("."),
        }
    }
}

/// What the audio mix did, for the report.
#[derive(Clone, Debug, Serialize)]
pub struct AudioReport {
    /// Largest sample before clamping, 1.0 being full scale.
    pub peak: f32,
    /// Samples that went past full scale and were clamped.
    pub clipped_samples: u64,
    /// Number of narration spans used for ducking.
    pub speech_intervals: usize,
}

/// The outcome of a finished encode.
#[derive(Clone, Debug, Serialize)]
pub struct EncodeReport {
    pub output: PathBuf,
    pub profile: Profile,
    /// The encoder that actually ran.
    pub backend: Backend,
    /// Why a hardware encoder was not used when the profile would have allowed it.
    pub fallback_reason: Option<String>,
    pub frames: u64,
    pub width: u32,
    pub height: u32,
    pub duration_sec: f64,
    pub audio: Option<AudioReport>,
    pub elapsed_sec: f64,
}

/// Why an encode failed.
#[derive(Debug)]
pub enum EncodeError {
    /// The request itself is not allowed (a hardware encoder for a final export).
    Policy(String),
    /// The requested hardware encoder cannot produce a conforming file on this machine.
    BackendUnavailable { backend: Backend, reason: String },
    /// ffmpeg or ffprobe could not be started.
    Tool(String),
    /// The frame source failed.
    Source(SourceError),
    /// The audio mix failed.
    Audio(AudioError),
    /// ffmpeg exited with an error; its last messages are attached.
    Ffmpeg { code: Option<i32>, stderr: String },
    /// The cancel flag was raised.
    Cancelled,
    /// A file operation failed.
    Io(io::Error),
}

impl fmt::Display for EncodeError {
    /// Writes a one-line (or, for ffmpeg, a short multi-line) description.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EncodeError::Policy(m) => write!(f, "{m}"),
            EncodeError::BackendUnavailable { backend, reason } => write!(f, "the {backend} encoder is not usable here: {reason}"),
            EncodeError::Tool(m) => write!(f, "{m}"),
            EncodeError::Source(e) => write!(f, "{e}"),
            EncodeError::Audio(e) => write!(f, "{e}"),
            EncodeError::Ffmpeg { code, stderr } => {
                write!(f, "ffmpeg failed")?;
                if let Some(c) = code {
                    write!(f, " with exit code {c}")?;
                }
                if !stderr.trim().is_empty() {
                    write!(f, ":\n{}", stderr.trim())?;
                }
                Ok(())
            }
            EncodeError::Cancelled => write!(f, "the encode was cancelled"),
            EncodeError::Io(e) => write!(f, "file operation failed: {e}"),
        }
    }
}

impl std::error::Error for EncodeError {}

impl From<io::Error> for EncodeError {
    /// Wraps an I/O error.
    fn from(e: io::Error) -> Self {
        EncodeError::Io(e)
    }
}

impl From<SourceError> for EncodeError {
    /// Wraps a frame source error.
    fn from(e: SourceError) -> Self {
        EncodeError::Source(e)
    }
}

impl From<AudioError> for EncodeError {
    /// Wraps an audio mix error.
    fn from(e: AudioError) -> Self {
        EncodeError::Audio(e)
    }
}

/// Removes its files when dropped, so a failed or cancelled encode leaves nothing behind.
struct Cleanup(Vec<PathBuf>);

impl Drop for Cleanup {
    /// Deletes each listed file that still exists.
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = fs::remove_file(path);
        }
    }
}

/// The scale filter that turns RGBA into limited-range BT.709 (accurate rounding and full chroma interpolation keep hairlines and small type clean).
const RGBA_TO_709: &str = "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int";

/// Builds the ffmpeg argument list for one encode.
fn build_args(spec: &FrameSpec, profile: Profile, backend: Backend, audio: Option<&Path>, partial: &Path, threads: Option<u32>) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();
    let mut push = |items: &[&str]| args.extend(items.iter().map(OsString::from));
    push(&["-hide_banner", "-loglevel", "error", "-y"]);
    if backend == Backend::Vaapi {
        let device = std::env::var("AIDEOS_VAAPI_DEVICE").unwrap_or_else(|_| "/dev/dri/renderD128".to_string());
        push(&["-vaapi_device", &device]);
    }
    let size = format!("{}x{}", spec.width, spec.height);
    push(&["-f", "rawvideo", "-pix_fmt", spec.pixel_format.ffmpeg_name(), "-video_size", &size, "-framerate", &spec.fps.ffmpeg_string(), "-i", "pipe:0"]);
    if let Some(wav) = audio {
        push(&["-i", &wav.to_string_lossy()]);
        push(&["-map", "0:v:0", "-map", "1:a:0"]);
    }
    let filter = match (backend, spec.pixel_format) {
        (Backend::Vaapi, PixelFormat::Rgba8) => Some(format!("{RGBA_TO_709},format=nv12,hwupload")),
        (Backend::Vaapi, PixelFormat::I420) => Some("format=nv12,hwupload".to_string()),
        (_, PixelFormat::Rgba8) => Some(format!("{RGBA_TO_709},format=yuv420p")),
        (_, PixelFormat::I420) => None,
    };
    if let Some(chain) = &filter {
        push(&["-vf", chain]);
    }
    match backend {
        Backend::Software => {
            push(&["-c:v", "libx264", "-preset", profile.x264_preset(), "-crf", &profile.policy().crf.to_string(), "-pix_fmt", "yuv420p"]);
        }
        Backend::Vaapi => {
            push(&["-c:v", "h264_vaapi", "-profile:v", "high", "-qp", &VAAPI_QP.to_string()]);
        }
        Backend::VideoToolbox => {
            let bits = (spec.width as f64 * spec.height as f64 * spec.fps.as_f64() * 0.2) as u64;
            push(&["-c:v", "h264_videotoolbox", "-profile:v", "high", "-b:v", &bits.to_string(), "-pix_fmt", "yuv420p"]);
        }
    }
    if let Some(n) = threads {
        push(&["-threads", &n.to_string()]);
    }
    push(&["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]);
    if audio.is_some() {
        push(&["-c:a", "aac", "-b:a", &profile.policy().audio_bitrate.to_string(), "-ar", &SAMPLE_RATE.to_string(), "-ac", "2"]);
    }
    push(&["-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact", "-movflags", "+faststart", "-f", "mp4"]);
    args.push(partial.as_os_str().to_owned());
    args
}

/// Keeps the tail of ffmpeg's messages, which is where the cause of a failure is.
fn tail(text: String) -> String {
    const KEEP: usize = 4000;
    if text.len() <= KEEP {
        return text;
    }
    let mut start = text.len() - KEEP;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_string()
}

/// Starts ffmpeg with a piped stdin and returns the child plus a thread that collects its stderr.
fn spawn_ffmpeg(tools: &Tools, args: &[OsString]) -> Result<(Child, std::thread::JoinHandle<String>), EncodeError> {
    let mut child = Command::new(&tools.ffmpeg)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| EncodeError::Tool(format!("cannot run {}: {e} (install ffmpeg or set AIDEOS_FFMPEG)", tools.ffmpeg.display())))?;
    let mut stderr = child.stderr.take().expect("stderr was piped");
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        tail(text)
    });
    Ok((child, reader))
}

/// Feeds every frame of `source` to ffmpeg and waits for it to finish.
fn run_ffmpeg(source: &mut dyn FrameSource, spec: &FrameSpec, args: &[OsString], opts: &mut EncodeOptions) -> Result<(), EncodeError> {
    let (mut child, stderr_reader) = spawn_ffmpeg(&opts.tools, args)?;
    let mut stdin = child.stdin.take().expect("stdin was piped");
    let mut frame = vec![0u8; spec.frame_bytes()];
    let mut failure: Option<EncodeError> = None;
    for done in 0..spec.frame_count {
        if opts.cancel.as_ref().is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            failure = Some(EncodeError::Cancelled);
            break;
        }
        match source.next_frame(&mut frame) {
            Ok(true) => {}
            Ok(false) => {
                failure = Some(EncodeError::Source(SourceError::Ended { expected: spec.frame_count, got: done }));
                break;
            }
            Err(e) => {
                failure = Some(EncodeError::Source(e));
                break;
            }
        }
        if stdin.write_all(&frame).is_err() {
            // ffmpeg stopped reading: its exit status and messages below say why.
            break;
        }
        if let Some(callback) = opts.on_progress.as_mut() {
            callback(Progress { frames_done: done + 1, frames_total: spec.frame_count });
        }
    }
    if failure.is_some() {
        let _ = child.kill();
    }
    drop(stdin);
    let status = child.wait()?;
    let stderr = stderr_reader.join().unwrap_or_default();
    if let Some(error) = failure {
        return Err(error);
    }
    if !status.success() {
        return Err(EncodeError::Ffmpeg { code: status.code(), stderr });
    }
    Ok(())
}

/// A unique scratch path in the system temp directory.
fn scratch_path(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    std::env::temp_dir().join(format!("aideos-encode-{label}-{}-{nanos}.mp4", std::process::id()))
}

/// Encodes a few synthetic frames with `backend` and checks the file really is H.264 yuv420p, limited range, tagged BT.709. Returns the reason when it is not.
pub fn probe_backend(tools: &Tools, backend: Backend) -> Result<(), String> {
    let spec = FrameSpec { width: 256, height: 144, fps: Fps { num: 30, den: 1 }, pixel_format: PixelFormat::Rgba8, frame_count: 3 };
    let mut source = SyntheticSource::new(spec, Pattern::Moving).map_err(|e| e.to_string())?;
    let out = scratch_path(&format!("probe-{backend}"));
    let _cleanup = Cleanup(vec![out.clone()]);
    let mut opts = EncodeOptions::new(Profile::Draft);
    opts.tools = tools.clone();
    let args = build_args(&spec, Profile::Draft, backend, None, &out, None);
    run_ffmpeg(&mut source, &spec, &args, &mut opts).map_err(|e| e.to_string().lines().last().unwrap_or("ffmpeg failed").to_string())?;
    let facts = probe(&tools.ffprobe, &out)?;
    let video = facts.video().ok_or("the probe file has no video stream")?;
    let tags = (video.codec_name.as_str(), video.pix_fmt.as_deref(), video.color_range.as_deref(), video.color_space.as_deref(), video.color_primaries.as_deref(), video.color_transfer.as_deref());
    if tags != ("h264", Some("yuv420p"), Some("tv"), Some("bt709"), Some("bt709"), Some("bt709")) {
        return Err(format!("its output is not tagged h264 yuv420p limited-range BT.709 (got {tags:?})"));
    }
    Ok(())
}

/// Decides which encoder runs: software for a final export, otherwise a hardware encoder that passes the probe, otherwise software with the reason recorded.
pub fn resolve_backend(tools: &Tools, profile: Profile, choice: BackendChoice) -> Result<(Backend, Option<String>), EncodeError> {
    match choice {
        BackendChoice::Exactly(Backend::Software) => Ok((Backend::Software, None)),
        BackendChoice::Exactly(hardware) => {
            if !profile.allows_hardware() {
                return Err(EncodeError::Policy(format!("a {profile} export is always encoded with x264; the {hardware} encoder is for draft and review renders")));
            }
            probe_backend(tools, hardware).map_err(|reason| EncodeError::BackendUnavailable { backend: hardware, reason })?;
            Ok((hardware, None))
        }
        BackendChoice::Auto => {
            if !profile.allows_hardware() {
                return Ok((Backend::Software, None));
            }
            match Backend::native_hardware() {
                None => Ok((Backend::Software, Some("no hardware encoder is supported on this operating system".to_string()))),
                Some(hardware) => match probe_backend(tools, hardware) {
                    Ok(()) => Ok((hardware, None)),
                    Err(reason) => Ok((Backend::Software, Some(format!("{hardware} unavailable: {reason}")))),
                },
            }
        }
    }
}

/// Encodes `source` (and the optional audio plan) into the mp4 at `out`. The file appears only when the encode succeeded.
pub fn encode(source: &mut dyn FrameSource, audio: Option<&AudioPlan>, out: &Path, opts: &mut EncodeOptions) -> Result<EncodeReport, EncodeError> {
    let started = Instant::now();
    let spec = source.spec();
    spec.validate()?;
    let (backend, fallback_reason) = resolve_backend(&opts.tools, opts.profile, opts.backend)?;
    if let Some(parent) = out.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    let name = out.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "out.mp4".to_string());
    let dir = out.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    let partial = dir.join(format!("{name}.partial"));
    let wav = dir.join(format!(".{name}.audio.wav"));
    let mut cleanup = Cleanup(vec![partial.clone()]);

    let mut audio_report = None;
    let mut wav_path: Option<&Path> = None;
    if let Some(plan) = audio {
        if opts.cancel.as_ref().is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            return Err(EncodeError::Cancelled);
        }
        let mixed = mix_plan(&opts.tools, plan, spec.duration_sec(), &opts.audio_base_dir)?;
        cleanup.0.push(wav.clone());
        write_wav_f32(&wav, &mixed.samples)?;
        audio_report = Some(AudioReport { peak: mixed.peak, clipped_samples: mixed.clipped_samples, speech_intervals: mixed.speech.len() });
        wav_path = Some(&wav);
    }

    let args = build_args(&spec, opts.profile, backend, wav_path, &partial, opts.threads);
    run_ffmpeg(source, &spec, &args, opts)?;
    fs::rename(&partial, out)?;
    Ok(EncodeReport {
        output: out.to_path_buf(),
        profile: opts.profile,
        backend,
        fallback_reason,
        frames: spec.frame_count,
        width: spec.width,
        height: spec.height,
        duration_sec: spec.duration_sec(),
        audio: audio_report,
        elapsed_sec: started.elapsed().as_secs_f64(),
    })
}
