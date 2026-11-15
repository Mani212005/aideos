<!--
File Description: Reference for the native renderer `native/aideos-render` (R2 and R4 of Phase 1 of the native renderer plan): what it draws, how a frame is evaluated, the semantics it gives the parts of the Render IR that the IR leaves open, the SVG subset it supports, whole-film rendering and text measurement, the TypeScript emitter and the renderer choice every render job makes (native for supported films, Remotion otherwise, the kill switch), the Three stage's Phase 4 steps (P4.1 carries it in `aideos.render/2`, P4.2 draws it for one performer in the cel treatment with the CPU rasterizer in `raster/stage3d/`, P4.3 draws several performers, Pip and Marlo, P4.4 draws the dots-v1 treatment), determinism, the exact Skia dependency (pinned feature set, prebuilt binary, CI cache, source-build fallback) and the commands that build, test and run it.
-->

# Native renderer (`native/aideos-render`)

`aideos-render` evaluates a Render IR [`aideos.render/1` or `/2`](RENDER_IR.md) as a pure function of the frame
number and draws the frame with Skia. Skia's **CPU rasterizer is the deterministic reference**; an
optional GPU path draws the same frame through OpenGL. There is no browser, no DOM and no HTML.

R2 of Phase 1 added the evaluator and the raster, with a CLI that renders one frame to a PNG. R3 added the
encoder and audio mux (`native/aideos-encode`, [NATIVE_ENCODE.md](NATIVE_ENCODE.md)). R4 connects them:
`aideos-render video` renders a whole film to an mp4 through the R3 encoder, `aideos-render measure` gives
the TypeScript emitter the raster's own text metrics, and the emitter (`backend/renderIr/emit.ts`) turns a
scene film into the IR. Every render job (pipeline final render, studio Export, review and all-check renders,
`aideos render` and `aideos reel`) draws a film natively when the emitter supports it in that format and renders
every other film on Remotion as before (see [The renderer flag](#the-renderer-flag)). The crate knows nothing of the `RenderJob` state machine: the
adapter in `backend/nativeRenderer.ts` hands it an IR path, a package directory and a format.

## Where things live

| Piece | Path |
| --- | --- |
| Frame evaluator (tracks, easing, camera spline, spring, element states, rail, end card) | `native/aideos-render/src/eval/mod.rs`, `track.rs`, `spring.rs` |
| Kinetic caption phrases (port of `captionPhrases.ts`) | `native/aideos-render/src/eval/captions.rs` |
| Retained SVG model and parser | `native/aideos-render/src/svg/mod.rs`, `color.rs` |
| Raster: stage and overlay, SVG drawing, chrome (rail, captions, end card), fonts | `native/aideos-render/src/raster/` |
| Three stage rasterizer (graph pose, face painting, triangle setup, tile raster) | `native/aideos-render/src/raster/stage3d/` (`pose.rs`, `face.rs`, `setup.rs`, `tiles.rs`) |
| Public `Renderer` (asset loading, checks, CPU render, PNG) | `native/aideos-render/src/renderer.rs` |
| Optional GPU path (feature `gpu`) | `native/aideos-render/src/gpu.rs` |
| Whole-film render: worker threads, RGBA to I420, in-order hand-off to the R3 encoder, audio plan from the IR | `native/aideos-render/src/video.rs` |
| Text measurement for the emitter | `native/aideos-render/src/measure.rs` |
| CLI (`<ir> --frame`, `video`, `measure`) | `native/aideos-render/src/main.rs` |
| Vendored variable fonts (Geist, JetBrains Mono) used by every emitted film | `native/fonts/` (provenance in its README) |
| The IR emitter (film.json to `aideos.render/1`, or `/2` for a Three-stage film) | `backend/renderIr/emit.ts`, `backend/renderIr/emitStage3d.ts` |
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

aideos render                               # native when it can draw the film, else Remotion (the reason is printed)
AIDEOS_RENDERER=remotion aideos render      # kill switch: every film on Remotion (or --renderer remotion)
AIDEOS_RENDERER=native aideos render        # require native: a film it cannot draw fails (or --renderer native)
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
| Caption card | KineticSubtitles' card: 12 x 28 px padding, 16 px radius, 1 px white 12% border, the shadow, a 16 px backdrop blur (skipped while the phrase fades, as Chrome isolates a partly transparent element's backdrop), rows balanced to two lines; the card is as wide as the phrase on one row, capped at 92% of the placement width, and a wrapped phrase keeps the capped width (`text-wrap: balance` evens the rows but never narrows the box); its edges snap to whole pixels as Chrome snaps a box (the left and right edges in the frame of the `translateX(-50%)` container, the top and bottom on the page); nothing is clipped to the card's content box, so the active word's spring scale and glow reach into the padding |
| Rail | the `scrim` colour fades out over the top 44% of `scrimHeight`; the label row is at the top of the box in `labelColor` and the bar at its bottom, filled in `ink` over `trackColor`; the reel's continuous bar fills over `progressFrames` (the film duration when absent); segment gap 8 px, bar 2 px (long) or 3 px (reel), scaled by width / 1920 (long) or width / 1080 (reel) like `useLayout().px`. `accent` is not drawn (Film.tsx fills with the label colour) |
| End card colours and faces | `surface`, `hairline`, `muted` and `chipFont` when the IR gives them (the emitter always does: the theme's surface, hairline and muted, JetBrains Mono 700 chips over a 400 label and handle); when absent, panel surface: the dim colour made opaque and mixed 6% toward `ink`; hairline: `ink` at 12%; label and handle: `ink` at 60%; chips in `monoFont`; LIKE outline: `ink` at 35%, a 2 px border added to the chip's width and content offset (the chip's width is auto); pill text: whichever of the opaque dim colour and `ink` contrasts more with `fill` (`readableInkOn`) |
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
node's `font` names one exact file. Skia's paragraph painter always draws with slight hinting (turning hinting off in the paragraph style has no effect on it), while the Chrome render draws unhinted outlines, so `Text::paint` (`raster/text.rs`) reads the shaped runs back from the paragraph and draws the glyphs itself with hinting off, which is what makes a 45 px Geist capital 32 px tall as in Chrome (33 hinted). It also places text as Blink does: the font's ascent, descent and gap rounded to whole pixels, half the leading above the line rounded down, the baseline rounded to a whole pixel, a line's height the CSS line height (Skia rounds it up to a whole pixel), the letter spacing all after each glyph (Skia puts half before and half after) and CSS `text-shadow` order (the first shadow on top). Translucent colour is blended as Chrome's compositor blends it, rounding to the nearest level, where Skia's 8-bit CPU blend truncates (a 55% dim of the canvas colour over the canvas colour came out one level too dark, which costs 0.005 SSIM on a flat dark frame): the end card's full-frame dim is painted with the alpha and colour, each within two levels, whose 8-bit blend over the film background (probed on a one pixel surface, cached) is nearest the rounded exact blend, and every other translucent solid colour (the chrome's fills and strokes and SVG fills and strokes) is painted by a one-colour shader that Skia blends in floating point. A half-float frame surface did the same for every layer but cost a quarter more CPU time, and a shader dim cost 5 ms a frame. SVG `<text>` resolves its `font-family` list against the
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

## Native golden frames

`native/aideos-render/tests/golden.rs` holds the CPU raster's own reference frames, separate from the Chrome
goldens in `backend/journeys/goldens/` (those still guard the default Remotion render and are untouched). The set
covers the native-supported fixture films, `hello-scene`, `still-talking` and the Three-stage character films `iona-receive`, `pixels-stage-pip`, `pixels-stage-marlo` and `journey-three-characters` (the J5 film: Iona, Pip and Marlo, each with a glider), in long and reel, at the same frames
and the same quarter scale as the Chrome goldens (`fixtures/golden/frames/<film>/<format>-<frame>.png`, 480 x 270
or 270 x 480, a 4 x 4 box average of the 1920 x 1080 CPU frame). `fixtures/golden/<film>/render.<format>.json` are
the emitter's IR for those films with the audio clips dropped (the frame raster never opens audio), with the
artwork in `<film>/visuals/`; fonts come from `native/fonts/`. `MANIFEST.json` records the platform, the renderer
version, the Skia pin and the tolerance.

The test (run by `cargo test`, so by the CI unit job) renders each frame and requires a mean channel difference of
at most 0.05 and at most 0.1% of pixels more than 8 apart, the same strict tolerance as
`backend/journeys/goldenCompare.ts`. It is verified on Linux only (macOS glyphs are CoreText's). To remake the set
after an intended change: `npm run goldens:native:ir` (needs the release binary; re-emits the IR) then
`AIDEOS_NATIVE_GOLDEN_UPDATE=1 cargo test --locked --manifest-path native/Cargo.toml -p aideos-render --test golden`,
which renders every frame twice and refuses to write a frame whose two renders differ. Never loosen the constants
in the test; the manifest check fails if they change without a new set.

The set is separate because the Chrome goldens record Remotion's pixels and the native renderer is a different
raster, so one reference cannot serve both. It was re-baselined on the native CPU reference after parity was shown
on the Phase 1 proof film (below), with the same strict tolerance and never a looser one. No Chrome golden,
tolerance or workflow is changed.

### Phase 1 parity on claude-dreaming

The Phase 1 proof film is `claude-dreaming` (the captain's unfinished film; its package is gitignored and not
committed). It was rendered through the native renderer and through Remotion on the same machine, in both formats,
and compared frame by frame.

| Measure | Long | Reel |
| --- | --- | --- |
| SSIM mean | 0.99474 | 0.99358 |
| SSIM min | 0.98684 (frame 4617, end card) | 0.98746 (frame 4617, end card) |
| PSNR mean | 39.56 dB | 39.92 dB |
| PSNR min | 31.19 dB | 32.08 dB |
| Whole-command time, native | 2:43 | 2:43 |
| Whole-command time, Remotion | 13:14 | 13:22 |
| Gemini 3.8 Flash criteria mean, native | 9.37 | 9.42 |
| Gemini 3.8 Flash criteria mean, Remotion | 9.42 | 9.40 |

No frame has an SSIM under 0.98, the worst frames in both formats are the end card, and all four Gemini reviews
are ACCEPT. Machine load differed between the native and Remotion runs, so the times are indicative. The evidence
(README.md and completeness.md, which lists what the unfinished film still lacks) is in
`/home/mani/aideos-linux-home/data/aideos-phase1-dreaming-proof/`.

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
| Burned-in kinetic captions (`KineticSubtitles`) | a `captions` node: the film's caption words plus the end card's spoken line, white text, the accent as the highlight, the component's `rgba(10, 15, 29, 0.88)` card (quantized to 8-bit alpha), Geist 600 (the component asks for 700, but `tokens.ts` loads Geist at 300 to 600 only, so Chrome draws the 600 face and the emitter matches the render), `round(min(width, height) * 0.042)` px, and one placement span per shot where the resolved `captionPlacement` changes (read at a phrase's first word, as `captionPlacementAt` does). Words starting after the delivered length are dropped and a word's end is capped at it |
| The frame's 1 px hairline | a stroked `rect` |
| Narration, end-card line, library music sections, library effects | audio clips with gain 1 and the level as a per-frame linear envelope: `voiceLevel`'s ramps; `mixSections`, `sectionEnvelope` and `speechGain` (ducking under the measured speech); `effectGain` |

Text is measured with `aideos-render measure`, so layout and drawing share one set of metrics. The emitter
refuses (with every reason, `nativeSupport`) a node-graph film, an actor scene, sub-group
rotation, a scene asset with no SVG source, a chapter with no shots, imported footage and overlay clips, a textured theme, legacy (non-library)
music and audio clips, panels other than `frame`, more than one block per shot and blocks other than
`TextReveal` and `StatCounter`. Those stay on Remotion until their phase.

## The Three stage (Phase 4)

The captain approved native rendering of the Three-stage character films ("Start B now"). This reverses his
earlier decision that those films stay on Remotion until their phase. The design and measurements are in the
Phase 4 report (a native prototype drew the real iona-receive film at 3.5x to 6.7x Remotion's speed, whole-frame
SSIM 0.998). The captain's answers to its decisions: the parity gate is the strict golden tolerance against
**native** goldens, plus a per-frame SSIM report against Remotion as evidence (bar 0.995); a Remotion export stays
the oracle of the J3 Player-versus-export journeys until a WASM preview exists; no look change and no draft tier.
Remotion stays the default and the kill switch for everything not yet native. The work lands in steps:

| Step | What | State |
| --- | --- | --- |
| P4.1 | `aideos.render/2` (the `stage3d` node and the `mesh` asset), its loaders and validators in TypeScript and Rust, the emitter (`backend/renderIr/emitStage3d.ts`), the mesh file codec and the reference pose (`backend/renderIr/stage3d.ts`) | done: nothing changes for users |
| P4.2 | the CPU rasterizer of the stage3d node and the first film (iona-receive, cel, one performer), native goldens and the parity report ([P4.2 parity on iona-receive](#p42-parity-on-iona-receive)) | done: `nativeSupport` accepts cel-v1 with one performer |
| P4.3 | several performers (the J5 film, Iona, Pip and Marlo each with a glider), Pip and Marlo as the performer: data and emitter work on the P4.2 rasterizer, native goldens for `pixels-stage-pip`, `pixels-stage-marlo` and `journey-three-characters`, and the parity report ([P4.3 parity on Pip, Marlo and J5](#p43-parity-on-pip-marlo-and-j5)) | done: `nativeSupport` accepts cel-v1 with any number of performers |
| P4.4 | the `dots-v1` treatment: the IR carries it (additive), the CPU rasterizer draws point sprites, edge lines and treatment spans, native goldens for the J3 and J4 film, and the parity report ([P4.4 parity on the dots film](#p44-parity-on-the-dots-film)) | done: `nativeSupport` accepts dots-v1 |
| P4.5 | journeys and goldens per the captain's decision | |

Since P4.2, `nativeSupport` accepts a Three-stage film in the cel treatment with one performer, and since P4.3 with
any number of performers, and since P4.4 the dots-v1 treatment too. Every other reason
`nativeSupport` lists is unchanged. The IR carries every performer in one `stage3d` node (the emitter builds each
performer and its prop as `ThreeStage` does, so ids are `<cast>.mesh.<name>` and `<cast>.group.<name>`, unique across
performers), so there is no development-only emit any more: what the IR carries the renderer draws.
A film without a Three stage is still emitted as `/1`, byte for byte as before.

For a Three film the emitter writes the stage as `SceneStage` draws it: a `ground-plane` group (the background
and `plane: "background"` props; props with no plane are not drawn on a Three film), the `stage3d` node, then a
`foreground-plane` group when there are `plane: "foreground"` props. The frame-scale drift is off for a Three film
(as `Film.tsx`), and the end card's slow push stays in the document camera's zoom (Remotion scales the whole
canvas about the frame centre; for the orthographic stage that is the same projection). The stage is sampled at
frames 0 to `min(storyFrames, scene.durationFrames) - 1` and holds after, which is what `ThreeStage` sees
through `Freeze` and its own clamp. `stage3d.test.ts` checks, for every frame of the iona-receive fixture (and every
fifth frame of the three-performer J5 film), that the world vertices posed from the IR equal the posed vertices
`prepareStageFacts` measures, bit for bit in f32.

### How the stage is drawn (P4.2)

`raster/stage3d/` is a small deterministic CPU z-buffer renderer, not a port of three.js: it draws exactly what the
cel treatment uses (orthographic camera, three-band toon, flat colours, one painted face texture per character,
inverted-hull ink outlines, the glider tip's polygon offset); the dots-v1 treatment is drawn on the same rasterizer ([How dots-v1 is drawn](#how-dots-v1-is-drawn-p44)). `draw_frame` draws the `stage3d` node in document
order between the SVG planes: the stage renders its own premultiplied RGBA layer under the document camera and
Skia composites it (at the node's opacity) over what the earlier planes drew.

| Step | Rule |
| --- | --- |
| Pose (`pose.rs`) | the graph's local transforms at sample `min(frame, sampleFrames - 1)`, `compose` and `multiply` in three r180's f64 arithmetic, `applyMatrix4` rounded to f32: the arithmetic `backend/renderIr/stage3d.ts` writes out and `stage3d.test.ts` checks against `prepareStageFacts` |
| Projection (`setup.rs`) | the document camera and cover fit exactly as `stagePointProjector` (so the stage lines up with the SVG planes), window depth `((cameraZ - z) - near) / (far - near)`, positions snapped to 4 sub-pixel bits (1/16 pixel) |
| Faces and culling | the winding of the snapped triangle, flipped by a mirroring world matrix, against the material's `side` |
| Coverage (`tiles.rs`) | exact i64 edge equations at the four MSAA samples (the GL standard pattern, flipped to y down), the top-left fill rule, z clip to the near and far planes |
| Depth | f32 buffer per sample, `LEQUAL`, polygon offset as `glPolygonOffset` (`factor * slope + units * 2^-24`); a pixel whose covered samples all fail depth is not shaded |
| Shading | once per pixel at its centre (no centroid): toon bands precomputed per material from the IR's lights and ramp (Lambert `diffuse / pi` times the lit directional plus the ambient light), back faces and `BackSide` flip the normal, flat colours for basic and ink, the face texture bilinear in linear light (sRGB8 decode table, clamp, flipY, no mipmaps); sRGB encode once to 8 bits |
| Resolve | the box average of the four 8-bit samples, rounded to nearest, premultiplied over a transparent clear |
| Faces (`face.rs`) | the recorded Canvas 2D program replayed into a Skia CPU surface (Skia is what Chrome's canvas draws with), painted on first use and cached per program, shared by every worker thread |

**Determinism.** Triangles keep the IR's drawable order and are binned into 32 x 32 pixel tiles in that order; a tile
reads only its own list and writes only its own pixels. There is no clock, randomness or thread-dependent state, so a
frame is the same bytes on every run, in any frame order and at any thread count. `tests/stage3d.rs` checks that on
synthetic scenes (a repeat render, frames backwards, four threads sharing one stage) and `video` shares the loaded
stage between its workers. The native goldens of the character films (see [Native golden frames](#native-golden-frames)) are Linux only, like the others.

**Limits.** One `stage3d` node, `cel-v1` and `dots-v1`, `dpr` 1, exposure 1, no tone mapping (the loader refuses the rest by name).
A path in a face program is built in the user space current when it is filled, which is what the painter relies on.

### How dots-v1 is drawn (P4.4)

`materials/dots.ts` is the source of truth; the emitter reads its result off three's own objects (see
`docs/RENDER_IR.md`, "The dots-v1 treatment") and `raster/stage3d/dots.rs` draws it. Every rule of the point sprites
below was measured on Chrome's SwiftShader with standalone WebGL2 probes (the same shaders, a grid of points at
random sub-pixel positions, sizes and depths, 4x MSAA, `readPixels`), not assumed, and then confirmed on the real
film (frame 111, the 3D stage's mean absolute difference from Remotion fell to 0.02 of 255):

| Step | Rule |
| --- | --- |
| Treatment | per cast member and frame: the first scene span holding `min(frame, sampleFrames - 1)`, else the cast member's own treatment, else the scene's (`stageTreatmentAt`) |
| Draw order | opaque pass first: every drawable's triangles in the look in use (cel, dots paper, ink hull) and the prop's edge lines, ascending by three's material creation order (the IR carries the ranks of those ids); then the dots as three's transparent pass, objects far first by the window depth of their sample field's bounding box centre |
| Paper | flat `0x0a0a0b` (white for a light fill, the face texture through `smoothstep(0.06, 0.4, luma)` for the head), the original side, no polygon offset; the hull white or black |
| Vertex stage | per sample, in view space (the camera at the document camera's centre, rolling about z): lighting band of `dot(n, normalize(3, 6, 5))` (0.25, 0.58 or 0.93), `lod = clamp(ppu / 100, 0.18, 1)`, `density`, `coverage = smoothstep(rank - 0.1, rank + 0.1, density)`, the back face cull toward the camera origin, `size = max(1, clamp(ppu * 0.024, 2, 4.6) * sqrt(coverage))` (the GL point size range starts at 1), window depth minus `1e-6` |
| Sprite coverage | a sample is covered when it lies in `[round16(c - s/2), round16(c + s/2))` on both axes (GL window space, y up, 1/16 pixel units, `c` the unsnapped centre); 0 mismatches in 230,000 probe pixels |
| Fragment | shaded once per pixel at its centre: `r` from the point coordinate whose origin uses the centre snapped to 1/16 pixel; `edge = max(fwidth(r), 0.04)` with `fwidth` the COARSE derivative of the 2x2 quad (pairs of columns and of GL rows, read from the even GL row and even column); `alpha = 1 - smoothstep(0.5 - edge, 0.5, r)`, discarded below 0.01 |
| Depth and blend | per sample LEQUAL against the opaque depth buffer, the dots never write depth; `round(255 * (alpha + dst / 255 * (1 - alpha)))` per channel and layer, alpha included |
| Triangle depth in a dots document | SwiftShader evaluates a triangle's depth plane at the sample's x mirrored about the pixel centre; applied to documents that use dots-v1 only, so the cel documents' pictures stay as they were |
| Edge lines | opaque white, a width 1 rectangle around the segment with its four corners snapped to 1/16 pixel, depth interpolated along the segment, depth written |

**Determinism.** The sprites are prepared per frame in IR order, binned into the same 32 x 32 pixel tiles after the
triangles, and each tile draws its triangles then its sprites in that order, so a frame with dots is the same bytes
on every run and at every thread count (`tests/stage3d_dots.rs`, and every native golden).

### P4.2 parity on iona-receive

Two things are measured, and they are not the same gate. The strict golden tolerance gate is native against native
goldens (`cargo test`, `tests/golden.rs`). The SSIM figures are evidence against Remotion, not a gate: every frame of
both formats was measured (ffmpeg `ssim` and `psnr`, Remotion PNG sequence against the native PNGs, same machine).
The evidence is kept at `/home/mani/aideos-linux-home/data/aideos-native-p42-raster/ssim/` (`parity-long`,
`parity-reel`: `per-frame.json`, `summary.json` and the worst-frame side-by-sides).

| Measure | Long (480 frames) | Reel (390 frames) |
| --- | --- | --- |
| Whole-frame SSIM min | 0.97965 (frame 345, end card) | 0.98056 (frame 345, end card) |
| Whole-frame SSIM mean | 0.99067 | 0.99007 |
| Whole-frame PSNR min | 28.31 dB | 29.21 dB |
| Whole-frame PSNR mean | 35.46 dB | 37.07 dB |
| Story frames SSIM min | 0.99458 (frames 0-299) | 0.98923 |
| Story frames SSIM mean | 0.99642 | 0.99220 |
| Story frames PSNR min | 35.19 dB | |
| Story frames PSNR mean | 38.99 dB | |
| End card SSIM min | 0.97965 (frames 300-479) | 0.98056 |
| End card SSIM mean | 0.98110 | 0.98298 |
| Character crop only SSIM min | 0.99893 | 0.99848 |
| Character crop only SSIM mean | 0.99924 | 0.99894 |

The 0.995 bar is **not** met on whole frames: the long story minimum is 0.99458, the reel story minimum is 0.98923
and both end cards are below 0.99. The cause is the 2D text that is already native (the caption card width and
wrap, the rail and the end card text in native fonts against Chrome text, as in the Phase 1 parity on
claude-dreaming), not the stage. With the text out of the measure (the character crop, the stage isolated by
region) the SSIM is 0.9985 or higher, and the stage differs from Remotion only by thin edge lines. No threshold and
no golden was changed to reach these figures.

### P4.3 parity on Pip, Marlo and the J5 film

P4.3 changes no raster code: the P4.2 rasterizer already draws every performer the emitter writes (one `stage3d` node,
each performer's own objects, face texture and per-frame face program track, drawables ordered by material creation
as three sorts them, one depth buffer). Mirrored left and right parts are baked into the geometry (the mesh file holds
each shared geometry once) and the round eyes are ordinary face program ops, so both needed no renderer work. What P4.3
adds is the acceptance of several performers by `nativeSupport`, native goldens for `pixels-stage-pip`,
`pixels-stage-marlo` and `journey-three-characters` (the J5 film: Iona, Pip and Marlo, each with a glider) in the
native golden set, and this measurement. Same method and machine as P4.2 (every frame of both formats, ffmpeg `ssim`
and `psnr` for the whole frame; the stage crop and the rest of the frame are the 11 x 11 gaussian SSIM map averaged
over that region; the crop is the union of every performer's and prop's projected bounds over the story plus 24 px).
Evidence: `/home/mani/aideos-linux-home/data/aideos-native-p43-pip-marlo/parity/<film>-<format>/`.

| Film, format | Stage crop SSIM story min / mean | Whole frame story SSIM min / mean | Whole frame end card SSIM min / mean | Whole frame story PSNR min / mean (dB) |
| --- | --- | --- | --- | --- |
| J5 three characters, long | 0.99686 / 0.99714 | 0.99457 / 0.99642 | 0.97977 / 0.98113 | 35.17 / 38.95 |
| J5 three characters, reel | 0.99896 / 0.99914 | 0.98923 / 0.99220 | 0.98061 / 0.98302 | 34.20 / 38.69 |
| Pip, long | 0.99880 / 0.99915 | 0.99453 / 0.99637 | 0.97986 / 0.98124 | 35.16 / 38.93 |
| Pip, reel | 0.99886 / 0.99922 | 0.98914 / 0.99215 | 0.98071 / 0.98314 | 34.20 / 38.67 |
| Marlo, long | 0.99937 / 0.99951 | 0.99459 / 0.99643 | 0.97986 / 0.98124 | 35.19 / 39.01 |
| Marlo, reel | 0.99949 / 0.99963 | 0.98925 / 0.99222 | 0.98069 / 0.98310 | 34.22 / 38.76 |

The 3D stage crop meets the 0.995 bar on every story frame of all six runs. The whole-frame bar is not met, for the
same reason as at P4.2: the already-native 2D text (caption card width and wrap, rail, end card text in native fonts
against Chrome text; the rest of the frame outside the crop reaches 0.9858 at worst and the end card 0.9798), not the
stage. That is tracked as `aideos-native-2d-text-parity`. The end card frames carry the end card text inside the stage
crop's box, so the crop figure is only meaningful on story frames. Against the committed Remotion stage stills of
`test_fixtures/characters/stage-stills/`, native frame 111 of Pip and Marlo has a stage crop SSIM of 0.9997 to 0.9998
(whole frame 0.9956 long, 0.9887 reel). The strict golden tolerance is the gate for native against native goldens only
(`cargo test`); no threshold or golden was changed.

### P4.4 parity on the dots film

Same method and machine as P4.2 and P4.3 (every frame of both formats, ffmpeg `ssim` and `psnr` for the whole frame; the
stage crop and the rest of the frame are the 11 x 11 gaussian SSIM map averaged over that region; the crop is the union
of every performer's and prop's projected bounds over the story plus 24 px). Film: `journey-j3-j4-dots` (Iona in
dots-v1 beside a cel Iona with her own glider; `backend/testSupport/characterFilms.ts`). Evidence:
`/home/mani/aideos-linux-home/data/aideos-native-p44-dots/parity/journey-j3-j4-dots-<format>/`.

| Format | Stage crop SSIM story min / mean | Whole frame story SSIM min / mean | Whole frame end card SSIM min / mean | Story PSNR min / mean (dB) | End card PSNR min / mean (dB) |
| --- | --- | --- | --- | --- | --- |
| long (480) | 0.99981 / 0.99990 | 0.99465 / 0.99651 | 0.97856 / 0.98027 | 35.20 / 39.03 | 28.25 / 29.36 |
| reel (390) | 0.99981 / 0.99996 | 0.98931 / 0.99229 | 0.97986 / 0.98217 | 34.23 / 38.79 | 29.15 / 30.99 |

The 3D stage crop meets the 0.995 bar on every story frame of both formats (minimum 0.99981). The whole-frame bar is not met,
for the same reason as at P4.2 and P4.3: the already-native 2D text (caption card, rail and end card text in native fonts
against Chrome text), tracked as `aideos-native-2d-text-parity`; the end card frames carry text inside the crop box, which is
why the crop measure falls to 0.93 there. Getting the stage crop here took measured rules, written up in
[How dots-v1 is drawn](#how-dots-v1-is-drawn-p44): the first draw of the dots (rules taken from the shader source alone)
scored 0.9906 on the crop; the last two corrections (the derivative's reference row, and the x mirrored depth sample
positions) took one frame's mean absolute difference from Remotion from 1.13 to 0.02. No threshold and no golden was changed.

### 2D text parity with Chrome (aideos-native-2d-text-parity)

The follow-up the P4.2 to P4.4 parity notes above point to. Same method (every frame of both formats, ffmpeg `ssim` and
`psnr` on the whole frame against the Remotion PNG sequence). Seven causes were measured and fixed;
none changed a threshold, a Chrome golden or the film design language:

| Cause (measured) | Where | What Chrome does |
| --- | --- | --- |
| a 1 level dark bias on every flat dark pixel under a translucent layer (0.005 SSIM on the end card, about a fifth of its shortfall) | `raster/chrome.rs` | the compositor rounds to the nearest level (Skia's 8-bit blend truncates): the dim's alpha and colour are tuned against a one pixel probe, other translucent solid colours use a float shader |
| glyphs drawn with slight hinting (cap height 33 px at 45 px Geist, Chrome 32) | `raster/text.rs` | unhinted outlines, drawn by `Text::paint` |
| baselines on fractions of a pixel, line heights rounded up by Skia | `raster/text.rs` | ascent, descent and gap rounded, leading floored, baseline on a whole pixel, exact line height |
| letter spacing half before each glyph | `raster/text.rs` | all of it after each glyph (0.5 to 1.5 px on spaced labels) |
| the caption card narrower than Chrome's in the reel | `raster/chrome.rs` | `text-wrap: balance` keeps the box at the capped width |
| the cut-off full stop (a clip to the card's content box) | `raster/chrome.rs` | no content-box clip: the spring scale and glow reach the padding |
| end card panel and chips: LIKE chip 4 px narrow, panel 2 px narrow, fractional box edges | `raster/chrome.rs` | borders add to auto widths, boxes pixel-snap, the entrance's fractional rise moves them after |

Whole-frame SSIM against Remotion, all frames (bar 0.995, before this change > after it). Evidence:
`/home/mani/aideos-linux-home/data/aideos-native-2d-text-parity/` (`runB/parity/<film>-<format>/`, `deliver/`).

| Film, format | Story SSIM min | End card SSIM min | Frames under 0.995 |
| --- | --- | --- | --- |
| iona-receive, long / reel | 0.99458 > 0.99857 / 0.98923 > 0.99903 | 0.97965 > 0.99886 / 0.98056 > 0.99877 | 174 > 0 of 480 / 285 > 0 of 390 |
| journey-three-characters, long / reel | 0.99457 > 0.99857 / 0.98923 > 0.99901 | 0.97977 > 0.99885 / 0.98061 > 0.99885 | 174 > 0 / 285 > 0 |
| pixels-stage-pip, long / reel | 0.99453 > 0.99849 / 0.98914 > 0.99895 | 0.97986 > 0.99897 / 0.98071 > 0.99900 | 174 > 0 / 285 > 0 |
| pixels-stage-marlo, long / reel | 0.99459 > 0.99857 / 0.98925 > 0.99905 | 0.97986 > 0.99896 / 0.98069 > 0.99894 | 174 > 0 / 285 > 0 |
| journey-j3-j4-dots, long / reel | 0.99465 > 0.99865 / 0.98931 > 0.99912 | 0.97856 > 0.99779 / 0.97986 > 0.99750 | 174 > 0 / 287 > 0 |
| hello-scene, long / reel | 0.98740 > 0.99794 / 0.98495 > 0.99851 | 0.97945 > 0.99906 / 0.98033 > 0.99910 | 476 > 0 of 480 / 320 > 0 of 390 |
| still-talking (story frames 0-299 and the end card), long / reel | 0.98145 > 0.99416 / 0.98623 > 0.99617 | 0.97959 > 0.99370 / 0.98007 > 0.99591 | 480 > 50 of 480 / 389 > 0 of 390 |

The 0.995 bar is met on every frame of every film and format except one: still-talking long, where 50 frames are
under it (frames 4 to 21, 266 to 299 and 4621 to 4625, minimum 0.99370). On the story frames of that film 74% to 82% of
the SSIM loss is the scene's own artwork (gradient banding and the anti-aliasing of the star discs), not text; on frame
4621 the loss is the text card, whose words sit about 0.9 px left of Chrome's and whose stems are lighter (a text
gamma of 1.2 with no extra contrast reproduces Chrome's total ink on that frame to 0.1% where Skia's default is 4%
heavier, but it moves no SSIM figure by more than 0.0002, so it is not applied). The text card row layout in
`emit.ts` is measured with Skia widths against Chrome's DOM widths, which is the likely source of the 0.9 px.

## The renderer flag

Every render job chooses its renderer through `createSelectedRenderer` (`backend/rendererSelection.ts`): the
pipeline's render stage (`backend/pipeline/run.ts`), the studio Export (`backend/exportJobs.ts`), the review and
all-check render (`backend/geminiReview/render.ts`) and `aideos render` / `aideos reel`
(`scripts/render_active.ts`, which also takes `--renderer`). The choice is made when the job prepares, on the film
the job actually renders (after the studio's preparation), and is read from `AIDEOS_RENDERER`:

| `AIDEOS_RENDERER` | Behaviour |
| --- | --- |
| unset or `auto` (default) | native when `nativeSupport` accepts the film in that format and the binary is built (`native/target/release/aideos-render`, or `AIDEOS_RENDER_BIN`); otherwise Remotion renders it exactly as before, and the log names every reason |
| `remotion` | the kill switch: every film on Remotion |
| `native` | native is required: a film it cannot draw, or a missing binary, fails the job with every reason |

A failure of the native renderer on a film it accepted fails the job; it never falls back to Remotion. The job
sidecar (`<output>.render.json`) records the renderer that drew the file (`renderer`), next to the profile
settings it applied.

**Encoder policy.** The job's profile decides the encode (the R3 policy in [NATIVE_ENCODE.md](NATIVE_ENCODE.md)):
the pipeline's render stage, the studio Export and `aideos render` are `final` (x264 CRF 16, yuv420p, limited
range); the review and all-check render is `review` (VAAPI or VideoToolbox after the conformance probe, else x264).
The Remotion path keeps its own unchanged flags (`FINAL_ENCODE_FLAGS`).

The native adapter (`backend/nativeRenderer.ts`)
implements the RenderJob `Renderer` interface: `prepare` emits the IR and stages the package (IR, artwork,
fonts, hard-linked audio) inside the job's attempt directory, `checkDiskBudget` needs room for the mp4 plus
the shared 3 GiB reserve (no frame images are written), and `render` runs `aideos-render video` through the
shared subprocess runner, which owns cancellation and the disk watchdog. The job's delivery checks,
mastering, probe and sidecar are shared; the sidecar records the CRF as applied only when x264 encoded. The
studio's progress bar reads the binary's `frames D/T` lines (a frame counts once it is encoded).

**Which films are native today.** Every film `nativeSupport` accepts, which since P4.2 includes the one-performer cel
Three-stage character film, since P4.3 the cel films with several performers (Pip, Marlo and the J5 film) and since P4.4
the dots-v1 films (the J3 and J4 film). Node-graph films and the other
refusals listed in [The emitter](#the-emitter-r4) stay on Remotion. A journey's render job takes the native path when
the release binary is built (the CI journeys job builds it); the Player-versus-export journeys keep a Remotion export
as their oracle until a WASM preview exists.

## Not yet native

Node-graph films, the other primitives, devices, inset and panel stages and footage (Phase 2), GPU encoding of
whole films (the GPU path renders stills), the editor preview, the Node addon, effects such as the paper curl,
and nothing of the Three stage any more: the cel stage with any number of performers is carried by
`aideos.render/2` since P4.1 and drawn since P4.2 and P4.3, and dots-v1 is carried and drawn since P4.4. `image`, `audio` and `mesh`
assets are not opened by the frame raster.
