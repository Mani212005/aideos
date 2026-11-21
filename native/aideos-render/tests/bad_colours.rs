//! File Description: Pins that the Render IR loader refuses a malformed colour in every colour-bearing field of the fixture film, naming the JSON pointer and the bad value, so the renderer never meets a colour it cannot read.
//! Inputs and outputs: fixtures/package/tiny-scene.json with one colour field replaced at a time -> a `LoadError::Invalid` issue per bad colour (pointing at the field, or at the node that holds it when the schema reports a oneOf mismatch).
//! Used by: cargo test (the CI unit job's cargo step).

mod common;

use aideos_render_ir::{load_from_str, LoadError};
use serde_json::Value;

/// The fixture document as JSON.
fn fixture_json() -> Value {
    let text = std::fs::read_to_string(common::tiny_scene_path()).expect("the fixture IR is readable");
    serde_json::from_str(&text).expect("the fixture IR is JSON")
}

/// Replaces the string at `pointer` with `bad`, loads the result and returns the issues the loader gave.
fn issues_for(pointer: &str, bad: &str) -> Vec<aideos_render_ir::Issue> {
    let mut doc = fixture_json();
    *doc.pointer_mut(pointer).unwrap_or_else(|| panic!("{pointer} is in the fixture")) = Value::String(bad.to_string());
    match load_from_str(&doc.to_string()) {
        Err(LoadError::Invalid(issues)) => issues,
        Err(other) => panic!("{pointer}={bad}: expected LoadError::Invalid, got {other}"),
        Ok(_) => panic!("{pointer}={bad}: the loader accepted a bad colour"),
    }
}

#[test]
fn the_loader_refuses_a_bad_colour_in_every_colour_field() {
    let fields = [
        "/background",
        "/overlay/0/children/0/fill",
        "/overlay/0/children/0/stroke/color",
        "/overlay/0/children/1/color",
        "/overlay/1/ink",
        "/overlay/1/labelColor",
        "/overlay/1/accent",
        "/overlay/1/trackColor",
        "/overlay/1/scrim",
    ];
    for pointer in fields {
        for bad in ["red", "#12345"] {
            let issues = issues_for(pointer, bad);
            assert!(
                issues.iter().any(|i| pointer.starts_with(i.path.as_str()) && i.message.contains(&format!("\"{bad}\""))),
                "{pointer}={bad}: no issue points at the field or its node and names the value, got {issues:?}"
            );
        }
    }
}
