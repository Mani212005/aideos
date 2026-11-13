<!--
File Description: Reference for the Render IR `aideos.render/1`: the versioned, data-only document the TypeScript pipeline hands to the native renderer - its model, versioning and rejection rules, issue codes, the shared fixtures, and the exact commands that build and test both the TypeScript and the Rust side.
-->

# Render IR (`aideos.render/1`)

The Render IR is the one document between the authoring layer (`film.json`, `design.json`, the scene
compiler, the layout modules) and the native renderer `aideos-render` (Rust, Skia). It carries
everything a frame depends on and nothing else: no scripts, no clocks, no random seeds. A frame is a
pure function of `(IR, frame number, format)`, so any frame can be rendered in any order.

This is **R1** of Phase 1 of the native renderer plan: the schema, the TypeScript validator and the
Rust loader. The evaluator and raster (R2), encode and audio mux (R3) and the film.json emitter plus
Still Talking acceptance (R4) are separate ships. The IR is not coupled to Remotion or to the
`RenderJob` state machine: a job hands a renderer an IR path and a format, whichever renderer that is.

**Status: unfrozen.** `/1` may still change shape until R4 passes on Still Talking. After that, any
change to the document shape is a new version number (see below), never a quiet edit.

## Where things live

| Piece | Path |
| --- | --- |
| Structural contract (zod, the single source) | `backend/renderIr/schema.ts` |
| TypeScript load, version gate and cross-reference rules | `backend/renderIr/validate.ts` |
| JSON Schema generator | `backend/renderIr/jsonSchema.ts`, `scripts/render_ir_schema.ts` |
| Committed JSON Schema (embedded by the Rust crate) | `native/aideos-render-ir/schema/aideos.render.1.schema.json` |
| Rust workspace and loader crate | `native/Cargo.toml`, `native/aideos-render-ir/` |
| Shared fixtures and their expected verdicts | `native/aideos-render-ir/fixtures/` (`valid/`, `invalid/`, `expectations.json`) |
| TypeScript tests | `backend/renderIr/renderIr.test.ts` |
| Rust tests | `native/aideos-render-ir/tests/fixtures.rs` |

`native/` is the home of every native renderer crate. R2 and R3 add members to `native/Cargo.toml`.

## Versioning and rejection

A document starts with `"schema": "aideos.render/1"`. The loader reads that field first:

1. Not JSON: refused as `not_json`.
2. Not an object, or no string `schema` field: refused as `invalid_document` with a `schema` issue.
3. A string other than exactly `aideos.render/1` (including `aideos.render/2`, `aideos.render/1.1` or a
   different case): refused as `unsupported_version` carrying the string found, **before** the rest of
   the document is read, because a later version may have a different shape.
4. Right version, wrong shape (a missing or unknown field, a wrong type, a bad colour, a frame that is
   not a whole number): refused as `invalid_document`, every issue listed.
5. Right shape, broken references or ranges: refused as `invalid_document`, every issue listed.

The shape is closed: an unknown field is an error, never ignored. There are no defaults in the wire
format, so a document says everything the renderer needs. Frame and pixel fields are whole numbers
(`30`, `30.0` and `3e1` all read as 30, as they do in JavaScript). Colours are `#RRGGBB` or `#RRGGBBAA`.

## The model

```
RenderIr
  schema      "aideos.render/1"
  film        { id, fps, durationFrames }
  scene       { width, height }                 the square scene space (1920 x 1920 for scene films)
  formats     { long?: {width,height}, reel?: {width,height} }   at least one
  background  colour
  assets[]    svg | font | image | audio       by id, path relative to the package directory
  camera?     { centerX[], centerY[], zoom[], rotation[] }       keyframes in scene space
  stage[]     nodes drawn in scene space under the camera   (svg, group)
  overlay[]   nodes drawn in frame space, no camera          (group, rect, text, rail, captions, endCard)
  audio[]     clips on the film timeline with a gain envelope
```

**Formats.** `long` (1920 x 1080) and `reel` (1080 x 1920) are two viewports onto one evaluated scene.
A format shows a centred cover-fit window of the scene: `fit = max(width / scene.width, height /
scene.height)`, and a scene point `p` lands at `width/2 + (R(p - center)) * zoom * fit` (and the same for
y), where `R` is the rotation by the camera's `rotation` in degrees. This is
`projectStagePoint` in `src/dl/scene/projection.ts`.

**Keyframes and tracks.** A track is a list of keyframes `{ frame, value, ease? }`. Before the first
keyframe the value holds the first value, after the last it holds the last (values hold, they do not
reset). Between two keyframes the `ease` of the earlier one shapes the segment; the last keyframe has
no segment, so it has no `ease`. `ease` is one of `linear`, `hold`, `expoIn`, `expoOut`,
`expoInOut` (the curves of `applySvgEasing` in `src/dl/scene/svgAnimation.ts`, `expoOut` being the
project's `cubic-bezier(0.16, 1, 0.3, 1)`) or `spline`, the monotone cubic the scene camera uses
(`src/dl/scene/cameraTrack.ts`). The emitter resolves every default, so the evaluator never guesses.
Dense data is allowed: a track with a `linear` keyframe at every frame reproduces any compiled curve
exactly (the emitter does this for the camera's hold push-in). A single keyframe is a constant.

**Stage nodes.** `svg` places an SVG asset (`x`, `y`, `scale`, `rotation`, `layer`) and carries two kinds
of motion: `tracks` on the whole node (`x`, `y`, `scale`, `rotation`, `opacity`) and `elementTracks`
on elements inside the asset's document (`translateX`, `translateY`, `scale`, `scaleX`, `scaleY`,
`rotate`, `opacity`, `drawOn`, `x1`, `y1`, `x2`, `y2`: the scene engine's clip properties, see
`src/dl/scene/README.md`). An element track may carry an `origin` in the asset's own coordinates,
only for scale and rotate, and one element has one origin. The asset lists its `elementIds`, so a
target is checked without parsing the SVG. `group` holds children with a transform and opacity.

**Overlay nodes.** Layout stays in TypeScript (`camera.ts`, `endCardLayout.ts`, `captionPlacement.ts`),
so overlay nodes carry geometry already resolved per format, in render pixels, under `placement` or
`layout`: `rect` (fill, stroke, radius), `text` (a run with font, colour, alignment, per-format box and
font size), `rail` (chapters, colours, per-format box), `captions` (words with frames, colours, and the
owner-resolved card placement as spans per format; line breaking is the evaluator's job with the vendored
fonts), `endCard` (copy, colours, per-format layout, the frame the subscribe pill presses).
Every `placement` or `layout` must have exactly the formats the document declares.

**Visibility.** `visible: { fromFrame, toFrame }` is a half-open span of frames in which a node is drawn.
Absent means the whole film. `opacity` is a static multiplier, absent meaning 1.

**Assets.** `svg` (`elementIds`), `font` (`family`, `weight`), `image` (`width`, `height`) and `audio`,
each with an optional `sha256` for caching and incremental rendering. A path is relative to the package
directory and may not be absolute, contain `..` or a backslash, or start with a drive letter. The
loader checks the **string**; it does not open the file (R2 resolves it with `getVideosDir()` and
friends). Fonts are vendored files, never fetched.

**Not in `/1`.** Transitions and effect stacks (paper curl, blur, masks, blend modes), springs and
particles, footage clips, Lottie, 3D and the Three-stage character films. They arrive with the phases
that need them, as a new version. Character films keep rendering through Remotion until Phase 4.

## Issue codes

Every refusal of an invalid document lists issues as `{ code, path, message }`, `path` being a JSON
Pointer (RFC 6901) into the document. Structural issues have the code `schema`; the rest are the
cross-reference rules, identical in both languages:

| Code | Meaning |
| --- | --- |
| `no_formats` | neither `long` nor `reel` is declared |
| `duplicate_asset_id`, `duplicate_node_id`, `duplicate_audio_id`, `duplicate_element_id` | an id used twice |
| `unsafe_asset_path` | an asset path leaves the package or is absolute |
| `unknown_asset`, `asset_kind_mismatch` | a reference to a missing asset, or to one of the wrong kind |
| `unknown_element` | an element track targets an id the SVG asset does not declare |
| `duplicate_track` | one property (of one element) driven by two tracks |
| `origin_misplaced`, `origin_conflict` | an origin on a property that takes none, or two origins for one element |
| `keyframes_unordered`, `ease_missing`, `ease_on_last`, `frame_out_of_range` | keyframe frames must strictly increase, every keyframe but the last has an ease, frames stay inside the film |
| `value_out_of_range` | opacity and drawOn outside 0 to 1, scale or zoom not above 0, gain outside 0 to 4 |
| `invalid_span` | a span that ends before it starts or runs past the film |
| `chapters_unordered`, `words_unordered`, `spans_unordered` | rail chapters, caption words or placement spans out of order |
| `missing_format_entry`, `undeclared_format` | a per-format object that does not match the declared formats |
| `node_not_allowed` | an `svg` node in the overlay, or an overlay node in the stage |

## Use

TypeScript (browser-safe, no Node imports in `schema.ts` or `validate.ts`):

```ts
import { parseRenderIr } from "backend/renderIr/validate";
const result = parseRenderIr(text);          // or validateRenderIr(parsedValue)
if (!result.ok) throw new Error(JSON.stringify(result.error));
const ir = result.ir;                        // typed RenderIr
```

Rust:

```rust
use aideos_render_ir::{load_from_path, LoadError};
match load_from_path("render.json") {
    Ok(ir) => { /* ir.film, ir.stage, ir.overlay ... */ }
    Err(LoadError::UnsupportedVersion { found, supported }) => { /* found a newer or foreign file */ }
    Err(e) => eprintln!("{e}"),              // lists every issue with its path
}
```

The Rust loader runs the same stages as the TypeScript one: parse, version gate, the committed JSON
Schema (embedded in the binary with `include_str!`), typed deserialization, then the rules above.

## Commands

```bash
npm run render-ir:schema                    # regenerate the JSON Schema after editing schema.ts
npm run render-ir:schema -- --check         # fail when the committed schema is out of date
node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/renderIr/renderIr.test.ts
cargo test --locked --manifest-path native/Cargo.toml      # the Rust loader against the same fixtures
```

`npm test` finds the TypeScript suite by glob. `npm run ci -- unit` also runs the `cargo test` step
(skipped with a reason on a machine without cargo, a failure under CI, which has it). Rust 1.85 or newer.

## Fixtures

`valid/tiny-scene.json` is the golden example: a 3 second scene film with an SVG stage element
(node and element tracks, an origin), a camera on a spline, a text card in a group, the rail, kinetic
captions with two placement spans, the end card and an audio clip, in both 16:9 and 9:16.
`valid/minimal-reel.json` and `valid/integral-floats.json` are the smallest documents. `invalid/*.json`
are short documents with one named defect each.

`fixtures/expectations.json` states the verdict for every file. Both test suites assert the same
thing: a structural failure has the code `schema` (a JSON Schema validator and zod word and locate those
differently, so only the code is compared); every cross-reference issue must match by code **and**
exact path. A fixture file missing from `expectations.json` fails both suites. To add a case, add the
JSON file and its entry, then run both suites.

## Dependencies this adds

Rust: `serde`, `serde_json` and `jsonschema` (built without HTTP or file resolution), 80 crates in
all, in `native/Cargo.lock`, built into `native/target` (gitignored). No Skia yet: `skia-safe` arrives
with R2. CI: one step in the existing `unit` job and a cache of the cargo registry and `native/target`.
