<!--
File Description: Reference for the Aideos scene graph's custom SVG animation layer - the clip
format, how it compiles, how it renders, and the rules that keep it deterministic.
-->

# Custom SVG animation

A scene asset is a plain, static `.svg` document. Motion is authored separately, as declarative
clips that name elements inside that document by id. Nothing in the asset animates itself: no
`<animate>`, no CSS transitions, no wall clock. Every value is a pure function of the frame index,
which is what makes a render reproducible.

```
videos/<slug>/visuals/thing.svg   static artwork, stable ids
        +
SvgAnimationTimeline              which id moves, how, when
        =
CompiledEntity.elementStates[f]   dense per-frame state
```

| Piece | File |
| --- | --- |
| Clip format, easing, compiler, validator | `svgAnimation.ts` |
| SVG parser (element identity, id discovery) | `svgDocument.ts` |
| Parsed tree to React elements, id namespacing | `svgReact.tsx` |
| Scene compiler (threads timelines onto frames) | `compile.ts` |
| Renderer | `SceneView.tsx` |
| Remotion entry point | `SceneClip.tsx` |
| Whole-film stage | `../SceneStage.tsx` |
| Audio-first retiming | `sceneTiming.ts` |
| Node-side asset loading | `../../../backend/scene/loadSceneAssets.ts` |
| Browser-bundle SVG source map builder | `../../../backend/scene/buildSvgSources.ts` |

## Authoring a timeline

A timeline hangs off an `EnvironmentAsset` as `animation`:

```ts
props: [
  {
    assetId: "diagram",
    svgSource: "videos/kvcache/visuals/pipeline.svg",
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
`drawOn`. `drawOn` reveals a stroked path from 0 to 1 by dashing its stroke; declared on a group,
it reaches the strokeable geometry inside.

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
an id the document does not declare. Pass `collectSceneAssetElementIds(scene)` (or
`loadSceneAssets(scene).elementIdsByAssetId`) to `compileScene` as `assetElementIds` to get the same
check at compile time.

## Rendering

`SceneView` needs the asset source text, because it is a pure browser-safe component with no
filesystem access:

```ts
const assets = loadSceneAssets(scene);                    // Node side
const compiled = compileScene(scene, { assetElementIds: assets.elementIdsByAssetId });
renderFrameStill(compiled.frames[30], "out/frame.png", { svgSources: assets.svgSources });
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
- All emitted numbers are quantized to 4 decimal places, and `-0` is normalized to `0`.
- `compileScene({ clockMs })` pins the diagnostic `meta.compiledAt` / `meta.compileTimeMs`, which
  makes the whole `CompiledScene` byte-identical across runs. Without it only `meta` differs.
- Regression coverage lives in `backend/scene/svgAnimation.test.ts` (A-13 renders the same frames
  twice and compares the markup byte for byte).

## Audio-first timing

Scene length is derived from the narration, never chosen. `framesForAudioMs` converts a segment
length to frames; `alignSceneToAudio` re-clocks a whole scene to a new take, retiming keyframe
tracks, actions and every animation clip proportionally so visuals stay on their beats instead of
drifting. Validation Rule 14 holds the two within 50ms.
