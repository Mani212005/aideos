//! File Description: The `aideos-render` command line: renders one frame of a Render IR file to a PNG on the deterministic CPU rasterizer (or, built with the `gpu` feature and given `--gpu`, on an EGL OpenGL surface); `video` renders a whole film or a frame range to an mp4 through the R3 encoder; `measure` reports text widths and line metrics with the renderer's own fonts.
//! Inputs and outputs: `aideos-render <ir.json> --frame N [--format long|reel] [--package DIR] [--gpu] --out frame.png` -> the PNG and one line on stdout; `aideos-render video <ir.json> --format F --out x.mp4 [...]` -> the mp4, progress lines and a JSON report; `aideos-render measure <request.json>` -> JSON on stdout. Exit 0 on success, 1 when loading, rendering or encoding fails, 2 on a usage error.
//! Used by: people and agents rendering stills, backend/nativeRenderer.ts and backend/renderIr/measure.ts, tests/cli.rs and tests/video.rs.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use aideos_encode::{BackendChoice, Profile};
use aideos_render::video::{render_video, VideoOptions};
use aideos_render::{Format, Renderer};

/// The usage text.
const USAGE: &str = "usage: aideos-render <ir.json> --frame N [--format long|reel] [--package DIR] [--gpu] --out frame.png

Renders one frame of an aideos.render/1 Render IR to a PNG.
  --frame N        frame number, 0 to durationFrames - 1
  --format F       long (16:9) or reel (9:16); defaults to long when declared, else reel
  --package DIR    directory asset paths resolve against; defaults to the IR file's directory
  --gpu            draw on the GPU (needs a build with --features gpu and an EGL driver)
  --out FILE       where to write the PNG

       aideos-render video <ir.json> --format long|reel --out film.mp4 [--package DIR] [--frames A-B]
                     [--profile draft|review|final] [--backend auto|software|vaapi|videotoolbox]
                     [--threads N] [--encoder-threads N]

Renders frames A to B (inclusive; the whole film by default) on the CPU reference raster with N
worker threads (default: the machine's parallelism) and encodes them with the film's audio clips.
Prints `frames D/T` progress lines, then one JSON report.

       aideos-render measure <request.json>

Prints the single-line width of each run and the line metrics of each face as JSON.";

/// Parsed command line arguments.
struct Args {
    ir: PathBuf,
    frame: u32,
    format: Option<Format>,
    package: Option<PathBuf>,
    gpu: bool,
    out: PathBuf,
}

/// Parses the command line, or returns the message to print with the usage.
fn parse_args(raw: Vec<String>) -> Result<Args, String> {
    let mut ir = None;
    let mut frame = None;
    let mut format = None;
    let mut package = None;
    let mut gpu = false;
    let mut out = None;
    let mut it = raw.into_iter();
    while let Some(arg) = it.next() {
        let mut value = |name: &str| it.next().ok_or_else(|| format!("{name} needs a value"));
        match arg.as_str() {
            "--frame" => {
                let v = value("--frame")?;
                frame = Some(
                    v.parse::<u32>()
                        .map_err(|_| format!("--frame: {v:?} is not a frame number"))?,
                );
            }
            "--format" => {
                let v = value("--format")?;
                format = Some(
                    Format::parse(&v)
                        .ok_or_else(|| format!("--format: {v:?} is not long or reel"))?,
                );
            }
            "--package" => package = Some(PathBuf::from(value("--package")?)),
            "--out" => out = Some(PathBuf::from(value("--out")?)),
            "--gpu" => gpu = true,
            "-h" | "--help" => return Err(String::new()),
            s if s.starts_with("--") => return Err(format!("unknown option {s}")),
            s if ir.is_none() => ir = Some(PathBuf::from(s)),
            s => return Err(format!("unexpected argument {s:?}")),
        }
    }
    Ok(Args {
        ir: ir.ok_or("missing the IR file")?,
        frame: frame.ok_or("missing --frame")?,
        format,
        package,
        gpu,
        out: out.ok_or("missing --out")?,
    })
}

/// Renders the requested frame and writes the PNG.
fn run(args: Args) -> Result<String, String> {
    let started = Instant::now();
    let renderer = Renderer::open(&args.ir, args.package.as_deref()).map_err(|e| e.to_string())?;
    let format = args
        .format
        .unwrap_or(if renderer.ir().formats.long.is_some() {
            Format::Long
        } else {
            Format::Reel
        });
    let frame = if args.gpu {
        render_gpu(&renderer, format, args.frame)?
    } else {
        renderer
            .render_frame(format, args.frame)
            .map_err(|e| e.to_string())?
    };
    let png = frame.encode_png().map_err(|e| e.to_string())?;
    std::fs::write(&args.out, png)
        .map_err(|e| format!("cannot write {}: {e}", args.out.display()))?;
    Ok(format!(
        "wrote {} ({}x{}, {}, frame {}, {}) in {} ms",
        args.out.display(),
        frame.width,
        frame.height,
        format.name(),
        args.frame,
        if args.gpu { "gpu" } else { "cpu" },
        started.elapsed().as_millis()
    ))
}

/// Renders on the GPU when the binary was built with it.
#[cfg(feature = "gpu")]
fn render_gpu(
    renderer: &Renderer,
    format: Format,
    frame: u32,
) -> Result<aideos_render::RenderedFrame, String> {
    let mut gpu = aideos_render::gpu::GpuContext::new().map_err(|e| e.to_string())?;
    gpu.render_frame(renderer, format, frame)
        .map_err(|e| e.to_string())
}

/// Refuses `--gpu` in a build without the GPU path.
#[cfg(not(feature = "gpu"))]
fn render_gpu(_: &Renderer, _: Format, _: u32) -> Result<aideos_render::RenderedFrame, String> {
    Err("this build has no GPU path; rebuild with --features gpu".into())
}

/// Parsed `video` arguments.
struct VideoArgs {
    ir: PathBuf,
    package: Option<PathBuf>,
    out: PathBuf,
    format: Format,
    frames: Option<(u32, u32)>,
    profile: Profile,
    backend: BackendChoice,
    threads: usize,
    encoder_threads: Option<u32>,
}

/// Parses a whole number option value.
fn whole(name: &str, v: &str) -> Result<u32, String> {
    v.parse::<u32>().map_err(|_| format!("{name}: {v:?} is not a whole number"))
}

/// Parses the `video` subcommand's arguments.
fn parse_video_args(raw: Vec<String>) -> Result<VideoArgs, String> {
    let mut ir = None;
    let mut package = None;
    let mut out = None;
    let mut format = None;
    let mut frames = None;
    let mut profile = Profile::Final;
    let mut backend = BackendChoice::Auto;
    let mut threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    let mut encoder_threads = None;
    let mut it = raw.into_iter();
    while let Some(arg) = it.next() {
        let mut value = |name: &str| it.next().ok_or_else(|| format!("{name} needs a value"));
        match arg.as_str() {
            "--package" => package = Some(PathBuf::from(value("--package")?)),
            "--out" => out = Some(PathBuf::from(value("--out")?)),
            "--format" => {
                let v = value("--format")?;
                format = Some(Format::parse(&v).ok_or_else(|| format!("--format: {v:?} is not long or reel"))?);
            }
            "--frames" => {
                let v = value("--frames")?;
                let (a, b) = v.split_once('-').ok_or_else(|| format!("--frames: {v:?} is not A-B"))?;
                frames = Some((whole("--frames", a)?, whole("--frames", b)?));
            }
            "--profile" => {
                let v = value("--profile")?;
                profile = Profile::parse(&v).ok_or_else(|| format!("--profile: {v:?} is not draft, review or final"))?;
            }
            "--backend" => {
                let v = value("--backend")?;
                backend = BackendChoice::parse(&v).ok_or_else(|| format!("--backend: {v:?} is not auto, software, vaapi or videotoolbox"))?;
            }
            "--threads" => {
                let v = value("--threads")?;
                threads = whole("--threads", &v)? as usize;
                if threads == 0 {
                    return Err("--threads must be at least 1".into());
                }
            }
            "--encoder-threads" => {
                let v = value("--encoder-threads")?;
                encoder_threads = Some(whole("--encoder-threads", &v)?);
            }
            "-h" | "--help" => return Err(String::new()),
            s if s.starts_with("--") => return Err(format!("unknown option {s}")),
            s if ir.is_none() => ir = Some(PathBuf::from(s)),
            s => return Err(format!("unexpected argument {s:?}")),
        }
    }
    Ok(VideoArgs {
        ir: ir.ok_or("missing the IR file")?,
        package,
        out: out.ok_or("missing --out")?,
        format: format.ok_or("missing --format")?,
        frames,
        profile,
        backend,
        threads,
        encoder_threads,
    })
}

/// Renders and encodes a film, printing progress lines and the JSON report.
fn run_video(args: VideoArgs) -> Result<String, String> {
    let mut last_printed = 0u64;
    let report = render_video(
        &args.ir,
        args.package.as_deref(),
        &args.out,
        VideoOptions {
            format: args.format,
            frames: args.frames,
            profile: args.profile,
            backend: args.backend,
            threads: args.threads,
            encoder_threads: args.encoder_threads,
            cancel: Arc::new(AtomicBool::new(false)),
            on_progress: Some(Box::new(move |done, total| {
                if done == total || done >= last_printed + 30 {
                    last_printed = done;
                    println!("frames {done}/{total}");
                }
            })),
        },
    )?;
    serde_json::to_string_pretty(&report).map_err(|e| e.to_string())
}

/// Runs a measure request file and returns the JSON answer.
fn run_measure(raw: Vec<String>) -> Result<String, String> {
    let [path] = raw.as_slice() else {
        return Err(if raw.is_empty() { "missing the request file".into() } else { "measure takes one request file".into() });
    };
    let path = Path::new(path);
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let request: aideos_render::measure::MeasureRequest =
        serde_json::from_str(&text).map_err(|e| format!("{} is not a measure request: {e}", path.display()))?;
    let base = path.parent().unwrap_or_else(|| Path::new("."));
    let report = aideos_render::measure::measure(&request, base)?;
    serde_json::to_string(&report).map_err(|e| e.to_string())
}

/// Prints a subcommand's result and maps it to an exit code (1 failure, 2 usage).
fn finish(parsed: Result<Result<String, String>, String>) -> ExitCode {
    match parsed {
        Err(message) if message.is_empty() => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("aideos-render: {message}\n\n{USAGE}");
            ExitCode::from(2)
        }
        Ok(Ok(line)) => {
            println!("{line}");
            ExitCode::SUCCESS
        }
        Ok(Err(message)) => {
            eprintln!("aideos-render: {message}");
            ExitCode::from(1)
        }
    }
}

/// Entry point: dispatches the subcommand (or the still render), and maps failures to exit codes.
fn main() -> ExitCode {
    let mut raw: Vec<String> = std::env::args().skip(1).collect();
    match raw.first().map(String::as_str) {
        Some("video") => {
            raw.remove(0);
            return finish(parse_video_args(raw).map(run_video));
        }
        Some("measure") => {
            raw.remove(0);
            if raw.iter().any(|a| a == "-h" || a == "--help") {
                return finish(Err(String::new()));
            }
            return finish(Ok(run_measure(raw)));
        }
        _ => {}
    }
    let args = match parse_args(raw) {
        Ok(a) => a,
        Err(message) => {
            if message.is_empty() {
                println!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            eprintln!("aideos-render: {message}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match run(args) {
        Ok(line) => {
            println!("{line}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("aideos-render: {message}");
            ExitCode::from(1)
        }
    }
}
