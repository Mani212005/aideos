<!-- File Description: Complete technical context, API dictionary, schema, and function reference for Aideos. -->

# Aideos: Context, Schema, Classes, Functions & Terminology Reference

This document serves as the complete technical context and API dictionary for the Aideos explainer video engine, detailing all schemas, types, classes, functions, design tokens, and components across `src/dl/`, `backend/`, and `editor/`.

---

## 1. Core Film Schema & Data Types (`src/dl/schema.ts`)

### `Film`
The root data contract defining a complete video composition (stored in `src/dl/films/<id>.ts` or `videos/<slug>/film.json`).
* `id: string` (Lowercase kebab-case identifier, e.g. "character-showcase", "what-is-jepa")
* `title: string` (Human-readable video title)
* `fps: number` (Target playback framerate, standard is 30)
* `accent?: string` (Primary brand hex color override, e.g. "#635BFF")
* `theme?: ThemeConfig` (Global paper background, typography, and camera settings)
* `chapters: string[]` (Ordered list of chapter titles for the progress rail)
* `canvas: { nodes: CanvasNode[], edges: CanvasEdge[] }` (The continuous 2D spatial graph)
* `shots: Shot[]` (Ordered chronological sequence of camera shots and visual blocks)
* `voiceover?: { src: string, volume?: number, speed?: number, retimedSrc?: string }` (Master audio track source file)
* `layers?: LayerDefinition[]` (Persisted non-linear track definitions and settings)
* `audioClips?: AudioClip[]` (Persisted multi-track audio clips)

### `AudioClip`
A discrete audio track entry on the multi-track timeline.
* `id: string` (Unique audio clip identifier)
* `src: string` (Source audio asset file path or URL)
* `position: number` (Timeline start timestamp in seconds)
* `start?: number` (In-point offset into source media in seconds, default 0)
* `end: number` (Out-point offset into source media in seconds)
* `volume?: number` (Audio level multiplier, 0.0 to 2.0, default 1.0)
* `speed?: number` (Playback rate multiplier, 0.25 to 4.0, default 1.0)
* `retimedSrc?: string` (Cached path to pitch-corrected WSOLA time-stretched WAV file)
* `channel?: "voiceover" | "music" | "sfx" | "external"` (Audio routing channel)
* `layerId?: string` (Assigned timeline layer ID)

### `Shot`
A single continuous camera view and duration window on the timeline.
* `id: string` (Unique shot identifier, e.g. "shot-intro")
* `ch?: string` (Chapter assignment for chapter rail tracking)
* `dur: number` (Authored duration in seconds; locked by master audio clock +/- 50ms)
* `stage: "anchor" | "frame" | "none"` (Visual staging: "frame"=Hero center stage, "anchor"=grows from canvas node, "none"=empty canvas)
* `look: string | string[] | "all"` (Node ID(s) targeted by the camera viewport)
* `move: "cut" | "pan" | "zoom-in" | "zoom-out" | "hold"` (Camera motion transition)
* `zoom?: number` (Camera optical zoom multiplier, default 1.0)
* `drift?: boolean` (True to apply subtle 100% to 104% scale drift during holds)
* `blocks: Block[]` (Array of visual blocks rendered during this shot)
* `scriptText?: string` (Exact voiceover narration sentence spoken in this shot)
* `visualDirection?: string` (Human/AI visual intent prompt)
* `metaphor?: string` (Assigned visual metaphor ID)
* `needsFootage?: boolean` (Flag indicating AI video b-roll overlay)
* `layerId?: string` (Explicit lane assignment when placed off default track)

### `CanvasNode`
A 2D rectangular concept card on the continuous spatial map.
* `id: string` (Unique node identifier)
* `label: string` (Primary node title)
* `sub?: string` (Secondary subtitle or descriptor)
* `x: number, y: number` (Top-left coordinate in virtual canvas pixels)
* `w: number, h: number` (Width and height bounding box)

### `CanvasEdge`
A directed relationship connection between two canvas nodes.
* `from: string` (Source node ID)
* `to: string` (Target node ID)
* `dashed?: boolean` (True if rendered as dashed connection line)

---

## 2. Visual Block Taxonomy (`src/dl/Block.tsx`, `src/dl/schema.ts`)

Blocks are divided into two strict categories:

### A. Device & Character Blocks (`DEVICE_BLOCKS`)
Interactive, complex visual containers that spend 1 accent token:
* **`CharacterBeat`**: 2-level kinematic SVG character rig (`characterId`, `poses`).
* **`DeviceCard`**: Browser window, code editor, or terminal mockup (`variant`, `title`, `url`).
* **`MetaphorViewer`**: Interactive concept visualizer (KV cache, balance scale, fluid reservoir).
* **`MatrixGrid`**: 2D memory allocation and tensor cell grid (`values`, `rowLabel`, `colLabel`, `sweep`).
* **`TokenStrip`**: Sequence token cards with active highlighting (`tokens`, `lit`, `caption`).
* **`AttentionArcs`**: Directed curved attention links between tokens (`tokens`, `focus`, `links`).
* **`LayerStack`**: 3D isometric neural network layer cards (`count`, `bottomLabel`, `topLabel`).
* **`VectorSpace`**: 2D embedding space with vector points and arrows (`points`, `arrow`, `xLabel`, `yLabel`).
* **`AnalogyInset`**: Full-bleed cinematic video b-roll overlay (`caption`, `framesDir`, `totalFrames`).

### B. Text Beats (`TEXT_BEATS`)
Typography and metric cards that spend 0 accent tokens:
* **`TextReveal`**: Staggered word-by-word kinetic headline typography (`text`, `size`, `accentWord`).
* **`StatCounter`**: High-impact numeric stat with animated counter (`to`, `label`, `suffix`, `format`).
* **`Body`**: Multi-line narrative description text (`text`).
* **`Kicker`**: Small uppercase tracking eyebrow tag above headlines (`text`).
* **`MathLine`**: Mathematical formula rendered in Source Serif italic (`text`).
* **`ProgressBar`**: Chapter progress indicator (`value`, `label`).
* **`IconLabel`**: Icon with text label (`text`).

---

## 3. Pure TypeScript Character Rigs (`src/dl/characters/`)

### `CharacterRig`
Interface defining a modular vector rig:
* `id: string` ("astronaut" | "developer")
* `name: string` ("Astro Guide" | "Tech Architect")
* `description: string` (Short visual description)
* `viewBox: string` (SVG viewBox string, e.g. "0 0 200 320")
* `groups: CharacterGroup[]` (Hierarchy of limbs and joint groups)

### `CharacterGroup`
A single poseable limb or joint container:
* `id: string` ("torso" | "head" | "leftArm" | "rightArm" | "legs")
* `parent?: string` (Parent group ID for 2-level hierarchical transforms, e.g. "torso")
* `pivot: { x: number, y: number }` (Rotational hinge anchor coordinate)
* `defaultRotation?: number` (Rest angle in degrees)
* `paths: CharacterPath[]` (Array of SVG vector paths)

### `CharacterPath`
An individual vector path inside a limb:
* `d: string` (SVG path data definition)
* `fill?: SemanticToken` ("surface" | "ink" | "muted" | "hairline" | "accent" | "canvas" | "none")
* `stroke?: SemanticToken` ("surface" | "ink" | "muted" | "hairline" | "accent" | "canvas" | "none")
* `strokeWidth?: number` (Stroke thickness in pixels)

### `POSE_PRESETS` (`src/dl/characters/presets.ts`)
8 built-in one-click gesture configurations:
* `neutral`: Rest posture, attentive listening.
* `present-right`: Body tilted -4 deg, left arm -35 deg, right arm +20 deg pointing right.
* `present-left`: Body tilted +4 deg, left arm +20 deg, right arm -35 deg pointing left.
* `think`: Body tilted -2 deg, head +8 deg, right hand to chin at -65 deg.
* `shrug`: Both arms raised at -45 deg and +45 deg, head +6 deg.
* `wave`: Right arm raised +85 deg with +15 deg wave flick.
* `crossed-arms`: Left arm -40 deg, right arm +40 deg crossed over chest.
* `celebrate`: Both arms raised high at +110 deg and -110 deg.

---

## 4. Camera & Spatial Coordinates Engine (`src/dl/camera.ts`)

| Function | Signature | Description |
| :--- | :--- | :--- |
| `buildTimeline(film, targetDur)` | `(Film, number?) => TimedShot[]` | Builds linear frame timeline, assigning start frame `from`, end frame `to`, and frame counts. |
| `camAt(film, timeline, frame, viewport)` | `(Film, TimedShot[], number, Size) => Cam` | Solves continuous camera position (x, y) and zoom factor at any exact frame. |
| `shotAt(timeline, frame)` | `(TimedShot[], number) => TimedShot` | Returns the active shot and chapter metadata at the current playhead frame. |
| `lookBox(film, shot)` | `(Film, Shot) => Box` | Calculates bounding box enclosing all nodes targeted by the shot's `look` parameter. |
| `projectBox(box, cam, viewport)` | `(Box, Cam, Size) => Box` | Projects 2D world-space coordinates into 2D screen-space pixel coordinates. |
| `totalFrames(timeline)` | `(TimedShot[]) => number` | Returns total frame count across all shots in the timeline. |

---

## 5. Design System Tokens (`src/dl/tokens.ts`, `src/dl/motion.ts`, `editor/src/styles/tokens.css`)

### Rendered Video Design System (`src/dl/tokens.ts`)
* `useTokens()`: React hook providing active theme-token colors for Remotion components dynamically.
* `canvas`: `#0A0A0B` (Deepest canvas background layer)
* `surface`: `#101013` (Raised card surface background)
* `ink`: `#F5F5F5` (High-contrast typography text)
* `muted`: `#8A8A8E` (Secondary captions, subtitles, and labels)
* `hairline`: `rgba(245, 245, 245, 0.10)` (Subtle borders and separators)
* `accent`: `#635BFF` (Default brand focus color)

### Rendered Video Background Themes (`src/dl/tokens.ts`)
* `paper-white`: Archival textured paper with organic fiber lighting (`#F8F6F0`).
* `parchment`: Warm academic manila cream paper with aged grain (`#F4EFEA`).
* `blueprint`: Deep cyan engineering blueprint grid (`#0B2545`).
* `charcoal`: Dark tactile slate paper with crisp silver ink (`#121214`).
* `dot-grid`: Minimalist precision dot matrix on crisp surface (`#FAF9F6`).
* `smooth-dark`: Studio deep matte dark presentation (`#0A0A0B`).

### Editor Chrome Neobrutalism Design System (`editor/src/styles/tokens.css`)
* `--nb-paper`: `#EDE9DE` (Main light application background canvas)
* `--nb-surface`: `#F8F5EE` (Raised panel and editor card surface)
* `--nb-subtle`: `#E2DDD0` (Sunken background, lane tracks, inputs)
* `--nb-ink`: `#121214` (High-contrast typography and borders)
* `--nb-muted`: `#66645E` (Secondary helper text and metadata)
* `--nb-border`: `#121214` (Solid 2-4px structural boundaries)
* `--nb-accent`: `#FF5500` (Neobrutal primary action accent)
* `--nb-matte`: `#0A0A0B` (Strictly reserved for video frame matte behind preview)

### `EXPO` Motion Token (`src/dl/motion.ts`)
* `EXPO = [0.16, 1, 0.3, 1]`: Native ease-out-expo cubic-bezier easing curve ensuring high initial velocity and soft, organic landing.

---

## 6. Backend Produce & Validation Engine (`backend/`, `src/dl/validateFilm.ts`)

### `backend/modelClient.ts`
* `getGoogleAiClient()`: Builds and returns the authenticated Google Gen AI client using GEMINI_API_KEY or GOOGLE_API_KEY.
* `isGoogleAiConfigured()`: Checks if Google AI API key credentials are configured in the environment.
* `generateStructuredJson(prompt, options)`: Executes a structured JSON prompt against Gemini with clean JSON parsing, markdown stripping, and a 3-attempt retry loop.
* `generateText(prompt, options)`: Executes a plain-text prompt against Gemini.

### `backend/audio.ts`
* `trimSilence(samples, threshold)`: Re-exported from `backend/pcm.ts`; trims silence samples below amplitude threshold from raw Float32Array audio.
* `chunkTextForTTS(text, maxChars)`: Splits text blocks exceeding maxChars (~800 chars) at sentence boundaries for Kokoro ONNX.
* `splitScriptIntoSegments(script)`: Splits a narration script into distinct shot-scoped segments (strictly by narration beats for Claude-tagged scripts, or blank-line paragraphs for untagged prose).
* `measureAudioDuration(filePath)`: Measures exact audio file duration using ffprobe.
* `concatAudioSegments(audioFiles, silenceWavPath, outWavPath)`: Merges audio clips with fixed pause buffers via FFmpeg concat filter with format normalization.
* `produceAudioPipeline(script, outDir, options)`: Synthesizes script into sample-domain audio timing spine, emitting `voiceover.wav`, `captions.vtt`, and `voiceover_words.json`.
* `buildCaptionsVtt(words)`: Builds phrase-grouped WebVTT caption tracks from absolute word timings.
* `buildFilmFromAudioResult(title, audioResult, options)`: Compiles verified audio durations into a structured `Film` object.
* `processAudioForFilm(film, outDir)`: Generates audio for a film using the narration pipeline and rebuilds the film around it.
* `buildAtempoFilter(speed)`: Builds a cascaded FFmpeg atempo filter chain for arbitrary playback speed factors.
* `resolveAudioSourcePath(src)`: Resolves an audio URL or relative path to an absolute path on disk.
* `retimeAudioSync(src, speed, options)`: Synchronously retimes audio via FFmpeg WSOLA atempo filter and caches the resulting pitch-corrected WAV.
* `retimeAudio(src, speed, options)`: Asynchronously retimes audio via WSOLA atempo filter and caches the result.
* `ensureRetimedAudio(film)`: Pre-renders all retimed audio tracks for a film to ensure static availability for Remotion CLI renders.

### `src/dl/audio/retime.ts` (Deterministic Retimed Audio Paths)
* `sanitizeAudioName(src)`: Converts audio source path into a filesystem-safe identifier.
* `getRetimedAudioFilename(src, speed)`: Computes deterministic filename for a retimed audio track.
* `getRetimedAudioRelPath(src, speed)`: Computes relative public path (`.tmp_audio/...`) for a retimed audio track.

### `backend/pcm.ts`
* `trimSilence(samples, threshold)`: Trims leading and trailing silence samples from Float32Array audio.
* `assembleSegments(segmentChunks, options)`: Assembles synthesized audio segments in the sample domain with exact inter-segment gaps and boundary fades.
* `deriveShotDurations(segments, totalSec)`: Derives boundary-to-boundary shot durations matching narration sample boundaries.
* `distributeWordTimings(text, durationSec)`: Calculates relative word start and end offsets across a segment duration.
* `normalizePeak(samples, targetDb)`: Normalizes Float32 audio samples to peak dBFS without clipping.
* `encodeWav(samples, sampleRate)`: Encodes Float32Array audio directly into a standard 16-bit mono PCM WAV buffer.
* `decodeWav(buffer)`: Decodes a WAV buffer into normalized Float32Array samples.

### `backend/tts.ts`
* `createTtsBackend(options)`: Instantiates pluggable TTS engine (`kokoro` via worker process, `google`, `say`, `tone`).
* `KokoroTtsBackend`: Local offline ONNX synthesizer using Kokoro-82M (default).

### Production Pipeline & MCP Server (`backend/pipeline/`, `backend/mcp/`)
* Deep reference documentation in [`docs/PRODUCTION_PIPELINE.md`](PRODUCTION_PIPELINE.md).
* `runProduction(request, onProgress)` (`backend/pipeline/run.ts`): Single typed programmatic entry point driving `intake`, `narrate`, `design`, `broll`, `assemble`, `render`, `verify`.
* `compileScreenplayToFilm(screenplay, spine, options)` (`backend/pipeline/design.ts`): Compiles screenplay and narration spine into validated `Film`.
* `renderFormat(slug, format, options)` (`backend/pipeline/render.ts`): Drives Remotion render with headless verification and contact sheet generation.
* `startMcpServer()` (`backend/mcp/server.ts`): Exposes the production pipeline as an MCP stdio server with tools `aideos_produce_film`, `aideos_run_status`, `aideos_list_runs`, `aideos_list_films`, `aideos_get_film`.

### `backend/scriptIntake.ts`
* `parseClaudeScript(raw)`: Parses a raw Claude or legacy screenplay into structured `ScriptSegment` items containing ordered visual, narration, and on-screen beats.
* `serializeSegmentsToScript(segments)`: Serializes structured segments back into canonical markdown with timestamp headers and bracket tags.
* `hasScreenplayTags(raw)`: Returns true when raw script text contains at least one recognizable screenplay tag beat.
* `extractSpokenBlocks(raw)`: Extracts strictly the spoken narration dialogue with zero visual or on-screen tag leakage.
* `buildFilmPartsFromScript(raw)`: Compiles a Claude screenplay into Remotion-ready sub-shots, canvas nodes and edges, and on-screen `TextReveal` blocks.

### `backend/sync.ts`
* `runSemanticVisualSync(film, captions)`: Evaluates spoken words against visual device blocks.
* `matchShotVisual(segmentText, chapter)`: Determines whether a shot uses `CharacterBeat`, `DeviceCard`, `StatCounter`, or `TextReveal`.

### `src/dl/videoPackageLoader.ts`
* `getProjectRoot()`: Resolves the absolute path to the project root directory walking up the filesystem.
* `getVideosDir()`: Resolves the absolute path to the `videos/` package directory (honors `AIDEOS_VIDEOS_DIR`).
* `listVideoPackages()`: Returns a sorted array of all valid video package directory slugs in `videos/`.
* `loadVideoPackage(slug)`: Loads and parses a standalone video package (`film.json`, `shotlist.json`, `treatment.json`, and visuals availability).

### `backend/scene/generateSvg.ts`
* `buildSvgPrompt(options)`: Constructs the system prompt for synthesizing bespoke React SVG visual components with invariant rules.
* `buildSvgAssetPrompt(options)`: Constructs the system prompt for synthesizing plain animatable static SVG scene assets.
* `validateGeneratedSvg(code)`: Validates generated React SVG code against geometric (viewBox, aspect ratio), determinism, self-containment, center-60% containment, and export invariants.
* `validateGeneratedSvgAsset(svgText)`: Validates generated static SVG scene assets (viewBox, preserveAspectRatio, static purity, unique element IDs, center-60% containment).
* `buildRepairPrompt(basePrompt, rejected, errors)`: Constructs retry prompt feeding validator failure reasons back to the model.
* `cleanCodeFence(raw)`: Strips markdown code fences from generated LLM code.
* `synthesizeBespokeSvg(options, llmCaller, targetDir)`: Synthesizes, validates, and saves a bespoke React SVG component to `videos/<slug>/visuals/` with automated repair retry loop.
* `synthesizeAnimatableSvgAsset(options, llmCaller, targetDir)`: Synthesizes, validates, and saves a plain animatable static SVG asset to `videos/<slug>/visuals/` with declared element IDs.

### `backend/scene/loadSceneAssets.ts`
* `loadSceneAssets(scene, options)`: Reads a scene's SVG assets off disk on the Node side, returning `svgSources` and `elementIdsByAssetId` for browser components.

### `backend/scene/renderStill.ts`
* `findChromeBinary()`: Locates an installed Chrome or Chromium binary for high-accuracy rasterization.
* `renderFrameSvgMarkup(frame, options)`: Renders a `CompiledFrame` to deterministic SVG markup string via `ReactDOMServer`.
* `renderFrameStill(frame, outputPath, options)`: Renders a `CompiledFrame` into a true 1920x1080 PNG image file on disk using headless Chrome with output dimension verification.

### `src/dl/scene/` (Custom SVG Animation & Scene Graph)
* Deep reference documentation in [`src/dl/scene/README.md`](../src/dl/scene/README.md).
* `svgAnimation.ts`: Declarative timeline types (`SvgAnimationClip`, `SvgAnimationTimeline`), easing curves, stagger calculations, validator (`validateSvgTimeline`), and compiler (`compileSvgTimeline`).
* `svgDocument.ts`: Pure dependency-free SVG document parser (`parseSvgDocument`), element ID discovery (`collectSvgElementIds`), and bounds calculation.
* `svgReact.tsx`: React SVG renderer (`renderSvgDocumentToReact`) with instance namespacing and per-frame element state transforms.
* `SceneClip.tsx`: Remotion composition entry point with single compilation and current frame selection.
* `sceneTiming.ts`: Audio-first retiming helpers (`framesForAudioMs`, `audioSyncDriftMs`, `alignSceneToAudio`, `retimeSvgTimeline`).
* `SceneView.tsx`: Pure browser-safe SVG scene renderer with no filesystem imports.
* `compile.ts`: Pure deterministic compiler (`compileScene`) threading keyframes, actions, and custom animation timelines onto frames.
* `validateScene.ts`: Phase 1 semantic and physical integrity validator (`validateScene`) including Rule 20 timeline consistency.
* `validateSceneNode.ts`: Node-side filesystem validator (`validateSceneWithNodeAssets`, `collectSceneAssetElementIds`).

### `src/dl/validateFilm.ts`
* `validateFilm(film)`: Runs Zod schema parsing and structural integrity assertions.
* `validatePacingInvariants(film)`: Enforces max 25s hold, no consecutive device repeats, and text breathers every 60-90s.
* `validateFilmAudioAndAssets(film, projectDir)`: Enforces duration sum invariant ($\sum \text{Shots} = \text{Audio} \pm 50\text{ms}$) and confirms audio asset presence.

---

## 7. Non-Linear Layer Engine & Timeline Tools (`backend/timeline/`)

* **`layer_engine.ts`**: Pure functional engine operating over `LayeredFilm`. Provides `buildLayerModelFromFilm`, `convertLayeredFilmToFilm` (lossless round-trip with base film), `moveClip`, `trimClip`, `rippleTrimLayerClipEdge`, `splitClip`, `deleteClip`, `rippleDeleteLayerClip`, and deterministic left-to-right sweep `resolveTrackCollisions`.
* **`timeline.ts`**: Pure functional operations on `Film` shots and associated audio clips (`moveShot`, `moveMultipleShots`, `trimShotEdge`, `rippleTrimShotEdge`, `splitShotAtTime`, `deleteShot`, `rippleDeleteShot`).
* **`layer_manager.ts`**: Track management functions (`addLayer`, `removeLayer`, `reorderLayers`, `setLayerVisibility`, `setLayerMuted`, `setLayerLocked`).
* **`drag_machine.ts`**: Pure pointer-drag state machine managing `move`, `trim-start`, `trim-end`, `scrub`, and `marquee` gestures with `DRAG_THRESHOLD_PX`, Escape cancellation, and zero sticky states.
* **`snap.ts`**: Magnetic snapping engine (`computeSnapPoints`, `snapTimeToTargets`) with zoom-adaptive thresholds and self-ignore boundaries.
* **`waveform.ts`**: Node-side FFmpeg audio peak extraction (`extractWaveformPeaks`, `extractAudioPeaks`) producing normalized amplitude vectors.
* **`voiceover_engine.ts`**: Browser-safe voiceover gap analysis, cue retiming, and drift calculation (`calculateNarrationDrift`).
* **`subtitle_engine.ts`**: VTT subtitle cue splitting, merging, retiming, and validation.

---

## 8. Interactive Web Studio Architecture (`editor/`)

### 7 Sequential Editing Stages (`editor/src/screens/`)
* **`ScriptStage.tsx` (`ScriptEditor.tsx`)**: Screenplay markdown editor with tag parsing, Visual Studio segment cards, and Kokoro ONNX TTS voiceover synthesis.
* **`StoryStage.tsx` (`MindMap.tsx`, `NodeEditor.tsx`)**: 2D infinite spatial canvas for dragging nodes, editing labels, and connecting directed edges.
* **`LookStage.tsx` (`Styleboard.tsx`, `CustomizationEditor.tsx`)**: Storyboard keyframe gallery, 1-click character gesture posing, canvas texture selection, and typography styling.
* **`MotionStage.tsx` (`motionTemplates.ts`)**: Custom SVG animation authoring studio with element-level timeline keyframing, motion templates, and live scrubbing.
* **`EditStage.tsx` (`TimelineEditor.tsx`, `InspectorPanel.tsx`, `AssetBin.tsx`)**: Non-linear multi-track timeline with clip dragging, sticky snapping, magnetic ripple editing (R), linked audio-video trimming, waveform preview, track mute/hide/lock, and clip/shot inspector.
* **`CaptionsStage.tsx` (`KineticCaptionEditor.tsx`)**: Word-level subtitle karaoke editor powered by `@chenglou/pretext`.
* **`ReviewStage.tsx` (`CritiqueStudio.tsx`, `ExportProgressModal.tsx`)**: AI critique drawer, pacing and coverage health charts (`Charts.tsx`), and headless MP4 export progress.

### State & Integration Layer (`editor/src/state/`)
* **`useFilmProject.ts`**: Owns the active `Film` document, autosave debounce, and single labelled undo/redo transaction stack.
* **`useLayeredTimeline.ts`**: Derives `LayeredFilm`, executes layer engine mutations (`moveClip`, `trimClip`, `rippleTrimClip`, `splitClip`, `removeClip`, `rippleRemoveClip`), folds changes back losslessly via `convertLayeredFilmToFilm`, and computes `renderFilm` for preview and export.

### Handcrafted Neobrutalism UI Primitives (`editor/src/components/ui/`)
* **`Badge.tsx`**: Status indicators and token chips.
* **`Button.tsx`**: Neobrutalist buttons with tactile depression on click.
* **`Charts.tsx`**: Pure SVG data visualizations (coverage map, duration distribution, loudness curve, pacing breakdown).
* **`Feedback.tsx`**: Inline error, warning, empty states, and toast notifications.
* **`Field.tsx`**: Text, numeric, and select inputs with monospace technical typography.
* **`Modal.tsx`**: Accessible dialog wrappers with focus trap and backdrop dismiss.
* **`Panel.tsx`**: Bordered containers and sections with hard shadows.
* **`Tabs.tsx`**: Segmented switches and tab lists.
* **`Toolbar.tsx`**: Grouped action strips and icon button bars.
