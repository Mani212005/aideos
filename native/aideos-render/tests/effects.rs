//! File Description: End-to-end checks of shaped-glyph tracks and the opt-in 2D shutter through the native loader and raster.
//! Inputs and outputs: committed effects IR, fonts and reviewed PNGs -> deterministic pixels and validation results.
//! Used by: cargo test -p aideos-render --test effects.

mod common;

use aideos_render::{Format, RenderedFrame, Renderer};
use aideos_render_ir::types::{GlyphProperty, GlyphTrack, Keyframe, Node, Whole};
use skia_safe::{AlphaType, ColorType, Data, Image, ImageInfo};
use std::time::Instant;

/// Loads the kinetic-type fixture through the public IR loader and renderer.
fn fixture() -> aideos_render_ir::RenderIr {
    aideos_render_ir::load_from_path(common::package_dir().join("kinetic-type.json")).expect("effects IR loads")
}

/// Opens the fixture's assets for a supplied validated IR.
fn renderer(ir: aideos_render_ir::RenderIr) -> Renderer {
    Renderer::new(ir, &common::package_dir()).expect("effects package loads")
}

/// Compares a full frame with a reviewed PNG at the native golden suite's strict tolerances.
fn assert_golden(actual: &RenderedFrame, png: &[u8]) {
    let image = Image::from_encoded(Data::new_copy(png)).expect("golden decodes");
    assert_eq!((actual.width, actual.height), (image.width() as u32, image.height() as u32));
    let info = ImageInfo::new((image.width(), image.height()), ColorType::RGBA8888, AlphaType::Unpremul, None);
    let mut expected = vec![0u8; actual.rgba.len()];
    assert!(image.read_pixels(&info, &mut expected, actual.width as usize * 4, (0, 0), skia_safe::image::CachingHint::Allow));
    let mut total = 0u64;
    let mut changed = 0usize;
    for (a, b) in actual.rgba.chunks_exact(4).zip(expected.chunks_exact(4)) {
        let mut max = 0u8;
        for c in 0..3 { let d = a[c].abs_diff(b[c]); total += u64::from(d); max = max.max(d); }
        if max > 8 { changed += 1; }
    }
    let pixels = (actual.width * actual.height) as usize;
    assert!(total as f64 / (pixels * 3) as f64 <= 0.05, "golden mean difference");
    assert!(changed as f64 / pixels as f64 <= 0.001, "golden changed-pixel share");
}

/// Compares all pixels in a rectangular region, including alpha.
fn region_equal(a: &RenderedFrame, b: &RenderedFrame, left: u32, top: u32, right: u32, bottom: u32) -> bool {
    (top..bottom).all(|y| (left..right).all(|x| common::pixel(a, x, y) == common::pixel(b, x, y)))
}

/// Verifies that glyph motion and shutter blur change only the intended glyph, with chrome held sharp.
#[test]
fn glyph_and_shutter_match_reviewed_frames_and_preserve_chrome() {
    let ir = fixture();
    let blurred = renderer(ir.clone()).render_frame(Format::Long, 10).expect("blurred frame");
    let mut sharp_ir = ir.clone();
    sharp_ir.shutter = None;
    let sharp = renderer(sharp_ir.clone()).render_frame(Format::Long, 10).expect("sharp frame");
    assert_golden(&sharp, include_bytes!("../fixtures/effects/glyph-long-10.png"));
    assert_golden(&blurred, include_bytes!("../fixtures/effects/shutter-long-10.png"));
    assert!(!region_equal(&sharp, &blurred, 400, 350, 610, 560), "moving A must blur");
    assert!(region_equal(&sharp, &blurred, 640, 350, 800, 560), "stationary B must stay sharp");
    assert!(region_equal(&sharp, &blurred, 0, 800, 1920, 1000), "caption must stay sharp");
    let Node::Text(text) = &mut sharp_ir.overlay[0] else { panic!("text fixture") };
    text.glyph_tracks = None;
    let untracked = renderer(sharp_ir).render_frame(Format::Long, 10).expect("untracked frame");
    assert!(!region_equal(&sharp, &untracked, 400, 350, 640, 560), "the tracked glyph must move");
    assert!(region_equal(&sharp, &untracked, 640, 350, 800, 560), "the other glyph must stay fixed");
}

/// Ensures seeking and a missing shaped-glyph index are handled by the real renderer.
#[test]
fn shutter_is_seek_deterministic_and_unknown_glyph_is_refused() {
    let r = renderer(fixture());
    let first = r.render_frame(Format::Reel, 10).expect("first");
    r.render_frame(Format::Reel, 20).expect("other frame");
    assert_eq!(first, r.render_frame(Format::Reel, 10).expect("seek back"));
    let mut bad = fixture();
    let Node::Text(text) = &mut bad.overlay[0] else { panic!("text fixture") };
    text.glyph_tracks.as_mut().unwrap()[0].glyph.0 = 999;
    let err = match Renderer::new(bad, &common::package_dir()) { Err(err) => err, Ok(_) => panic!("missing glyph accepted") };
    assert!(err.to_string().contains("glyph 999"), "{err}");
}

/// Ensures an effects-version document without effects leaves existing frame pixels unchanged.
#[test]
fn effects_version_without_fields_matches_existing_frames() {
    let original = common::tiny_scene();
    let mut newer = original.clone();
    newer.schema = "aideos.render/4".into();
    let newer_json = serde_json::to_string(&newer).expect("serialize /4");
    let newer = aideos_render_ir::load_from_str(&newer_json).expect("/4 without effects loads");
    let old = renderer(original);
    let new = renderer(newer);
    for format in [Format::Long, Format::Reel] {
        for frame in [0, 43, 89] {
            assert_eq!(old.render_frame(format, frame).unwrap(), new.render_frame(format, frame).unwrap());
        }
    }
}

/// Measures the real 1080p shutter loop and checks all delivered frames are distinct.
#[test]
fn measures_eight_sample_1080p_frame_loop() {
    let r = renderer(fixture());
    r.render_frame(Format::Long, 9).expect("warm up");
    let start = Instant::now();
    let mut previous = Vec::new();
    for frame in 4..28 {
        let current = r.render_frame(Format::Long, frame).expect("frame").rgba;
        if !previous.is_empty() { assert_ne!(previous, current, "motion must advance"); }
        previous = current;
    }
    eprintln!("8-sample 1080p single-worker frame loop: {:.3} fps", 24.0 / start.elapsed().as_secs_f64());
}

/// Exercises each glyph property against real shaped text while the neighbouring glyph stays fixed.
#[test]
fn glyph_properties_change_only_the_selected_glyph() {
    let mut base_ir = fixture();
    base_ir.shutter = None;
    let Node::Text(text) = &mut base_ir.overlay[0] else { panic!("text fixture") };
    text.glyph_tracks = None;
    let base = renderer(base_ir.clone()).render_frame(Format::Long, 10).unwrap();
    for (property, value) in [(GlyphProperty::X, -50.0), (GlyphProperty::Y, 60.0),
        (GlyphProperty::Scale, 0.5), (GlyphProperty::Rotation, 20.0), (GlyphProperty::Opacity, 0.0)] {
        let mut ir = base_ir.clone();
        let Node::Text(text) = &mut ir.overlay[0] else { panic!("text fixture") };
        text.glyph_tracks = Some(vec![GlyphTrack { glyph: Whole(0), property,
            keyframes: vec![Keyframe { frame: Whole(0), value, ease: None }] }]);
        let result = renderer(ir).render_frame(Format::Long, 10).unwrap();
        assert!(!region_equal(&base, &result, 400, 300, 640, 700), "{property:?} must affect glyph A");
        assert!(region_equal(&base, &result, 640, 350, 800, 560), "{property:?} must not affect glyph B");
        if property == GlyphProperty::Opacity {
            let background = common::pixel(&result, 0, 0);
            assert!((300..700).all(|y| (400..640).all(|x| common::pixel(&result, x, y) == background)), "opacity zero hides A");
        }
    }
}

/// Checks the shutter samples ordinary 2D node motion, not just the per-glyph path.
#[test]
fn shutter_samples_fractional_2d_node_motion() {
    let mut ir = fixture();
    ir.overlay[0] = serde_json::from_value(serde_json::json!({
        "kind": "rect", "id": "moving-rect", "fill": "#FFFFFF", "radius": 0,
        "tracks": [{ "property": "x", "keyframes": [
            { "frame": 0, "value": -150, "ease": "linear" }, { "frame": 30, "value": 150 }
        ] }],
        "placement": {
            "long": { "x": 500, "y": 350, "w": 100, "h": 100 },
            "reel": { "x": 200, "y": 500, "w": 100, "h": 100 }
        }
    })).expect("rect node");
    let blurred = renderer(ir.clone()).render_frame(Format::Long, 10).unwrap();
    ir.shutter = None;
    let sharp = renderer(ir).render_frame(Format::Long, 10).unwrap();
    assert_eq!(common::pixel(&sharp, 447, 400), common::pixel(&sharp, 0, 0), "sharp rect has not reached this pixel");
    assert_ne!(common::pixel(&blurred, 447, 400), common::pixel(&sharp, 447, 400), "fractional samples must reach beyond the sharp edge");
}

/// Rejects invalid shutter settings even when a caller constructed the IR without the loader.
#[test]
fn malformed_hand_built_shutter_is_refused() {
    let mut ir = fixture();
    ir.shutter.as_mut().unwrap().samples = Whole(0);
    let error = renderer(ir).render_frame(Format::Long, 10).expect_err("zero samples must fail");
    assert!(error.to_string().contains("2 to 16 samples"), "{error}");
}
