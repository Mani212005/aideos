//! File Description: The `aideos-render` command line: renders one frame of a Render IR file to a PNG on the deterministic CPU rasterizer (or, built with the `gpu` feature and given `--gpu`, on an EGL OpenGL surface).
//! Inputs and outputs: `aideos-render <ir.json> --frame N [--format long|reel] [--package DIR] [--gpu] --out frame.png` -> the PNG file and one line on stdout; exit 0 on success, 1 when loading or rendering fails, 2 on a usage error.
//! Used by: people and agents rendering stills, and tests/cli.rs.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use aideos_render::{Format, Renderer};

/// The usage text.
const USAGE: &str = "usage: aideos-render <ir.json> --frame N [--format long|reel] [--package DIR] [--gpu] --out frame.png

Renders one frame of an aideos.render/1 Render IR to a PNG.
  --frame N        frame number, 0 to durationFrames - 1
  --format F       long (16:9) or reel (9:16); defaults to long when declared, else reel
  --package DIR    directory asset paths resolve against; defaults to the IR file's directory
  --gpu            draw on the GPU (needs a build with --features gpu and an EGL driver)
  --out FILE       where to write the PNG";

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

/// Entry point: parses arguments, renders, and maps failures to exit codes.
fn main() -> ExitCode {
    let args = match parse_args(std::env::args().skip(1).collect()) {
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
