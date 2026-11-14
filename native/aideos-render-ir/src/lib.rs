//! File Description: Loader and validator for the Render IR (`aideos.render/1` and its superset `aideos.render/2`): parses a JSON document, refuses an unknown version, checks it against that version's committed JSON Schema, deserializes it into typed structs and runs the cross-reference rules; also decodes the `/2` binary mesh file. The TypeScript twins are backend/renderIr/validate.ts and backend/renderIr/mesh.ts.
//! Inputs and outputs: a JSON file or string -> a `RenderIr`, or a `LoadError` (not JSON, unsupported version, invalid document with every issue, or an I/O error); mesh file bytes and their declared asset -> mesh parts or a `MeshError`.
//! Used by: the native renderer crates and native/aideos-render-ir/tests/*.rs.

mod load;
pub mod mesh;
mod semantic;
pub mod types;

pub use load::{load_from_path, load_from_str, Issue, LoadError, SCHEMA_JSON, SCHEMA_V2_JSON};
pub use semantic::is_safe_relative_path;
pub use types::RenderIr;

/// The first document version: SVG scene films.
pub const VERSION: &str = "aideos.render/1";
/// The second version, a strict superset of the first: adds the stage3d node and the mesh asset.
pub const VERSION_2: &str = "aideos.render/2";
/// Every version this crate reads.
pub const VERSIONS: [&str; 2] = [VERSION, VERSION_2];
/// The versions this crate reads, as the `supported` text of an unsupported-version refusal.
pub const SUPPORTED: &str = "aideos.render/1, aideos.render/2";
