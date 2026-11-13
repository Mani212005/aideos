//! File Description: Runs the Rust loader over the same fixture files and expectations as backend/renderIr/renderIr.test.ts, so the two implementations are held to one set of verdicts, plus the round trip of the golden example and the file-level error path.
//! Inputs and outputs: native/aideos-render-ir/fixtures/** -> pass or fail.
//! Used by: cargo test in native/ (the native CI job and docs/RENDER_IR.md).

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use aideos_render_ir::{load_from_path, load_from_str, LoadError, RenderIr};
use serde_json::Value;

/// The shared fixture directory.
fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

/// Reads one fixture's text.
fn read(rel: &str) -> String {
    fs::read_to_string(fixtures().join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

/// Parses the shared expectations file.
fn expectations() -> Value {
    serde_json::from_str(&read("expectations.json")).expect("expectations.json is JSON")
}

/// Lists the fixture files of one folder as `folder/name.json`, sorted.
fn listing(folder: &str) -> BTreeSet<String> {
    fs::read_dir(fixtures().join(folder))
        .expect("fixture folder exists")
        .map(|e| format!("{folder}/{}", e.unwrap().file_name().to_string_lossy()))
        .collect()
}

/// Rewrites every JSON number as an f64 so `1` and `1.0` compare equal.
fn normalize(v: Value) -> Value {
    match v {
        Value::Number(n) => Value::from(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.into_iter().map(normalize).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, normalize(v))).collect()),
        other => other,
    }
}

#[test]
fn every_fixture_file_is_listed_in_the_expectations() {
    let exp = expectations();
    let valid: BTreeSet<String> = exp["valid"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
    let invalid: BTreeSet<String> = exp["invalid"].as_object().unwrap().keys().cloned().collect();
    assert_eq!(valid, listing("valid"));
    assert_eq!(invalid, listing("invalid"));
}

#[test]
fn valid_fixtures_load() {
    for rel in expectations()["valid"].as_array().unwrap() {
        let rel = rel.as_str().unwrap();
        if let Err(e) = load_from_str(&read(rel)) {
            panic!("{rel} should load: {e}");
        }
    }
}

#[test]
fn invalid_fixtures_are_refused_with_the_expected_verdict() {
    for (rel, want) in expectations()["invalid"].as_object().unwrap() {
        let err = load_from_str(&read(rel)).expect_err(rel);
        match (want["kind"].as_str().unwrap(), &err) {
            ("not_json", LoadError::NotJson(_)) => {}
            ("unsupported_version", LoadError::UnsupportedVersion { found, supported }) => {
                assert_eq!(found, want["found"].as_str().unwrap(), "{rel}");
                assert_eq!(*supported, "aideos.render/1");
            }
            ("invalid_document", LoadError::Invalid(issues)) => {
                let want_issues = want["issues"].as_array().unwrap();
                if want_issues.iter().all(|i| i.get("path").is_none()) {
                    // A structural failure: the codes agree, the wording and location are the validator's own.
                    assert!(issues.iter().all(|i| i.code == "schema"), "{rel}: {err}");
                } else {
                    let mut got: Vec<(String, String)> = issues.iter().map(|i| (i.code.clone(), i.path.clone())).collect();
                    let mut exp: Vec<(String, String)> =
                        want_issues.iter().map(|i| (i["code"].as_str().unwrap().to_string(), i["path"].as_str().unwrap().to_string())).collect();
                    got.sort();
                    exp.sort();
                    assert_eq!(got, exp, "{rel}");
                }
            }
            (kind, other) => panic!("{rel}: expected {kind}, got {other}"),
        }
    }
}

#[test]
fn the_golden_example_survives_a_round_trip_through_the_typed_model() {
    let text = read("valid/tiny-scene.json");
    let ir: RenderIr = load_from_str(&text).expect("tiny-scene loads");
    let again = serde_json::to_value(&ir).unwrap();
    let original: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(normalize(again), normalize(original), "a field was dropped or renamed by the typed model");
}

#[test]
fn the_golden_example_declares_both_formats_and_the_scene_pieces() {
    let ir = load_from_path(fixtures().join("valid/tiny-scene.json")).unwrap();
    assert_eq!((ir.formats.long.as_ref().unwrap().width.0, ir.formats.long.as_ref().unwrap().height.0), (1920, 1080));
    assert_eq!((ir.formats.reel.as_ref().unwrap().width.0, ir.formats.reel.as_ref().unwrap().height.0), (1080, 1920));
    assert_eq!(ir.film.duration_frames.0, 90);
    assert!(ir.camera.is_some());
    let kinds: Vec<&str> = ir.overlay.iter().map(|n| n.kind_name()).collect();
    assert_eq!(kinds, ["group", "rail", "captions", "endCard"]);
}

#[test]
fn a_missing_file_is_an_io_error_naming_the_path() {
    let err = load_from_path(fixtures().join("valid/absent.json")).unwrap_err();
    assert!(matches!(err, LoadError::Io { .. }), "{err}");
    assert!(err.to_string().contains("absent.json"));
}

#[test]
fn a_version_string_that_is_not_exactly_the_supported_one_is_refused() {
    for found in ["aideos.render/0", "aideos.render/1.1", "aideos.render/10", "AIDEOS.RENDER/1", ""] {
        let doc = format!("{{\"schema\": {found:?}}}");
        match load_from_str(&doc) {
            Err(LoadError::UnsupportedVersion { found: f, .. }) => assert_eq!(f, found),
            other => panic!("{found:?}: {other:?}"),
        }
    }
}

#[test]
fn a_non_string_or_missing_schema_field_is_an_invalid_document() {
    for doc in ["{}", "{\"schema\": 1}", "[1]", "\"aideos.render/1\"", "null"] {
        assert!(matches!(load_from_str(doc), Err(LoadError::Invalid(_))), "{doc}");
    }
}
