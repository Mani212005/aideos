// File Description: The aideos-encode command line: encodes a directory of PNG frames or a raw frame stream on stdin, plus audio, into an mp4.
// Inputs and outputs: command line flags (see USAGE) and optional raw frames on stdin -> an mp4, a one-line or JSON report on stdout, errors on stderr; exit code 0 success, 1 failure, 2 usage error.
// Used by: people and scripts running `cargo run --release -p aideos-encode -- ...`, docs/NATIVE_ENCODE.md, tests/encode.rs.

use aideos_encode::audio::{AudioClip, AudioPlan, Role};
use aideos_encode::frames::{Fps, FrameSource, FrameSpec, PixelFormat, PngSequenceSource, RawStreamSource};
use aideos_encode::profile::{BackendChoice, Profile};
use aideos_encode::{encode, EncodeOptions};
use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "aideos-encode: raw frames and audio in, a BT.709 limited-range mp4 out (ffmpeg subprocess)

USAGE
  aideos-encode --out FILE.mp4 FRAMES [AUDIO] [OPTIONS]
FRAMES (exactly one)
  --frames DIR                  PNG files in natural name order (frame2.png before frame10.png)
  --raw-stdin --size WxH --frame-count N [--pixel-format rgba|i420]
                                tightly packed frames on stdin
AUDIO (optional)
  --audio FILE                  one finished track
  --voiceover FILE              narration
  --music FILE                  music bed; ducks under the narration unless --no-duck
  --no-duck                     keep the music at a flat level
  --audio-plan FILE.json        a full plan (clips, gains, envelopes, ducking levels); excludes the flags above

OPTIONS
  --fps N|N/D                   frame rate (default 30)
  --profile final|review|draft  final is always x264 CRF 16 (default); draft and review use VAAPI or
                                VideoToolbox when the machine passes the probe
  --backend auto|software|vaapi|videotoolbox
  --threads N                   pin encoder threads (x264 output depends on the thread count)
  --json                        print the report as JSON
";

/// A usage mistake, reported with exit code 2.
struct Usage(String);

/// Everything the command line asked for.
struct Args {
    out: Option<PathBuf>,
    frames_dir: Option<PathBuf>,
    raw_stdin: bool,
    size: Option<(u32, u32)>,
    frame_count: Option<u64>,
    pixel_format: Option<PixelFormat>,
    fps: Fps,
    profile: Profile,
    backend: BackendChoice,
    threads: Option<u32>,
    audio: Option<PathBuf>,
    voiceover: Option<PathBuf>,
    music: Option<PathBuf>,
    no_duck: bool,
    audio_plan: Option<PathBuf>,
    json: bool,
}

/// Parses `WxH`.
fn parse_size(text: &str) -> Result<(u32, u32), Usage> {
    let bad = || Usage(format!("size \"{text}\" must look like 1920x1080"));
    let (w, h) = text.split_once('x').ok_or_else(bad)?;
    Ok((w.parse().map_err(|_| bad())?, h.parse().map_err(|_| bad())?))
}

/// Reads the command line into `Args`.
fn parse_args(raw: &[String]) -> Result<Args, Usage> {
    let mut args = Args {
        out: None,
        frames_dir: None,
        raw_stdin: false,
        size: None,
        frame_count: None,
        pixel_format: None,
        fps: Fps { num: 30, den: 1 },
        profile: Profile::Final,
        backend: BackendChoice::Auto,
        threads: None,
        audio: None,
        voiceover: None,
        music: None,
        no_duck: false,
        audio_plan: None,
        json: false,
    };
    let mut it = raw.iter();
    while let Some(flag) = it.next() {
        let mut value = |name: &str| it.next().cloned().ok_or_else(|| Usage(format!("{name} needs a value")));
        match flag.as_str() {
            "--out" => args.out = Some(PathBuf::from(value("--out")?)),
            "--frames" => args.frames_dir = Some(PathBuf::from(value("--frames")?)),
            "--raw-stdin" => args.raw_stdin = true,
            "--size" => args.size = Some(parse_size(&value("--size")?)?),
            "--frame-count" => args.frame_count = Some(value("--frame-count")?.parse().map_err(|_| Usage("--frame-count must be a whole number".to_string()))?),
            "--pixel-format" => {
                let text = value("--pixel-format")?;
                args.pixel_format = Some(PixelFormat::parse(&text).ok_or_else(|| Usage(format!("pixel format \"{text}\" must be rgba or i420")))?);
            }
            "--fps" => args.fps = Fps::parse(&value("--fps")?).map_err(|e| Usage(e.to_string()))?,
            "--profile" => {
                let text = value("--profile")?;
                args.profile = Profile::parse(&text).ok_or_else(|| Usage(format!("profile \"{text}\" must be final, review or draft")))?;
            }
            "--backend" => {
                let text = value("--backend")?;
                args.backend = BackendChoice::parse(&text).ok_or_else(|| Usage(format!("backend \"{text}\" must be auto, software, vaapi or videotoolbox")))?;
            }
            "--threads" => args.threads = Some(value("--threads")?.parse().map_err(|_| Usage("--threads must be a whole number".to_string()))?),
            "--audio" => args.audio = Some(PathBuf::from(value("--audio")?)),
            "--voiceover" => args.voiceover = Some(PathBuf::from(value("--voiceover")?)),
            "--music" => args.music = Some(PathBuf::from(value("--music")?)),
            "--no-duck" => args.no_duck = true,
            "--audio-plan" => args.audio_plan = Some(PathBuf::from(value("--audio-plan")?)),
            "--json" => args.json = true,
            other => return Err(Usage(format!("unknown option {other}"))),
        }
    }
    Ok(args)
}

/// Opens the frame source the flags describe.
fn open_source(args: &Args) -> Result<Box<dyn FrameSource>, Usage> {
    let chosen = [args.frames_dir.is_some(), args.raw_stdin].iter().filter(|b| **b).count();
    if chosen != 1 {
        return Err(Usage("give exactly one of --frames and --raw-stdin".to_string()));
    }
    if let Some(dir) = &args.frames_dir {
        if args.size.is_some() || args.frame_count.is_some() || args.pixel_format.is_some() {
            return Err(Usage("--size, --frame-count and --pixel-format apply only to --raw-stdin".to_string()));
        }
        return Ok(Box::new(PngSequenceSource::open(dir, args.fps).map_err(|e| Usage(e.to_string()))?));
    }
    let (width, height) = args.size.ok_or_else(|| Usage("--raw-stdin needs --size WxH".to_string()))?;
    let count = args.frame_count.ok_or_else(|| Usage("this frame source needs --frame-count N".to_string()))?;
    let spec = FrameSpec { width, height, fps: args.fps, pixel_format: args.pixel_format.unwrap_or(PixelFormat::Rgba8), frame_count: count };
    Ok(Box::new(RawStreamSource::new(spec, std::io::BufReader::with_capacity(1 << 20, std::io::stdin())).map_err(|e| Usage(e.to_string()))?))
}

/// Builds the audio plan the flags describe, plus the directory its relative paths resolve against.
fn build_audio(args: &Args) -> Result<Option<(AudioPlan, PathBuf)>, Usage> {
    let shortcuts = args.audio.is_some() || args.voiceover.is_some() || args.music.is_some();
    if let Some(path) = &args.audio_plan {
        if shortcuts || args.no_duck {
            return Err(Usage("--audio-plan cannot be combined with --audio, --voiceover, --music or --no-duck".to_string()));
        }
        let text = std::fs::read_to_string(path).map_err(|e| Usage(format!("cannot read {}: {e}", path.display())))?;
        let plan: AudioPlan = serde_json::from_str(&text).map_err(|e| Usage(format!("{} is not a valid audio plan: {e}", path.display())))?;
        let base = path.parent().map(|p| p.to_path_buf()).filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| PathBuf::from("."));
        return Ok(Some((plan, base)));
    }
    if !shortcuts {
        return Ok(None);
    }
    if args.audio.is_some() && (args.voiceover.is_some() || args.music.is_some()) {
        return Err(Usage("--audio is a finished track; use --voiceover and --music to mix, not both".to_string()));
    }
    let mut clips = Vec::new();
    if let Some(path) = args.audio.as_ref().or(args.voiceover.as_ref()) {
        clips.push(AudioClip::new(path, Role::Voice));
    }
    if let Some(path) = &args.music {
        let mut clip = AudioClip::new(path, Role::Music);
        clip.duck_under_voice = !args.no_duck;
        clip.fade_in_sec = 0.25;
        clip.fade_out_sec = 0.25;
        clips.push(clip);
    }
    Ok(Some((AudioPlan { clips, ..AudioPlan::default() }, PathBuf::from("."))))
}

/// Runs the encode the flags describe and prints its report.
fn run_encode(args: Args) -> Result<ExitCode, Usage> {
    let out = args.out.clone().ok_or_else(|| Usage("--out FILE.mp4 is required".to_string()))?;
    let mut source = open_source(&args)?;
    let audio = build_audio(&args)?;
    let mut opts = EncodeOptions::new(args.profile);
    opts.backend = args.backend;
    opts.threads = args.threads;
    if let Some((_, base)) = &audio {
        opts.audio_base_dir = base.clone();
    }
    match encode(source.as_mut(), audio.as_ref().map(|(plan, _)| plan), &out, &mut opts) {
        Ok(report) => {
            if args.json {
                println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
            } else {
                let spec = source.spec();
                println!(
                    "{}: {} frames {}x{} at {} fps, {} profile, {} encoder{}, {:.2}s",
                    report.output.display(),
                    report.frames,
                    spec.width,
                    spec.height,
                    spec.fps.ffmpeg_string(),
                    report.profile,
                    report.backend,
                    report.fallback_reason.as_ref().map(|r| format!(" (fell back: {r})")).unwrap_or_default(),
                    report.elapsed_sec
                );
            }
            Ok(ExitCode::SUCCESS)
        }
        Err(error) => {
            eprintln!("aideos-encode: {error}");
            Ok(ExitCode::from(1))
        }
    }
}

/// Entry point for the encode command.
fn main() -> ExitCode {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    if raw.is_empty() || raw.iter().any(|a| a == "--help" || a == "-h") {
        print!("{USAGE}");
        return if raw.is_empty() { ExitCode::from(2) } else { ExitCode::SUCCESS };
    }
    let outcome = parse_args(&raw).and_then(run_encode);
    match outcome {
        Ok(code) => code,
        Err(Usage(message)) => {
            eprintln!("aideos-encode: {message}\n\nrun aideos-encode --help for usage");
            ExitCode::from(2)
        }
    }
}
