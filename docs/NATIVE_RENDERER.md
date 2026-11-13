<!--
File Description: Reference for the native renderer `native/aideos-render` (R2 and R4 of Phase 1 of the native renderer plan): what it draws, how a frame is evaluated, the semantics it gives the parts of the Render IR that the IR leaves open, the SVG subset it supports, whole-film rendering and text measurement, the TypeScript emitter and the renderer flag, determinism, the exact Skia dependency (pinned feature set, prebuilt binary, CI cache, source-build fallback) and the commands that build, test and run it.
-->

# Native renderer (`native/aideos-render`)

`aideos-render` evaluates a Render IR [`aideos.render/1`](RENDER_IR.md) as a pure function of the frame
number and draws the frame with Skia. Skia's **CPU rasterizer is the deterministic reference**; an
optional GPU path draws the same frame through OpenGL. There is no browser, no DOM and no HTML.

R2 of Phase 1 added the evaluator and the raster, with a CLI that renders one frame to a PNG. R3 added the
encoder and audio mux (`native/aideos-encode`, [NATIVE_ENCODE.md](NATIVE_ENCODE.md)). R4 connects them:
`aideos-render video` renders a whole film to an mp4 through the R3 encoder, `aideos-render measure` gives
the TypeScript emitter the raster's own text metrics, and the emitter (`backend/renderIr/emit.ts`) turns a
scene film into the IR. Remotion stays the default renderer; `--renderer native` selects this one (see
[The renderer flag](#the-renderer-flag)). The crate knows nothing of the `RenderJob` state machine: the
adapter in `backend/nativeRenderer.ts` hands it an IR path, a package directory and a format.

## Where things live

| Piece | Path |
| --- | --- |
| Frame evaluator (tracks, easing, camera spline, spring, element states, rail, end card) | `native/aideos-render/src/eval/mod.rs`, `track.rs`, `spring.rs` |
| Kinetic caption phrases (port of `captionPhrases.ts`) | `native/aideos-render/src/eval/captions.rs` |
| Retained SVG model and parser | `native/aideos-render/src/svg/mod.rs`, `color.rs` |
| Raster: stage and overlay, SVG drawing, chrome (rail, captions, end card), fonts | `native/aideos-render/src/raster/` |
| Public `Renderer` (asset loading, checks, CPU render, PNG) | `native/aideos-render/src/renderer.rs` |
| Optional GPU path (feature `gpu`) | `native/aideos-render/src/gpu.rs` |
| Whole-film render: worker threads, RGBA to I420, in-order hand-off to the R3 encoder, audio plan from the IR | `native/aideos-render/src/video.rs` |
| Text measurement for the emitter | `native/aideos-render/src/measure.rs` |
| CLI (`<ir> --frame`, `video`, `measure`) | `native/aideos-render/src/main.rs` |
| Vendored variable fonts (Geist, JetBrains Mono) used by every emitted film | `native/fonts/` (provenance in its README) |
| The IR emitter (film.json to `aideos.render/1`) | `backend/renderIr/emit.ts` |
| RenderJob adapter and the renderer flag | `backend/nativeRenderer.ts`, `backend/rendererSelection.ts` |
| Linux fontconfig link shim | `native/aideos-render/build.rs` |
| Test package (vendored OFL fonts, artwork, IR) | `native/aideos-render/fixtures/package/` |
| Tests | `native/aideos-render/tests/` |

## Commands

```bash
cargo build --locked --manifest-path native/Cargo.toml -p aideos-render            # debug build
cargo build --locked --release --manifest-path native/Cargo.toml -p aideos-render  # release build
cargo test  --locked --manifest-path native/Cargo.toml                             # every native crate (what CI runs)
cargo test  --locked --manifest-path native/Cargo.toml -p aideos-render --features gpu   # also the GPU test (needs EGL)

native/target/release/aideos-render <ir.json> --frame N [--format long|reel] [--package DIR] [--gpu] --out frame.png
native/target/release/aideos-render video <ir.json> --format long|reel --out film.mp4 [--package DIR] [--frames A-B] \
    [--profile draft|review|final] [--backend auto|software|vaapi|videotoolbox] [--threads N] [--encoder-threads N]
native/target/release/aideos-render measure <request.json>

AIDEOS_RENDERER=native aideos render        # or: aideos render --renderer native; aideos reel --renderer native
```

The CLI writes one PNG and prints one line (`wrote frame.png (1920x1080, long, frame 43, cpu) in 246 ms`).
Exit codes: 0 written, 1 the document, an asset or the frame was refused (the reason is on stderr), 2 a
usage mistake. `--package` defaults to the IR file's directory; every asset path resolves against it.
`npm run ci -- unit` runs the `cargo test` step (skipped with a reason on a laptop without cargo).

`video` loads the film once on the calling thread (so a bad document or asset fails before anything
starts), then N worker threads (default: the machine's parallelism) each open their own `Renderer`, draw
frames on the CPU reference raster, convert them to limited-range BT.709 I420 (2x2 averaged chroma) and
hand them through a bounded reorder buffer to `aideos_encode::encode`, which pipes them to ffmpeg while
the next frames draw. The profile is the R3 policy: `final` is x264 CRF 16; `draft` and `review` use
VAAPI (or VideoToolbox) after the R3 conformance probe, else x264. The audio plan is built from the IR's
own audio clips (path, start, length, source offset, gain and its linear envelope), so the IR is the one
description of the film; a non-linear gain envelope is refused. A frame range shifts the audio with it.
It prints `frames D/T` lines and then one JSON report (frames, size, threads, encoder, wall time, fps).

`measure` takes `{fonts: [{id, path, family, weight}], runs: [{text, font, size, letterSpacing}],
metrics: [{font, size}]}` and prints `{widths, metrics: [{baseline, height, ascent, descent}]}`: each run's
single-line width (letter spacing follows every glyph, as in CSS) and each face's `line-height: normal`
metrics, in whole pixels as browsers round them.

## How a frame is drawn

1. **Background**: the IR `background` fills the frame.
2. **Stage**, in scene units under the camera: the frame centre, the cover fit
   `max(width / scene.width, height / scene.height)`, then the camera's rotation, zoom and centre
   (`projectStagePoint` in `src/dl/scene/projection.ts`). Stage siblings draw by svg `layer` (a group
   counts as 0), document order breaking ties, as SceneView sorts entities by layer.
3. **Overlay**, in frame pixels, in document order: groups, rects, text, the rail, captions, the end card.

An `svg` node is drawn like SceneView's entity: `translate(x, y) scale(s) rotate(r)` with its opacity as a
group, then the asset's root children in the asset's own coordinates (the root `<svg>` element's own
attributes and viewBox are not drawn, as in SceneView). Element states follow `svgReact.tsx`: the animated
transform is appended to the authored one (translate, then rotate and scale about the track origin), a
driven opacity replaces the authored attribute, `drawOn` dashes a stroke over its own length and a group's
`drawOn` reaches the strokeable shapes inside it, and `x1`/`y1`/`x2`/`y2` move a line. A compositing layer
is used only where the result needs one: a group (or node) below full opacity, or a shape that has both a
fill and a stroke below full opacity.

### Evaluation

Every value is a pure function of `(IR, format, frame)`: integer frames, f64 maths, no clock, nothing
carried between frames. Track semantics are the IR's (hold before the first keyframe and after the last,
the earlier keyframe's ease shapes a segment). The curves are the project's own, ported and checked against
the TypeScript on the same inputs (`tests/evaluator.rs`):

- `expoIn`, `expoOut`, `expoInOut`, `linear`, `hold`: `applySvgEasing` in `src/dl/scene/svgAnimation.ts`,
  same cubic-bezier solver and iteration counts.
- `spline`: the camera's monotone cubic (`compileCameraTrack` with `evaluateMonotoneSpline`): knots are all
  of the track's keyframes at `frame / (durationFrames - 1)`, padded flat to both ends; a segment whose two
  values are equal holds exactly.
- Element track values are quantized to 4 decimals (`-0` to `0`) and opacity and drawOn clamped to [0, 1],
  like the scene compiler. Camera and node tracks are not quantized, as in TypeScript.
- The caption word spring is Remotion's `spring` (damping 14, stiffness 260, mass 1) in closed form.

### Semantics this renderer gives where the IR is silent

`aideos.render/1` is unfrozen until R4 passes on Still Talking. These are the readings the renderer implements; R4 made some explicit
in the IR (a new field, never a quiet change) where parity with the Remotion render needs it.

| IR part | Reading |
| --- | --- |
| A node track and the static field it names (`x`, `y`, `scale`, `rotation`) | the track's value replaces the field; `opacity` multiplies the static `opacity`; `scaleX` and `scaleY` multiply `scale` on their axis |
| Tracks on `rect` and `text` (no static transform) | `x`, `y` offset the box in pixels; `scale`, `scaleX`, `scaleY` and `rotation` act about the box centre |
| `rect.gradient` | a vertical linear gradient from the box top (offset 0) to its bottom (offset 1), dithered, painted over `fill` and under `stroke` |
| `scale` together with `scaleX` or `scaleY` on one element | `scale` sets both axes, an axis track wins on its axis |
| `text.letterSpacing` | ems (multiplied by the format's font size), like the CSS letter spacing the components use |
| `text` placement | laid out to the box width, top aligned at the box top; not clipped to the box height |
| Caption phrase end | trimmed to the next phrase's start when either phrase's span has a `w` (an owner-chosen card), as `buildCaptionPhrases` does for a non-default placement |
| Caption words not yet spoken | the primary colour at 38% (KineticSubtitles uses white at 38%) |
| Caption card | KineticSubtitles' card: 12 x 28 px padding, 16 px radius, 1 px white 12% border, the shadow, a 16 px backdrop blur (skipped while the phrase fades, as Chrome isolates a partly transparent element's backdrop), rows balanced to two lines |
| Rail | the `scrim` colour fades out over the top 44% of `scrimHeight`; the label row is at the top of the box in `labelColor` and the bar at its bottom, filled in `ink` over `trackColor`; the reel's continuous bar fills over `progressFrames` (the film duration when absent); segment gap 8 px, bar 2 px (long) or 3 px (reel), scaled by width / 1920 (long) or width / 1080 (reel) like `useLayout().px`. `accent` is not drawn (Film.tsx fills with the label colour) |
| End card colours and faces | `surface`, `hairline`, `muted` and `chipFont` when the IR gives them (the emitter always does: the theme's surface, hairline and muted, JetBrains Mono 700 chips over a 400 label and handle); when absent, panel surface: the dim colour made opaque and mixed 6% toward `ink`; hairline: `ink` at 12%; label and handle: `ink` at 60%; chips in `monoFont`; LIKE outline: `ink` at 35%; pill text: whichever of the opaque dim colour and `ink` contrasts more with `fill` (`readableInkOn`) |
| End card timing | EndCard.tsx: the dim settles over 600 ms from `visible.fromFrame`, parts enter 150 ms in on the one entrance (400 ms, 70 ms stagger, 12 px rise), the pill presses for 360 ms from `pressFrame` |

### Fonts and text

A font asset whose file is a variable font with a `wght` axis is instantiated at the asset's `weight`
(clamped to the axis), as a browser does for `font-weight`. The emitter declares one asset per weight, all
pointing at the same vendored file in `native/fonts/`: the exact Geist and JetBrains Mono `latin` files the
Remotion render loads from Google Fonts, unpacked from `woff2` because Skia's FreeType cannot read it.

Every typeface comes from a `font` asset of the IR (a vendored file in the package). On Linux they load
through Skia's FreeType manager with **no system font scan**, and text layout (Skia textlayout: HarfBuzz
shaping, ICU line breaking) runs with **font fallback disabled**, so a render never depends on the fonts
installed on the host and never touches the network. Each face is registered under its asset id, so a text
node's `font` names one exact file. Hinting is off. SVG `<text>` resolves its `font-family` list against the
IR's font assets (generic `monospace` picks a family named "Mono", other generic names the first family
that is not); a family no asset provides is refused at load. On macOS Skia has no FreeType, so the platform
manager loads the same files and glyph rasterization is CoreText's: byte identity holds per platform, and
goldens and gates use the Linux CPU reference.

The test package vendors Geist SemiBold and Bold (from the `geist` npm package 1.3.1) and JetBrains Mono
Medium (release 2.304), both SIL Open Font License 1.1 (`fixtures/package/fonts/*-OFL.txt`).

### Supported SVG

Static scene artwork: `g`, `rect` (with `rx`/`ry`), `circle`, `ellipse`, `line`, `polyline`, `polygon`,
`path`, single-run `text`, `defs`, `linearGradient` and `radialGradient` (bounding-box or user-space units,
`gradientTransform`, spread methods, focal point, and geometry, units, transform, spread and stops inherited
through same-type `href` chains), `clipPath` (user-space
units), presentation attributes and `style` declarations (fill, stroke and their opacities, stroke width,
caps, joins, miter limit, dash array and offset, fill and clip rule, `color`/`currentColor`, opacity, display,
inherited visibility, font family, size and weight, text anchor, letter spacing), `transform` lists, CSS colours
(hex, `rgb()`/`rgba()`, named). `title`, `desc` and `metadata` are skipped.

Rendering attributes whose behavior is not implemented are **refused at load with the attribute named**,
including `vector-effect`, `paint-order`, `mix-blend-mode`, `isolation`, `transform-origin`,
`transform-box`, `shape-rendering`, `text-rendering`, unsupported baseline and font style properties,
`text-decoration`, `writing-mode` and `direction`. Inert metadata attributes remain ignored.

Anything else is **refused at load with the element or attribute named**: filters, masks, markers, `use`,
`image`, `pattern`, `symbol`, `tspan`, SMIL, stylesheets, percentage geometry. Silently dropping part of an
asset would render a wrong frame with no sign of it. The loader also refuses an asset whose IR
`elementIds` name an element the artwork does not contain, a missing file, and a path that resolves outside
the package directory (including through a symlink).

## Determinism

- The CPU raster is the reference. `tests/render.rs` renders the same frame in two separate processes and
  requires byte-identical PNGs (long and reel), and requires a frame to render identically whatever frames
  the same renderer drew before it, and when drawn again.
- No clock, no randomness, no system fonts, no network. Anything iterated during drawing is ordered.
- GPU output is for speed only and is never byte-compared. `tests/gpu.rs` (with `--features gpu`) requires
  the GPU frame to stay within a mean channel difference of 1/255 of the CPU frame, with under 1% of pixels
  more than 8/255 apart (measured on the Intel Iris Xe laptop: mean 0.11, 0.03% of pixels).

## The Skia dependency

**Crate:** `skia-safe` pinned to exactly `=0.157.0` (Skia milestone of that release, `skia-bindings`
0.157.0), features `gl`, `textlayout`, `embed-freetype`, plus the defaults (`binary-cache`,
`embed-icudtl`, `pdf`). That one feature set selects one prebuilt binary per target:

| Target | Prebuilt binary key (release `0.157.0` of `rust-skia/skia-binaries`) | Size |
| --- | --- | --- |
| x86_64 Linux (CI, the laptop) | `30669978c3f39a73e8a7-x86_64-unknown-linux-gnu-ftembed-ganesh-gl-jpegd-jpege-pdf-textlayout` | 21 MB |
| aarch64 Linux | `...-aarch64-unknown-linux-gnu-ftembed-ganesh-gl-jpegd-jpege-pdf-textlayout` | 21 MB |
| macOS (Apple silicon and Intel) | `...-{aarch64,x86_64}-apple-darwin-ganesh-gl-jpegd-jpege-pdf-textlayout` (macOS drops `ftembed`: no FreeType there) | 18 MB |

Changing any feature changes the key, and many combinations have **no** prebuilt (the plan's scout hit a 404
on its first combination), so change the feature list only together with this table. The GPU path is a
crate feature of `aideos-render` (`gpu`), not a Skia feature: it adds `khronos-egl` (libEGL loaded at run
time) and leaves the Skia binary unchanged.

**What links.** `libstdc++` and the system `fontconfig` (Skia's Linux font manager links it even though
the renderer never scans system fonts). FreeType, HarfBuzz, ICU (with its data embedded), libpng and zlib are
inside the Skia binary. No GL library is linked; `--features gpu` loads `libEGL.so.1` when a GPU render is
asked for. A Linux host with only the runtime fontconfig (`libfontconfig.so.1`, no `libfontconfig1-dev`)
cannot satisfy `-lfontconfig`; `build.rs` then links through a symlink to the runtime library in its
`OUT_DIR` and says so in a cargo warning, so no root access is needed.

**How the binary arrives.** On the first build, `skia-bindings`' build script downloads
`https://github.com/rust-skia/skia-binaries/releases/download/0.157.0/skia-binaries-<key>.tar.gz` and
unpacks it into `native/target/<profile>/build/skia-bindings-*/out/skia`. Nothing is installed globally.

**How CI caches it.** The `unit` job's "Restore the Rust build cache" step caches
`~/.cargo/registry`, `~/.cargo/git` and `native/target`, keyed by `native/Cargo.lock`. The unpacked binary
lives in `native/target`, so a cache hit needs no download; a lockfile change misses the cache and downloads
the 21 MB binary once. The cache step was added alongside the Rust test step in the existing `unit` job.

**Mirror or offline build.** `SKIA_BINARIES_URL` replaces the download URL template (`{tag}` and `{key}`
are substituted; `file://` works), for example
`SKIA_BINARIES_URL='file:///srv/skia/skia-binaries-{key}.tar.gz'` with the tarball above saved there.

**Source-build fallback.** When no prebuilt exists for a target or feature set, or with
`FORCE_SKIA_BUILD=1`, `skia-bindings` builds Skia from source: it fetches the Skia sources and their third
party dependencies, then runs GN and ninja. That needs `git`, `python3`, `ninja` and `clang` (C++17), takes
tens of minutes and several GB, and honours `SKIA_NINJA_COMMAND`, `SKIA_GN_COMMAND` and `SKIA_SOURCE_DIR`.
The source build has not been exercised for this crate; the prebuilt covers every target above.

## The emitter (R4)

`backend/renderIr/emit.ts` turns one format of a film into a validated IR, reading every number from the
modules the Remotion render reads, so the native picture follows the authored film rather than a second
description of it. One IR per (film, format): the delivered length, the end card and the overlay geometry
differ per format.

| Film part | IR |
| --- | --- |
| `film.scene` background and props | `svg` stage nodes at their position, scale, rotation, opacity and layer (`layer ?? round(y)`, as the compiler) |
| Clip timelines | one element track per driven slot (`scale` writes `scaleX` and `scaleY`, as the compiler); each clip is one eased segment; a clip ended by an adjacent clip that continues from its end value stays one segment; a clip cut by a snapping clip or by the story's end is linear or held where that is exact, else per-frame keyframes. `emit.test.ts` checks every frame against `compileScene` |
| The camera (`compileCameraTrack`, including the hold push) | per-frame linear keyframes, compressed to where the slope changes |
| Asset-level Catmull-Rom tracks | per-frame keyframes from `compileScene` |
| The end card's freeze and slow push (`Film.tsx`), a shot's drift | the stage holds the story's last frame; the push multiplies the camera zoom, and the text cards sit in one overlay group scaled about the frame centre |
| `frame` shots' `TextReveal` | a scrim band (`gradient` rect), one `text` node per word laid out like the flex row (greedy wrap, rows centred, block centred in the stage margins) with the per-word entrance as per-frame `opacity` and `y` keyframes, the accent word's core and tail in their colours, and its underline as a rect whose `scaleX` and `x` keyframes draw it from the left |
| `StatCounter` | one group per value on screen (number, muted suffix baseline-aligned in the number's letter spacing, uppercase label), visible while that value shows, inside the block's entrance |
| The rail | `rail` with the label in the muted colour, the bar in ink, chapters spanning their shots, `progressFrames` set to the story |
| The end card | `endCard` with the `getEndCardLayout` geometry, the configured copy, `subscribePressFrame`, and the theme's surface, hairline, muted colour and faces |
| The frame's 1 px hairline | a stroked `rect` |
| Narration, end-card line, library music sections, library effects | audio clips with gain 1 and the level as a per-frame linear envelope: `voiceLevel`'s ramps; `mixSections`, `sectionEnvelope` and `speechGain` (ducking under the measured speech); `effectGain` |

Text is measured with `aideos-render measure`, so layout and drawing share one set of metrics. The emitter
refuses (with every reason, `nativeSupport`) a node-graph film, a Three-stage or actor scene, sub-group
rotation, a scene asset with no SVG source, a chapter with no shots, imported footage and overlay clips, a textured theme, burned-in captions, legacy (non-library)
music and audio clips, panels other than `frame`, more than one block per shot and blocks other than
`TextReveal` and `StatCounter`. Those stay on Remotion until their phase.

## The renderer flag

`aideos render` and `aideos reel` (`scripts/render_active.ts`) take `--renderer remotion|native`, or read
`AIDEOS_RENDERER`; Remotion is the default. Native is used only when the emitter supports the film in that
format and the binary is built (`native/target/release/aideos-render`, or `AIDEOS_RENDER_BIN`); otherwise
the render falls back to Remotion and prints why. The native adapter (`backend/nativeRenderer.ts`)
implements the RenderJob `Renderer` interface: `prepare` emits the IR and stages the package (IR, artwork,
fonts, hard-linked audio) inside the job's attempt directory, `checkDiskBudget` needs room for the mp4 plus
the shared 3 GiB reserve (no frame images are written), and `render` runs `aideos-render video` through the
shared subprocess runner, which owns cancellation and the disk watchdog. The job's delivery checks,
mastering, probe and sidecar are unchanged; the sidecar records the CRF as applied only when x264 encoded.

## Not yet native

Node-graph films, the other primitives, devices, inset and panel stages and footage (Phase 2), burned-in
kinetic captions in the emitter (the raster draws them; the emitter does not emit them yet), GPU encoding of
whole films (the GPU path renders stills), the editor preview, the Node addon, effects such as the paper curl,
and the Three stage. `image` and `audio` assets are not opened by the frame raster.
