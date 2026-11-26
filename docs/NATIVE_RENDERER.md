<!--
File Description: Reference for the native renderer `native/aideos-render` (R2 and R4 of Phase 1 of the native renderer plan): what it draws, how a frame is evaluated, the semantics it gives the parts of the Render IR that the IR leaves open, the SVG subset it supports, whole-film rendering and text measurement, the TypeScript emitter and the renderer choice every render job makes (native for supported films, Remotion otherwise, the kill switch), the Three stage's Phase 4 steps (P4.1 carries it in `aideos.render/2`, P4.2 draws it for one performer in the cel treatment with the CPU rasterizer in `raster/stage3d/`, P4.3 draws several performers, Pip and Marlo, P4.4 draws the dots-v1 treatment), pictures (the illustrated stage, phase 1, `aideos.render/3`: drawing, the pin, the load check and fallback, parity and speed), opt-in 2D effects (`aideos.render/4`: glyph tracks and the shutter), Phase 2 (its steps; P2.1 draws the SVG filter subset of glows and drop shadows, with its parity; P2.2a carries colour and dash offset tracks in `aideos.render/5`, P2.2b emits the node-graph canvas, P2.2c draws flat node-graph films natively), determinism, the exact Skia dependency (pinned feature set, prebuilt binary, CI cache, source-build fallback) and the commands that build, test and run it.
-->

# Native renderer (`native/aideos-render`)

`aideos-render` evaluates a Render IR [`aideos.render/1` through `/6`](RENDER_IR.md) as a pure function of the frame
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

## Opt-in 2D effects (`aideos.render/4`)

The native renderer accepts per-glyph tracks and a 2D shutter (2 to 16 samples) in `/4`. Shaped glyph
indices, sample placement, sharp chrome, and the explicit 3D and overlay-order restrictions are documented
in [Render IR effects](RENDER_IR.md#effects-aideosrender4). The film emitter and editor do not yet write or
preview those fields. Existing versions use the old integer frame path and keep their output unchanged.
Version `/6` adds native-only SkSL fade and wipe transitions and seeded scene-space particles. See [Render IR effects](RENDER_IR.md#native-transitions-and-particles-aideosrender6).

## Where things live

| Piece | Path |
| --- | --- |
| Frame evaluator (tracks, easing, camera spline, spring, element states, rail, end card) | `native/aideos-render/src/eval/mod.rs`, `track.rs`, `spring.rs` |
| Kinetic caption phrases (port of `captionPhrases.ts`) | `native/aideos-render/src/eval/captions.rs` |
| Retained SVG model and parser | `native/aideos-render/src/svg/mod.rs`, `color.rs` |
| SVG filter subset: the parsed filter (`svg/filter.rs`) and its Skia image filter (`raster/filter.rs`) | `native/aideos-render/src/svg/filter.rs`, `native/aideos-render/src/raster/filter.rs` |
| Raster: stage and overlay, SVG drawing, chrome (rail, captions, end card), fonts | `native/aideos-render/src/raster/` |
| Three stage rasterizer (graph pose, face painting, triangle setup, tile raster) | `native/aideos-render/src/raster/stage3d/` (`pose.rs`, `face.rs`, `setup.rs`, `tiles.rs`) |
| Public `Renderer` (asset loading, checks, picture decode and pin check, CPU render, PNG) | `native/aideos-render/src/renderer.rs`, `src/sha256.rs` |
| Optional GPU path (feature `gpu`) | `native/aideos-render/src/gpu.rs` |
| Whole-film render: worker threads, RGBA to I420, in-order hand-off to the R3 encoder, audio plan from the IR | `native/aideos-render/src/video.rs` |
| Text measurement for the emitter | `native/aideos-render/src/measure.rs` |
| CLI (`<ir> --frame`, `video`, `measure`, `check`) | `native/aideos-render/src/main.rs` |
| Vendored variable fonts (Geist, JetBrains Mono) used by every emitted film | `native/fonts/` (provenance in its README) |
| The IR emitter (film.json to `aideos.render/1`, `/2` for a Three-stage film, `/3` for a film with pictures) | `backend/renderIr/emit.ts`, `backend/renderIr/emitStage3d.ts` |
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
native/target/release/aideos-render check <ir.json> [--package DIR]    # load everything a render loads, draw nothing

aideos render                               # native when it can draw the film, else Remotion (the reason is printed)
AIDEOS_RENDERER=remotion aideos render      # kill switch: every film on Remotion (or --renderer remotion)
AIDEOS_RENDERER=native aideos render        # require native: a film it cannot draw fails (or --renderer native)
```

The CLI writes one PNG and prints one line (`wrote frame.png (1920x1080, long, frame 43, cpu) in 246 ms`).
Exit codes: 0 written, 1 the document, an asset or the frame was refused (the reason is on stderr), 2 a
usage mistake. `--package` defaults to the IR file's directory; every asset path resolves against it.
`bun run ci -- unit` runs the `cargo test` step (skipped with a reason on a laptop without cargo).

`video` loads the film once on the calling thread (so a bad document or asset fails before anything
starts), then N worker threads (default: the machine's parallelism) each open their own `Renderer`, draw
frames on the CPU reference raster, convert them to limited-range BT.709 I420 (2x2 averaged chroma) and
hand them through a bounded reorder buffer to `aideos_encode::encode`, which pipes them to ffmpeg while
the next frames draw. The profile is the R3 policy: `final` is x264 CRF 16; `draft` and `review` use
VAAPI (or VideoToolbox) after the R3 conformance probe, else x264. The audio plan is built from the IR's
own audio clips (path, start, length, source offset, gain and its linear envelope), so the IR is the one
description of the film; a non-linear gain envelope is refused. A frame range shifts the audio with it.
It prints `frames D/T` lines and then one JSON report (frames, size, threads, encoder, wall time, fps).

`check` loads the IR and every asset it draws (SVG artwork, pinned pictures, fonts, the Three stage mesh) exactly as
a render does and draws nothing: it prints `ok <film> (<version>)` or exits 1 naming what it refuses. The renderer
choice asks it before rendering (see [The renderer flag](#the-renderer-flag)).

`measure` takes `{fonts: [{id, path, family, weight}], runs: [{text, font, size, letterSpacing}],
metrics: [{font, size}]}` and prints `{widths, metrics: [{baseline, height, ascent, descent}]}`: each run's
single-line width (letter spacing follows every glyph, as in CSS) and each face's `line-height: normal`
metrics, in whole pixels as browsers round them.

## How a frame is drawn

1. **Background**: the IR `background` fills the frame.
2. **Stage**, in scene units under the camera: the frame centre, the cover fit
   `max(width / scene.width, height / scene.height)`, then the camera's rotation, zoom and centre
   (`projectStagePoint` in `src/dl/scene/projection.ts`). Stage siblings draw by svg or image `layer` (a group
   counts as 0), document order breaking ties, as SceneView sorts entities by layer.
3. **Overlay**, in frame pixels, in document order: groups, rects, text, the rail, captions, the end card.

An `svg` node is drawn like SceneView's entity: `translate(x, y) scale(s) rotate(r)` with its opacity as a
group, then the asset's root children in the asset's own coordinates (the root `<svg>` element's own
attributes and viewBox are not drawn, as in SceneView). Element states follow `svgReact.tsx`: the animated
transform is appended to the authored one (translate, then rotate and scale about the track origin), a
driven opacity replaces the authored attribute, `drawOn` dashes a stroke over its own length and a group's
`drawOn` reaches the strokeable shapes inside it, and `x1`/`y1`/`x2`/`y2` move a line. A compositing layer
is used only where the result needs one: a group (or node) below full opacity, or a shape that has both a
fill and a stroke below full opacity. An `image` node (a picture) is drawn the same way up to its element state,
then its decoded image fills its box (see [Pictures](#pictures-the-illustrated-stage-phase-1)).

### Evaluation

Every value is a pure function of `(IR, format, frame)`: integer delivered frames, f64 maths, no clock, nothing
carried between frames. With a shutter, 2D tracks also sample fractional frame times. Track semantics are the IR's (hold before the first keyframe and after the last,
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
node's `font` names one exact file. Skia's paragraph painter always draws with slight hinting (turning hinting off in the paragraph style has no effect on it), while the Chrome render draws unhinted outlines, so `Text::paint` (`raster/text.rs`) reads the shaped runs back from the paragraph and draws the glyphs itself with hinting off, which is what makes a 45 px Geist capital 32 px tall as in Chrome (33 hinted). It also places text as Blink does: the font's ascent, descent and gap rounded to whole pixels, half the leading above the line rounded down, the baseline rounded to a whole pixel, a line's height the CSS line height (Skia rounds it up to a whole pixel), the letter spacing all after each glyph whatever the alignment (Skia puts half of it before a line, and drops that half again on a right-aligned or centred line narrower than its box, so the correction is made per line), the optional ligatures (`liga`, `clig`) off when the letter spacing is not zero as Blink turns them off (Geist joins "tt" and "ti": a spaced "transmitting" is 2 px wider without them) and CSS `text-shadow` order (the first shadow on top). A caption row keeps its fractional offset below the card top and only its baseline is rounded. SVG `<text>` is drawn with its baseline exactly on its `y` (`Text::paint_on_baseline`, unrounded; Skia's run origin sits on its own rounded ascent, so placing it from `alphabetic_baseline` drew it up to 0.5 px high, a whole pixel at a 2.2 camera zoom) and shares the unhinted glyphs and the letter spacing. Glyph masks get Chrome's text contrast and gamma (Chromium builds Skia for Linux with `SK_GAMMA_CONTRAST=0.2` and `SK_GAMMA_EXPONENT=1.2`; Skia's own defaults, 0.5 and sRGB, drew light text on a dark ground about 4% heavier): every frame surface, CPU and GPU, is made with those surface properties (`frame_surface_props`, `renderer.rs`). Translucent colour is blended as Chrome's compositor blends it, rounding to the nearest level, where Skia's 8-bit CPU blend truncates (a 55% dim of the canvas colour over the canvas colour came out one level too dark, which costs 0.005 SSIM on a flat dark frame): every translucent solid colour (the chrome's fills and strokes, the end card's full-frame dim and SVG fills and strokes) is painted by a one-colour shader that Skia blends in floating point. A half-float frame surface did the same for every layer but cost a quarter more CPU time, and the shader dim costs about 5 ms a frame. Compositing layers are restored the same way: a layer at partial opacity (a node's or group's opacity, a shape with both fill and stroke fading as one) or under a filter is restored with an identity runtime colour filter, so Skia blends it in floating point and rounds, as Chrome's GPU raster does; a plain restore went through Skia's legacy 8-bit sprite blitter, which truncates (`(d * (256 - a)) >> 8`), and drew a shadow or a faded card over the dark canvas one level too dark (black at alpha i/255 over `#0A0A0B` in a 35% layer: Chrome changes level at 37, 110 and 183, the plain restore at 3, 74, 148 and 219). SVG `<text>` resolves its `font-family` list against the
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

**Filters (P2.1).** The glow and drop-shadow subset of SVG filters is drawn: `filter="url(#id)"` on any element,
and a `filter` with `feGaussianBlur` (one or two standard deviations, `edgeMode="none"`), `feOffset`, `feFlood`
(`flood-color`, `flood-opacity`), `feComposite` (`over`, `in`, `out`, `atop`, `xor`, `arithmetic`) and `feMerge`, with the
`SourceGraphic` and `SourceAlpha` inputs, named results, `color-interpolation-filters` (`linearRGB`, the initial
value, or `sRGB`; inherited from the filter's ancestors) and a region in bounding-box units (the default
-10%/-10%/120%/120%) or user units. It is drawn as Chrome's Blink builds it: the element (a group with its children,
a shape, or a text run) draws into a layer, SourceGraphic is that layer cropped to the region, every primitive is
cropped to the region, each input is converted into the primitive's colour space at 8 bits (as Chrome does, so a
dark gradient under a linearRGB filter posterises the same way), the last result is converted back to sRGB, and
the element's opacity applies after the filter. The region is resolved against the element's geometric bounding box
in its own space (the fill geometry, a group's the union of its children's), so a straight horizontal line under a
bounding-box filter has an empty region and draws nothing, exactly as in Chrome. Refused with the feature named:
every other primitive (`feColorMatrix`, `feBlend`, `feTurbulence`, lighting, ...), primitive subregions
(`x`/`y`/`width`/`height` on a primitive), `primitiveUnits="objectBoundingBox"`, a filter `href`, `edgeMode` other
than `none`, the `BackgroundImage`, `BackgroundAlpha`, `FillPaint` and `StrokePaint` inputs, a negative deviation, a
user-space region that leaves a side to the viewport, CSS filter functions (`filter="blur(4px)"`), a filter list or any text after the `url(#id)` reference (`filter="url(#a) url(#b)"`), a reference to a
missing filter, and a bounding-box filter on text (its box depends on the glyphs; a user-space region is drawn).
Parity with Remotion is in [P2.1 parity](#p21-svg-filters-glow-and-drop-shadow).

Rendering attributes whose behavior is not implemented are **refused at load with the attribute named**,
including `vector-effect`, `paint-order`, `mix-blend-mode`, `isolation`, `transform-origin`,
`transform-box`, `shape-rendering`, `text-rendering`, unsupported baseline and font style properties,
`text-decoration`, `writing-mode` and `direction`. Inert metadata attributes remain ignored.

Anything else is **refused at load with the element or attribute named**: filters outside the subset above, masks, markers, `use`,
`image`, `pattern`, `symbol`, `tspan`, SMIL, stylesheets, percentage geometry. Silently dropping part of an
asset would render a wrong frame with no sign of it. The loader also refuses an asset whose IR
`elementIds` name an element the artwork does not contain, a missing file, and a path that resolves outside
the package directory (including through a symlink).

## Native golden frames

`native/aideos-render/tests/golden.rs` holds the CPU raster's own reference frames, separate from the Chrome
goldens in `backend/journeys/goldens/` (those still guard the default Remotion render and are untouched). The set
covers the native-supported fixture films, `hello-scene`, `still-talking`, the Three-stage character films `iona-receive`, `pixels-stage-pip`, `pixels-stage-marlo` and `journey-three-characters` (the J5 film: Iona, Pip and Marlo, each with a glider) and `journey-j3-j4-dots` (the dots-v1 film), and `pictures-stage` (the illustrated stage's synthetic picture film, `/3`, its pinned PNGs in `<film>/pictures/`), in long and reel, at the same frames
and the same quarter scale as the Chrome goldens (`fixtures/golden/frames/<film>/<format>-<frame>.png`, 480 x 270
or 270 x 480, a 4 x 4 box average of the 1920 x 1080 CPU frame). `fixtures/golden/<film>/render.<format>.json` are
the emitter's IR for those films with the audio clips dropped (the frame raster never opens audio), with the
artwork in `<film>/visuals/`; fonts come from `native/fonts/`. `MANIFEST.json` records the platform, the renderer
version, the Skia pin and the tolerance.

The test (run by `cargo test`, so by the CI unit job) renders each frame and requires a mean channel difference of
at most 0.05 and at most 0.1% of pixels more than 8 apart, the same strict tolerance as
`backend/journeys/goldenCompare.ts`. It is verified on Linux only (macOS glyphs are CoreText's). To remake the set
after an intended change: `bun run goldens:native:ir` (needs the release binary; re-emits the IR) then
`AIDEOS_NATIVE_GOLDEN_UPDATE=1 cargo test --locked --manifest-path native/Cargo.toml -p aideos-render --test golden`,
which renders every frame twice and refuses to write a frame whose two renders differ. Never loosen the constants
in the test; the manifest check fails if they change without a new set.

The set is separate because the Chrome goldens record Remotion's pixels and the native renderer is a different
raster, so one reference cannot serve both. It was re-baselined on the native CPU reference after parity was shown
on the Phase 1 proof film (below), with the same strict tolerance and never a looser one. No Chrome golden,
tolerance or workflow is changed.

The cargo test draws the committed IR. `backend/journeys/native_character_goldens.journey.ts` (P4.5) reaches the same frames the way a user does: it builds each character film of the set (iona-receive, Pip, Marlo, the J5 film and the dots film) from its package, emits the IR with the production emitter, draws it with the release binary, box-averages 4 x 4 as the golden test does and compares with the committed frames at the strict tolerance, so an emitter change that moves a picture fails there even though the committed IR still renders.

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

## Pictures (the illustrated stage, phase 1)

Phase 1 of the illustrated stage (one generated plate and a few generated objects on the one stage, every word,
line and motion still SVG; [GOOD_VIDEO.md](GOOD_VIDEO.md#pictures-the-illustrated-stage)) is drawn natively. A scene
asset with a `raster` source becomes an `image` node of an `aideos.render/3` document (a film with no picture stays
`/1` or `/2`, byte for byte), and its pinned PNG is staged at `pictures/<sha256>.png`.

**Loading.** Only the images an `image` node draws are opened. Each must be exactly the pinned bytes (its SHA-256,
computed by `src/sha256.rs`, must equal the asset's `sha256`) and decode to exactly the declared size, else the film is
refused at load naming the asset. The pixels are decoded once into the frame surface's own layout (N32,
premultiplied, no colour space, so no colour conversion per draw), marked opaque when every pixel is, with mipmaps
built once. The worker threads of `video` share one decoded set (`SharedAssets`, with the Three stage), so a film's
pictures cost their memory once, not once per thread.

**Drawing** follows SceneView's `<image preserveAspectRatio="none">`: the node placement (`translate`, `scale`,
`rotate`, node opacity as a group), the element state (translate, then rotate and scale about the track origin), the
element opacity as the paint's alpha, then the image stretched over `width` x `height` centred on the origin with its
straight alpha blended over the stage below; SVG layers above it and the whole overlay (captions, rail, end card) draw
over it. Sampling matches Chrome as measured in the Remotion render: bilinear when the picture is enlarged on screen
(closer to Chrome than Mitchell or Catmull-Rom cubics: 0.9966 to 0.9973 SSIM against 0.9959 to 0.9969 and 0.9954 to
0.9966) and bilinear on the nearest mipmap level when it is reduced (0.9976 to 0.9979 on the reduced object, the same
as blending two levels at about two thirds of its cost; with no mipmaps 0.988).

**Parity with Remotion** on the synthetic fixture film `pictures-stage` (a 48 px plate enlarged 40 times, a 32 px orb
and a 24 px chip with alpha, SVG labels and kinetic captions over them; every frame of the native goldens, both
formats): whole-frame SSIM 0.9959 to 0.9967 and stage SSIM (above the caption band) 0.9959 to 0.9972 with the
Mitchell enlargement first tried, 0.9966 to 0.9973 with bilinear; a 600 px object shown at a third of its size measured
0.9976 to 0.9979 on its crop. `backend/journeys/pictures_stage.journey.ts` gates the stage at SSIM 0.995 (the bar of
the reports above) and the native frames against their goldens at the strict tolerance.

**Reel cut.** A picture film whose reel must be cut (a long past the 179 s cap, so `aideos reel build` condenses the
narration instead of reusing the long) resolves its pictures the way the long design build does: `compileReel`
(`backend/reelCut/build.ts`) reads the shared `design/design.json` `pictures` block through `resolvePinnedPictures`, so the
reel names the same cached, sha256-pinned plate and objects as the long and refuses a missing, unapproved or changed
picture with the same message and fix. Nothing is generated there. An identity reel reuses the long film and needs no
step. `backend/reelCut/build.test.ts` builds the cut reel of the synthetic picture film (long past the cap, tighter narration)
and checks its pictures, its emission as `/3` image nodes and the refusals; `pictures_stage.journey.ts` draws that cut reel natively
and on Remotion and gates the stage at the same SSIM.

**Speed.** Measured on the Linux laptop (12 threads, x264 `final`, 480 frames of 1920 x 1080, alternating runs with a
pause between them because the laptop throttles under sustained load): the fixture layout with a realistic picture set
(one 1672 x 941 plate covering the frame, eight 1254 x 1254 objects with alpha, the generator's measured sizes) renders
at **42 to 52 fps**, against **99 to 107 fps** for the same layout drawn as SVG, and **12.4 fps** for Remotion on the same
picture film (PNG frames only, no encode). Drawing only, on one thread: 10 ms a frame without the pictures, about 12 ms
more for the enlarged full-frame plate (Skia's CPU bilinear cost per output pixel, the same through every draw path;
nearest sampling is 3.8 ms but breaks parity) and about 5 ms for the eight objects. So a picture film keeps about half
of the native speed and stays about 4 times faster than its Remotion fallback; the plate is the cost.

**Not drawn in phase 1** (phase 2): parallax (a depth factor per layer), masks, soft mattes and blend modes (a cut-out
with real transparency is the phase 1 route), and picture motion beyond placing, scaling, turning and fading. A raster
inside an SVG asset (`<image>`) is still refused at load, as before; the design check refuses it first.

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
| A picture (`raster` asset: the plate or a generated object) | an `image` stage node the same way, its box the PNG's pixel size, its one element the asset id, over an `image` asset carrying the pinned `sha256`; the document becomes `aideos.render/3` |
| Clip timelines | one element track per driven slot (`scale` writes `scaleX` and `scaleY`, as the compiler); each clip is one eased segment; a clip ended by an adjacent clip that continues from its end value stays one segment; a clip cut by a snapping clip or by the story's end is linear or held where that is exact, else per-frame keyframes. `emit.test.ts` checks every frame against `compileScene` |
| The camera (`compileCameraTrack`, including the hold push) | per-frame linear keyframes, compressed to where the slope changes |
| Asset-level Catmull-Rom tracks | per-frame keyframes from `compileScene` |
| The end card's freeze and slow push (`Film.tsx`), a shot's drift | the stage holds the story's last frame; the push multiplies the camera zoom, and the text cards sit in one overlay group scaled about the frame centre |
| `frame` shots' `TextReveal` | a scrim band (`gradient` rect), one `text` node per word laid out like the flex row (greedy wrap; rows start at the block's left, as TextReveal's `flex-start` row does, and the block, as wide as its content up to the stage, is centred in the stage margins, so a wrapped headline starts at the stage's left edge) with the per-word entrance as per-frame `opacity` and `y` keyframes, the accent word's core and tail in their colours, and its underline as a rect whose `scaleX` and `x` keyframes draw it from the left, placed on whole pixels (the underline's `scaleX` is not a pure translation, so Blink rounds its paint offset and drops the fraction) |
| `StatCounter` | one group per value on screen (number, muted suffix baseline-aligned in the number's letter spacing, uppercase label), visible while that value shows, inside the block's entrance |
| The rail | `rail` with the label in the muted colour, the bar in ink, chapters spanning their shots, `progressFrames` set to the story |
| The end card | `endCard` with the `getEndCardLayout` geometry, the configured copy, `subscribePressFrame`, and the theme's surface, hairline, muted colour and faces |
| Burned-in kinetic captions (`KineticSubtitles`) | a `captions` node: the film's caption words plus the end card's spoken line, white text, the accent as the highlight, the component's `rgba(10, 15, 29, 0.88)` card (quantized to 8-bit alpha), Geist 600 (the component asks for 700, but `tokens.ts` loads Geist at 300 to 600 only, so Chrome draws the 600 face and the emitter matches the render), `round(min(width, height) * 0.042)` px, and one placement span per shot where the resolved `captionPlacement` changes (read at a phrase's first word, as `captionPlacementAt` does). Words starting after the delivered length are dropped and a word's end is capped at it |
| The frame's 1 px hairline | a stroked `rect` |
| Narration, end-card line, library music sections, library effects | audio clips with gain 1 and the level as a per-frame linear envelope: `voiceLevel`'s ramps; `mixSections`, `sectionEnvelope` and `speechGain` (ducking under the measured speech); `effectGain` with `effectDuckGain` (transition effects are ducked under the same speech; other effects keep their cap) |

Text is measured with `aideos-render measure`, so layout and drawing share one set of metrics. The emitter
refuses (with every reason, `nativeSupport`) a node-graph film with a CSS 3D camera angle (a flat one is drawn since P2.2c), an actor scene, sub-group
rotation, a scene asset with no SVG source, a chapter with no shots, imported footage and overlay clips, a textured theme over a scene (the blueprint grid and the dot matrix since P2.4a and the paper grain since P2.4b are drawn for node-graph films only), legacy (non-library)
music and audio clips, panels other than `frame` and `none` (except an `inset` panel holding one StatCounter, TokenStrip or LayerStack in a film with a scene, P2.6a, P2.6b, P2.5b and P2.5c), more than one block per shot (except a `TextReveal` followed by a `Body`, a `TokenStrip` or a `LayerStack`, P2.5a to P2.5c) and blocks other than
`TextReveal`, `StatCounter`, `Body`, `TokenStrip` and `LayerStack` (a `Body` only under a headline, at a measured body size, made of measured word shapes; a `TokenStrip` only under a headline or alone in an inset, with a caption that fits on one line; a `LayerStack` only under a headline or alone in an inset, with no prompt, a label column that fits beside the stack and bar text that fits one line). Blocks on a `none` stage are not drawn by `Film.tsx` and do not count (P2.5e), except an `AnalogyInset`. Those stay on Remotion until their phase.

The film-only check also reports invalid scene animation timelines, picture animation properties the IR cannot
carry, asset IDs that cannot form IR IDs, and asset IDs shared by more than one asset. A rejected invalid
timeline may also fail in Remotion's scene compiler. The check does not read SVG source, evaluate Three-stage
data, validate the generated IR, or call the native measurer. Rejections that need those inputs still surface
during native preparation.

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
| P4.5 | journeys and goldens per the captain's decisions: what each engine-comparing journey compares once export is native ([P4.5 journeys](#p45-journeys-and-goldens)), and the native goldens of Pip, Marlo and the dots film reached through the emitter | done |

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
| a 1 level dark bias on every flat dark pixel under a translucent layer (0.005 SSIM on the end card, about a fifth of its shortfall) | `raster/chrome.rs` | the compositor rounds to the nearest level (Skia's 8-bit blend truncates): every translucent solid colour, the end card dim included, is painted by a float shader |
| glyphs drawn with slight hinting (cap height 33 px at 45 px Geist, Chrome 32) | `raster/text.rs` | unhinted outlines, drawn by `Text::paint` |
| baselines on fractions of a pixel, line heights rounded up by Skia | `raster/text.rs` | ascent, descent and gap rounded, leading floored, baseline on a whole pixel, exact line height |
| letter spacing half before each glyph | `raster/text.rs` | all of it after each glyph (0.5 to 1.5 px on spaced labels) |
| the caption card narrower than Chrome's in the reel | `raster/chrome.rs` | `text-wrap: balance` keeps the box at the capped width |
| the cut-off full stop (a clip to the card's content box) | `raster/chrome.rs` | no content-box clip: the spring scale and glow reach the padding |
| end card panel and chips: LIKE chip 4 px narrow, panel 2 px narrow, fractional box edges | `raster/chrome.rs` | borders add to auto widths, boxes pixel-snap, the entrance's fractional rise moves them after |

Whole-frame SSIM against Remotion, all frames (bar 0.995, before this change > after it), measured on the merged code
(SVG `<text>` keeps its unrounded baseline; the end card dim is painted in its IR colour by the float shader). Evidence:
`/home/mani/aideos-linux-home/data/aideos-native-2d-text-parity/` (`runG/parity/<film>-<format>/`, `deliver/`).

| Film, format | Story SSIM min | End card SSIM min | Frames under 0.995 |
| --- | --- | --- | --- |
| iona-receive, long / reel | 0.99458 > 0.99827 / 0.98923 > 0.99875 | 0.97965 > 0.99877 / 0.98056 > 0.99869 | 174 > 0 / 285 > 0 |
| journey-three-characters, long / reel | 0.99457 > 0.99828 / 0.98923 > 0.99875 | 0.97977 > 0.99875 / 0.98061 > 0.99877 | 174 > 0 / 285 > 0 |
| pixels-stage-pip, long / reel | 0.99453 > 0.99819 / 0.98914 > 0.99868 | 0.97986 > 0.99887 / 0.98071 > 0.99892 | 174 > 0 / 285 > 0 |
| pixels-stage-marlo, long / reel | 0.99459 > 0.99827 / 0.98925 > 0.99876 | 0.97986 > 0.99887 / 0.98069 > 0.99887 | 174 > 0 / 285 > 0 |
| journey-j3-j4-dots, long / reel | 0.99465 > 0.99835 / 0.98931 > 0.99883 | 0.97856 > 0.99779 / 0.97986 > 0.99748 | 174 > 0 / 287 > 0 |
| hello-scene, long / reel | 0.98740 > 0.99725 / 0.98495 > 0.99800 | 0.97945 > 0.99856 / 0.98033 > 0.99878 | 476 > 0 / 320 > 0 |
| still-talking (story frames 0-299 and the end card), long / reel | 0.98145 > 0.99325 / 0.98623 > 0.99540 | 0.97959 > 0.99267 / 0.98007 > 0.99551 | 480 > 68 / 389 > 0 |

The 0.995 bar is met on every frame of every film and format except the still-talking long cut, which has 68 of 480
frames under it (frames 0 to 25, 262 to 299 and 4621 to 4626, minimum 0.99267 at frame 4621; story minimum 0.99325); its
reel has 0 of 390 (minimum 0.99540). The minimum of every other row is 0.99725 or higher (hello-scene's story minimum
is 0.99725 long and 0.99800 reel). Those still-talking frames carry the film's own artwork (soft gradients and star
discs, blended through translucent SVG gradients and group opacity layers, where a half-float surface recovered most of
the gap) and moving text cards; on its story frames 74% to 82% of the SSIM loss is outside the text, and the text cards'
words sat about 1 px off Chrome's with heavier stems. Both were later traced and fixed (Chrome's text gamma and the
ligatures Blink turns off for letter-spaced text, [Fonts and text](#fonts-and-text)); the numbers in this table predate
those fixes. A half-float frame surface closed most of the artwork gap (still-talking long
50 frames under the bar, reel 0) but cost a quarter more CPU time, so it was not kept. Cost of the float-shader dim:
about 5 ms a frame on end card frames only (end card frames about 10% slower, story frames unchanged).

### Text parity follow-up (aideos-native-text-parity)

Measured again on main after the reel caption safe zone (#251), which had moved the reel captions and stage and taken
the reel story minimum of the character films from 0.9987 to 0.9971. Same method: every frame of both formats (still-talking:
story frames 0-299 and the end card), ffmpeg `ssim` on the whole frame against a fresh Remotion PNG sequence, the IR
emitted by each binary's own `measure`. Five text causes were measured and fixed (see [Fonts and text](#fonts-and-text)):

| Cause (measured) | What Chrome does |
| --- | --- |
| right-aligned and centred letter-spaced text ls/2 left (the rail timestamp, 1.1 px) | all of the letter spacing after each glyph; Skia drops its half shift on those lines, so the correction is per line |
| letter-spaced words up to 2 px narrow ("transmitting"), moving a whole text card row 1 px | Blink turns `liga` and `clig` off when the letter spacing is not zero |
| light text 3% to 7% heavier, accent text 2% lighter | text contrast 0.2 and gamma 1.2 (Chromium's Linux Skia build) |
| SVG text 1 px high at a 2.2 camera zoom | the baseline exactly on `y` |
| a caption card's second row 1 px high | the row keeps its fractional offset; only the baseline is rounded |

Whole-frame SSIM against Remotion, before > after (bar 0.995). No threshold, tolerance or Chrome golden changed; the
native goldens were remade from the renderer at the same strict tolerance because their text moved toward Chrome.
Evidence: `/home/mani/aideos-linux-home/data/aideos-native-text-parity/` (`before/`, `after/`, `handoff.md`).

| Film, format | Story SSIM min | End card SSIM min | Frames under 0.995 |
| --- | --- | --- | --- |
| hello-scene, long / reel | 0.99725 > 0.99894 / 0.99612 > 0.99917 | 0.99856 > 0.99911 / 0.99859 > 0.99918 | 0 > 0 / 0 > 0 |
| pixels-stage-pip, long / reel | 0.99820 > 0.99873 / 0.99707 > 0.99880 | 0.99887 > 0.99919 / 0.99850 > 0.99921 | 0 > 0 / 0 > 0 |
| journey-j3-j4-dots, long / reel | 0.99836 > 0.99888 / 0.99721 > 0.99896 | 0.99779 > 0.99826 / 0.99577 > 0.99577 | 0 > 0 / 0 > 0 |
| still-talking, long / reel | 0.99325 > 0.99383 / 0.99485 > 0.99515 | 0.99267 > 0.99617 / 0.99506 > 0.99660 | 69 > 49 / 2 > 0 |

Means rose on every row (hello-scene story 0.99795 > 0.99939 long, 0.99737 > 0.99947 reel). What is left is not text:
the 49 still-talking long frames (0 to 25 and 262 to 299) lose to the film's soft gradients and star discs (on its
worst end card frame 94% of the loss lies outside the text, and with gradient dithering off the native frame moves
further from Chrome, 0.99499 > 0.99362), and the dots reel end card minimum (frame 306) is the dots performer under the
end card's fading dim. Two tries were measured and dropped: whole-pixel glyph positioning (hello-scene 0.998 > 0.992)
and turning the gradient dither off.

### P4.5 journeys and goldens

The journeys that compared one engine with another were decided one by one, following the captain's answers (the strict
golden tolerance stays and is native against native, never loosened; a Remotion export stays the oracle of the J3
Player-versus-export journeys until a WASM preview exists; a new baseline on the native CPU reference is approved and
is not a looser tolerance). No existing assertion, tolerance, timeout or golden changed. Remotion is still the engine
of every film the native renderer does not draw and the kill switch (`AIDEOS_RENDERER=remotion`), so the Remotion
checks stay and the native ones are added beside them.

| Journey | Compared before (Remotion) | After P4.5 |
| --- | --- | --- |
| J1 "J3 determinism" (`j1_pipeline.journey.ts`) | a concurrent, out-of-order Remotion image sequence against each frame rendered cold by Remotion | unchanged, and a new native journey beside it: the real export job (`createNativeRenderer`) over the contact window at one raster thread and at three gives the same decoded frames (difference 0), and each is within 38 dB PSNR (the bar of `tests/video.rs`; measured 44.99 dB or more) of the same frame drawn cold and lossless by `aideos-render --frame`, with scrambled order and a repeated frame byte-identical |
| `character_pixels` Pip and Marlo stage stills | the Remotion stage at contact against the committed Remotion stills in both formats | unchanged (it checks the Remotion stage), and `native_character_goldens.journey.ts` holds the native raster of the same contact frames to the native goldens |
| J3 and J3/J4 Player against export (`j3_j5_stage`, `j3_j4_dots`) | the Player against a Remotion export | unchanged: the Remotion export stays the oracle until a WASM preview exists; their production renders are native and are checked for size, frames, motion and crops only |
| Native goldens (new, `native_character_goldens.journey.ts`) | not covered through the emitter | iona-receive, Pip, Marlo, the J5 film and the dots film, long and reel, every golden frame: built from the package, emitted, drawn by the binary and compared at the strict tolerance; the contact frame must be among the goldens |

The native goldens for Pip, Marlo, the J5 film and the dots film were added with P4.3 and P4.4 to the native golden set
(no new baseline is needed here: the frames did not change). Evidence for the PR is the per-frame whole-frame SSIM
against Remotion at every one of those golden frames (lowest 0.99833, bar 0.995) taken from the full-film runs of the
[2D text parity](#2d-text-parity-with-chrome-aideos-native-2d-text-parity) measurement on the merged renderer. The
native journeys need the release binary: they skip when it is not built, and fail when `CI=true` or
`AIDEOS_NATIVE_TESTS_REQUIRED=1`.

## Phase 2 (node-graph films and the rest)

Phase 2 of the native renderer plan moves what is still on Remotion: node-graph films, the other primitives, devices
and the inset stage, and imported footage. It lands in small steps, each drawn exactly or refused, with Remotion as
the fallback for everything not yet native:

| Step | What | State |
| --- | --- | --- |
| P2.1 | the SVG filter subset of glows and drop shadows (above), which the node-graph canvas uses for its live edges (`CanvasGraph.tsx`, `neonGlow`) and onto which a card's CSS `box-shadow` lowers; scene artwork with such a filter, refused by the loader before and so rendered on Remotion, is now drawn natively | done |
| P2.2a | `aideos.render/5`: colour tracks (fill and stroke, mixed per channel as Remotion's `interpolateColors`) and the `dashOffset` element track on svg nodes, what the node-graph canvas animates (card borders and labels, the edges' travelling packets): schema, loaders and validators in TypeScript and Rust, the evaluator and the raster ([RENDER_IR.md](RENDER_IR.md#colour-and-dash-offset-aideosrender5)); the P2.2b emitter writes it, opt-in | done: nothing changes for users |
| P2.2b | the node-graph canvas in the emitter, flat camera (`backend/renderIr/emitNodeGraph.ts`): `CanvasGraph` lowered to one generated SVG (cards with their 145 degree gradients, border, `box-shadow` list and `backdrop-filter` on the P2.1 filters, edges with the P2.1 glow, labels as SVG text laid out as the flex column lays them out) under the camera `camAt` solves, with arrival, activeness, the beacon pulse, the breathing glow and the travelling packets as element, colour and dash offset tracks ([P2.2b](#p22b-the-node-graph-canvas)); opt-in only (`nodeGraphCanvas`), so node-graph films stay on Remotion | done: nothing changes for users |
| P2.2c | `nativeSupport` accepts node-graph films with the flat camera (and `top-down`), behind the parity journey `backend/journeys/node_graph_native.journey.ts` at 0.995 on every measured frame against Remotion's Chrome (swangle); the gap it closed was not the blur but the layer composite (#324) and the TextReveal underline (#322) ([P2.2c](#p22c-node-graph-films-drawn-natively)) | done |
| P2.3 | the node-graph camera angles other than `flat` (`getCameraPerspective`: CSS 3D perspective), a 4 x 4 perspective transform on the stage | planned |
| P2.4a | the `blueprint-grid` and `subtle-dots` theme textures, lowered to explicit shapes in the `aideos.render/7` underlay (frame space, under the stage), behind a parity journey ([P2.4a](#p24a-the-pattern-theme-textures)) | done |
| P2.4b | the `paper-fibers` texture of `paper-white`, `parchment` and `charcoal`: Chrome draws it as a flat darkening (the filter's `multiply` blend with the rect's black fill leaves no grain), lowered to that in the `/7` underlay, and a card's backdrop starts from the darkened canvas ([P2.4a](#p24a-the-pattern-theme-textures)) | done |
| P2.5a | the compiler's text card, a `TextReveal` headline followed by its `Body` support copy, with Chrome's `text-wrap: pretty` line breaking, behind a parity journey ([P2.5a](#p25a-body-copy-under-a-headline)) | done |
| P2.5b | the `TokenStrip` device, alone in an inset panel and under a headline on the frame stage (the compiler's device card), behind a parity journey ([P2.5b](#p25b-the-tokenstrip-device)) | done |
| P2.5c | the `LayerStack` device, alone in an inset panel and under a headline on the frame stage, behind a parity journey ([P2.5c](#p25c-the-layerstack-device)) | done |
| P2.5d | a `LayerStack` of 10 or more bars whose "k / n" counter gains a digit mid-sweep (the schema's default 32 bars), behind the same journey ([P2.5d](#p25d-the-layerstack-counter-gaining-a-digit)) | done |
| P2.5e | blocks on a `none` stage (never drawn by `Film.tsx`) no longer refuse a film, behind the node-graph journey ([P2.5e](#p25e-blocks-on-a-none-stage)) | done |
| P2.5 | the other five primitives (CodeBlock, Card, Divider, IconLabel, ProgressBar), other block combinations, panels other than `frame` | planned |
| P2.6a | the `inset` panel holding exactly one StatCounter on a cut shot that is not the first, in a film with a scene, behind a parity journey ([P2.6a](#p26a-the-inset-panel)) | done |
| P2.6b | the `inset` panel on the first shot, and one that opens on a camera move (its open and close fade, its content's delayed fade and entrance), behind the same journey ([P2.6b](#p26b-the-inset-panel-on-a-camera-move)) | done |
| P2.6 | devices in the inset, an inset with no block, an inset in a node-graph film | planned |
| P2.7 | imported footage and overlay clips (ffmpeg decode with accurate seek) | planned |

The paper-rip transition every node-graph film names by default is a retired no-op (`PaperRip.tsx`), so it needs no
native work. The editor preview (WASM) and the Node addon are the later Remotion-removal step, not Phase 2 here.

### P2.2b the node-graph canvas

The emitter lowers `CanvasGraph.tsx` for the flat camera (and `top-down`, which draws the same); the other camera
angles (CSS 3D perspective) are refused. Each part is drawn as Chrome draws it, which the parity work below measured:
a CSS border of 1 px or more is drawn at a whole number of pixels rounded down (the card's `1.5px` border is 1 px), line
boxes keep their fractional height (`1.2` at 18 px is 21.6) while each glyph baseline is rounded to a whole pixel, a
painted box (the tag chip) is snapped to whole pixels, `box-shadow` is a Gaussian of deviation blur / 2 (fitted 20.25 for a
40 px shadow and 13.75 for 28 px against Remotion's Chrome), an outer shadow is cut out of the box and an inset one kept in
the padding box, and `backdrop-filter: blur(12px)` is a blurred copy (deviation 12) of what lies behind the card, the
canvas colour and the edges that pass under it, cut to the card (a lit card is 6 to 18% opaque, so it shows; since P2.2c only what is inside the card, mirrored at its edges, see below). The chip
asks for JetBrains Mono 600, which `tokens.ts` does not load, so Chrome draws 700 and so does the canvas. Remotion's
`interpolateColors` (channels rounded, alpha to three decimals) is reproduced, one hold keyframe per change.

Since P2.2c every render job uses it for a node-graph film with the flat camera (see below). Measured on
`test_fixtures/packages/node-graph-flat` (the sample explainer's canvas with only frame and none stages and one
TextReveal, so nothing else refuses it), native frames against Remotion's Chrome (swangle), SSIM by ffmpeg on the stage
(above the caption band), frames 20, 60, 100, 150, 250, 330, 420, 520 and every shot's midpoint 45, 255, 345, 435, 525,
both formats (26 frames): 26 at or above 0.995 once layers are restored with rounding (lowest long 250 0.99570; it was 24
of 26 before, evidence: `docs/evidence/verify/2026-11-26-native-layer-restore-rounding.md`). What remains below the
margin is the tails of the large blurs (glow, shadows and backdrop at 100 to 140 px on screen) about one level off over
wide dark areas, the CPU triple-box blur against Chrome's GPU Gaussian measured in P2.1, plus text anti-aliasing on dark
ground; one lit card's two shadows alone match at 0.9987.

Remotion's own render overflows a two-line label out of its 64 px card (`Multiscale Bottleneck` spills below it); the
canvas draws what Remotion draws, and changing the card is a design decision outside this renderer work.

### P2.2c node-graph films drawn natively

`nativeSupport` accepts a node-graph film (no `film.scene`) whose camera angle is `flat` or `top-down` in every shot; the
other angles stay refused until P2.3, and everything else `nativeSupport` checks still applies (P2.2c drew only the
`smooth-dark` theme, which has no texture; [P2.4a](#p24a-the-pattern-theme-textures) added the blueprint grid and the dot matrix and P2.4b the paper grain; panels other than `frame` and `none`, blocks
other than TextReveal and StatCounter, several blocks in a shot and footage stay refused). Cards that overlap (the lit
card's 2% lift included) are refused too: Chrome's `backdrop-filter` blurs the card behind into the card in front, which
the canvas does not draw (measured 0.990). The journey `backend/journeys/node_graph_native.journey.ts` asks the renderer
choice for both formats of two fixtures (native must be chosen) and compares their frames with Remotion's stills at the
stage bar 0.995, none left out: `test_fixtures/packages/node-graph-flat` at 20, 45, 60, 100, 150, 250, 255, 330, 345, 420,
435, 520, 525 and an end-card frame, and `test_fixtures/packages/node-graph-cases` (a bright amber accent, small nodes at
a zoom of 9.3, cards 46 units apart, a StatCounter over the canvas) at every shot's midpoint, its lowest sweep frames and
an end-card frame. Every 15th frame of each whole delivered video, long and reel, was measured too: all at or above
0.995 against swangle (node-graph-flat: 95 frames, lowest long 270 at 0.99541; node-graph-cases: 88 frames, lowest long
345 at 0.99510).

A card's backdrop is drawn as Chrome draws it: Chrome blurs only what lies inside the card's border box, with mirrored
edges (measured: light just outside a card never reaches its backdrop, and a bar 6 to 12 px inside the edge reads 79 at
the edge, as a mirror gives, where a clamp would give 47). The canvas copies what is behind the card (the canvas colour
and the edges passing under it), clips the copy to the box, adds its mirror images across each edge and corner, blurs
that and clips it to the rounded box. Each copy draws only the edges that can reach the blur's filter region through it
(36 units, 3 x the 12 px deviation, from the box edge), so the many copies stay small and the pixels are the same. SVG `feGaussianBlur` itself ignores `edgeMode` in Chrome (none, mirror and
duplicate draw the same), so the native SVG subset still refuses it and the mirror is built from plain SVG.

What closed the gap was not the blur. The reference is Remotion's Chrome with `AIDEOS_GL=swangle` (CI and the goldens),
whose GPU raster blends a layer in floating point and rounds: native layer restores were truncating (fixed in #324), and
the TextReveal underline is placed on whole pixels as Blink paints it (#322). Measured against swangle: a CSS
`box-shadow` is an exact Gaussian of deviation blur / 2 with the deviation in device pixels capped at about 128 (a
40 px shadow at a 6.9 zoom, nominal 138, fits 127.5); an SVG `feGaussianBlur` is an exact Gaussian with no cap (fitted
138.0 for 138); native's CPU blur (Skia's three-box approximation) is slightly darker near the edge and lighter past
1.5 deviations (at 2 deviations 0.0157 against 0.0228). Neither is needed for the bar, and both would change how scene
artwork filters draw (P2.1), so a GPU-shaped Gaussian and the 128 px cap are left for a later step if a film needs them.
A default Remotion render (`AIDEOS_GL` unset, `angle`) on a host without a GPU falls back to Chrome's software raster,
which paints shadows and layers with Skia's truncating 8-bit blitters; native matches the swangle reference, not that
fallback.

### P2.4a the pattern theme textures

`Film.tsx` draws the theme texture under the canvas, at the texture layer's opacity (`blueprint-grid` 0.45, `subtle-dots`
0.35), scaled with the canvas by the end card's push but not by the shot drift. The emitter lowers each pattern to
explicit shapes in one frame-sized SVG (`backend/renderIr/emitThemeTexture.ts`) and places it in the `aideos.render/7`
underlay, so the native renderer draws it between the background colour and the stage. A pattern tile in Chrome draws only
what lies inside the tile: a stroke centred on the tile's top and left edges keeps its inner half, so the blueprint
grid's 0.5 px minor lines are 0.25 px wide and its 1 px major lines 0.5 px wide, starting on the tile edge. Measured
alone against Remotion's Chrome (swangle), a whole frame of each texture: blueprint SSIM 0.99997, dots 0.99994, no
pixel more than one level apart. Under the end card's slow push Chrome resamples the texture layer (rastered once, scaled
with bilinear sampling) rather than redrawing it, so a top-level underlay group is drawn the same way (see
[RENDER_IR.md](RENDER_IR.md#the-underlay-aideosrender7)); before that the end-card frames of the blueprint fixture measured
0.990 to 0.995, after it 0.997 and above. The journey `backend/journeys/theme_textures.journey.ts` asks the renderer
choice for both formats of `test_fixtures/packages/node-graph-blueprint` and `node-graph-dots` (node-graph-flat on each
theme; native must be chosen), and since P2.4b `node-graph-paper` and `node-graph-charcoal`, and compares 21 frames of each
(20, 45, 150, 255, 345, 435, 525, 570, 600 and the end card's 660 and 749 long, 645 reel) with Remotion's stills at the
stage bar 0.995, none left out.

`paper-fibers` (P2.4b) is `feTurbulence` lit by `feDiffuseLighting` and then `feBlend mode="multiply" in="SourceGraphic"`,
where `SourceGraphic` is the rect's default black fill: black multiplied by anything is black, so Chrome draws no grain,
only the black rect at its 0.8 opacity in the 0.28 layer. Measured in Chrome on `paper-white`, `parchment` and `charcoal`:
one flat colour over the whole frame (248, 246, 240 becomes 193, 191, 187). It is lowered to exactly that: a black rect at
0.8 in a layer at 71/255, the 8-bit opacity Chrome composites (0.28 itself gives 192). A card's backdrop blurs what lies
behind it, so for these themes its copy starts from the darkened canvas, not the theme's canvas colour (that alone took
paper-white long 285 from 0.965 to 0.995). Every 15th frame of `node-graph-paper` and `node-graph-charcoal`, long and reel:
all at or above 0.995 (lowest 0.99513 and 0.99559).

The textures are drawn for node-graph films only: a film with a scene (an SVG scene film, a Three
stage or a character film) on one of these themes is refused ("the texture over a scene has not been measured against Remotion
yet") until a journey measures the texture together with a scene.

### P2.5a Body copy under a headline

The compiler's text card is a headline and, when a beat has a second on-screen line, its support copy (`design.ts`
`buildTextBlocks`: a `TextReveal` then a `Body`). `Film.tsx` stacks them in the stage's centred column (a 2.5-grid gap,
`justify-content: center`). `Body` sets Geist 400 at the body size in the muted colour, left-aligned, in a box as wide as its
text up to its measure (680 px on the long frame, the stage on the reel) and centred, with `line-height` 1.5 and
`text-wrap: pretty`. Its line breaks are the hard part:

- Chrome's `text-wrap: pretty` is Blink's `ScoreLineBreaker`, ported in `backend/renderIr/bodyWrap.ts`: the greedy breaker, then,
  when the paragraph's last line is a single word narrower than a third of the line, a dynamic programme over the last four
  lines (squared slack per line, a free last line, a per-line penalty of `4 * width * size`, an orphan penalty on the last break),
  kept only when it finds as many lines; single precision as Blink.
- Remotion's Chrome runs with `--font-render-hinting=none`, so glyphs are placed at subpixels. Its Geist 400 advances at 24 px
  equal the native shaper's at 24 px, but at 33.6 px (the long frame's body size) they equal the native shaper's at 33.585 px
  (measured over every word prefix of 400 sentences: all 2402 within 1/64 px at 33.585, 37 at 33.6). The emitter measures the
  copy at that size for breaking and placing words (`CHROME_BODY_ADVANCE_SIZE`); a body size with no measured advance size is
  refused.
- Line-break differential against Remotion's Chrome (a probe page with the same CSS and launch flags): the same lines for all
  400 sentences in both formats, the pretty pass changing 87 of them on the long frame and 42 on the reel.

Each word is a text node at Chrome's position (the next word starts where the paragraph's width up to it, less its own width,
ends), and the block enters as one, 70 ms after the headline. The fixture `test_fixtures/packages/text-cards` (a scene film)
has three cards: copy the pretty pass re-breaks in both formats, a wrapping headline over four lines of copy, and one line of
copy. Measured against Remotion (swangle), 86 frames over both formats (every 10th frame across the cards, the shots around
them and the end card): all at or above 0.995, lowest 0.99848. The journey `backend/journeys/text_cards.journey.ts` pins native
selection and 27 of those frames. A `Body` on its own, other block pairs and other primitives stay refused. Only white-space
line breaks between measured word shapes are drawn: each word (the copy split at white space) must be an optional opening `(`,
`"` or `'`, then a lone `&` or ASCII letters and digits with optional internal groups of one `.`, `,` or `'` followed by more
letters or digits (`1,000`, `3.5`, `model's`), then an optional closing `)`, `"` or `'`, then an optional single trailing
`. , ; : ! ?`. A `Body` with any other word (a hyphen, slash, dash, soft hyphen, zero-width space or non-breaking space, or
punctuation glued to the next word, any other break opportunity of Chrome's UAX 14 breaker) is refused with a reason naming
the shot and the first such word, and the film stays with Remotion. Those shapes are what two differentials measured (400
generated sentences of letters, and 400 more with digits and the punctuation, 397 carrying at least one): every word-prefix
width within 1/64 px and the same line breaks in both formats.

### P2.5b the TokenStrip device

`TokenStrip` (devices.tsx) is a wrapping row of mono chips (0.9 of the body size, one grid by 1.5 grid of padding, a 1 px
border, the chip radius times 0.6, a one-grid gap) and an optional label-style caption two grids below. The block is as wide as
its widest content up to its column and centred in it; chips wrap greedily and sit at the left of each row. A sweep runs
linearly from the entrance's end to one camera move before the shot's end: a chip is off (sunken fill, rule border, muted text)
until the sweep reaches it, then on (an accent fill at 0.1 rising to 0.18 as the sweep crosses it, an accent border at 0.5,
ink text); a `lit` chip is on from the start at 0.22. The emitter draws each chip state as a group shown over its frames, the
rising fill as an opacity track. Two Blink details measured on the way:

- Blink paints a box's background and border pixel-snapped (each edge rounded to a whole pixel); unsnapped chips smeared the
  1 px border over two rows.
- Blink's `line-height: normal` is the rounded ascent plus the rounded descent: 28 px for JetBrains Mono at the reel's 21.6 px,
  where the native line metrics round the sum (29). With both, the lowest frame went from 0.99553 to 0.99833.

JetBrains Mono gives every Latin glyph a 0.6 em advance, so `nativeSupport` computes a caption's width without measuring and
refuses a caption that would wrap. The fixture `test_fixtures/packages/token-strips` (a scene film) has a TokenStrip alone in an
inset that opens on a pan (eight chips, three `lit`, wrapping to two rows on the long frame) and a headline over a TokenStrip on
the frame stage. Measured against Remotion (swangle), 114 frames over both formats (every 6th frame through both strips, the
shots around them and the end card): all at or above 0.995, lowest 0.99833. The journey
`backend/journeys/token_strips.journey.ts` pins native selection and 33 of those frames. A TokenStrip alone on the frame stage,
with a block other than a headline, or with a wrapping caption stays refused.

### P2.5c the LayerStack device

`LayerStack` (devices.tsx) grows (`flex: 1`) into all the height its column leaves: alone in an inset it fills the panel's
content box, and under a headline the column has no free space to centre, so the headline sits at the stage's top and the
stack fills the rest below the 2.5-grid gap. It is a stack of equal bars (`flex: 1`; a 6 px gap and a 28 px minimum for named
layers, 3 px and 3 px for an anonymous `count`) 640 px wide for named layers or 460 px otherwise, at most 80% or 60% of the
column, beside a label column (the top label, the lit step as "k / n" in the accent, the bottom label, spread top to bottom),
the two centred together with a 2.5-grid gap. A linear sweep over the shot lights one bar at a time (from the bottom for named
layers, from the top otherwise), marked by a 5 x 10 px accent tab 14 px to the stack's left. Named bars carry their label and
dimension in mono at 0.85 of the body size. The emitter draws each bar unlit before and after its lit step and lit within it,
and the counter and tab once per step; bar boxes are pixel-snapped and mono lines use Blink's `line-height: normal`, as P2.5b
measured. The fixture `test_fixtures/packages/layer-stacks` (a scene film) has five named layers alone in an inset that opens
on a pan and a headline over an anonymous stack (eight bars in P2.5c, twelve since [P2.5d](#p25d-the-layerstack-counter-gaining-a-digit)). Measured against Remotion (swangle), 114 frames over both formats
(every 6th frame through both stacks, the shots around them and the end card): all at or above 0.995, lowest 0.99840. The
journey `backend/journeys/layer_stacks.journey.ts` pins native selection and 33 of those frames (39 since P2.5d). A LayerStack alone on the frame
stage, with a block other than a headline, or with a `prompt` stays refused. So does a LayerStack whose stack, 2.5-grid gap
and label column (the widest of the top label, the bottom label and the "n / n" counter, mono at the label size plus 0.14 em
letter spacing) exceed the column, because Remotion then shrinks the stack, and one with a named bar whose label, a grid and
its dimension (mono at 0.85 of the body size) exceed the bar's content width, because the text overflows or wraps; neither is
measured against Remotion. A LayerStack of 10 or more bars whose counter gains a digit at 10 was refused here and is drawn since P2.5d. A named LayerStack in an inset whose bars' minimum heights (28 px each with a 6 px gap) exceed
the panel's content height (the region less the border and 3 grid of padding on each side) is refused, because Remotion's panel
clips the overflow, and so is a named LayerStack under a headline on the frame stage (no producer, not measured); an
anonymous `count` stack (3 px bars with 3 px gaps) stays native everywhere. `emit.test.ts` asserts each refusal by its reason.

### P2.5d the LayerStack counter gaining a digit

The LayerStack's label column is `flex: none`, as wide as its widest line at each step, and the stack and column are centred
together, so when the "k / n" counter gains a digit at k = 10 (and is the column's widest line) the column widens by one label
character and the whole stack moves left by half of it. The emitter draws the stack once per column width, each over the
frames that width holds (one width, as before P2.5d, emits the same document). Chrome's JetBrains Mono advance at the long
frame's 16.8 px label size is 0.09% narrower than the native shaper's (it equals the native shaper's at 16.7813 px, measured over
300-glyph runs; 12 px is exact), and here that decides the pixel snapping: the stack's left edge after the shift is 676.53 in
Chrome (snapped to 677) but 676.49 with native widths (676), which put 24 frames under the bar (lowest 0.99335). Label widths in
the column are measured at Chrome's advance size (`CHROME_MONO_ADVANCE_SIZE`). The layer-stacks fixture's device card now has
twelve bars with short labels, so its counter reaches 10 mid-shot (frame 426). Measured against Remotion (swangle), 142 frames
over both formats (the P2.5c sweep plus every 2nd frame 430 to 470): all at or above 0.995, lowest 0.99840. The journey adds
frames 426, 440 and 460.

### P2.5e blocks on a none stage

`Film.tsx`'s `Stage` returns nothing for a shot whose stage is `none`, so that shot's blocks never reach the frame; the
screenplay compiler (`backend/scriptIntake.ts`) still leaves its primitive blocks (a CodeBlock, a ProgressBar, a Kicker and
so on) on the first shot of every other segment, which it gives a `none` stage. `nativeSupport` no longer refuses a film for a
block it would never draw. Two things on a `none` shot stay refused: an `AnalogyInset` (its full-screen hero played from a
frames directory is overlaid by `Film.tsx` on any stage) and footage. The fixture `test_fixtures/packages/node-graph-quiet-blocks`
is node-graph-flat with a CodeBlock, a ProgressBar, and a Kicker, Divider and IconLabel on its `none` shots. Measured against
Remotion (swangle), every 15th frame of both formats through the end card (90 frames): all at or above 0.995, lowest 0.99541,
as node-graph-flat itself measures. The journey `backend/journeys/node_graph_native.journey.ts` adds the fixture with 16 frames.

### P2.6a the inset panel

`Film.tsx` draws an `inset` shot's panel in the format's inset region (`getInsetRegion`): a box filled with the theme's
surface colour, a 1 px hairline border, the card radius, no shadow, and its content centred in a column padded by 3 grid.
The render sizes the panel border-box (measured: its border box is exactly the region, 1152 to 1823 on the long frame) and
centres the counter in the region; treating it as content-box drew the counter 25 px low and the panel 2 px wide (0.987).
The emitter draws the panel as two rects (the fill over the border box, the hairline on its band) and lays the
StatCounter out in the column's content box (the region less the border and the padding on every side). It is drawn on a
measured form only: a film with a scene, holding exactly one block, a StatCounter. P2.6a measured it on a shot that is
not the first and whose move is `cut`; [P2.6b](#p26b-the-inset-panel-on-a-camera-move) added the first shot and the camera
move. Every other inset form is refused with a reason naming `stage "inset"`: an inset with no block, an inset in a
node-graph film (no scene), and an inset holding anything but a StatCounter (none of these is measured against Remotion
yet). The journey `backend/journeys/inset_panel.journey.ts` asks
the renderer choice for both formats of `test_fixtures/packages/inset-stage` (native must be chosen) and compares 21 frames
(the shot before, the counter shot counting and landed, the shot after and the end card) with Remotion's stills at 0.995,
none left out. Every 15th frame of the delivered video, long and reel (59 frames): all at or above 0.995, lowest 0.99847.

### P2.6b the inset panel on a camera move

A compiled film opens every inset shot on a `pan` unless it starts a chapter, so the cut form of P2.6a alone rarely applies.
`Film.tsx` draws a panel on a shot that is not a cut and not the first with an opacity of `min(1, 1.4 * open) * (1 - close)`,
`open` the ease-out-expo over the camera move (900 ms) from the shot's start and `close` the same ease over its last 420 ms; its
content column fades in linearly from 55% of the move to its end, and the blocks start their own entrance when that fade
starts. The first shot is drawn still, as a cut. The emitter gives the card group the panel's opacity as a dense track (held at
the shot's last frame under the end card) and the blocks a content group with the column's fade, both composited as rounded
layers the way Chrome composites nested opacity; a cut keeps the P2.6a document byte for byte. The fixture
`test_fixtures/packages/inset-moves` holds a first-shot inset on a cut and an inset on a `pan` that opens, counts and closes.
Measured against Remotion (swangle), 76 frames over both formats (every second frame of the open and the close, a spread and
the end card): all at or above 0.995, lowest 0.99847; mid-fade pixels agree exactly (the panel at 152: 15, 15, 17 in both).
The journey `backend/journeys/inset_panel.journey.ts` adds the fixture with 33 frames. An inset with no block, an inset in a
node-graph film and an inset holding anything but one StatCounter stay refused.

### P2.1 SVG filters: glow and drop shadow

Measured on the Linux laptop against Remotion's own Chrome (its pinned `chrome-headless-shell` with the `swangle` GL
flags the journeys use), whole 1920 x 1080 frames, SSIM by ffmpeg:

| Artwork | SSIM | Same artwork without its filters (the anti-aliasing floor) |
| --- | --- | --- |
| The node-graph edge glow (`neonGlow`) on curved, dashed and straight edges | 0.99965 | 0.99996 |
| Drop shadows and an accent glow on cards (translucent gradient fill, group opacity, scaled, rotated) | 0.99844 | 0.99982 |
| The same two at a 2.2 camera zoom | 0.99979 and 0.99502 | 0.99995 and 0.99931 |
| Saturated colour blocks blurred in linearRGB and sRGB, an anisotropic blur, arithmetic and xor composites | 0.99631 | 0.99988 |
| A blur under its own `clip-path` and under an ancestor's (the filter runs before the clip, as in Chrome) | 0.99981 | - |

The blur is Skia's CPU Gaussian with the standard deviation as sigma and transparent edges; Remotion's Chrome blurs on
its GPU raster path, so a blur edge differs by at most 7 levels (sigma 2) and 2 to 5 levels at larger sigmas,
measured on a white bar over black; a filter layer in half float changed nothing, so the difference is the kernel,
not precision. Inside a dark card under a linearRGB filter both renderers posterise the same way (Chrome converts at
8 bits too); what differs there is where the gradient's dither crosses a level. `backend/journeys/svg_filters.journey.ts`
gives a copy of the picture fixture the edge glow and a shadowed card, checks the renderer choice draws it natively,
and gates three frames (long 135 and 285, reel 285) at the stage SSIM bar of 0.995 against Remotion: native measured
0.99752 to 0.99764, and the same frames drawn without the filters 0.99195 to 0.99259, so the gate fails if the filters
stop being drawn.

## The renderer flag

Every render job chooses its renderer through `createSelectedRenderer` (`backend/rendererSelection.ts`): the
pipeline's render stage (`backend/pipeline/run.ts`), the studio Export (`backend/exportJobs.ts`), the review and
all-check render (`backend/geminiReview/render.ts`) and `aideos render` / `aideos reel`
(`scripts/render_active.ts`, which also takes `--renderer`). The choice is made when the job prepares, on the film
the job actually renders (after the studio's preparation), and is read from `AIDEOS_RENDERER`:

| `AIDEOS_RENDERER` | Behaviour |
| --- | --- |
| unset or `auto` (default) | native when `nativeSupport` accepts the film in that format, the binary is built (`native/target/release/aideos-render`, or `AIDEOS_RENDER_BIN`) and the native loader accepts the staged package (`aideos-render check`, asked while the job prepares); otherwise Remotion renders it exactly as before, and the log names every reason, including the loader's own refusal |
| `remotion` | the kill switch: every film on Remotion |
| `native` | native is required: a film it cannot draw, or a missing binary, fails the job with every reason |

A failure of the native renderer on a film it accepted fails the job; it never falls back to Remotion. A refusal at
load is not acceptance: before the illustrated stage, a PNG wrapped inside an SVG asset passed the design check, was
sent to the native renderer and failed there with no fallback. Now the design check refuses it, and if such a film
is rendered anyway the native loader's refusal (`unsupported element <image>`) sends it to Remotion in `auto`, with that
reason in the log (`backend/journeys/pictures_stage.journey.ts` reproduces it end to end); `native` mode still fails it. The job
sidecar (`<output>.render.json`) records the renderer that drew the file (`renderer`), next to the profile
settings it applied.

**Encoder policy.** The job's profile decides the encode (the R3 policy in [NATIVE_ENCODE.md](NATIVE_ENCODE.md)):
the pipeline's render stage, the studio Export and `aideos render` are `final` (x264 CRF 16, yuv420p, limited
range); the review and all-check render is `review` (VAAPI or VideoToolbox after the conformance probe, else x264).
The Remotion path keeps its own unchanged flags (`FINAL_ENCODE_FLAGS`).

The native adapter (`backend/nativeRenderer.ts`)
implements the RenderJob `Renderer` interface: `prepare` emits the IR, stages the package (IR, artwork, pictures,
fonts, hard-linked audio) inside the job's attempt directory and runs `aideos-render check` on it (a refusal is a
`NativeLoadRefusal`), `checkDiskBudget` needs room for the mp4 plus
the shared 3 GiB reserve (no frame images are written), and `render` runs `aideos-render video` through the
shared subprocess runner, which owns cancellation and the disk watchdog. The job's delivery checks,
mastering, probe and sidecar are shared; the sidecar records the CRF as applied only when x264 encoded. The
studio's progress bar reads the binary's `frames D/T` lines (a frame counts once it is encoded).

**Which films are native today.** Every film `nativeSupport` accepts, which since P4.2 includes the one-performer cel
Three-stage character film, since P4.3 the cel films with several performers (Pip, Marlo and the J5 film) and since P4.4
the dots-v1 films (the J3 and J4 film). Node-graph films and the other
refusals listed in [The emitter](#the-emitter-r4) stay on Remotion. A journey's render job takes the native path when
the release binary is built (the CI journeys job builds it); the Player-versus-export journeys keep a Remotion export
as their oracle until a WASM preview exists ([P4.5 journeys](#p45-journeys-and-goldens)).

## Not yet native

Node-graph films, the other primitives, devices other than the TokenStrip and the LayerStack ([P2.5b](#p25b-the-tokenstrip-device), [P2.5c](#p25c-the-layerstack-device)), inset forms other than the measured ones ([P2.6a](#p26a-the-inset-panel), [P2.6b](#p26b-the-inset-panel-on-a-camera-move)), panel stages and footage (Phase 2; its first steps, P2.1
and P2.2a, draw the SVG filter subset of glows and drop shadows and the colour and dash offset tracks of `aideos.render/5`; P2.2b emits the flat-camera node-graph canvas and P2.2c draws flat node-graph films natively, see [Phase 2](#phase-2-node-graph-films-and-the-rest)), GPU encoding of
whole films (the GPU path renders stills), the editor preview, the Node addon, effects such as the paper curl,
and nothing of the Three stage any more: the cel stage with any number of performers is carried by
`aideos.render/2` since P4.1 and drawn since P4.2 and P4.3, and dots-v1 is carried and drawn since P4.4. Pictures are
drawn since `/3` (placing, scaling, turning and fading; parallax, masks and blend modes are phase 2). `audio` assets
and `image` assets no image node draws are not opened by the frame raster.
