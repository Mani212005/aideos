//! File Description: Behavioural tests of the CPU raster through the public `Renderer`: cold renders are byte-identical across processes, any frame renders the same whatever was rendered before it (deterministic seeking), both formats have their sizes, element tracks and the camera move the pixels they should, and every load-time refusal (unknown format, frame out of range, missing or escaping asset, unsupported SVG, undeclared element, unvendored font) names its cause.
//! Inputs and outputs: the fixture package and scratch packages -> asserted frames, pixels and errors.
//! Used by: `cargo test --manifest-path native/Cargo.toml`.

mod common;

use std::process::Command;

use aideos_render::{eval, Format, RenderError, Renderer};
use aideos_render_ir::types::{Asset, Node};
use common::{close, pixel, png_size};

/// The fixture renderer.
fn renderer() -> Renderer {
    Renderer::new(common::tiny_scene(), &common::package_dir()).expect("the fixture package loads")
}

/// The colour of the fixture's background, #0B0D10.
const BACKGROUND: [u8; 4] = [0x0B, 0x0D, 0x10, 0xFF];
/// The accent of the fixture's edge, #635BFF.
const ACCENT: [u8; 4] = [0x63, 0x5B, 0xFF, 0xFF];

/// Checks that cold renders in separate processes are byte identical.
#[test]
fn cold_renders_in_separate_processes_are_byte_identical() {
    let dir = common::scratch_dir("cold");
    for format in ["long", "reel"] {
        let mut outputs = Vec::new();
        for run in 0..2 {
            let out = dir.join(format!("{format}-{run}.png"));
            let status = Command::new(env!("CARGO_BIN_EXE_aideos-render"))
                .arg(common::tiny_scene_path())
                .args(["--frame", "43", "--format", format, "--out"])
                .arg(&out)
                .status()
                .expect("run aideos-render");
            assert!(status.success(), "{format} render {run} failed");
            outputs.push(std::fs::read(&out).expect("read the PNG"));
        }
        assert_eq!(
            outputs[0], outputs[1],
            "two cold {format} renders of frame 43 differ"
        );
    }
}

/// Checks that a frame renders the same whatever was rendered before it.
#[test]
fn a_frame_renders_the_same_whatever_was_rendered_before_it() {
    let warm = renderer();
    for f in [89, 0, 44, 12] {
        warm.render_frame(Format::Long, f).expect("render");
    }
    let after_others = warm.render_frame(Format::Long, 43).expect("render 43");
    let fresh = renderer()
        .render_frame(Format::Long, 43)
        .expect("render 43 cold");
    assert!(
        after_others == fresh,
        "frame 43 depends on the frames rendered before it"
    );
    let again = warm
        .render_frame(Format::Long, 43)
        .expect("render 43 again");
    assert!(
        after_others == again,
        "rendering the same frame twice gives different pixels"
    );
}

/// Checks that both formats render at their declared sizes and encode to png.
#[test]
fn both_formats_render_at_their_declared_sizes_and_encode_to_png() {
    let r = renderer();
    let long = r.render_frame(Format::Long, 30).expect("long");
    let reel = r.render_frame(Format::Reel, 30).expect("reel");
    assert_eq!(
        (long.width, long.height, long.rgba.len()),
        (1920, 1080, 1920 * 1080 * 4)
    );
    assert_eq!((reel.width, reel.height), (1080, 1920));
    assert_eq!(png_size(&long.encode_png().expect("encode")), (1920, 1080));
    assert_eq!(png_size(&reel.encode_png().expect("encode")), (1080, 1920));
}

/// Checks that the stage is hidden until its opacity track brings it in.
#[test]
fn the_stage_is_hidden_until_its_opacity_track_brings_it_in() {
    let r = renderer();
    let first = r.render_frame(Format::Long, 0).expect("frame 0");
    assert_eq!(
        pixel(&first, 960, 540),
        BACKGROUND,
        "the stage node starts at opacity 0"
    );
    assert_eq!(pixel(&first, 4, 4), BACKGROUND);
    let later = r.render_frame(Format::Long, 30).expect("frame 30");
    assert_ne!(
        pixel(&later, 960, 540),
        BACKGROUND,
        "by frame 30 the artwork is visible at the camera centre"
    );
}

/// Checks that draw on reveals the edge where the camera projects it.
#[test]
fn draw_on_reveals_the_edge_where_the_camera_projects_it() {
    let r = renderer();
    let ir = r.ir();
    // The edge's midpoint is the asset origin, placed at scene (960, 960).
    let at = |f: u32| {
        let pose = eval::camera(ir, f);
        let (x, y) = eval::project(ir, &pose, 1920, 1080, 960.0, 960.0);
        pixel(
            &r.render_frame(Format::Long, f).expect("render"),
            x.round() as u32,
            y.round() as u32,
        )
    };
    assert!(
        !close(at(20), ACCENT, 24),
        "at frame 20 the edge has not started drawing"
    );
    assert!(
        close(at(44), ACCENT, 2),
        "at frame 44 the edge is fully drawn: {:?}",
        at(44)
    );
}

/// Checks that the reel shows the captions in its own placement.
#[test]
fn the_reel_shows_the_captions_in_its_own_placement() {
    let r = renderer();
    // Frame 12: the first phrase is fully in, its card at x 0.5, y 0.78 of the reel.
    let reel = r.render_frame(Format::Reel, 12).expect("reel 12");
    let below_card_top = pixel(&reel, 540, (0.78 * 1920.0) as u32 + 6);
    assert_ne!(
        below_card_top, BACKGROUND,
        "the caption card is drawn where its span places it"
    );
    let before = r.render_frame(Format::Reel, 70).expect("reel 70");
    assert_eq!(
        pixel(&before, 540, (0.78 * 1920.0) as u32 + 6),
        BACKGROUND,
        "no caption between phrases"
    );
}

/// Checks that an oversized spoken word wraps inside the caption card when painted.
#[test]
fn an_oversized_caption_word_stays_inside_its_card() {
    let mut ir = common::tiny_scene();
    for node in &mut ir.overlay {
        if let Node::Captions(captions) = node {
            captions.words[0].text = "W".repeat(120);
        }
    }
    let long_word = Renderer::new(ir, &common::package_dir())
        .expect("mutated caption IR loads")
        .render_frame(Format::Long, 3)
        .expect("oversized caption renders");
    let ordinary = renderer()
        .render_frame(Format::Long, 3)
        .expect("ordinary caption renders");
    for y in 820..960 {
        for x in 0..288 {
            assert!(close(pixel(&long_word, x, y), pixel(&ordinary, x, y), 1));
        }
        for x in 1632..1920 {
            assert!(close(pixel(&long_word, x, y), pixel(&ordinary, x, y), 1));
        }
    }
}

/// Checks that a format the ir does not declare is refused.
#[test]
fn a_format_the_ir_does_not_declare_is_refused() {
    let mut ir = common::tiny_scene();
    ir.formats.reel = None;
    for n in ir.overlay.iter_mut() {
        match n {
            Node::Group(g) => g.children.iter_mut().for_each(strip_reel),
            other => strip_reel(other),
        }
    }
    let r = Renderer::new(ir, &common::package_dir()).expect("a long-only IR loads");
    assert!(matches!(
        r.render_frame(Format::Reel, 0),
        Err(RenderError::FormatNotDeclared(Format::Reel))
    ));
}

/// Drops a node's reel placement so the document stays consistent with a long-only format list.
fn strip_reel(n: &mut Node) {
    match n {
        Node::Rect(r) => r.placement.reel = None,
        Node::Text(t) => t.placement.reel = None,
        Node::Rail(r) => r.placement.reel = None,
        Node::Captions(c) => c.placement.reel = None,
        Node::EndCard(e) => e.layout.reel = None,
        _ => {}
    }
}

/// Checks that a frame outside the film is refused.
#[test]
fn a_frame_outside_the_film_is_refused() {
    let err = renderer()
        .render_frame(Format::Long, 90)
        .expect_err("frame 90 of a 90 frame film");
    assert!(matches!(
        err,
        RenderError::FrameOutOfRange {
            frame: 90,
            duration_frames: 90
        }
    ));
    assert!(err.to_string().contains("frames 0 to 89"), "{err}");
}

/// Points the fixture's SVG asset somewhere else.
fn with_svg_path(path: &str, element_ids: &[&str]) -> aideos_render_ir::types::RenderIr {
    let mut ir = common::tiny_scene();
    for a in ir.assets.iter_mut() {
        if let Asset::Svg(s) = a {
            s.path = path.into();
            if !element_ids.is_empty() {
                s.element_ids = element_ids.iter().map(|s| s.to_string()).collect();
            }
        }
    }
    ir
}

/// Checks that a missing asset file is named.
#[test]
fn a_missing_asset_file_is_named() {
    let err = Renderer::new(
        with_svg_path("visuals/absent.svg", &[]),
        &common::package_dir(),
    )
    .err()
    .expect("refused");
    assert!(
        matches!(&err, RenderError::Asset { id, .. } if id == "orbit"),
        "{err}"
    );
    assert!(err.to_string().contains("visuals/absent.svg"), "{err}");
}

/// Checks that an svg feature the renderer does not draw is refused not dropped.
#[test]
fn an_svg_feature_the_renderer_does_not_draw_is_refused_not_dropped() {
    let err = Renderer::new(
        with_svg_path("visuals/filtered.svg", &[]),
        &common::package_dir(),
    )
    .err()
    .expect("refused");
    assert!(
        matches!(&err, RenderError::Svg { id, .. } if id == "orbit"),
        "{err}"
    );
    assert!(
        err.to_string().contains("filter"),
        "the refusal names the filter: {err}"
    );
}

/// Checks that an element the ir declares but the artwork lacks is refused.
#[test]
fn an_element_the_ir_declares_but_the_artwork_lacks_is_refused() {
    let mut ir = common::tiny_scene();
    for a in ir.assets.iter_mut() {
        if let Asset::Svg(s) = a {
            s.element_ids.push("ghost".into());
        }
    }
    let err = Renderer::new(ir, &common::package_dir())
        .err()
        .expect("refused");
    assert!(err.to_string().contains("\"ghost\""), "{err}");
}

/// Writes a scratch package with one SVG and an IR that places it, and returns its directory.
fn scratch_package(name: &str, svg: &str) -> std::path::PathBuf {
    let dir = common::scratch_dir(name);
    std::fs::create_dir_all(dir.join("visuals")).unwrap();
    std::fs::write(dir.join("visuals/art.svg"), svg).unwrap();
    let ir = r##"{"schema":"aideos.render/1","film":{"id":"scratch","fps":30,"durationFrames":10},
      "scene":{"width":1920,"height":1920},"formats":{"long":{"width":320,"height":180}},"background":"#000000",
      "assets":[{"kind":"svg","id":"art","path":"visuals/art.svg","elementIds":[]}],
      "stage":[{"kind":"svg","id":"art-node","asset":"art","x":960,"y":960,"scale":1,"rotation":0,"layer":0,"tracks":[],"elementTracks":[]}],
      "overlay":[],"audio":[]}"##;
    std::fs::write(dir.join("ir.json"), ir).unwrap();
    dir
}

/// Checks that svg text in a font the ir does not vendor is refused.
#[test]
fn svg_text_in_a_font_the_ir_does_not_vendor_is_refused() {
    let dir = scratch_package(
        "font",
        r#"<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="0" font-family="Comic Sans MS">hi</text></svg>"#,
    );
    let err = Renderer::open(dir.join("ir.json"), None)
        .err()
        .expect("refused");
    assert!(matches!(err, RenderError::Font(_)), "{err}");
    assert!(err.to_string().contains("Comic Sans MS"), "{err}");
}

/// Checks that an asset that escapes the package through a symlink is refused.
#[cfg(unix)]
#[test]
fn an_asset_that_escapes_the_package_through_a_symlink_is_refused() {
    let dir = scratch_package("escape", r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#);
    let outside = common::scratch_dir("outside").join("secret.svg");
    std::fs::write(&outside, r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#).unwrap();
    std::fs::remove_file(dir.join("visuals/art.svg")).unwrap();
    std::os::unix::fs::symlink(&outside, dir.join("visuals/art.svg")).unwrap();
    let err = Renderer::open(dir.join("ir.json"), None)
        .err()
        .expect("refused");
    assert!(err.to_string().contains("outside the package"), "{err}");
}

/// Checks that a scratch package renders from the ir files directory.
#[test]
fn a_scratch_package_renders_from_the_ir_files_directory() {
    let dir = scratch_package(
        "plain",
        r##"<svg xmlns="http://www.w3.org/2000/svg"><rect x="-100" y="-100" width="200" height="200" fill="#FF0000"/></svg>"##,
    );
    let frame = Renderer::open(dir.join("ir.json"), None)
        .expect("loads")
        .render_frame(Format::Long, 0)
        .expect("renders");
    // 320 x 180 shows the scene at fit 1/6: the 200 unit square spans about 33 px round the centre.
    assert_eq!(pixel(&frame, 160, 90), [0xFF, 0, 0, 0xFF]);
    assert_eq!(pixel(&frame, 10, 10), [0, 0, 0, 0xFF]);
}
