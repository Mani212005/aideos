<!--
File Description: Reference for the Render IR `aideos.render/1` and its superset `aideos.render/2` (the Three stage): the versioned, data-only boundary for the native renderer - its model, versioning and rejection rules, the stage3d node, the mesh file and the reference pose, issue codes, shared fixtures, and commands for the TypeScript and Rust sides.
-->

# Render IR (`aideos.render/1`, `aideos.render/2`)

The Render IR is the document boundary between the authoring layer (`film.json`, `design.json`,
the scene compiler, the layout modules) and the native renderer. It carries everything a frame depends
on and nothing else: no scripts, no clocks, no random seeds. A frame is a pure function of `(IR, frame
number, format)`, so any frame can be rendered in any order. R1 of Phase 1 of the native renderer plan
provides its schema and loaders; R2 the evaluator and raster; R3 the encoder and audio mux; R4 the
emitter (`backend/renderIr/emit.ts`, which writes one document per film and format) and the renderer
flag, see [NATIVE_RENDERER.md](NATIVE_RENDERER.md). The IR is not coupled to Remotion or to the
`RenderJob` state machine: the native adapter hands the renderer an IR path, a package and a format.

R4 added, for Still Talking's text cards and chrome: `rect.gradient`, the `scaleX` and `scaleY` node
track properties, the rail's `labelColor` (required) and `progressFrames` (optional), and the end card's
optional `chipFont`, `surface`, `hairline` and `muted`.

**Status: unfrozen.** `/1` may still change shape until R4 passes on Still Talking. After that, any
change to the document shape is a new version number (see below), never a quiet edit.

P4.1 of Phase 4 added `aideos.render/2`: a strict superset of `/1` that adds the `stage3d` stage node and the
`mesh` asset, so a Three-stage character film can be described (see [The Three stage](#the-three-stage-aideosrender2)).
The captain approved native rendering of those films, reversing his earlier decision that they stay on
Remotion until their phase; the steps are in [NATIVE_RENDERER.md](NATIVE_RENDERER.md#the-three-stage-phase-4).

## Where things live

| Piece | Path |
| --- | --- |
| Structural contract (zod, the single source, both versions) | `backend/renderIr/schema.ts` |
| TypeScript load, version gate and cross-reference rules | `backend/renderIr/validate.ts` |
| JSON Schema generator | `backend/renderIr/jsonSchema.ts`, `scripts/render_ir_schema.ts` |
| Committed JSON Schemas (embedded by the Rust crate) | `native/aideos-render-ir/schema/aideos.render.1.schema.json`, `aideos.render.2.schema.json` |
| Rust workspace and loader crate | `native/Cargo.toml`, `native/aideos-render-ir/` |
| Mesh file codec | `backend/renderIr/mesh.ts` (write and read), `native/aideos-render-ir/src/mesh.rs` (read) |
| Stage3d emitter and reference pose | `backend/renderIr/emitStage3d.ts`, `backend/renderIr/stage3d.ts` |
| Shared fixtures and their expected verdicts | `native/aideos-render-ir/fixtures/` (`valid/`, `invalid/`, `expectations.json`, `mesh/`) |
| TypeScript tests | `backend/renderIr/renderIr.test.ts`, `mesh.test.ts`, `stage3d.test.ts` |
| Rust tests | `native/aideos-render-ir/tests/fixtures.rs`, `tests/mesh.rs` |

`native/` is the home of every native renderer crate. R2 added the renderer crate to
`native/Cargo.toml`; the workspace also includes the encoder and audio mux; see [NATIVE_ENCODE.md](NATIVE_ENCODE.md).

## Versioning and rejection

A document starts with `"schema": "aideos.render/1"` or `"schema": "aideos.render/2"`. The loader reads
that field first:

1. Not JSON: refused as `not_json`.
2. Not an object, or no string `schema` field: refused as `invalid_document` with a `schema` issue.
3. A string other than exactly `aideos.render/1` or `aideos.render/2` (including `aideos.render/3`,
   `aideos.render/1.1` or a different case): refused as `unsupported_version` carrying the string found and
   the versions this build reads (`supported`: `aideos.render/1, aideos.render/2`), **before** the rest of the
   document is read, because a later version may have a different shape.
4. Right version, wrong shape (a missing or unknown field, a wrong type, a bad colour, a frame that is
   not a whole number): refused as `invalid_document`, every issue listed. Each version is checked against
   its own schema, so a `/1` document that uses a `stage3d` node or a `mesh` asset is refused here.
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
  stage[]     nodes drawn in scene space under the camera   (svg, group; SVG layer is signed 32-bit)
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
of motion: `tracks` on the whole node (`x`, `y`, `scale`, `scaleX`, `scaleY`, `rotation`, `opacity`;
`scaleX` and `scaleY` multiply `scale` on one axis and may be zero or negative) and `elementTracks`
on elements inside the asset's document (`translateX`, `translateY`, `scale`, `scaleX`, `scaleY`,
`rotate`, `opacity`, `drawOn`, `x1`, `y1`, `x2`, `y2`: the scene engine's clip properties, see
`src/dl/scene/README.md`). An element track may carry an `origin` in the asset's own coordinates,
only for scale, scaleX, scaleY and rotate, and one element has one origin. The asset lists its
`elementIds`, so a target is checked without parsing the SVG. Element `scale` keyframes must stay
above zero; `scaleX` and `scaleY` may be negative to mirror an element. `group` holds children with a
transform and opacity.

**Overlay nodes.** Layout stays in TypeScript (`camera.ts`, `endCardLayout.ts`, `captionPlacement.ts`),
so overlay nodes carry geometry already resolved per format, in render pixels, under `placement` or
`layout`: `rect` (fill, an optional vertical `gradient` of colour stops from the box top at offset 0 to
its bottom at offset 1, stroke, radius), `text` (a run with font, colour, alignment, per-format box and
font size), `rail` (chapters, colours including the label row's `labelColor`, per-format box, and
`progressFrames`, the frames the reel's continuous bar fills over, the film duration when absent),
`captions` (words with frames, colours, and the
owner-resolved card placement as spans per format; line breaking is the evaluator's job with the vendored
fonts), `endCard` (copy, colours, per-format layout, the frame the subscribe pill presses).
Every `placement` or `layout` must have exactly the formats the document declares.

**Visibility.** `visible: { fromFrame, toFrame }` is a half-open span of frames in which a node is drawn.
Its end may not exceed the film duration. Absent means the whole film. `opacity` is a static multiplier,
absent meaning 1. SVG `layer` is a signed 32-bit integer to match the Rust loader's representation.

**Assets.** `svg` (`elementIds`), `font` (`family`, `weight`), `image` (`width`, `height`) and `audio`,
each with an optional `sha256` for caching and incremental rendering. A path is relative to the package
directory and may not be absolute, contain `..` or a backslash, or start with a drive letter. The
loader checks the **string**; it does not open the file. The renderer (`native/aideos-render`, see
[NATIVE_RENDERER.md](NATIVE_RENDERER.md)) opens it against the package directory its caller names and
refuses a file that resolves outside it. Fonts are vendored files, never fetched.

**Audio.** An audio clip plays its asset from `sourceStartMs` at film frame `startFrame` for
`durationFrames`. Its `gainEnvelope` keyframes are in **film frames**, like every other track (a clip that
starts at frame 900 keys its envelope from frame 900, not 0), so they are checked against the film duration
and the mixer reads them on the film clock. The gain is held before the first and after the last keyframe.

**Not in `/1`.** Transitions and effect stacks (paper curl, blur, masks, blend modes), springs and
particles, footage clips, Lottie, 3D and the Three-stage character films. They arrive with the phases
that need them, as a new version. `/2` carries the Three stage; character films keep rendering through
Remotion until the native renderer draws it (P4.2 onward).

## The Three stage (`aideos.render/2`)

`/2` is `/1` plus two additions, nothing else; every valid `/1` document is a valid `/2` document once its
version string changes. The emitter writes `/2` only for a film with a Three stage, so every other film stays
`/1`, byte for byte. The IR carries data, never behaviour: geometry is baked by the frozen TypeScript builders,
poses by the frozen performance evaluator and faces by the frozen face painter, so Rust never ports tube
generation, retargeting, limits, contact solving, Euler conversion or the painter.

```
stage3d                       a stage node, only at the top of the stage, at most one per document
  id, visible?, opacity?      as every node
  mesh                        id of the mesh asset holding every drawable's part
  treatment                   "cel-v1" (dots-v1 is P4.4; the IR cannot carry its dot fields yet)
  projection                  { cameraZ, near, far }: orthographic camera at z = cameraZ looking down -z;
                              its frustum comes from the document camera and the format
  lighting                    { directional: { position, target, color, intensity }, ambient: { color, intensity } }
  ramp                        the toon gradient's texels (0 to 255), sampled nearest
  output                      { dpr, antialias, colorSpace: "srgb", toneMapping: "none", exposure }
  sampleFrames                n: every channel and face texture holds n samples
  nodes[]                     { id, parent?, position[3], quaternion[4] (x y z w), scale }, parents listed first
  channels[]                  { node, position?[3n], quaternion?[4n], scale?[n] }: dense per-frame local values
  drawables[]                 { id, node, part, material }, in draw order
  faceTextures[]              { id, size, flipY, filter: "linear", mipmaps, colorSpace: "srgb", programs[n] }
  facePrograms[]              { ops[] }: distinct recorded Canvas 2D programs, shared by textures and frames
mesh asset                    { kind: "mesh", id, path, sha256?, parts: [{ id, vertices, indices, uv }] }
```

**Stage order.** The emitter writes a Three film's stage as `SceneStage` draws it: a `ground-plane` group, the
`stage3d` node, then a `foreground-plane` group when the scene has foreground props. Groups and the stage3d node
count as layer 0, so the renderer keeps that document order.

**Graph and frames.** Frame `f` reads sample `min(f, sampleFrames - 1)`: the stage holds its last sample through
the end card. A node's local transform at a sample is its static fields with each channel present replaced by
that sample (an absent channel never moves). Scale is uniform. A root node's world matrix is its local matrix; a
child's is its parent's world matrix times its local one.

**Reference pose.** `backend/renderIr/stage3d.ts` writes out three.js r180's exact f64 arithmetic:
`Matrix4.compose(position, quaternion, scale)`, `Matrix4.multiplyMatrices(parentWorld, local)` and
`Vector3.applyMatrix4` (including its w divide), rounded to f32 at the end. The emitter reads every static value
and sample straight off three's Object3Ds after `applyCharacter` and `applyProp`, so these are the numbers three
composes. JSON text carries f64 exactly (JavaScript writes the shortest round-trip text; the Rust crate turns on
serde_json's `float_roundtrip` so it parses correctly rounded). `stage3d.test.ts` checks every frame of the
iona-receive fixture: the IR-posed world vertices equal `prepareStageFacts`' posed vertices bit for bit.

**Materials** (inline in each drawable, discriminated on `kind`): `toon { color, side }` (lit through `ramp`),
`basic { color, side }` (unlit), `face { texture, color, side }` (the face texture times `color`, unlit) and
`ink { color, width, side }` (the part's mesh pushed out along its normals by `width` object units, drawn with
back faces). Any may carry `polygonOffset { factor, units }`. Colours are linear-light floats exactly as three
holds them on the material, so no sRGB decode is repeated in another language. Every mesh owns its material,
so three's opaque sort (material creation order first) is the list order.

**Face programs.** Each op is one recorded Canvas 2D call: `setTransform`, `save`, `restore`, `scale`,
`translate`, `fillStyle`, `strokeStyle`, `lineWidth`, `lineCap`, `lineJoin`, `globalAlpha`, `fillRect`,
`beginPath`, `moveTo`, `lineTo`, `quadraticCurveTo`, `bezierCurveTo`, `ellipse` and `arc` (both clockwise),
`fill`, `stroke` and `clip`. A paint is `{ kind: "color", color: "#RRGGBB", alpha }` or `{ kind:
"linearGradient", x0, y0, x1, y1, stops: [{ offset, color, alpha }] }`; the painter's `rgba()` alpha is carried
exactly, not quantized. A program starts from the canvas default state on a transparent `size x size` canvas.

### The mesh file

Little-endian. The signature `AIDMESH` and the format byte `0x01`; a `u32` part count; per part a header of
`u32 vertices`, `u32 indices`, `u32 flags` (bit 0: the part has uvs; other bits must be 0); then, per part in
order, `f32 positions[3 x vertices]`, `f32 normals[3 x vertices]`, `f32 uvs[2 x vertices]` when flagged and
`u32 indices[indices]`. Unindexed three geometry is written with sequential indices (the same triangles). The
readers check the signature, that the counts and flags match the asset's `parts`, the exact length, that every
float is finite and that every index is inside its part. The IR loaders never open the file (as for every
asset); the renderer does. The shared fixture `fixtures/mesh/two-parts.{json,mesh}` holds both languages to
one byte layout.

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
| `keyframes_unordered`, `ease_missing`, `ease_on_last`, `frame_out_of_range` | keyframe frames must strictly increase and may not exceed the film duration, every keyframe but the last has an ease, caption placement starts must be before the film duration, a rail's `progressFrames` may not exceed it |
| `value_out_of_range` | opacity and drawOn outside 0 to 1, element scale or camera zoom not above 0, gain outside 0 to 4 |
| `invalid_span` | a span that ends before it starts or runs past the film |
| `chapters_unordered`, `words_unordered`, `spans_unordered`, `stops_unordered` | rail chapters, caption words, placement spans or gradient stop offsets out of order |
| `missing_format_entry`, `undeclared_format` | a per-format object that does not match the declared formats |
| `node_not_allowed` | an `svg` node in the overlay, an overlay node in the stage, a `stage3d` node anywhere but the top of the stage, or a second one |
| `duplicate_part_id`, `indices_not_triangles` | a mesh part id used twice, or an index count that is not a multiple of 3 |
| `duplicate_stage3d_id` | a stage3d node, drawable or face texture id used twice in its own list |
| `unknown_node`, `unknown_part`, `unknown_texture`, `unknown_program` | a parent not listed before its child, or a channel or drawable naming a missing node; a drawable naming a part its mesh lacks; a face material naming a missing texture; a texture naming a missing program |
| `sample_count_mismatch` | a channel or a texture's `programs` that is not `sampleFrames` samples long |

`duplicate_track` also covers two channels for one stage3d node; `value_out_of_range` a channel scale not above
0 and a far plane not beyond the near one; `frame_out_of_range` a `sampleFrames` past the film.

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
npm run render-ir:schema                    # regenerate both JSON Schemas after editing schema.ts
npm run render-ir:schema -- --check         # fail when a committed schema is out of date
node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/renderIr/renderIr.test.ts
cargo test --locked --manifest-path native/Cargo.toml      # loader fixtures and renderer tests
```

`npm test` finds the TypeScript suite by glob. `npm run ci -- unit` also runs the `cargo test` step
(skipped with a reason on a machine without cargo, a failure under CI, which has it). Rust 1.85 or newer.

## Fixtures

`valid/tiny-scene.json` is the golden example: a 3 second scene film with an SVG stage element
(node and element tracks, an origin), a camera on a spline, a text card in a group, the rail, kinetic
captions with two placement spans, the end card and an audio clip, in both 16:9 and 9:16.
`valid/minimal-reel.json` and `valid/integral-floats.json` are the smallest documents;
`valid/gradient-and-axis-scale.json` covers the gradient band and an underline drawn by `scaleX`.
`valid/stage3d-minimal.json` is the `/2` example: a ground plane and a stage3d node with a graph, a quaternion
channel, face, ink and toon drawables (one with polygon offset), a face texture and two face programs that use
every kind of paint. `invalid/*.json` are short documents with one named defect each; the `stage3d-*` ones cover
a `/1` document carrying `/2` additions, broken references, sample counts and ranges, placement, and shapes only
`/2` knows.

`fixtures/expectations.json` states the verdict for every file. Both test suites assert the same
thing: a structural failure has the code `schema` (a JSON Schema validator and zod word and locate those
differently, so only the code is compared); every cross-reference issue must match by code **and**
exact path. A fixture file missing from `expectations.json` fails both suites. To add a case, add the
JSON file and its entry, then run both suites.

## Dependencies this adds

The loader uses `serde`, `serde_json` (with `float_roundtrip`) and `jsonschema` (built without HTTP or file resolution). Skia
(`skia-safe`) is a dependency of the renderer crate only, not of this loader; see
[NATIVE_RENDERER.md](NATIVE_RENDERER.md). CI runs the workspace tests in the existing `unit` job and
caches the Cargo registry and `native/target`.
