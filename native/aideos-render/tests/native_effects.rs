//! File Description: Native rendering and validation checks for SkSL transitions and seeded particles.
//! Inputs and outputs: committed effects IR and reviewed PNGs -> pixels, seek and schema assertions.
//! Used by: cargo test -p aideos-render --test native_effects.

mod common;
use aideos_render::{Format, RenderedFrame, Renderer};
use skia_safe::{AlphaType, ColorType, Data, Image, ImageInfo};

/// Loads a fixture through the same loader and renderer as the CLI.
fn renderer(name: &str) -> Renderer {
    Renderer::open(
        common::package_dir().join(format!("native-{name}.json")),
        None,
    )
    .expect("valid effects document")
}

/// Checks every channel against a reviewed, lossless native frame.
fn golden(frame: &RenderedFrame, bytes: &[u8]) {
    let image = Image::from_encoded(Data::new_copy(bytes)).expect("golden PNG");
    assert_eq!(
        (frame.width, frame.height),
        (image.width() as u32, image.height() as u32)
    );
    let info = ImageInfo::new(
        (image.width(), image.height()),
        ColorType::RGBA8888,
        AlphaType::Unpremul,
        None,
    );
    let mut pixels = vec![0; frame.rgba.len()];
    assert!(image.read_pixels(
        &info,
        &mut pixels,
        frame.width as usize * 4,
        (0, 0),
        skia_safe::image::CachingHint::Allow
    ));
    assert_eq!(frame.rgba, pixels, "native effect pixels changed");
}

/// Checks both shader transitions and the particle scene against reviewed frames and known colours.
#[test]
fn effects_match_reviewed_frames() {
    let fade = renderer("fade").render_frame(Format::Long, 30).unwrap();
    let wipe = renderer("wipe").render_frame(Format::Long, 30).unwrap();
    let particles = renderer("particles")
        .render_frame(Format::Long, 30)
        .unwrap();
    golden(&fade, include_bytes!("../fixtures/effects/native/fade.png"));
    golden(&wipe, include_bytes!("../fixtures/effects/native/wipe.png"));
    golden(
        &particles,
        include_bytes!("../fixtures/effects/native/particles.png"),
    );
    assert_eq!(common::pixel(&wipe, 20, 90), [20, 52, 84, 255]);
    assert_eq!(common::pixel(&wipe, 300, 90), [236, 161, 66, 255]);
    assert_ne!(common::pixel(&fade, 20, 90), common::pixel(&wipe, 20, 90));
    assert_ne!(
        particles.rgba,
        renderer("particles")
            .render_frame(Format::Long, 0)
            .unwrap()
            .rgba
    );
}

/// Tests order-independent seeks over several seeds and detects seed changes in the actual raster.
#[test]
fn seeded_particles_are_seek_deterministic_and_seeded() {
    let original = renderer("particles");
    let mut last = None;
    for seed in 0..12 {
        let mut ir = original.ir().clone();
        ir.particles.as_mut().unwrap()[0].seed.0 = seed;
        let r = Renderer::new(ir, &common::package_dir()).unwrap();
        let first = r.render_frame(Format::Long, 30).unwrap();
        r.render_frame(Format::Long, 70).unwrap();
        assert_eq!(
            first,
            r.render_frame(Format::Long, 30).unwrap(),
            "seed {seed} changed after seeking"
        );
        if let Some(previous) = last {
            assert_ne!(first.rgba, previous, "seed {seed} did not affect pixels");
        }
        last = Some(first.rgba);
    }
}

/// Checks the Rust loader shares the bounds and version gate exercised by the TypeScript loader.
#[test]
fn loader_refuses_old_version_and_bad_effect_parameters() {
    let path = common::package_dir().join("native-particles.json");
    let doc: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    for (pointer, value) in [
        ("/schema", serde_json::json!("aideos.render/4")),
        ("/particles/0/count", serde_json::json!(1001)),
        ("/particles/0/lifetimeFrames", serde_json::json!(0)),
        ("/particles/0/seed", serde_json::json!(-1)),
    ] {
        let mut bad = doc.clone();
        *bad.pointer_mut(pointer).unwrap() = value;
        assert!(
            aideos_render_ir::load_from_str(&bad.to_string()).is_err(),
            "accepted {pointer}"
        );
    }
}

/// Confirms a newer document without effects has identical pixels to its /4 source.
#[test]
fn absent_effects_preserve_old_pixels() {
    let mut old = renderer("fade").ir().clone();
    old.transition = None;
    old.schema = aideos_render_ir::VERSION_4.into();
    let mut new = old.clone();
    new.schema = aideos_render_ir::VERSION_EFFECTS.into();
    let old = Renderer::new(
        aideos_render_ir::load_from_str(&serde_json::to_string(&old).unwrap()).unwrap(),
        &common::package_dir(),
    )
    .unwrap();
    let new = Renderer::new(
        aideos_render_ir::load_from_str(&serde_json::to_string(&new).unwrap()).unwrap(),
        &common::package_dir(),
    )
    .unwrap();
    for frame in [0, 30, 89] {
        assert_eq!(
            old.render_frame(Format::Long, frame).unwrap(),
            new.render_frame(Format::Long, frame).unwrap()
        );
    }
}

/// Checks reveal and cover endpoints, and that transition paint stays below overlay content.
#[test]
fn transitions_reveal_cover_and_preserve_overlay() {
    use aideos_render_ir::types::{Node, TransitionDirection};
    let base = renderer("wipe");
    let mut ir = base.ir().clone();
    let rect: Node = serde_json::from_value(serde_json::json!({
        "kind":"rect", "id":"overlay", "fill":"#FFFFFF", "radius":0, "tracks":[],
        "placement":{"long":{"x":10,"y":10,"w":20,"h":20}}
    }))
    .unwrap();
    ir.overlay.push(rect);
    let incoming = Renderer::new(ir.clone(), &common::package_dir()).unwrap();
    let first = incoming.render_frame(Format::Long, 0).unwrap();
    let last = incoming.render_frame(Format::Long, 60).unwrap();
    let midpoint_in = incoming.render_frame(Format::Long, 30).unwrap();
    assert_eq!(common::pixel(&midpoint_in, 40, 90), [20, 52, 84, 255]);
    assert_eq!(common::pixel(&midpoint_in, 280, 90), [236, 161, 66, 255]);
    assert_eq!(common::pixel(&first, 0, 0), [236, 161, 66, 255]);
    assert_eq!(common::pixel(&first, 300, 90), [236, 161, 66, 255]);
    assert_eq!(common::pixel(&last, 300, 90), [20, 52, 84, 255]);
    assert_eq!(common::pixel(&first, 15, 15), [255, 255, 255, 255]);
    ir.transition.as_mut().unwrap().direction = TransitionDirection::Out;
    let outgoing = Renderer::new(ir, &common::package_dir()).unwrap();
    let midpoint_out = outgoing.render_frame(Format::Long, 30).unwrap();
    assert_eq!(common::pixel(&midpoint_out, 40, 90), [236, 161, 66, 255]);
    assert_eq!(common::pixel(&midpoint_out, 280, 90), [20, 52, 84, 255]);
    assert_eq!(
        common::pixel(&outgoing.render_frame(Format::Long, 0).unwrap(), 300, 90),
        [20, 52, 84, 255]
    );
    assert_eq!(
        common::pixel(&outgoing.render_frame(Format::Long, 60).unwrap(), 300, 90),
        [236, 161, 66, 255]
    );
}

/// Checks fractional shutter samples move particles and remain stable under seeking.
#[test]
fn shutter_samples_particle_motion() {
    let base = renderer("particles");
    let sharp = base.render_frame(Format::Long, 30).unwrap();
    let mut ir = base.ir().clone();
    ir.shutter =
        Some(serde_json::from_value(serde_json::json!({ "samples": 8, "angle": 360 })).unwrap());
    let blurred = Renderer::new(ir, &common::package_dir()).unwrap();
    let frame = blurred.render_frame(Format::Long, 30).unwrap();
    assert_ne!(
        sharp.rgba, frame.rgba,
        "shutter must sample particle motion"
    );
    blurred.render_frame(Format::Long, 40).unwrap();
    assert_eq!(frame, blurred.render_frame(Format::Long, 30).unwrap());
}

/// Loads a document combining /5 colour tracks and /6 particles through the native loader.
#[test]
fn colour_tracks_and_particles_share_one_document() {
    let prior = std::fs::read_to_string(
        common::package_dir().join("../../../aideos-render-ir/fixtures/valid/color-and-dash.json"),
    )
    .unwrap();
    let mut document: serde_json::Value = serde_json::from_str(&prior).unwrap();
    let particles: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(common::package_dir().join("native-particles.json")).unwrap(),
    )
    .unwrap();
    document["schema"] = serde_json::json!(aideos_render_ir::VERSION_EFFECTS);
    document["particles"] = particles["particles"].clone();
    let ir =
        aideos_render_ir::load_from_str(&document.to_string()).expect("combined /6 document loads");
    assert_eq!(ir.particles.unwrap().len(), 1);
    let aideos_render_ir::types::Node::Svg(svg) = &ir.stage[0] else {
        panic!("svg stage")
    };
    assert_eq!(svg.color_tracks.as_ref().unwrap().len(), 2);
}
