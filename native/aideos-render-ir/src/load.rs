//! File Description: The load path of the Render IR: JSON parse, version gate, JSON Schema check, typed deserialization and the cross-reference rules, with one error type that names exactly why a document was refused.
//! Inputs and outputs: a path or JSON text -> `RenderIr` or `LoadError`.
//! Used by: crate::load_from_path and crate::load_from_str, the native renderer crates.

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde_json::Value;

use crate::types::RenderIr;
use crate::{semantic, VERSION};

/// The committed JSON Schema, embedded so a built binary needs no file next to it.
pub const SCHEMA_JSON: &str = include_str!("../schema/aideos.render.1.schema.json");

/// One problem in a document: a stable machine code, a JSON Pointer to the offending value and a sentence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    pub code: String,
    pub path: String,
    pub message: String,
}

/// Why a document was refused.
#[derive(Debug)]
pub enum LoadError {
    /// The file could not be read.
    Io { path: PathBuf, source: std::io::Error },
    /// The text is not JSON.
    NotJson(String),
    /// The `schema` field names a version this crate does not read.
    UnsupportedVersion { found: String, supported: &'static str },
    /// The document is JSON of a supported version but breaks the schema or a cross-reference rule.
    Invalid(Vec<Issue>),
}

impl fmt::Display for LoadError {
    /// Writes a one-line description, followed by the issues for an invalid document.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoadError::Io { path, source } => write!(f, "cannot read {}: {source}", path.display()),
            LoadError::NotJson(m) => write!(f, "not JSON: {m}"),
            LoadError::UnsupportedVersion { found, supported } => write!(f, "unsupported Render IR version {found:?}, this build reads {supported}"),
            LoadError::Invalid(issues) => {
                write!(f, "invalid Render IR ({} issues)", issues.len())?;
                for i in issues {
                    write!(f, "\n  {} at {:?}: {}", i.code, i.path, i.message)?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for LoadError {
    /// The underlying I/O error, when there is one.
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            LoadError::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

/// Builds the issue list for a single structural failure.
fn schema_issue(path: String, message: String) -> LoadError {
    LoadError::Invalid(vec![Issue { code: "schema".into(), path, message }])
}

/// The compiled JSON Schema validator, built once.
fn validator() -> &'static jsonschema::Validator {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    VALIDATOR.get_or_init(|| {
        let schema: Value = serde_json::from_str(SCHEMA_JSON).expect("the embedded Render IR schema is JSON");
        jsonschema::validator_for(&schema).expect("the embedded Render IR schema is a valid JSON Schema")
    })
}

/// Reads and loads a Render IR file.
pub fn load_from_path(path: impl AsRef<Path>) -> Result<RenderIr, LoadError> {
    let path = path.as_ref();
    let text = std::fs::read_to_string(path).map_err(|source| LoadError::Io { path: path.to_path_buf(), source })?;
    load_from_str(&text)
}

/// Loads a Render IR from JSON text: version first, then the schema, then the typed rules.
pub fn load_from_str(text: &str) -> Result<RenderIr, LoadError> {
    let value: Value = serde_json::from_str(text).map_err(|e| LoadError::NotJson(e.to_string()))?;
    let found = match value.get("schema").and_then(Value::as_str) {
        Some(found) if value.is_object() => found,
        _ => return Err(schema_issue(String::new(), "a Render IR is an object with a string `schema` field".into())),
    };
    if found != VERSION {
        return Err(LoadError::UnsupportedVersion { found: found.to_string(), supported: VERSION });
    }
    let structural: Vec<Issue> = validator()
        .iter_errors(&value)
        .map(|e| Issue { code: "schema".into(), path: e.instance_path().to_string(), message: e.to_string() })
        .collect();
    if !structural.is_empty() {
        return Err(LoadError::Invalid(structural));
    }
    let ir: RenderIr = serde_json::from_value(value).map_err(|e| schema_issue(String::new(), e.to_string()))?;
    let issues = semantic::check(&ir);
    if issues.is_empty() {
        Ok(ir)
    } else {
        Err(LoadError::Invalid(issues))
    }
}
