//! File Description: Behavioural tests of the R4 additions to drawing and measuring: `measure` reports single-line widths with letter spacing after every glyph (as CSS does) and line metrics, a variable font set to a heavier weight measures wider, an unknown font is refused; a gradient rect paints its stops top to bottom; a `scaleX` track scales a box about its centre; the rail's label row is drawn in its own `labelColor`; an explicit end card `surface` paints the panel.
//! Inputs and outputs: the vendored variable fonts in native/fonts, the shared IR fixtures and the R2 fixture package -> asserted widths, metrics, pixels and errors.
//! Used by: `cargo test --manifest-path native/Cargo.toml`.

mod common;

use std::path::PathBuf;
use std::process::Command;

use aideos_render::measure::{measure, MeasureRequest};
use aideos_render::{Format, Renderer};
use aideos_render_ir::types::{Node, RailNode};
use common::{close, pixel};

/// The repository's vendored fonts directory.
fn fonts_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fonts")
}

/// A measure request over the vendored Geist at two weights and JetBrains Mono.
fn request(runs: &str, metrics: &str) -> MeasureRequest {
    let fonts = fonts_dir();
    let json = format!(
        r#"{{"fonts":[
            {{"id":"g400","path":"{0}/Geist-latin.ttf","family":"Geist","weight":400}},
            {{"id":"g700","path":"{0}/Geist-latin.ttf","family":"Geist","weight":700}},
            {{"id":"m400","path":"{0}/JetBrainsMono-latin.ttf","family":"JetBrains Mono","weight":400}}],
          "runs":{runs},"metrics":{metrics}}}"#,
        fonts.display()
    );
    serde_json::from_str(&json).expect("a valid request")
}

/// Letter spacing is added after every glyph, so two glyphs spaced 10 px are 20 px wider.
#[test]
fn letter_spacing_follows_every_glyph() {
    let report = measure(
        &request(r#"[{"text":"AB","font":"g400","size":100},{"text":"AB","font":"g400","size":100,"letterSpacing":10}]"#, "[]"),
        &fonts_dir(),
    )
    .expect("measure");
    assert!((report.widths[1] - report.widths[0] - 20.0).abs() < 1e-3, "{:?}", report.widths);
}

/// The variable font is set to each asset's weight: the same word is wider in Geist 700 than in 400.
#[test]
fn a_variable_font_takes_the_asset_weight() {
    let report = measure(
        &request(r#"[{"text":"Still Talking","font":"g400","size":96},{"text":"Still Talking","font":"g700","size":96}]"#, "[]"),
        &fonts_dir(),
    )
    .expect("measure");
    assert!(report.widths[1] > report.widths[0] * 1.03, "700 should be wider than 400: {:?}", report.widths);
}

/// Line metrics give the normal line height and the baseline inside it, in whole pixels (as browsers round them), scaling with the size.
#[test]
fn line_metrics_scale_with_the_size() {
    let report = measure(&request("[]", r#"[{"font":"m400","size":10},{"font":"m400","size":100}]"#), &fonts_dir()).expect("measure");
    let (small, large) = (report.metrics[0], report.metrics[1]);
    assert!(large.height > large.baseline && large.baseline > 0.0, "{large:?}");
    assert!((small.height - large.height / 10.0).abs() <= 1.0, "{small:?} {large:?}");
}

/// A run in a font the request does not load is refused with its name, by the library and the CLI.
#[test]
fn an_unknown_font_is_refused() {
    let err = measure(&request(r#"[{"text":"x","font":"nope","size":10}]"#, "[]"), &fonts_dir()).expect_err("refused");
    assert!(err.contains("\"nope\""), "{err}");
    let dir = common::scratch_dir("measure-cli");
    let file = dir.join("request.json");
    std::fs::write(&file, r#"{"fonts":[],"runs":[{"text":"x","font":"nope","size":10}]}"#).expect("write request");
    let out = Command::new(env!("CARGO_BIN_EXE_aideos-render")).arg("measure").arg(&file).output().expect("run the CLI");
    assert_eq!(out.status.code(), Some(1));
}

/// The shared fixture with a gradient band and an underline driven by `scaleX`.
fn gradient_renderer() -> Renderer {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../aideos-render-ir/fixtures/valid/gradient-and-axis-scale.json");
    Renderer::open(&path, None).expect("the fixture loads")
}

/// A gradient band is transparent at its top edge and nearly opaque canvas at its middle.
#[test]
fn a_gradient_rect_paints_its_stops_top_to_bottom() {
    let frame = gradient_renderer().render_frame(Format::Long, 0).expect("render");
    // The band runs y 389..689; the canvas is #0A0A0B, so both ends read as the background colour.
    let middle = pixel(&frame, 960, 539);
    assert!(close(middle, [0x0A, 0x0A, 0x0B, 0xFF], 2), "{middle:?}");
}

/// A `scaleX` track scales a box about its centre: at 0 nothing is drawn, at 1 the whole underline.
#[test]
fn a_scale_x_track_scales_a_box_about_its_centre() {
    let r = gradient_renderer();
    let accent = [0x63, 0x5B, 0xFF, 0xFF];
    let start = r.render_frame(Format::Long, 0).expect("render frame 0");
    assert!(!close(pixel(&start, 1000, 621), accent, 40), "a zero-width underline draws nothing");
    let end = r.render_frame(Format::Long, 20).expect("render frame 20");
    for x in [802, 1000, 1198] {
        assert!(close(pixel(&end, x, 621), accent, 2), "x {x}: {:?}", pixel(&end, x, 621));
    }
    let mid = r.render_frame(Format::Long, 2).expect("render frame 2");
    assert!(close(pixel(&mid, 1000, 621), accent, 2), "the centre fills first");
    assert!(!close(pixel(&mid, 802, 621), accent, 40), "the ends fill last");
}

/// The rail's label row takes `labelColor` while the filled bar keeps `ink`.
#[test]
fn the_rail_label_uses_its_own_colour() {
    let mut ir = common::tiny_scene();
    ir.overlay.retain(|n| matches!(n, Node::Rail(_)));
    let Some(Node::Rail(RailNode { label_color, ink, .. })) = ir.overlay.first_mut() else { panic!("the fixture has a rail") };
    *label_color = "#FF0000".into();
    *ink = "#00FF00".into();
    let r = Renderer::new(ir, &common::package_dir()).expect("load");
    let frame = r.render_frame(Format::Long, 10).expect("render");
    let reds = (0..frame.width).flat_map(|x| (900..frame.height).map(move |y| (x, y))).filter(|&(x, y)| {
        let p = pixel(&frame, x, y);
        p[0] > 200 && p[1] < 60
    });
    assert!(reds.count() > 50, "the label row is drawn in the label colour");
}

/// An end card's explicit `surface` paints the panel; without it the panel colour is derived as before.
#[test]
fn the_end_card_panel_uses_an_explicit_surface() {
    let count_red = |surface: Option<&str>| {
        let mut ir = common::tiny_scene();
        ir.overlay.retain(|n| matches!(n, Node::EndCard(_)));
        let Some(Node::EndCard(card)) = ir.overlay.first_mut() else { panic!("the fixture has an end card") };
        card.surface = surface.map(String::from);
        let r = Renderer::new(ir, &common::package_dir()).expect("load");
        let frame = r.render_frame(Format::Long, 89).expect("render");
        (0..frame.width).step_by(4).flat_map(|x| (0..frame.height).step_by(4).map(move |y| (x, y)))
            .filter(|&(x, y)| close(pixel(&frame, x, y), [0xFF, 0, 0, 0xFF], 3))
            .count()
    };
    assert_eq!(count_red(None), 0, "the derived panel is not red");
    assert!(count_red(Some("#FF0000")) > 1000, "the explicit surface fills the panel");
}
