//! File Description: Native golden frames: the CPU raster's own reference frames of hello-scene and still-talking (long and reel), rendered from the committed Render IR documents in `fixtures/golden/`, downscaled 4x4 to the Chrome goldens' quarter scale and compared with the committed PNGs under the same strict tolerance as backend/journeys/goldenCompare.ts (mean difference at most 0.05, at most 0.1% of pixels changed by more than 8). `AIDEOS_NATIVE_GOLDEN_UPDATE=1` renders every frame twice, requires identical pixels, and rewrites the PNGs and MANIFEST.json.
//! Inputs and outputs: fixtures/golden/cases.json, <film>/render.<format>.json, <film>/visuals/*.svg, native/fonts and frames/<film>/<format>-<frame>.png -> a passing or failing comparison per frame, or (update mode) new frames and a manifest.
//! Used by: `cargo test --manifest-path native/Cargo.toml` (the CI unit job's cargo step), docs/NATIVE_RENDERER.md.

mod common;

use std::path::{Path, PathBuf};

use aideos_render::{Format, Renderer};
use aideos_render_ir::types::Asset;
use serde::{Deserialize, Serialize};
use skia_safe::{AlphaType, ColorType, Data, Image, ImageInfo};

/// The same tolerance as the Chrome goldens (backend/journeys/goldenCompare.ts): never loosen it.
const MEAN_ABS_MAX: f64 = 0.05;
const CHANGED_SHARE_MAX: f64 = 0.001;
/// A pixel counts as changed when any channel differs by more than this.
const CHANGED_THRESHOLD: u8 = 8;
/// The golden scale: every frame is box-averaged 4x4, like the Chrome goldens' 0.25.
const SHRINK: u32 = 4;

/// One IR document and the frames kept from it.
#[derive(Debug, Deserialize)]
struct Case {
    film: String,
    format: String,
    ir: String,
    frames: Vec<u32>,
}

/// One committed golden frame.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct GoldenFrame {
    name: String,
    film: String,
    format: String,
    frame: u32,
    width: u32,
    height: u32,
    bytes: u64,
}

/// The golden set's provenance: where it was made and what made it.
#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    platform: String,
    renderer: String,
    skia: String,
    scale: f64,
    tolerance: Tolerance,
    frames: Vec<GoldenFrame>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Tolerance {
    #[serde(rename = "meanAbs")]
    mean_abs: f64,
    #[serde(rename = "changedShare")]
    changed_share: f64,
}

/// The Skia pin the golden frames were made with (kept equal to Cargo.toml by `the_manifest_matches_the_pinned_skia`).
const SKIA_PIN: &str = "0.157.0";

/// The golden fixture folder.
fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/golden")
}

/// The vendored fonts every emitted film uses.
fn fonts_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fonts")
}

/// The cases the fixture IR documents define.
fn cases() -> Vec<Case> {
    let text =
        std::fs::read_to_string(golden_dir().join("cases.json")).expect("cases.json is committed");
    serde_json::from_str(&text).expect("cases.json parses")
}

/// Copies a directory of regular files (non recursive) into `to`.
fn copy_files(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("create the package directory");
    for entry in std::fs::read_dir(from).expect("read the directory") {
        let entry = entry.expect("directory entry");
        if entry.file_type().expect("file type").is_file() {
            std::fs::copy(entry.path(), to.join(entry.file_name())).expect("copy a package file");
        }
    }
}

/// A renderer over one case's IR with its package (artwork and vendored fonts) staged in a scratch directory.
fn renderer_for(case: &Case) -> Renderer {
    let package = common::scratch_dir(&format!("golden-{}-{}", case.film, case.format));
    copy_files(
        &golden_dir().join(&case.film).join("visuals"),
        &package.join("visuals"),
    );
    let ir =
        aideos_render_ir::load_from_path(golden_dir().join(&case.ir)).expect("the golden IR loads");
    for asset in &ir.assets {
        if let Asset::Font(font) = asset {
            let target = package.join(&font.path);
            std::fs::create_dir_all(target.parent().expect("font parent"))
                .expect("create the fonts directory");
            let name = Path::new(&font.path).file_name().expect("font file name");
            std::fs::copy(fonts_dir().join(name), target).expect("copy a vendored font");
        }
    }
    Renderer::new(ir, &package).expect("the golden package loads")
}

/// The render format a case names.
fn format_of(case: &Case) -> Format {
    match case.format.as_str() {
        "long" => Format::Long,
        "reel" => Format::Reel,
        other => panic!("unknown golden format {other}"),
    }
}

/// Renders one frame on the CPU raster and box-averages it down 4x4 into straight RGB.
fn render_small(renderer: &Renderer, format: Format, frame: u32) -> (u32, u32, Vec<u8>) {
    let full = renderer
        .render_frame(format, frame)
        .expect("the frame renders");
    assert!(
        full.width % SHRINK == 0 && full.height % SHRINK == 0,
        "frame size {}x{} is not divisible by {SHRINK}",
        full.width,
        full.height
    );
    let (w, h) = (full.width / SHRINK, full.height / SHRINK);
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for y in 0..h {
        for x in 0..w {
            let mut sum = [0u32; 3];
            for dy in 0..SHRINK {
                for dx in 0..SHRINK {
                    let i = (((y * SHRINK + dy) * full.width + x * SHRINK + dx) * 4) as usize;
                    for c in 0..3 {
                        sum[c] += u32::from(full.rgba[i + c]);
                    }
                }
            }
            for s in sum {
                rgb.push(((s + SHRINK * SHRINK / 2) / (SHRINK * SHRINK)) as u8);
            }
        }
    }
    (w, h, rgb)
}

/// Encodes straight RGB as an opaque PNG with Skia's encoder.
fn encode_png(w: u32, h: u32, rgb: &[u8]) -> Vec<u8> {
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for px in rgb.chunks(3) {
        rgba.extend_from_slice(&[px[0], px[1], px[2], 255]);
    }
    let info = ImageInfo::new(
        (w as i32, h as i32),
        ColorType::RGBA8888,
        AlphaType::Unpremul,
        None,
    );
    let pixmap = skia_safe::Pixmap::new(&info, &mut rgba, w as usize * 4).expect("wrap the pixels");
    skia_safe::png_encoder::encode_pixmap(&pixmap, &Default::default())
        .expect("encode the PNG")
        .as_bytes()
        .to_vec()
}

/// Decodes a PNG into straight RGB.
fn decode_png(bytes: &[u8]) -> (u32, u32, Vec<u8>) {
    let image = Image::from_encoded(Data::new_copy(bytes)).expect("the golden PNG decodes");
    let (w, h) = (image.width() as u32, image.height() as u32);
    let info = ImageInfo::new(
        (w as i32, h as i32),
        ColorType::RGBA8888,
        AlphaType::Unpremul,
        None,
    );
    let mut rgba = vec![0u8; (w * h * 4) as usize];
    assert!(
        image.read_pixels(
            &info,
            &mut rgba,
            w as usize * 4,
            (0, 0),
            skia_safe::image::CachingHint::Allow
        ),
        "read the golden pixels"
    );
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for px in rgba.chunks(4) {
        rgb.extend_from_slice(&px[..3]);
    }
    (w, h, rgb)
}

/// Mean absolute channel difference and the share of pixels with any channel more than the threshold apart.
fn diff(a: &[u8], b: &[u8]) -> (f64, f64) {
    assert_eq!(a.len(), b.len(), "frames differ in size");
    let n = a.len() / 3;
    let mut total = 0u64;
    let mut changed = 0usize;
    for i in 0..n {
        let mut max = 0u8;
        for c in 0..3 {
            let d = a[i * 3 + c].abs_diff(b[i * 3 + c]);
            total += u64::from(d);
            max = max.max(d);
        }
        if max > CHANGED_THRESHOLD {
            changed += 1;
        }
    }
    (total as f64 / (n * 3) as f64, changed as f64 / n as f64)
}

/// The committed golden file of one frame.
fn golden_name(case: &Case, frame: u32) -> String {
    format!("frames/{}/{}-{frame}.png", case.film, case.format)
}

/// This machine's platform string, as the manifest records it.
fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

/// Update mode: renders every frame twice, requires identical pixels, writes the PNGs and the manifest.
fn update() {
    let mut frames = Vec::new();
    for case in cases() {
        let format = format_of(&case);
        let (first, second) = (renderer_for(&case), renderer_for(&case));
        for &frame in &case.frames {
            let a = render_small(&first, format, frame);
            let b = render_small(&second, format, frame);
            assert_eq!(a, b, "{} {} frame {frame} differs between two renders on this machine, so it cannot be a golden", case.film, case.format);
            let png = encode_png(a.0, a.1, &a.2);
            let name = golden_name(&case, frame);
            let path = golden_dir().join(&name);
            std::fs::create_dir_all(path.parent().expect("frame parent"))
                .expect("create the frame directory");
            std::fs::write(&path, &png).expect("write the golden frame");
            frames.push(GoldenFrame {
                name,
                film: case.film.clone(),
                format: case.format.clone(),
                frame,
                width: a.0,
                height: a.1,
                bytes: png.len() as u64,
            });
        }
    }
    let manifest = Manifest {
        platform: platform(),
        renderer: format!("aideos-render {}", env!("CARGO_PKG_VERSION")),
        skia: format!("skia-safe ={SKIA_PIN} (features gl, textlayout, embed-freetype)"),
        scale: 1.0 / f64::from(SHRINK),
        tolerance: Tolerance {
            mean_abs: MEAN_ABS_MAX,
            changed_share: CHANGED_SHARE_MAX,
        },
        frames,
    };
    let text = serde_json::to_string_pretty(&manifest).expect("serialize the manifest");
    std::fs::write(golden_dir().join("MANIFEST.json"), format!("{text}\n"))
        .expect("write the manifest");
}

/// The committed manifest.
fn manifest() -> Manifest {
    let text = std::fs::read_to_string(golden_dir().join("MANIFEST.json"))
        .expect("MANIFEST.json is committed (run with AIDEOS_NATIVE_GOLDEN_UPDATE=1 to make it)");
    serde_json::from_str(&text).expect("MANIFEST.json parses")
}

/// Every native golden frame is reproduced by the CPU raster within the strict tolerance.
#[test]
fn native_golden_frames_are_reproduced() {
    if std::env::var("AIDEOS_NATIVE_GOLDEN_UPDATE").as_deref() == Ok("1") {
        update();
        return;
    }
    if !cfg!(target_os = "linux") {
        eprintln!("native goldens are verified on Linux only: macOS glyphs are rasterized by CoreText (docs/NATIVE_RENDERER.md)");
        return;
    }
    let manifest = manifest();
    assert_eq!(
        manifest.platform,
        platform(),
        "the goldens were made on {} but this is {}",
        manifest.platform,
        platform()
    );
    let expected: Vec<(String, u32)> = cases()
        .iter()
        .flat_map(|c| c.frames.iter().map(move |f| (golden_name(c, *f), *f)))
        .collect();
    let listed: Vec<(String, u32)> = manifest
        .frames
        .iter()
        .map(|f| (f.name.clone(), f.frame))
        .collect();
    assert_eq!(
        listed, expected,
        "the manifest no longer matches cases.json: regenerate with AIDEOS_NATIVE_GOLDEN_UPDATE=1"
    );
    let mut failures = Vec::new();
    for case in cases() {
        let format = format_of(&case);
        let renderer = renderer_for(&case);
        for &frame in &case.frames {
            let name = golden_name(&case, frame);
            let (w, h, rgb) = render_small(&renderer, format, frame);
            let bytes = std::fs::read(golden_dir().join(&name))
                .unwrap_or_else(|e| panic!("{name} is listed but cannot be read: {e}"));
            let (gw, gh, golden) = decode_png(&bytes);
            if (gw, gh) != (w, h) {
                failures.push(format!(
                    "{name}: golden is {gw}x{gh} but the render is {w}x{h}"
                ));
                continue;
            }
            let (mean_abs, changed) = diff(&golden, &rgb);
            if mean_abs > MEAN_ABS_MAX || changed > CHANGED_SHARE_MAX {
                failures.push(format!(
                    "{name}: {:.3}% of pixels changed, mean difference {mean_abs:.3}",
                    changed * 100.0
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "native frames no longer render as they did:\n{}",
        failures.join("\n")
    );
}

/// The manifest records the tolerance and Skia pin this test enforces, so a loosened constant or a bumped Skia cannot pass silently.
#[test]
fn the_manifest_matches_the_pinned_skia_and_tolerance() {
    if !golden_dir().join("MANIFEST.json").exists() {
        return;
    }
    let manifest = manifest();
    assert_eq!(manifest.tolerance.mean_abs, MEAN_ABS_MAX);
    assert_eq!(manifest.tolerance.changed_share, CHANGED_SHARE_MAX);
    assert!(
        manifest.skia.contains(SKIA_PIN),
        "manifest Skia pin {} vs {SKIA_PIN}",
        manifest.skia
    );
    let cargo = include_str!("../Cargo.toml");
    assert!(cargo.contains(&format!("skia-safe = {{ version = \"={SKIA_PIN}\"")), "Cargo.toml no longer pins skia-safe {SKIA_PIN}: re-make the goldens and update this constant");
}
