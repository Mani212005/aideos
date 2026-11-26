//! File Description: Loader and validator for the Render IR (`aideos.render/1`, its superset `aideos.render/2` and its supersets through `aideos.render/5`): parses a JSON document, refuses an unknown version, checks it against that version's committed JSON Schema, deserializes it into typed structs and runs the cross-reference rules; also decodes the `/2` binary mesh file. The TypeScript twins are backend/renderIr/validate.ts and backend/renderIr/mesh.ts.
//! Inputs and outputs: a JSON file or string -> a `RenderIr`, or a `LoadError` (not JSON, unsupported version, invalid document with every issue, or an I/O error); mesh file bytes and their declared asset -> mesh parts or a `MeshError`.
//! Used by: the native renderer crates and native/aideos-render-ir/tests/*.rs.

mod load;
pub mod mesh;
mod semantic;
pub mod types;

pub use load::{load_from_path, load_from_str, Issue, LoadError, SCHEMA_JSON, SCHEMA_V2_JSON, SCHEMA_V3_JSON, SCHEMA_V4_JSON, SCHEMA_V5_JSON, SCHEMA_EFFECTS_JSON};
pub use semantic::is_safe_relative_path;
pub use types::RenderIr;

/// The first document version: SVG scene films.
pub const VERSION: &str = "aideos.render/1";
/// The second version, a strict superset of the first: adds the stage3d node and the mesh asset.
pub const VERSION_2: &str = "aideos.render/2";
/// The third version, a strict superset of the second: adds the image stage node (a pinned picture).
pub const VERSION_3: &str = "aideos.render/3";
/// The fourth version adds optional glyph tracks and 2D shutter sampling.
pub const VERSION_4: &str = "aideos.render/4";
/// The fifth version, a strict superset of the fourth: adds colour tracks and the dash offset element track on svg nodes.
pub const VERSION_5: &str = "aideos.render/5";
/// Native transition and particle effects version.
pub const VERSION_EFFECTS: &str = "aideos.render/6";
/// Every version this crate reads.
pub const VERSIONS: [&str; 6] = [VERSION, VERSION_2, VERSION_3, VERSION_4, VERSION_5, VERSION_EFFECTS];
/// The versions this crate reads, as the `supported` text of an unsupported-version refusal.
pub const SUPPORTED: &str = "aideos.render/1, aideos.render/2, aideos.render/3, aideos.render/4, aideos.render/5, aideos.render/6";
