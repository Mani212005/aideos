<!--
File Description: Reference for the Aideos scene graph's custom SVG animation layer and scene camera - the clip
format, how it compiles, how it renders, and the rules that keep it deterministic.
-->

# Custom SVG animation and Scene Camera

A scene asset is a plain, static `.svg` document. Motion is authored separately, as declarative
clips that name elements inside that document by id. Nothing in the asset animates itself: no
`<animate>`, no CSS transitions, no wall clock. Every value is a pure function of the frame index,
which is what makes a render reproducible.

```
videos/<slug>/visuals/thing.svg   static artwork, stable ids
        +
SvgAnimationTimeline              which id moves, how, when
        +
Scene.camera                      center, zoom, rotation trajectory
        =
CompiledEntity.elementStates[f]   dense per-frame state
CompiledFrame.camera              dense per-frame camera state
```

| Piece | File |
| --- | --- |
| Clip format, easing, compiler, validator | `svgAnimation.ts` |
| SVG parser (element identity, id discovery) | `svgDocument.ts` |
| Parsed tree to React elements, id namespacing | `svgReact.tsx` |
| Scene compiler (threads timelines onto frames) | `compile.ts` |
| Camera track compiler and motion stats | `cameraTrack.ts` |
| Scene data types (hierarchy, tracks, camera track) | `types.ts` |
| Renderer (with camera transform) | `SceneView.tsx` |
| Remotion entry point | `SceneClip.tsx` |
| Whole-film stage | `../SceneStage.tsx` |
| Audio-first retiming | `sceneTiming.ts` |
| Stage camera projection & output viewports | `projection.ts` |
| Scene-film kit (Canvas, Timeline builder, camera authoring) | `../../../backend/sceneKit/` |
| Node-side asset loading | `../../../backend/scene/loadSceneAssets.ts` |
| Browser-bundle SVG source map builder | `../../../backend/scene/buildSvgSources.ts` |

## Authoring a timeline

A timeline hangs off an `EnvironmentAsset` as `animation`:

```ts
props: [
  {
    assetId: "diagram",
    svgSource: "videos/<slug>/visuals/pipeline.svg",
    position: { x: 960, y: 540 },
    scale: 2.2,
    rotation: 0,
    opacity: 1,
    animation: {
      timelineId: "pipeline-assembles",
      clips: [
        // Order defines stagger: these three land 8 frames apart, in this order.
        ...stagedEntryClips({
          clipIdPrefix: "nodes-in",
          targets: ["node-input", "node-model", "node-output"],
          startFrame: 0,
          durationFrames: 18,
          staggerFrames: 8,
        }),
        // An edge draws itself in before the thing it points at matters.
        { clipId: "edge-1", targets: ["edge-in-model"], property: "drawOn",
          from: 0, to: 1, startFrame: 26, durationFrames: 14 },
        // A token travels the length of the diagram.
        { clipId: "token-travel", targets: ["token"], property: "translateX",
          from: 0, to: 290, startFrame: 60, durationFrames: 45, easing: "expoInOut" },
        // The model swells as the token reaches it, then settles.
        { clipId: "model-pulse", targets: ["node-model"], property: "scale",
          from: 1, to: 1.18, startFrame: 62, durationFrames: 12, origin: { x: 0, y: 0 } },
        { clipId: "model-settle", targets: ["node-model"], property: "scale",
          from: 1.18, to: 1, startFrame: 74, durationFrames: 16, origin: { x: 0, y: 0 } },
      ],
    },
  },
],
```

**Properties.** `translateX`, `translateY`, `scale`, `scaleX`, `scaleY`, `rotate`, `opacity`,
`drawOn`, `x1`, `y1`, `x2`, `y2`. `drawOn` reveals a stroked path from 0 to 1 by dashing its stroke; declared on a group,
it reaches the strokeable geometry inside. `x1`, `y1`, `x2`, `y2` animate line endpoint coordinates directly.

**Easing.** `expoOut` is the default and is the project's only curve, `cubic-bezier(0.16, 1, 0.3, 1)`
(§03, `motion.ts`). `expoIn`, `expoInOut`, `linear` and `hold` exist for the cases that genuinely
need them. Nothing invents its own curve.

**Origin.** `origin` is the transform origin in the asset's own coordinate space, and only affects
`scale` and `rotate`.

## The two rules that make it read as a movie

1. **Values hold, they do not reset.** Before a clip starts its target holds the clip's `from`;
   after it ends the target holds its `to` until another clip takes over. A base element stays on
   screen and evolves rather than cutting between disconnected states.
2. **Order defines stagger.** A clip's `staggerFrames` delays each target by its index in
   `targets`. No element declares its own delay.

## What is rejected, and why

`validateSvgTimeline` runs inside `validateScene` (Rule 20) and again inside `compileSvgTimeline`.
It rejects: unknown properties and easings, non-integer or negative frames, a clip ending past the
scene, opacity or drawOn outside `[0, 1]`, duplicate clip ids, duplicate targets, and **two clips
driving the same property of the same element over overlapping frames**. That last one is a
conflict with no correct answer, so it fails rather than picking a winner.

`validateSceneWithNodeAssets` additionally reads each asset off disk and rejects a clip that targets
an id the document does not declare. Pass `loadSceneAssets(scene).elementIdsByAssetId` to
`compileScene` as `assetElementIds` to get the same check at compile time.

`validateScene` also rejects any scene containing actors (Rule 21): character rigs are not
supported by the renderer, which currently supports SVG backgrounds and props only.

## Scene camera

A scene can define a declarative camera track (`scene.camera = { keyframes: CameraKeyframe[] }`)
to continuously pan, zoom, or rotate across the persistent 2D scene stage without jumping between
disconnected shots.

```ts
scene.camera = {
  keyframes: [
    { frame: 0, center: { x: 960, y: 960 }, zoom: 1 },
    { frame: 90, center: { x: 500, y: 500 }, zoom: 1.8 },
    { frame: 180, center: { x: 500, y: 500 }, zoom: 1.8 },
  ],
};
```

**Keyframe properties.** `frame`, `center` (`{ x, y }` in scene space), `zoom` (scale factor > 0),
`rotation` (degrees, optional), `easing` (optional).

**Interpolation.** Leave `easing` off, which is the default for a camera. The compiler
(`cameraTrack.ts`) then runs a monotone cubic spline through the keyframes: it never overshoots a
keyframe, a move flows straight through the keyframes it passes, and it comes to rest only where a
value holds or turns (the exact coordinates are kept during a hold, so there is no drift). When
`easing` is specified, the named curve (`expoOut`, `expoInOut`, `linear`, etc.) governs the segment
after that keyframe and the camera stops at both of its ends. Easing every keyframe of a camera track
with `expoInOut` makes each move a short burst between stops, which reads as jitter even when the
peak speed is under the cap; the design check rejects it.

**Authoring with sceneKit.** The scene-film kit's `Timeline` builder provides `Timeline.camera(...)`
and `Timeline.buildCamera()`:

```ts
timeline
  .camera({
    id: "cam-intro",
    from: { center: { x: 960, y: 960 }, zoom: 1 },
    to: { center: { x: 500, y: 500 }, zoom: 1.8 },
    start: 0,
    end: 90,
  })
  .camera({
    id: "cam-focus",
    from: { center: { x: 500, y: 500 }, zoom: 1.8 },
    to: { center: { x: 1200, y: 600 }, zoom: 2.2 },
    start: 120,
    end: 180,
  });
```

`Timeline.camera` asserts temporal bounds and validates continuity: the camera must begin at the
exact center, zoom, and rotation where the prior camera clip ended, unless explicitly flagged with
`allowJump: true`.

**Speed limits & validation.** `checkFilmDesign` (`backend/designCheck/`) validates that declared
camera tracks contain at least two keyframes, exhibit actual motion, have no zero-duration jumps,
and keep translation speed below 20% of the scene frame width per second (384 px/s for 1920-wide scenes)
to prevent disorienting camera shifts. It also measures the compiled per-frame curve: zoom may change at
most 0.8% in a single frame (`MAX_CAMERA_ZOOM_STEP`) and pan may accelerate at most 0.3 scene widths per
second squared (`MAX_CAMERA_PAN_ACCEL_WIDTHS`, 576 px/s^2 for 1920), so a track that bursts between stops is
caught the way an over-fast one is. For Three stage scenes, camera pan/zoom/rotation speed and acceleration
are verified through `projection.ts` in projected output pixels across both wide and reel viewports.

**Pacing & focus validation.** Camera motion must follow move-then-hold pacing: the camera must hold
at rest for at least 30% of the film (`MIN_CAMERA_HOLD_SHARE`), and continuous moves cannot exceed 6 seconds
(`MAX_CAMERA_CONTINUOUS_MOVE_SECONDS`) without settling into a hold. When checked against look-plan targets,
moves must arrive within 1.5 seconds of their planned narration cue (`CAMERA_CUE_LANDING_TOLERANCE_SECONDS`),
and close poses must declare their focused cast object (`focus`) and frame that subject in scene space.

**Hold push-in (opt-in).** Set `scene.camera.holdPush` (a fraction, 0.01 to 0.03; absent is off, and an
off film compiles to exactly what it did before) and `compileCameraTrack` adds a slow push-in over every
camera hold, about 1 to 3 percent of zoom (`src/dl/holdPush.ts`). It is a zoom about the camera's own
centre, so the pan is untouched. It eases in on a smoothstep, a hold of 3 seconds or more gets the full
amount and a shorter one proportionally less (under 1 second gets none), and the push is handed back across
the move that follows, so the camera still lands exactly on every authored pose. A hand-back that would
push the compiled zoom step over the 0.8% ceiling pushes less instead. The design check measures hold share and
continuous-move time on the track without the push, zoom step and pan on the pushed track, and still requires a carried change to stay framed through it.
In `design.json` set `"holdPush": 0.02` next to `camera`. Node-graph films set `holdPush` on a shot instead.
A shot that opts in is not also scaled by the older `drift` flag, which would stack two pushes.

## Rendering

`SceneView` renders sorted compiled background and prop assets in layer order with camera transformation
applied (character rigs are not supported). It needs the asset source text, because it is a pure
browser-safe component with no filesystem access:

```ts
const assets = loadSceneAssets(scene);                    // Node side
const compiled = compileScene(scene, { assetElementIds: assets.elementIdsByAssetId });
renderFrameStill(compiled.frames[30], "videos/my-video/renders/frame.png", { svgSources: assets.svgSources });
```

Inside a composition, `SceneClip` does the compile and frame selection:

```tsx
<SceneClip scene={scene} svgSources={svgSources} startFrame={shot.startFrame} />
```

For scene films where a vector scene replaces the node graph across the whole film,
`SceneStage` (`src/dl/SceneStage.tsx`) wraps `SceneClip` to render the square scene stage
windowed for each aspect ratio, using the bundled `SVG_SOURCES` generated by
`backend/scene/buildSvgSources.ts`.

Each rendered instance namespaces its element ids (`node-model--diagram`), so the same asset can
appear twice in one frame without id collisions.

## Determinism

- No `Date`, no `Math.random`, no CSS transitions, no SMIL. The frame index is the only time input.
- `SceneClip.tsx` holds Remotion capture readiness across an SVG paint boundary after each frame
  commit. Keep this barrier for DOM paint readiness. It cannot make Chromium's fractional-DPR
  surface readback deterministic: even a frozen SVG can rasterize its thin plate border differently
  between captures. The journey frame harness uses Remotion's DPR-1 view capture for scaled PNGs;
  `backend/journeys/j9_svg_repeatability.journey.ts` requires exact cold-render equality.
- All emitted numbers are quantized to 4 decimal places, and `-0` is normalized to `0`.
- `compileScene({ clockMs })` pins the diagnostic `meta.compiledAt` / `meta.compileTimeMs`, which
  makes the whole `CompiledScene` byte-identical across runs. Without it only `meta` differs.
- Regression coverage lives in `backend/scene/svgAnimation.test.ts` (A-13 renders the same frames
  twice and compares the markup byte for byte).

## Audio-first timing

Scene length is derived from the narration, never chosen. `framesForAudioMs` converts a segment
length to frames; `alignSceneToAudio` re-clocks a whole scene to a new take, retiming keyframe
tracks and every animation clip proportionally so visuals stay on their beats instead of
drifting. Validation Rule 14 holds the two within 50ms.

## Scene engine and scene film rules (moved from AGENTS.md)

### Scene graph and custom SVG animation

- The scene engine renders a static `.svg` asset plus a separate declarative animation timeline. The clip format, its rules and the determinism contract are documented in [src/dl/scene/README.md](README.md); read that before touching `src/dl/scene/**`.
- `src/dl/scene/**` is browser bundle code and must stay free of Node imports, because Remotion bundles it. The filesystem half lives in `src/dl/scene/validateSceneNode.ts` and `backend/scene/loadSceneAssets.ts`, which are the Node-only modules by design. `SceneView` therefore takes asset source text as a prop rather than reading it.
- Rasterize review stills with headless Chrome via `backend/scene/renderStill.ts`, never `qlmanage`: qlmanage ignores the document aspect ratio and emits a square thumbnail, so stills made with it are a misleading record of the frame. `renderFrameStill` verifies the PNG dimensions and throws if they are wrong.

### Scene films (a film whose canvas is a scene)

- Characters are data (`aideos.character/1`): author, check and draw them with `characters/README.md` and
  `aideos character check|sheet`; architecture and the retargeted receive are in `docs/CHARACTER_ENGINE.md`.
  After any spec edit re-stamp its hash (`--stamp`); after editing an engine file listed in
  `src/dl/scene/rigs/registry.ts` run `npx tsx scripts/freeze_stage_resources.ts`.
- For Three stage contracts, resource freezes, cue binding or stage review evidence, read
  `docs/THREE_STAGE_P0.md`. Rendering and fixture tests must run sequentially because both rewrite
  the generated active-film module.

- A film's canvas is either the node graph (`film.canvas`) or a vector scene (`film.scene`), never
  both: `src/dl/Film.tsx` renders `SceneStage` in place of `CanvasGraph` when `scene` is present.
  `examples/hello-scene/` is the tiny worked example (see its [README](../../../examples/hello-scene/README.md))
  and `test_fixtures/packages/still-talking/` the full-length one; `backend/stillTalking/` rebuilds it
  into `videos/still-talking/` on the shared kit.
- One `Scene` spans the whole film, not one per shot. That is what makes continuity real, because
  the engine holds each element's last value until another clip takes over. Shots then carry only
  the text cards that overlay it.
- `SceneView` is pure and cannot read disk, so committed assets reach the Remotion bundle through
  the generated, gitignored `src/dl/scene/assets/svgSources.generated.ts`. Regenerate it with
  `npm run ensure:generated` whenever a `visuals/*.svg` changes.
- Compose a scene film on a **square** scene space (1920 x 1920). Each format takes a 1080-wide
  strip through the centre, so the shared safe area is the centre 1080 square; the wide cut also
  sees the left and right wings, and the reel also sees the top and bottom bands. `SceneStage`
  covers rather than contains, so a scene of any other aspect would be cropped, not letterboxed.
- Two rules the engine cannot check, both enforced by the `Timeline` builder in the scene-film kit
  (`backend/sceneKit/`, which every scene film builds on): a clip must start from the value the previous clip on that
  property left behind (otherwise the value snaps on screen), and one element may only ever be
  given one transform `origin` (the compiler applies the last origin it sees to every frame).
  `Timeline.camera()` likewise enforces camera track continuity from the previous camera clip,
  preventing visual snaps on camera movement.
- `backend/sceneKit/` is also the authoring layer, so a new scene film writes no kit code of its own:
  `Canvas` (`canvas.ts`: markup plus continuity-checked motion, and `lyric()` kinetic type that
  throws when a row no longer matches the narration or overflows its bounds; a token like `HNSW{4}`
  covers four spoken words), `svg.ts` (palette, `el`/`g`/`text`, seeded `rng`), `typeMetrics.ts` plus
  `wordWidths.json` (kerned Geist word widths measured in Chrome; add a film's new words with
  `measureWords.ts`, which merges rather than replaces), `wrap.ts` (`wrapBalanced`), `chrome.ts`
  (corners, backdrop, readouts), and the Node-only tools `voiceover.ts` (`produceVoiceover({slug,
  beats, alignment})`: synthesize, master, optional Whisper word alignment, write the spine),
  `preview.ts` (fast Chrome frames) and `reviewFrames.ts` (`npx tsx backend/sceneKit/reviewFrames.ts
  <slug>`). A film supplies its beats, artwork and accent; topic scenes stay in the film's own folder.
- Aim a cue at a spoken word, not at a fraction of its shot: the payoff word of a sentence is
  usually near its end. The kit's `createCues(timing).word()` reads the narration's own offsets and throws
  when the phrase is no longer in that shot, so rewriting a line cannot silently mis-time the film.
- Chrome drawn over a scene needs its own ground. A node graph leaves the bottom of the frame
  empty, but a star field will put a dot straight through a glyph of the chapter rail, so `Rail`
  carries its own scrim rather than trusting what is behind it.
- Opacity has one trap worth knowing: an authored `opacity` attribute and a clip that drives
  opacity both want the same attribute. The compiled state wins only when a clip actually drives
  it (`SvgElementState.opacityDriven`), so an element authored `opacity="0"` can be faded fully in,
  and an element authored faint can be translated without being forced opaque.
- An asset meant to live in one format's exclusive band (the reel's top/bottom, or the wide cut's
  left/right wings) has to fit its whole bounding box, not just its placement anchor, inside that
  band. `SceneStage` covers with a single fixed window per format, so anchoring an element at the
  band's edge is not enough if the artwork's own extent (control points, stroke half-width) reaches
  back across the 1500-world-unit line into the shared safe square: it leaks a truncated fragment
  into the other format. Compute the local bounding box (not just the authored viewBox, which can
  be smaller than what a curve's control points actually draw) and choose `position`/`scale` so
  the whole thing clears the line with margin, the way `backend/stillTalking/scene.ts`'s
  `trajectory` asset does.
