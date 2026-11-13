//! File Description: Loader and validator for the Render IR `aideos.render/1`: parses a JSON document, refuses an unknown version, checks it against the committed JSON Schema, deserializes it into typed structs and runs the cross-reference rules. The TypeScript twin is backend/renderIr/validate.ts.
//! Inputs and outputs: a JSON file or string -> a `RenderIr`, or a `LoadError` (not JSON, unsupported version, invalid document with every issue, or an I/O error).
//! Used by: the native renderer crates (R2 and later) and native/aideos-render-ir/tests/fixtures.rs.

mod load;
mod semantic;
pub mod types;

pub use load::{load_from_path, load_from_str, Issue, LoadError, SCHEMA_JSON};
pub use semantic::is_safe_relative_path;
pub use types::RenderIr;

/// The one document version this crate reads.
pub const VERSION: &str = "aideos.render/1";
