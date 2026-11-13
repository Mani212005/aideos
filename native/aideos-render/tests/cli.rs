//! File Description: Behavioural tests of the `aideos-render` command line: it writes a PNG of the requested frame and format, reports a refused document or frame with exit code 1 and the reason, and a usage mistake with exit code 2.
//! Inputs and outputs: command lines run against the fixture package -> asserted exit codes, messages and PNG files.
//! Used by: `cargo test --manifest-path native/Cargo.toml`.

mod common;

use std::process::{Command, Output};

/// Runs the CLI with arguments.
fn run(args: &[&std::ffi::OsStr]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_aideos-render"))
        .args(args)
        .output()
        .expect("run aideos-render")
}

/// Checks that it writes the requested frame as a png.
#[test]
fn it_writes_the_requested_frame_as_a_png() {
    let out = common::scratch_dir("cli").join("reel.png");
    let ir = common::tiny_scene_path();
    let o = run(&[
        ir.as_os_str(),
        "--frame".as_ref(),
        "85".as_ref(),
        "--format".as_ref(),
        "reel".as_ref(),
        "--out".as_ref(),
        out.as_os_str(),
    ]);
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    assert_eq!(
        common::png_size(&std::fs::read(&out).expect("the PNG exists")),
        (1080, 1920)
    );
    let stdout = String::from_utf8_lossy(&o.stdout);
    assert!(
        stdout.contains("1080x1920, reel, frame 85, cpu"),
        "{stdout}"
    );
}

/// Checks that a refused frame exits 1 with the reason.
#[test]
fn a_refused_frame_exits_1_with_the_reason() {
    let out = common::scratch_dir("cli").join("x.png");
    let ir = common::tiny_scene_path();
    let o = run(&[
        ir.as_os_str(),
        "--frame".as_ref(),
        "500".as_ref(),
        "--out".as_ref(),
        out.as_os_str(),
    ]);
    assert_eq!(o.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&o.stderr).contains("frame 500 is outside the film"));
    assert!(!out.exists(), "no PNG is written for a refused frame");
}

/// Checks that an unsupported render ir version exits 1.
#[test]
fn an_unsupported_render_ir_version_exits_1() {
    let dir = common::scratch_dir("cli");
    let ir = dir.join("future.json");
    std::fs::write(&ir, r#"{"schema":"aideos.render/2"}"#).unwrap();
    let out = dir.join("x.png");
    let o = run(&[
        ir.as_os_str(),
        "--frame".as_ref(),
        "0".as_ref(),
        "--out".as_ref(),
        out.as_os_str(),
    ]);
    assert_eq!(o.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&o.stderr)
        .contains("unsupported Render IR version \"aideos.render/2\""));
}

/// Checks that a usage mistake exits 2.
#[test]
fn a_usage_mistake_exits_2() {
    let ir = common::tiny_scene_path();
    let missing_frame = run(&[ir.as_os_str(), "--out".as_ref(), "x.png".as_ref()]);
    assert_eq!(missing_frame.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&missing_frame.stderr).contains("missing --frame"));
    let bad_format = run(&[
        ir.as_os_str(),
        "--frame".as_ref(),
        "0".as_ref(),
        "--format".as_ref(),
        "square".as_ref(),
        "--out".as_ref(),
        "x.png".as_ref(),
    ]);
    assert_eq!(bad_format.status.code(), Some(2));
}
