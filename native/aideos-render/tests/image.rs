//! File Description: Behavioural tests of the image node (`aideos.render/3`), encoding the captain's decision for the illustrated stage, phase 1 (option A of the mixed-media research), item 3: the design pins each approved picture by sha256 so a render is as repeatable as an SVG render. The renderer loads the picture fixture film from its committed golden package, refuses a picture whose bytes are not the pinned ones or whose size is not the declared one, and draws the accepted picture with its alpha over the plate.
//! Inputs and outputs: fixtures/golden/pictures-stage (render.long.json, pictures/*.png, visuals/label.svg) and the vendored fonts, copied into a scratch package per case -> load verdicts and pixels.
//! Used by: cargo test (the CI unit job's cargo step).

mod common;

use std::path::{Path, PathBuf};

use aideos_render::{Format, RenderError, Renderer};
use aideos_render_ir::types::Asset;

/// The committed golden package of the picture fixture film.
fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/golden/pictures-stage")
}

/// Copies every regular file of `from` into `to`.
fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("create the directory");
    for entry in std::fs::read_dir(from).expect("read the directory") {
        let entry = entry.expect("directory entry");
        if entry.file_type().expect("file type").is_file() {
            std::fs::copy(entry.path(), to.join(entry.file_name())).expect("copy a file");
        }
    }
}

/// Stages the fixture's wide-cut package (pictures, artwork and fonts) in a scratch directory; returns it with the IR path.
fn staged(name: &str) -> (PathBuf, PathBuf) {
    let package = common::scratch_dir(name);
    copy_dir(&fixture().join("pictures"), &package.join("pictures"));
    copy_dir(&fixture().join("visuals"), &package.join("visuals"));
    let fonts = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fonts");
    std::fs::create_dir_all(package.join("fonts")).expect("fonts directory");
    for font in ["Geist-latin.ttf", "JetBrainsMono-latin.ttf"] {
        std::fs::copy(fonts.join(font), package.join("fonts").join(font)).expect("copy a vendored font");
    }
    let ir = package.join("render.json");
    std::fs::copy(fixture().join("render.long.json"), &ir).expect("copy the IR");
    (package, ir)
}

/// The package path of the image asset named `id` in the staged IR.
fn image_path(ir: &Path, id: &str) -> String {
    let doc = aideos_render_ir::load_from_path(ir).expect("the fixture IR loads");
    doc.assets
        .iter()
        .find_map(|a| match a {
            Asset::Image(i) if i.id == id => Some(i.path.clone()),
            _ => None,
        })
        .expect("the fixture declares the image")
}

/// The fixture renders: the orb, drawn with its alpha over the plate, keeps the plate's colour around it.
#[test]
fn an_accepted_picture_is_drawn_with_its_alpha_over_the_plate() {
    let (package, ir) = staged("image-accepted");
    let renderer = Renderer::open(&ir, Some(&package)).expect("the pinned pictures load");
    assert_eq!(renderer.ir().schema, "aideos.render/3");
    let frame = renderer.render_frame(Format::Long, 225).expect("a frame renders");
    let plate_corner = common::pixel(&frame, 40, 40);
    // The orb's centre is accent violet: blue well above red and green.
    let orb = (0..frame.width)
        .flat_map(|x| (0..frame.height / 2).map(move |y| (x, y)))
        .map(|(x, y)| common::pixel(&frame, x, y))
        .find(|p| p[2] > 200 && p[0] < 150 && p[1] < 150);
    assert!(orb.is_some(), "the orb picture is drawn");
    assert!(plate_corner[2] > plate_corner[0], "the plate keeps its cool tone where nothing covers it: {plate_corner:?}");
}

/// A picture whose bytes are not the pinned ones is refused at load, naming both hashes.
#[test]
fn a_picture_that_is_not_the_pinned_file_is_refused_at_load() {
    let (package, ir) = staged("image-unpinned-bytes");
    let path = package.join(image_path(&ir, "img-orb"));
    let mut bytes = std::fs::read(&path).expect("read the picture");
    let last = bytes.len() - 1;
    bytes[last] ^= 0xff;
    std::fs::write(&path, bytes).expect("write the changed picture");
    let err = Renderer::open(&ir, Some(&package)).err().expect("a changed picture is refused");
    assert!(matches!(err, RenderError::Asset { .. }), "{err}");
    assert!(err.to_string().contains("not the pinned"), "{err}");
}

/// A picture whose size is not the declared one is refused at load (its pin is moved along so only the size differs).
#[test]
fn a_picture_of_another_size_is_refused_at_load() {
    let (package, ir) = staged("image-wrong-size");
    let text = std::fs::read_to_string(&ir).expect("read the IR");
    let wrong = text.replacen("\"width\":32,\"height\":32", "\"width\":33,\"height\":32", 1);
    assert_ne!(wrong, text, "the fixture declares the 32 x 32 orb");
    std::fs::write(&ir, wrong).expect("write the IR");
    let err = Renderer::open(&ir, Some(&package)).err().expect("a picture of another size is refused");
    assert!(err.to_string().contains("33 x 32"), "{err}");
}
