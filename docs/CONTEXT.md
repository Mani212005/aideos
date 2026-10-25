<!-- File Description: Complete technical context, API dictionary, schema, and function reference for Aideos. -->

# Aideos: Context, Schema, Classes, Functions & Terminology Reference

This document serves as the complete technical context and API dictionary for the Aideos explainer video engine, detailing all schemas, types, classes, functions, design tokens, and components across `src/dl/`, `backend/`, and `editor/`.

---

## 1. Core Film Schema & Data Types (`src/dl/schema.ts`)

### `Film`
The root data contract defining a complete video composition (stored authoritatively in `videos/<slug>/film.json`, with a generated shadow in `src/dl/films/<id>.ts`).
* `id: string` (Lowercase kebab-case identifier, e.g. "hello-scene", "sample-explainer")
* `title: string` (Human-readable video title)
* `fps: number` (Target playback framerate, standard is 30)
* `accent?: string` (Primary brand hex color override, e.g. "#635BFF")
* `theme?: ThemeConfig` (Global paper background, typography, and camera settings)
* `chapters: string[]` (Ordered list of chapter titles for the progress rail)
* `canvas: { nodes: CanvasNode[], edges: CanvasEdge[] }` (The continuous 2D spatial graph)
* `scene?: FilmScene` (Optional vector scene replacing the canvas graph for scene films)
* `shots: Shot[]` (Ordered chronological sequence of camera shots and visual blocks)
* `voiceover?: { src: string, volume?: number, speed?: number, retimedSrc?: string }` (Master audio track source file)
* `captionPlacement?: CaptionPlacementByFormat` (Optional per-format owner caption card placement, see [caption placement](../src/dl/README.md#owner-caption-cards))
* `captions?: "bottom" | "off" | string` (Burned-in captions mode or sidecar path, default "bottom"; position is configured separately by `captionPlacement` in `src/dl/schema.ts`, see [caption placement](../src/dl/README.md#owner-caption-cards))
* `layers?: LayerDefinition[]` (Persisted non-linear track definitions and settings)
* `audioClips?: AudioClip[]` (Persisted multi-track audio clips)
* `videoClips?: VideoClip[]` (Persisted imported footage picture clips)
* `overlayClips?: OverlayClip[]` (Persisted standalone text/image/subtitle overlay clips)

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
* `linkedClipId?: string` (Id of the linked `videoClips` entry, kept symmetric on both sides)

### `VideoClip`
An imported footage picture clip entry on the multi-track timeline (`src/dl/schema.ts`).
* `id: string` (Unique video clip identifier)
* `src: string` (Source video asset file path or URL)
* `position: number` (Timeline start timestamp in seconds)
* `start?: number` (In-point offset into source media in seconds, default 0)
* `end: number` (Out-point offset into source media in seconds)
* `sourceDuration?: number` (Total length of the source file, when known)
* `width?: number, height?: number` (Source video dimensions in pixels)
* `opacity?: number` (Visual opacity, 0.0 to 1.0, default 1.0)
* `volume?: number` (Embedded audio level multiplier, 0.0 to 2.0, default 1.0)
* `speed?: number` (Playback rate multiplier, 0.25 to 4.0, default 1.0, wired to Remotion playbackRate)
* `muted?: boolean` (True to mute embedded audio track)
* `layerId?: string` (Assigned timeline layer ID)
* `linkedClipId?: string` (Id of the linked `audioClips` entry, kept symmetric on both sides)

### `OverlayClip`
A standalone text, image, or subtitle overlay clip not tied to the shot list (`src/dl/schema.ts`).
* `id: string` (Unique overlay clip identifier)
* `kind: "text" | "image" | "subtitle"` (Discriminator for overlay type)
* `position: number` (Timeline start timestamp in seconds)
* `start?: number` (In-point offset in seconds, default 0)
* `end: number` (Out-point offset in seconds)
* `opacity?: number` (Visual opacity, 0.0 to 1.0, default 1.0)
* `layerId?: string` (Assigned timeline layer ID)
* `payload: TextPayload | ImagePayload | SubtitlePayload` (Type-specific overlay content)

### `TextPayload`
Typography overlay payload for standalone text overlays and layered text clips.
* `text: string` (Text content)
* `size?: "kicker" | "headline" | "body" | "caption"` (Visual sizing hierarchy, default "headline")
* `accentWord?: string` (Word to highlight in accent token color)
* `x?: number, y?: number` (Optional fractional 0..1 viewport coordinates)

### `ImagePayload`
Static image overlay payload for standalone image overlays and layered image clips.
* `src: string` (Source image file path or URL)
* `scale?: number` (Display scale multiplier, default 1.0)
* `x?: number, y?: number` (Optional fractional 0..1 viewport coordinates)

### `SubtitlePayload`
Standalone caption cue payload for standalone subtitle overlays.
* `text: string` (Caption text content)
* `startFrame?: number, endFrame?: number` (Optional frame-level timing bounds)

### `CaptionPlacement`
An owner-controlled caption card placement (`src/dl/schema.ts`, `src/dl/captionPlacement.ts`).
* `x?: number` (Normalized card horizontal centre, 0.0 to 1.0, default 0.5)
* `y: number` (Normalized card top edge, 0.0 to 1.0)
* `w?: number` (Normalized card width, 0.0 to 1.0; absent keeps auto-width shrink-to-content sizing)
* `locked?: boolean` (Pinned by owner; prevents agent edits and rebuild overwrite, default false)

### `CaptionPlacementByFormat`
Independent caption card placements per format (`src/dl/schema.ts`).
* `long?: CaptionPlacement` (Owner caption card for 16:9 Long cut)
* `reel?: CaptionPlacement` (Owner caption card for 9:16 Reel cut)

### `CameraTrack`
Declarative camera motion track for continuous scene graph camera movement (`src/dl/schema.ts`, `src/dl/scene/types.ts`).
* `keyframes: CameraKeyframe[]` (Ordered list of camera position, zoom, and rotation keyframes)

### `CameraKeyframe`
A discrete camera position and framing keyframe on the scene timeline.
* `frame: number` (Frame index, integer >= 0)
* `center: { x: number, y: number }` (Scene center coordinate)
* `zoom: number` (Camera zoom multiplier, positive number)
* `rotation?: number` (Camera rotation angle in degrees)
* `easing?: string` (Optional transition easing curve name; leave omitted so monotone spline flows smoothly through keyframes without jitter)

### `Shot`
A single continuous camera view and duration window on the timeline.
* `id: string` (Unique shot identifier, e.g. "shot-intro")
* `captionPlacement?: CaptionPlacementByFormat` (Optional per-format owner caption card exception for this shot)
* `ch?: string` (Chapter assignment for chapter rail tracking)
* `dur: number` (Authored duration in seconds; locked by master audio clock +/- 50ms)
* `stage: "anchor" | "frame" | "none" | "inset"` (Visual staging: "frame"=Hero center stage, "anchor"=grows from canvas node, "none"=empty canvas, "inset"=one device in the format's fixed inset region over a scene stage)
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

### A. Device Blocks (`DEVICE_BLOCKS`)
Interactive, complex visual containers that spend 1 accent token:
* **`DeviceCard`**: Browser window, code editor, or terminal mockup (`variant`, `title`, `url`).
* **`MatrixGrid`**: 2D memory allocation and tensor cell grid (`values`, `rowLabel`, `colLabel`, `sweep`).
* **`TokenStrip`**: Sequence token cards with active highlighting (`tokens`, `lit`, `caption`).
* **`AttentionArcs`**: Directed curved attention links between tokens (`tokens`, `focus`, `links`).
* **`LayerStack`**: 3D isometric neural network layer cards (`count`, `bottomLabel`, `topLabel`).
* **`VectorSpace`**: 2D embedding space with vector points and arrows (`points`, `arrow`, `xLabel`, `yLabel`).
* **`AnalogyInset`**: Full-bleed cinematic video b-roll overlay (`caption`, `framesDir`, `totalFrames`).
* **`INSET_BLOCKS`**: Blocks permitted in a `stage: "inset"` shot (`[...DEVICE_BLOCKS, "StatCounter"]`): exactly one device or numeric counter, never a text card or full-screen hero.

### B. Text Beats & Animated Primitives (`TEXT_BEATS`, `src/dl/primitives.tsx`)
Typography, code, metrics, and cards that spend 0 accent tokens (including the 7 design system animated primitives: `TextReveal`, `StatCounter`, `CodeBlock`, `Card`, `Divider`, `IconLabel`, `ProgressBar`):
* **`TextReveal`**: Staggered word-by-word kinetic headline typography (`text`, `size`, `accentWord`).
* **`StatCounter`**: High-impact numeric stat with animated counter (`to`, `label`, `suffix`, `format`).
* **`CodeBlock`**: Monospace animated code block for terminal commands and code snippets (`code`, `language`, `caption`).
* **`Card`**: High-clarity glassmorphic card grouping metadata or concepts (`title`, `body`, `state`).
* **`Divider`**: Hairline separation rule for section breaks and topic transitions.
* **`IconLabel`**: Icon with text label or status tag (`text`).
* **`ProgressBar`**: Chapter or multi-step progress indicator (`value`, `label`).
* **`Body`**: Multi-line narrative description text (`text`).
* **`Kicker`**: Small uppercase tracking eyebrow tag above headlines (`text`).
* **`MathLine`**: Mathematical formula rendered in Source Serif italic (`text`).

---

## 3. Camera & Spatial Coordinates Engine (`src/dl/camera.ts`)

| Function | Signature | Description |
| :--- | :--- | :--- |
| `buildTimeline(film, targetDur)` | `(Film, number?) => TimedShot[]` | Builds linear frame timeline, assigning start frame `from`, end frame `to`, and frame counts. |
| `camAt(film, timeline, frame, viewport)` | `(Film, TimedShot[], number, Size) => Cam` | Solves continuous camera position (x, y) and zoom factor at any exact frame. |
| `shotAt(timeline, frame)` | `(TimedShot[], number) => TimedShot` | Returns the active shot and chapter metadata at the current playhead frame. |
| `lookBox(film, shot)` | `(Film, Shot) => Box` | Calculates bounding box enclosing all nodes targeted by the shot's `look` parameter. |
| `projectBox(box, cam, viewport)` | `(Box, Cam, Size) => Box` | Projects 2D world-space coordinates into 2D screen-space pixel coordinates. |
| `totalFrames(timeline)` | `(TimedShot[]) => number` | Returns total frame count across all shots in the timeline. |
| `MIN_SHOT_FRAMES` | `15` | Minimum frame duration for any shot on the timeline (0.5 seconds at 30 fps). |

---

## 4. Design System Tokens (`src/dl/tokens.ts`, `src/dl/motion.ts`, `editor/src/styles/tokens.css`)

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

### Number Formatting (`src/dl/numberFormat.ts`)
* `compactNumber(value)`: Formats numeric values with compact magnitude thresholds (T, B, M, k) used by `StatCounter` and reel number grounding.

### `src/dl/fullScreenHeroLayout.ts` (Frame Safe Areas, Hero Layout & Inset Regions)
* `SUBTITLE_BAND_TOP_RATIO`: Single definition of the burned-in caption card top ratio (0.78), aligned with scene engine `CAPTION_SAFE_SQUARE`.
* `subtitleCardHeight(width, height, lines)`: Returns the rendered caption card height for the planned number of lines.
* `subtitleCardBottom(width, height)`: Bottom edge (render px) of the subtitle card.
* `getFullScreenHeroLayout(input)`: Computes media, scrim, and caption bounding box geometry for full-screen B-roll heroes from `FullScreenHeroLayoutInput` (moving the hero label to the bottom when `captionRect.y < height / 2`).
* `getInsetRegion(format, width, height)`: Fixed frame rectangle (`InsetRect`) for `stage: "inset"` device beats (right third in long cut, lower-middle band in reel, clearing subtitle band and margins).
* `INSET_FORMAT_FRAMES`: Reference frame sizes (`long`: 1920x1080, `reel`: 1080x1920) windowed against the square scene.
* `getFrameMargins(format, width)`: Shared format chrome margins (long: 96px, reel: top 120px, left/right 64px, bottom 240px, scaled from format reference width), consumed by `useLayout()` and stage safe regions.
* `getStageSafeRegion(format, width, height, captions)`: Safe scene rectangle intersecting the shared 1080 square with output margins and optional caption band.

### `src/dl/captionPlacement.ts` (Owner Caption Placement Resolution & Gesture Geometry)
* `resolveCaptionPlacement(film, format, shotId)`: Resolves shot exception, film-wide placement, or default bottom card (`{x: 0.5, y: 0.78, w: undefined}`).
* `captionBounds(format, frameW, frameH, w)`: Format-safe placement bounds clamping card within margins, 0.78 floor, and Reel action-zone boundaries.
* `captionCardRect(format, frameW, frameH, placement, lines)`: Computes 2D card bounding rectangle for render, design check, and review OCR.
* `dragCaption(input)`, `resizeCaption(input)`: Gesture math clamping deltas and snapping to margins/center/presets.
* `carryCaptionPlacement(prev, next, options)`: Preserves placements across film writers, protecting locked entries from agent edits or rebuild overwrites.

### `src/dl/captionPhrases.ts` (Deterministic Phrase Splitting by Measured Width)
* `buildCaptionPhrases({ words, fps, width, fontSize, placementAt, measure })`: Measures word widths and splits caption words into at most two lines per phrase, locking placement at phrase start.
* `captionPhraseAtFrame(phrases, frame)`: Resolves active caption phrase and its placement at a given frame.

---

## 5. Backend Produce & Validation Engine (`backend/`, `src/dl/validateFilm.ts`)

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
* `produceAudioPipeline(script, outDir, options)`: Synthesizes script into sample-domain audio timing spine, emitting `voiceover.wav`, `captions.vtt`, and `voiceover_words.json`.
* `normalizeNarrationLoudness(inputPath, outputPath)`: Normalizes a narration WAV to the review loudness target (-16 integrated LUFS, -1 dB true peak) without changing duration.
* `NARRATION_LOUDNESS_TARGET`: Loudness target (`{ integratedLufs: -16, truePeakDb: -1 }`) inside the review window with safe true-peak headroom.
* `buildCaptionsVtt(words)`: Builds phrase-grouped WebVTT caption tracks from absolute word timings.
* `buildFilmFromAudioResult(title, audioResult, options)`: Compiles verified audio durations into a structured `Film` object.
* `buildAtempoFilter(speed)`: Builds a cascaded FFmpeg atempo filter chain for arbitrary playback speed factors.
* `resolveAudioSourcePath(src)`: Resolves an audio URL or relative path to an absolute path on disk.
* `retimeAudioSync(src, speed, options)`: Synchronously retimes audio via FFmpeg WSOLA atempo filter and caches the resulting pitch-corrected WAV.
* `retimeAudio(src, speed, options)`: Asynchronously retimes audio via WSOLA atempo filter and caches the result.
* `ensureRetimedAudio(film)`: Pre-renders all retimed audio tracks for a film to ensure static availability for Remotion CLI renders.

### `src/dl/audio/retime.ts` (Deterministic Retimed Audio Paths)
* `sanitizeAudioName(src)`: Converts audio source path into a filesystem-safe identifier.
* `getRetimedAudioFilename(src, speed)`: Computes deterministic filename for a retimed audio track.
* `getRetimedAudioRelPath(src, speed)`: Computes relative path (`.tmp_audio/...`) for a retimed audio track.

### `backend/pcm.ts`
* `trimSilence(samples, threshold)`: Trims leading and trailing silence samples from Float32Array audio.
* `assembleSegments(segmentChunks, options)`: Assembles synthesized audio segments in the sample domain with exact inter-segment gaps and boundary fades.
* `deriveShotDurations(segments, totalSec)`: Derives boundary-to-boundary shot durations matching narration sample boundaries.
* `distributeWordTimings(text, durationSec)`: Calculates relative word start and end offsets across a segment duration.
* `normalizePeak(samples, targetDb)`: Normalizes Float32 audio samples to peak dBFS without clipping.
* `encodeWav(samples, sampleRate)`: Encodes Float32Array audio directly into a standard 16-bit mono PCM WAV buffer.
* `decodeWav(buffer)`: Decodes a WAV buffer into normalized Float32Array samples.

### `backend/tts.ts`
* `DEFAULT_KOKORO_SPEED`: Kokoro default pace multiplier (0.75) chosen to keep explainer narration within the review pacing limit.
* `createTtsBackend(options)`: Instantiates pluggable TTS engine (`kokoro` via worker process, `google`, `say`, `tone`).
* `KokoroTtsBackend`: Local offline ONNX synthesizer using Kokoro-82M (default).

### `backend/voiceSynthesis.ts`
* `synthesizeVoiceover(req, deps, env)`: Executes the multi-provider voiceover synthesis chain (local Kokoro -> Deepgram Aura -> Google Cloud TTS -> macOS `say`) for `/api/generate-voiceover` and returns WAV audio with the winning provider, throwing `VoiceSynthesisError` with diagnostic reasons for all skipped or failed providers on total failure.
* `VoiceSynthesisError`: Error carrying `attempts: ProviderAttempt[]` recording why each provider failed or was skipped.
* `kokoroFits(limit, env)`: Verifies whether the container or host memory meets the minimum threshold (1.5 GB) for in-process Kokoro TTS, honoring `AIDEOS_KOKORO=1/0` overrides.
* `readContainerMemoryLimit()`: Detects cgroup v1 and v2 memory limits in containerized Linux environments.
* `pcm16ToWav(pcm, sampleRate)`, `floatToPcm16(samples)`, `wavDataChunk(wav)`: Pure audio conversion helpers between raw float samples, 16-bit PCM, and WAV data containers.
* `sayToWav(text, voice)`: Native macOS `say` voice synthesizer pipeline converting AIFF to 48kHz mono WAV via FFmpeg.
* `macVoiceFor(voice)`: Maps studio voice identifier to macOS system voice name.

### Production Pipeline, Auto-Prompt Director & MCP Server (`backend/pipeline/`, `backend/mcp/`)
* Deep reference documentation in [`docs/PRODUCTION_PIPELINE.md`](PRODUCTION_PIPELINE.md) and [`docs/DIRECTOR_GUIDE.md`](DIRECTOR_GUIDE.md).
* `runProduction(request, onProgress)` (`backend/pipeline/run.ts`): Single typed programmatic entry point driving `intake`, `narrate`, `look`, `design`, `reel`, `broll`, `assemble`, `render`, `verify`.
* `runDirector(request, onProgress)` (`backend/pipeline/director.ts`): Auto-prompt entry point above `runProduction` that drafts a Claude screenplay from a raw prompt with an LLM and produces it end to end.
* `draftScreenplay(prompt, options)` (`backend/pipeline/director.ts`): Drafts and validates a Claude screenplay from a natural language prompt, retrying rejected drafts with feedback.
* `transformProseToScreenplay(prose, options)` (`backend/pipeline/director.ts`): Automatically transforms raw untagged prose into a structured Claude screenplay with visual and narration beats via LLM with validation retries and code fence stripping.
* `buildProseTransformSystemInstruction()` (`backend/pipeline/director.ts`): Assembles the system instruction for transforming raw prose into structured scenes, visual directions, on-screen text, and narration beats.
* `compileFilmFromScreenplayAsync(script, narration, shotDurations, options, jevOptions)` (`backend/pipeline/design.ts`): The design stage's compile path. Compiles screenplay and narration spine into a validated `Film`, asking Jev `selectShotVisual` (see `backend/jev.ts`) only for beats that could take a device, and emitting a device only when `backend/shotVisualCues.ts` finds its data in the narration and the beat has on-screen copy to headline it.
* `renderFormat(slug, format, options)` (`backend/pipeline/render.ts`): Drives Remotion render with headless verification and contact sheet generation.
* `startMcpServer(options)` / `createMcpServer(options)` (`backend/mcp/server.ts`): Exposes the production pipeline, design tools, agent bridge, and remote agent link loop (`aideos_wait_for_task`) as an MCP stdio/HTTP server with tools `aideos_produce_film`, `aideos_run_status`, `aideos_list_runs`, `aideos_list_films`, `aideos_get_film`, `aideos_edit_film`, `aideos_list_edit_log`, `aideos_get_pending_tasks`, `aideos_claim_task`, `aideos_complete_task`, `aideos_report_step`, `aideos_look_brief`, `aideos_look_check`, `aideos_design_brief`, `aideos_read_file`, `aideos_write_file`, `aideos_design_build`, `aideos_design_check`, `aideos_frame_stills`, `aideos_submit_frame_review`, and `aideos_wait_for_task`.

### `backend/pipeline/filmStore.ts`
* `ROOT`: Absolute path to project root directory.
* `readFilm(slug)`: Reads and parses `videos/<slug>/film.json` as authoritative `Film`.
* `writeFilm(slug, film)`: Validates and persists `Film` to both `videos/<slug>/film.json` and its shadow `src/dl/films/<slug>.ts` module simultaneously, and broadcasts `traceBus.notifyFilmUpdated` for live Studio synchronization.
* `setActiveFilm(slug)`: Points the generated, gitignored `src/dl/activeFilm.ts` at the target film package.
* `ensureGenerated()` (`generatedFiles.ts`): Rebuilds every generated file (`src/dl/films/<slug>.ts` shadows, `svgSources.generated.ts`, `activeFilm.ts`) from the packages on disk; run by `npm run ensure:generated`, postinstall and the pre-hooks of the scripts that bundle them.
* `wireFootageIntoFilm(slug, shotId, relPath, promptText)`: Wires rendered B-roll video clip into a shot as an `AnalogyInset` block and saves to both storage targets.

### `backend/pipeline/deviceData.ts` (Model-Authored Chart Data)
* `authorDeviceData(requests, caller)`: Authors and validates data for complex chart devices (`TokenStrip`, `Plot`, `MatrixGrid`, `Distribution`, `LayerStack`, `ScaleBar`) via batched LLM generation, refusing any block that fails validation or uses ungrounded labels/numbers.
* `checkDeviceHonesty(block, source)`: Verifies that all labels, tokens, ticks, and numbers shown by an authored block are grounded in the beat's spoken narration or on-screen copy.

### `backend/agentBridge/` (Connected Agent Bridge Hub & Multi-Channel Dispatcher)
* `traceBus` (`backend/agentBridge/traceBus.ts`): Global singleton in-process telemetry and live film update bus (`TraceBus`) collecting and streaming execution steps (`recordStep`, `updateStep`, `getRecentSteps`, `subscribe`, `clear`) and broadcasting real-time film change notifications (`onFilmUpdate`, `notifyFilmUpdated`, `filmSubscriberCount`) across coding agents, Studio clients, AI edit planning, neural TTS synthesis, GPU B-roll rendering, and invariant validation.
* `formatStepTimestamp(date)`, `generateStepId()` (`backend/agentBridge/traceBus.ts`): Formatting and identifier helpers for trace steps.
* `dispatchTask(opts)`: Dispatches rich task context across all active channels (Firstmate steering inbox, MCP task queue, local file/tmux) with automatic hybrid timeout fallback. The tmux effect is injectable and only sends to a recorded pane ID; without one, durable file and event-log delivery still occurs.
* `buildTaskContext(opts, rootDir)`: Assembles full working context payload (script, film manifest, audio spine, word timings, director guide ref, design invariants).
* `shotLookContext(filmId, shotId, rootDir)`: Reads the checked look plan's treatment and carried cast objects for one shot to provide look-first context in shot redesign prompts.
* `buildDirectingPrompt(opts, context)`: Formats structured directing prompts for connected coding agents from Studio events (`canvas_updated`, `critique`, `ai_edit`, `narrate_audio`, `script_updated`, `produce_film`, `custom_directive`).
* `taskQueue`: Global in-memory lifecycle manager for agent tasks (`createTask`, `claimTask`, `completeTask`, `failTask`, `timeoutTask`, `listPendingTasks`, `listAllTasks`, `addListener`).
* `writeFirstmateInboxMessage(task, targetInboxDir)`: Writes sequential steering message file (`001.msg`, `002.msg`, ...) to Firstmate agent inbox.
* `dispatchLocalAndTmux(prompt, opts)`: Writes `.aideos_task.md` and an event-log entry, then pastes to a recorded tmux pane ID when available. Session names alone are never paste targets.
* `cancelFallbackTimer(taskId)`, `clearAllFallbackTimers()`: Manages and clears active fallback timer callbacks.
* `getAgentSession()`, `setAgentSession(info)`: Reads and persists active agent session metadata (`.aideos_session.json`).

### `backend/agentLink/` (Headless Coding Agent Link & Connector Hub)
* `AgentLinkStore` (`backend/agentLink/store.ts`): State store for signed pairing tokens, owner keys, heartbeat tracking, and connected agent long-poll queues with single-agent-per-owner replacement tracking (`startPairing`, `startAgentPairing`, `claim`, `authenticate`, `replacementNote`, `isConnector`, `endReason`, `status`, `disconnect`, `heartbeat`, `enqueue`, `next`, `report`, `recordActivity`, `activity`).
* `buildAgentInstructions(agent, apiUrl, token)` (`backend/agentLink/connectInstructions.ts`): Generates agent-native MCP configuration commands and the paste-in prompt for Claude Code, Antigravity, Codex, and OpenCode.
* `remoteTaskPrompt(taskId, prompt)` (`backend/agentLink/prompt.ts`): Maps studio task instructions onto the sandboxed MCP tool interface for headless agents.
* `aideos-connect.mjs` (`scripts/aideos-connect.mjs`): Standalone dependency-free connector script linking local coding agents (Claude, Antigravity, Codex, OpenCode) to the studio via long-polling, supporting `--model provider/model` overrides, free-tier refusal diagnostics (`taskFailureHint`), quiet reconnect notes (`createReconnectNotes`), indented agent output (`indentAgentOutput`), duration formatting (`formatElapsed`), and real-time tool call streaming.

### `backend/jev.ts` (TypeSafe Jev Decision Model & Primitive Selection)
* `selectPrimitive(state, options)`: Selects the most appropriate animated primitive from the 7 design system primitives (`TextReveal`, `StatCounter`, `CodeBlock`, `Card`, `Divider`, `IconLabel`, `ProgressBar`) using TypeSafe Jev decision model evaluation with confidence gating, safe-generic fallback (`TextReveal` or `Card`), and fast deterministic heuristic fallback.
* `decidePrimitiveWithModel(state, options)`: Sends structured choice question to TypeSafe System One (`/v1/systemone`) or OpenRouter alpha decisions endpoint with timeout handling.
* `applyConfidenceGating(answer, state, options)`: Evaluates model choice against confidence thresholds (default 0.65 for complex primitives, 0.40 overall minimum), falling back to safe generic primitives or heuristics.
* `heuristicPrimitiveSelection(state)`: Fast deterministic offline rule-based primitive selector for code, statistics, progress, cards, dividers, and icon labels.
* `buildDecisionRequest(state, model)`: Constructs payload for TypeSafe and OpenRouter decisions API.
* `parseDecisionResponse(val)`: Validates and parses decision response from Jev endpoint into typed `JevChoiceAnswer`.
* `setMockJevHandler(handler)`, `getMockJevHandler()`, `clearMockJevHandler()`: Test hooks for injecting mock Jev decisions without live network calls.
* `selectShotVisual(state, options)`: Chooses a shot-level visual (`Text`, `StatCounter`, `TokenStrip`, `Plot`, `MatrixGrid`, `Distribution`, `LayerStack`, `ScaleBar`) with the same confidence gating and heuristic fallback; `setMockShotVisualHandler`/`clearMockShotVisualHandler` are its test hooks.
* `judgeFrameVerdicts(states, options)`: Evaluates sampled scene-film frames against narration and notes (`Match`, `WrongData`, `LayoutDefect`, `Unreadable`) and rates suggestions (`accept`, `accept-with-change`, `reject`) using text-only Jev CHOICE with confidence gating and heuristic fallback.
* `buildFrameVerdictRequest(state, model)`: Constructs payload for frame-verdict decisions.
* `parseFrameVerdictResponse(val, suggestionCount)`: Parses response for a single frame-verdict request.
* `heuristicFrameVerdict(state)`, `heuristicSuggestionVerdict(suggestion, frameVerdict)`: Deterministic heuristic fallbacks for frame verdicts and suggestion ratings.
* `setMockFrameVerdictHandler(handler)`, `clearMockFrameVerdictHandler()`: Test hooks for injecting mock frame-verdict decisions.
* `candidatePhrases(narration)`: Extracts candidate spoken clauses for the `servesPhrase` question.
* `PRIMITIVE_CRITERIA`: Rubric criteria for the 7 animated primitives written by communicative job (JOB, WHEN, WHEN NOT).

### `backend/visionJudge/` (Rendered Frame Vision Judge & Embedding Review Loop)
* `judgeFilm(filmId, options)` (`backend/visionJudge/judge.ts`): Judges a designed scene film's rendered frames through 5-7 frame sampling, coding agent critique and image-text similarity scoring, and per-frame embedding logging; skips cleanly with `passed: null` when image reviews and embeddings are absent or incomplete (distinguishing unavailable visual judgment from pass or fail), otherwise querying Jev for frame verdicts.
* `judgeAndRepair(filmId, options)` (`backend/visionJudge/judge.ts`): Bounded repair loop handing exact failure errors back to synthesis for automated fixing when visual judgment has failed (`passed === false`), leaving unavailable reviews intact.
* `describeFailure(sample, narration)` (`backend/visionJudge/judge.ts`): Formats exact error string from a failed sample and suggestions for synthesis retry.
* `renderSamples(filmId, film, options)` (`backend/visionJudge/sampler.ts`): Samples every 5-7th frame and rasterizes each once to a verified 1920x1080 PNG via headless Chrome.
* `sampleFrameNumbers(totalFrames, options)`, `clampStride(stride)`, `describeFrame(film, frame)` (`backend/visionJudge/sampler.ts`): Frame index sampling helpers with 5-7 stride clamping and frame narration/on-screen metadata extraction.
* `writeAgentReview(filmId, raw, now)`, `readAgentReview(filmId, since)` (`backend/visionJudge/agentReview.ts`): Validates and persists/reads the coding model's frame review (`design/judge/agent-report.json`).
* `appendEmbeddingLog(filmId, entries)` (`backend/visionJudge/agentReview.ts`): Appends per-frame similarity scores and thresholds to `design/judge/embedding-log.jsonl`.

### `backend/review/` (Deterministic Video Review & Good-Video Rubric)
* `reviewFormats(options)`, `reviewVideo(options)` (`backend/review/review.ts`): Orchestrates measuring rendered video(s) (picture, text, audio) plus film data and narration, evaluating rubric criteria (including criterion 14 `reel-length` on reels), extracting evidence stills, and writing `review.json` (long) and `review.reel.json` (reel).
* `formatReview(report)` (`backend/review/review.ts`): Formats a `ReviewReport` into a human-readable terminal summary with passing/failing gates.
* `measureRenderFacts(videoPath, options)` (`backend/review/renderFacts.ts`): Measures layout persistence, stage clears, cuts, stillness, captions, text size, contrast, overlap, and on-screen numbers from decoded frames and OCR (accepting `captionRectAt` for owner-placed caption regions).
* `prepareCaptionReview(film, width, height)` (`backend/review/captionRegion.ts`): Prepares declared caption review rectangles from film words and output format for measured review OCR and Gemini deterministic facts.
* `measureCaptionWords(words, fontSize)` (`backend/review/captionMeasurements.ts`): Measures caption words with the render's pinned font and layout utility for exact review phrase boundaries.
* `evaluateCriteria(inputs)` (`backend/review/criteria.ts`): Pure evaluation of rubric criteria (criteria 1 to 12 plus supplemental criterion 13 `plan-adherence`) from measured facts against calibrated thresholds.
* `readFilmFacts(film, viewport)`, `loadFilmFacts(filmJson, viewport)` (`backend/review/source.ts`): Derives camera motion, element persistence, carry-over transformations, per-shot stage and motion facts (`planShots`), and optional look plan from film data. Three-stage presence, camera and evaluated performance contact are measured in the supplied output viewport; see [REVIEW.md](REVIEW.md) for the review contract.
* `deriveNarrationFacts(words, duration)` (`backend/review/speech.ts`): Derives pace, dead air, narrated moments, and sync alignment from word timings or narration text.
* `spokenNumbers(text)` (`backend/review/speech.ts`): Extracts numbers from digits and spoken English number phrases, including year expressions ("nineteen eighty four", "twenty twenty four") and cardinal amounts ("twenty five").

### `backend/aideosConfig.ts` (Video Model Policy & Config Loader)
* `loadAideosConfig(file?)`: Loads and validates `aideos.config.json` containing the committed video model policy (generation agent/model, reviewer agent/model, forbidden generation models).
* `reviewerModel(explicit?, env?, file?)`: Resolves the active reviewer model from explicit options, environment variables (`AIDEOS_GEMINI_REVIEW_MODEL`, `GEMINI_MODEL`), or `aideos.config.json`.
* `forbiddenGenerationMatch(model, policy)`: Checks if a model ID matches any configured forbidden generation models (e.g. `gemini-3.1-pro`).
* `generationCaller(file?, runner?)`: Creates the server text generation caller from `videoModels.generation`, enforcing an allowed Claude model.

### `backend/geminiReview/` (Gemini 3.8 Flash Video Quality Review & Rubric)
* `reviewVideo(videoPath, options)` (`backend/geminiReview/geminiReview.ts`): Evaluates rendered mp4 video and audio against the 12-criterion rubric via the configured agy reviewer in an isolated workspace with neutral `video.mp4`, with deterministic facts extraction (including `design/LOOK.md` shot treatments for unscored plan checking), timestamp evidence validation, and pairwise comparison support.
* `reviewPairwise(pathA, pathB, options)` (`backend/geminiReview/geminiReview.ts`): Executes a cross-review pairwise evaluation where two independent agy CLI agents in isolated workspaces first evaluate their respective videos, then exchange text-based evaluation reports to score each other, avoiding multimodal position bias.
* `createIsolatedVideoWorkspace(videos)` (`backend/geminiReview/geminiReview.ts`): Creates an isolated temporary directory containing hardlinks or copies of video files under neutral names (`video.mp4`, `video_1.mp4`, `video_2.mp4`) with automatic cleanup to prevent model agents from inspecting repository source files.
* `defaultAgyRunner(prompt, options)` (`backend/geminiReview/geminiReview.ts`): Non-interactive agy CLI runner with prompt-requested JSON (no `--json-schema`). `agyProcess.ts` owns the hard process-group deadline, opt-in idle detection, and parent-exit cleanup; single reviews stage the full rubric and facts in an isolated `review-brief.md`.
* `formatReviewSummary(report)` (`backend/geminiReview/geminiReview.ts`): Formats a review report as the plain-text breakdown `aideos gemini-review` prints and `aideos all-check` saves.
* `renderVideoForSlug(slug, format)` (`backend/geminiReview/render.ts`): Renders a film package to `videos/<slug>/renders/<format>.mp4` through the Remotion CLI for `aideos all-check`.
* `extractDeterministicFacts(videoPath, options)` (`backend/geminiReview/facts.ts`): Extracts OCR captions coverage, audio loudness LUFS, duration, framerate, and camera tracks (inspecting canvas moves and declared `scene.camera` keyframes) for ground-truth review prompt context.
* `RUBRIC_CRITERIA`, `RUBRIC_SYSTEM_PROMPT`, `SINGLE_REVIEW_JSON_SCHEMA`, `PAIRWISE_WATCH_JSON_SCHEMA`, `PAIRWISE_EXCHANGE_JSON_SCHEMA` (`backend/geminiReview/rubric.ts`): The 12-criterion rubric definitions, structured JSON schemas, and review prompts enforcing the 6 hard gates.

### `backend/allCheck/` (End-to-End Review & Repair Background Agent)
* `startAllCheck(options, deps)` (`backend/allCheck/index.ts`): Orchestrates preflight, locking, brief generation, and launching the background agent in its own unfocused Herdr workspace to review and repair long and reel formats.
* `resolveAgent(env)` (`backend/allCheck/agent.ts`): Resolves the background agent and model from `aideos.config.json` or CLI flags, enforcing the forbidden generation model policy.
* `buildAgentCommand(agent, briefPath, slug, model)` (`backend/allCheck/agent.ts`): Builds the interactive invocation command for the background agent with the specified model and brief.
* `formatAllCheckReport(result)` (`backend/allCheck/index.ts`): Formats final all-check outcomes and round summaries into human-readable markdown.
* `runPreflight(slug, options, deps)` (`backend/allCheck/preflight.ts`): Validates video package, voiceover, ffmpeg, tesseract, Herdr 0.8.0+ and its server, agent CLI, and agy login before starting the background agent.
* `acquireLock(record, deps)`, `releaseLock(slug)`, `lockIsLive(lock, deps)` (`backend/allCheck/lock.ts`): Manages the per-video lock in `videos/<slug>/all-check/lock.json` tied to the recorded Herdr socket and foreground process in its pane.
* `generateAgentBrief(context)` (`backend/allCheck/brief.ts`): Generates structured instructions and review constraints for the background coding agent (`videos/<slug>/all-check/brief.md`).
* `launchAgentWorkspace(slug, scriptPath, opts)` (`backend/allCheck/launch.ts`): Creates a dedicated Herdr workspace and launches the coding agent (Claude Code or Antigravity) with pre-approved permissions. The workspace stays open, and the next start closes only its previous idle workspace.
* `executeReviewRound(slug, options, deps)` (`backend/allCheck/round.ts`): Renders formats, backs up `film.json`, executes measured review and Gemini 3.8 Flash review, extracts stills, and performs automatic rollback on score regressions.
* `recordFrameCheck(slug, options, deps)` (`backend/allCheck/round.ts`): Records the agent's inspection of rendered frame stills for visual defects.
* `findBestRound(rounds)` (`backend/allCheck/best.ts`): Evaluates completed rounds to identify the best composite round and detect repo baseline violations.
* `rollbackToRound(slug, round, deps)` (`backend/allCheck/best.ts`): Restores `film.json` from a designated previous round backup.
* `finishAllCheck(slug, options, deps)` (`backend/allCheck/finish.ts`): Concludes an all-check run, restores the best `film.json` on incomplete runs, copies final MP4s, and writes reports.
* `waitForResult(slug, options, deps)` (`backend/allCheck/finish.ts`): Blocks and polls for the all-check result file with real-time round reporting and agent idle detection.

### `backend/mcp/designTools.ts` (Design & Review MCP Tools)
* `registerDesignTools(server)`: Registers sandboxed MCP tools for reading look briefs (`aideos_look_brief`), validating look plans (`aideos_look_check`), reading design briefs (`aideos_design_brief`), inspecting design files and look plans (`aideos_read_file`), writing look plans, design specs and SVGs (`aideos_write_file`), building designs (`aideos_design_build`), validating against design rules (`aideos_design_check`), fetching sampled review stills (`aideos_frame_stills`), and submitting coding model frame reviews (`aideos_submit_frame_review`).

### `backend/scriptIntake.ts`
* `parseClaudeScript(raw)`: Parses a raw Claude or legacy screenplay into structured `ScriptSegment` items containing ordered visual, narration, and on-screen beats.
* `serializeSegmentsToScript(segments)`: Serializes structured segments back into canonical markdown with timestamp headers and bracket tags.
* `hasScreenplayTags(raw)`: Returns true when raw script text contains at least one recognizable screenplay tag beat.
* `structureUntaggedProseToScript(raw)`: Deterministically structures untagged prose paragraphs into Claude screenplay segments with slug IDs, headlines, visual descriptions, and narration beats.
* `extractSpokenBlocks(raw)`: Extracts strictly the spoken narration dialogue with zero visual or on-screen tag leakage.
* `buildBlocksForPrimitive(primitive, group, fallbackTitle)`: Builds conforming `GeneratedBlock` structures for any of the 7 animated primitives; never invents stand-in data, falling back to `TextReveal` when required metrics, backtick code, or percentage bounds are missing.
* `selectScenePrimitives(segments, options)`: Maps screenplay segments to animated primitives with active components history tracking via Jev.
* `buildFilmPartsFromScript(raw, targetDurationSec, options)`: Compiles a Claude screenplay (falling back to `structureUntaggedProseToScript` for untagged prose) into Remotion-ready sub-shots, canvas nodes and edges, supporting optional heuristic primitive mapping (`usePrimitives`).
* `buildFilmPartsFromScriptAsync(raw, targetDurationSec, options)`: Compiles a Claude screenplay (falling back to `structureUntaggedProseToScript` for untagged prose) into Remotion-ready parts asynchronously using Jev for intelligent primitive selection across the 7 animated primitives.

### `backend/ideation/segmentSync.ts`
* `buildBriefFromSegmentFallback(segmentText, shotId, context)`: Builds a shot's headline and blocks from its narration segment with the heuristic visual selector (used by `buildFilmFromAudioResult`).
* `runSegmentSyncGate(segments)` / `runPreRenderSyncGate(film, segments)`: Picks a visual brief for every narration segment before `aideos produce` writes the film.

### `src/dl/videoPackageLoader.ts`
* `getProjectRoot()`: Resolves the absolute path to the project root directory walking up the filesystem.
* `getVideosDir()`: Resolves the absolute path to the gitignored personal `videos/` package directory (honors `AIDEOS_VIDEOS_DIR`, a relative value resolves against the repo root); where new packages are written.
* `getExamplesDir()`, `resolvePackageDir(slug)`: The committed `examples/` fallback and the directory a slug reads from (personal first, then examples).
* `resolveRepoAssetPath(rel)`: Resolves a repo-relative asset path a film names, mapping `videos/...` through `AIDEOS_VIDEOS_DIR`.
* `listVideoPackages()`: Returns a sorted array of all available package slugs: those in `videos/` plus any `examples/` package they do not shadow.
* `loadVideoPackage(slug)`: Loads and parses a standalone video package (`film.json`, `shotlist.json`, `treatment.json`, and visuals availability).

### `backend/scene/loadSceneAssets.ts`
* `loadSceneAssets(scene, options)`: Reads a scene's SVG assets off disk on the Node side, returning `svgSources` and `elementIdsByAssetId` for browser components.

### `backend/scene/renderStill.ts`
* `findChromeBinary()`: Locates an installed Chrome or Chromium binary for high-accuracy rasterization.
* `renderFrameSvgMarkup(frame, options)`: Renders a `CompiledFrame` to deterministic SVG markup string via `ReactDOMServer`.
* `renderFrameStill(frame, outputPath, options)`: Renders a `CompiledFrame` into a true 1920x1080 PNG image file on disk using headless Chrome with output dimension verification.

### `src/dl/scene/` (Custom SVG Animation & Scene Graph)
* Deep reference documentation in [`src/dl/scene/README.md`](../src/dl/scene/README.md).
* `types.ts`: TypeScript contracts for scene hierarchy, actors schema, environment assets, custom SVG animation timelines, and camera tracks (`CameraKeyframe`, `CameraTrack`). Three.js character rigs use `src/dl/characters/` and are outside this SVG scene contract.
* `svgAnimation.ts`: Declarative timeline types (`SvgAnimationClip`, `SvgAnimationTimeline`), easing curves, stagger calculations, validator (`validateSvgTimeline`), and compiler (`compileSvgTimeline`).
* `svgDocument.ts`: Pure dependency-free SVG document parser (`parseSvgDocument`), element ID discovery (`collectSvgElementIds`), and bounds calculation.
* `svgReact.tsx`: React SVG renderer (`renderSvgDocumentToReact`) with instance namespacing and per-frame element state transforms.
* `SceneClip.tsx`: Remotion composition entry point with single compilation and current frame selection.
* `sceneTiming.ts`: Audio-first retiming helpers (`framesForAudioMs`, `audioSyncDriftMs`, `alignSceneToAudio`, `retimeSvgTimeline`).
* `SceneView.tsx`: Pure browser-safe SVG scene renderer for background and prop assets with camera transform support and no filesystem imports; character rigs render through the separate Three stage.
* `compile.ts`: Pure deterministic compiler (`compileScene`) threading custom animation timelines and camera tracks onto frames for environment assets (background and props).
* `cameraTrack.ts`: Camera track compiler (`compileCameraTrack`) and motion stats (`measureCameraMotion`) measuring peak pan speed, per-frame zoom step, pan acceleration, hold share, and continuous move duration, exporting pacing constants (`MIN_CAMERA_HOLD_SHARE`, `MAX_CAMERA_CONTINUOUS_MOVE_SECONDS`, `CAMERA_CUE_LANDING_TOLERANCE_SECONDS`).
* `validateScene.ts`: Semantic and physical integrity validator (`validateScene`) rejecting unsupported actor rigs (Rule 21) before enforcing scene integrity rules and Rule 20 timeline consistency.
* `validateSceneNode.ts`: Node-side filesystem validator (`validateSceneWithNodeAssets`).
* `projection.ts`: Canonical orthographic projection, cover-fit viewport calculation (`stageViewport`, `stageProjection`), Three.js camera pose assignment (`applyStageCamera`), and stage rect geometry helpers (`projectStagePoint`, `rectInside`, `overlaps`, `SAFE_SQUARE`).
* `stageGeometry.ts`: Character-independent posed mesh bounds with outline allowance (`projectMeshParts`, `unionPartBounds`), material declarations (`undeclaredMaterialColours`), and sampled depth evidence (`sampleMeshDepth`).
* `stageMaterials.ts`: Character-owned material declarations (`declaredMaterialPalette`: the spec palette, the face texture base and the prop's `PROP_MATERIAL_PALETTES`).
* `stageFacts.ts`: Shared CPU geometry projection and numerical evidence for the opt-in Three stage, reporting visibility provenance.
* `ThreeStage.tsx`: Persistent opt-in Three.js stage canvas with orthographic camera, delayRender readiness barriers, and transparent foreground/background SVG compositing.

### `backend/sceneKit/` (Scene-Film Authoring & Stage Kit)
* `stage.ts`: Scene geometry constants (`SCENE_SIZE`, `SAFE_SQUARE`, `FORMAT_WINDOWS`, `FPS`).
* `Canvas` (`canvas.ts`): Authoring canvas combining static SVG markup generation and continuity-checked declarative animation clips; provides `group`, `add`, `svg`, `lifetime`, `init`, `to`, `fadeIn`, `fadeOut`, `cutOn`, `cutOff`, `draw`, `appear`, `typeReveal`, `typeCaret`, and `lyric` for kinetic typography locked to spoken words.
* `Timeline` (`timeline.ts`): Continuity-checked declarative timeline builder enforcing monotonic clip transitions, single-origin transforms, and camera track continuity (`Timeline.camera`, `Timeline.buildCamera`).
* `parts/` (`parts/index.ts`): Ready-made diagram building blocks: `drawGraph` (network graphs with nodes, links, and labels), `LayerPlanes` (isometric and flat layered 3D multi-plane diagrams), `drawChart` (2D line charts with axes, curves, and progress marker dots), `drawFlowCards` (flowchart cards and connector edges), `drawCallout` (annotated callout indicators with pointers).
* `shotFrames(timing)`, `createCues(timing)` (`timing.ts`): Calculates cumulative shot frame spans and creates audio-first word-level cue resolution functions from narration timing.
* `writeSvgAssets(dir, assets)` (`assets.ts`): Validates and persists SVG artwork dictionaries to disk.
* `PAL`, `DEFAULT_ACCENT`, `HAIR`, `HAIR2`, `W`, `H`, `OY`, `FONT`, `frameOf(sec)`, `rng(seed)`, `n(v)`, `attrs(o)`, `el(tag, o, inner)`, `g(id, x, y, inner, extra)`, `text(content, o)`, `stroke(color, width, extra)` (`svg.ts`): SVG markup generators, deterministic random number generator, standard palette tokens, and layout constants.
* `norm(word)`, `bare(token)`, `shape(token)` (`text.ts`): Text normalization and markup stripping helpers for matching spoken words and measuring display tokens.
* `measureText(text, size, face, weight, trackingEm)`, `tokenWidth(token, size, face, weight, trackingEm)`, `advanceEm(ch, face, weight)`, `resolveTypeOpts(options)`, `MONO_ADVANCE` (`typeMetrics.ts`): Font metric measurement with kerning support backed by `wordWidths.json`.
* `wrapBalanced(marked, options)` (`wrap.ts`): Balanced line wrapping algorithm for display type.
* `corners(inset, bottom, len, color)`, `backdropSvg(options)`, `hudTag(label, x, y, anchor)`, `readoutSeries(canvas, prefix, x, y, values)` (`chrome.ts`): Frame furniture and chrome elements for scene films.
* `produceVoiceover(config)`, `readVoiceoverTiming(slug, spineFile, rootDir)` (`voiceover.ts`): Audio-first narration synthesis, mastering, Whisper word alignment, and shot-spine persistence.
* `previewFrames(source, frames, rootDir)`, `framesFromArgs(args)` (`preview.ts`): Fast headless Chrome preview frames rasterizer.
* `reviewFilmFrames(slug, frames, scale)` (`reviewFrames.ts`): Renders Remotion composition review stills for any scene film.
* `midShotPicks(spans, composition)`, `renderReviewStills(picks, outDir, scale)` (`reviewStills.ts`): Renders review still picks via Remotion bundler and renderer.
* `displayWords(lines, extra)`, `unmeasuredWords(words, table)`, `measureWords(words, file)` (`measureWords.ts`): Measures unmeasured words in headless Chrome and merges them into `wordWidths.json`.

### `backend/designCheck/` (Deterministic Design Standard Checker)
* `checkFilmDesign(raw, context)` (`designCheck.ts`): Single verification gate for all film designs: schema validity, scene engine validity, static self-contained artwork, locked palette, typography, motion continuity, single transform origin, picture locked to narration, honest data / grounded numbers, smooth, speed-capped camera moves (max 20% frame width per second, no zero-duration jumps, and on the compiled curve at most 0.8% zoom change per frame and 0.3 widths/s^2 pan acceleration), move-then-hold pacing (>= 30% hold share, <= 6s continuous moves, cue landing, and subject focus framing), carry-over change holds (substantial visible animation settling in a camera hold and remaining framed for >= 2s), a clear inset region while a device shot shares the stage, Three.js stage geometry gates (`checkThreeStage`) including occlusion checks, and owner caption placement checks (`checkCaptionPlacements`).
* `checkCaptionPlacements(film, scene)` (`captionPlacement.ts`): Checks format-aware caption bounds, inset collisions, and stage art collisions against owner-placed caption cards; reports a non-blocking warning when caption placement is not checked against CanvasGraph art.
* `checkThreeStage(film, scene, context)` (`threeStage.ts`): Evaluates Three stage designs against geometry-driven gates across wide and reel formats: posed mesh vertex extents and outlines within stage safe region and caption clearance, device inset clearance during inset shots, foreground SVG and sampled mesh depth occlusion, 2s settled aftermath carry holds, camera speed (<= 20% width/s) and acceleration (<= 0.3 widths/s^2), cast focus framing, duplicate performance writers, and finite character material palettes.
* `MAX_CAMERA_ZOOM_STEP`, `MAX_CAMERA_PAN_WIDTHS`, `MAX_CAMERA_PAN_ACCEL_WIDTHS` (`designCheck.ts`): Scene camera limits on single-frame zoom change (0.8%), pan speed (20% of scene width/s), and pan acceleration (0.3 scene widths/s^2).
* `checkFilmDesignById(filmId)` (`designCheck.ts`): Loads a film by package slug and executes design validation against optional look plan and camera target cues.
* `checkInsetRegions(film)`, `projectedSvgParts(entity, frameToPx)`, `prepareSvgProjection(scene, width, height)` (`insetRegion.ts`): Verifies that no visible scene artwork occupies the format-specific inset region during `stage: "inset"` shots across both wide and reel formats, and extracts projected SVG parts for stage occlusion checks.
* `leafBounds(node)`, `parseTransform(value)` (`svgBounds.ts`): Conservative 2D bounding box and affine transform calculations for SVG elements without rasterization.
* `formatDesignReport(report)` (`designCheck.ts`): Formats validation findings and recommendations into a terminal report.
* `offPaletteColours(svgText, accent)` (`designCheck.ts`): Finds colour literals in SVG markup that violate the locked palette and chosen accent.

### `backend/designSpec/` (Bespoke Film Design Specification & Compiler)
* `renderDesignBrief(film)`, `writeDesignBrief(filmId)` (`brief.ts`): Generates designer briefs (`design/BRIEF.md`) containing film contracts, shot narration, and asset specifications.
* `compileDesign(film, spec, options)` (`compile.ts`): Compiles a `DesignSpec` and narration timing into a validated scene film, compiling camera poses through `Timeline.camera()`.
* `buildDesign(filmId, source)` (`build.ts`): Compiles design specifications, executes design checks, and writes passing films.
* `readCheckedLookPlan(film)`, `checkDesignAgainstLook(film, spec, words, pkg, plan)` (`build.ts`): Validates look plan completeness and checks design cast (supporting cast IDs matching elements across multiple assets), SVG carried motion starting within 0.4s of its cue, declared Three performance anticipation before its decisive word and contact on that word, inset device overrides, and camera against the accepted look.
* `resolveCue(cue, cues)` (`cues.ts`): Resolves cue strings and frame offsets against narration timing cues.
* `planFilmLook(filmId, options)`, `designFilm(filmId, options)` (`designer.ts`): Delivers look planning and scene design through inline, agent, server, or templates policies.
* `requestShotMotion(filmId, request)` (`motionRequests.ts`): Manages shot-level motion design tasks and history snapshots.
* `designOverview(film)`, `approveLookPlan(filmId)`, `swapShotVisual(film, shotId, visual, caller)`, `requestShotRedesign(film, shotId, note, options)` (`shotTools.ts`): Gathers design and look plan overview (`look.json`, `LOOK.md`, stage, cast, shot treatments) for the Studio Look stage, records captain look approval, executes honest chart visual swaps, and dispatches per-shot redesign requests.
* `designSpecSchema`, `specCameraSchema`, `specClipSchema`, `specAssetSchema` (`spec.ts`): Zod schemas and TypeScript types for bespoke film designs (brief, accent, background, assets, cue-timed clips, camera poses with optional focus, and shot block overrides).

### `backend/lookPlan/` (Look Plan Specification, Semantic Checker, Briefing & Renderer)
* `lookPlanSchema`, `lookFilmSchema`, `lookCastItemSchema`, `lookChangeSchema`, `lookCameraPoseSchema`, `lookCaptionsSchema`, `lookShotSchema`, `lookApprovalSchema`, `parseLookPlan(data)`, `safeParseLookPlan(data)` (`schema.ts`): Zod schemas for `look.json` (`aideos.look/1`), defining stage, persistent cast transformations with distinct resulting states, camera poses with optional focus, palette, captions, and per-shot beat treatments (`scene`, `scene+card`, `device`, `footage`).
* `checkLookPlan(plan, filmId, context)`, `checkLookPlanById(filmId)`, `formatLookReport(report)` (`check.ts`): Semantic checker enforcing unique cast and shot IDs, valid carries references, non-minor carry-over changes with distinct resulting states, initial and final wide camera framing, intermediate camera poses naming cast focus, bottom captions without kinetic columns, device naming, no consecutive device shots, at most 1 device shot per 4 shots, valid shot and cast IDs against `film.json`, cue phrases against narration text, and cast IDs against design assets or SVG element IDs (reporting warnings when auxiliary inputs are unavailable and attributing parse errors to source files).
* `renderLookBrief(film)`, `writeLookBrief(filmId)` (`brief.ts`): Generates designer look briefs (`design/LOOK_BRIEF.md`) detailing the 6 look questions, shot treatment decision rules, example look plan, and timed script beats.
* `renderLookMd(plan, filmTitle, shotTimings)`, `writeLookMd(filmId)` (`render.ts`): Renders and writes human-readable look plans (`design/LOOK.md`) from validated `look.json`.

### `backend/reelCut/` (Condensed Reel Narration Cut & Deterministic Check Engine)
* `schema.ts`: `reelCutSchema` (`aideos.reelcut/1`), `reelBudgetSchema`, constants `REEL_MAX_SEC` (179), `REEL_TARGET_SEC` (170), `REEL_END_CARD_SEC` (3), `DEFAULT_REEL_BUDGET`, and `parseReelBudget(input)`.
* `brief.ts`: `loadReelContext(slug)`, `readReelCut(slug)`, `reelBrief(context, budget)`, `writeReelBrief(slug, budget)`, `ReelCutSceneFilmError`. Generates `videos/<slug>/reel/REEL_BRIEF.md` for eligible films (scene films and node-graph films, excluding legacy actors) with source narration hashes, word targets, motion duration floors, locked phrases, and on-screen numbers.
* `check.ts`: `checkReelCut(raw, context, budget)`, `formatReelReport(report)`. Deterministic validator for `videos/<slug>/reel/cut.json` checking schema, shot coverage, original order, long narration hash freshness, locked phrases, spoken on-screen numbers, forbidden new numbers, protected drop constraints (hook, payoff, decisive performances), camera motion duration floors, and delivery length limits (179s cap, 170s target). Flags non-blocking advisories for novel content words and uninspected imported media.
* `build.ts`: `buildReel(slug, options)`, `compileReel(input)`, `recordReelStatus(slug, status)`. Compiles derived reel narration and film with checked shot drops, snap-free scene continuity, and reel-crop design checks.
* `store.ts`: `writeReelFilm(slug, film)`, `formatInputs(slug, format)`, `assertReelCap(film, stage)`, `reelForRender(slug)`, `reelSourceFingerprint(slug)`, `reelBudgetFor(film)`. Manages reel persistence, shadows (`<slug>.reel.ts`), delivery length cap assertions, and input resolution.
* `writer.ts`: `deliverReel(slug, options)`. Delivers reel cut inline (`needs_reel_cut`), via connected agent, or via server model with checked retry loop.
* `constraints.ts`: `createReelContext(options)`, `countWords(text)`, `groundedNumbers(text)`.
* `motion.ts`: `minShotDurationSec(camera, startSec, endSec, fps)`. Computes shortest safe shot duration satisfying camera speed, zoom step, and acceleration caps.
* `visibleText.ts`: `visibleReelText(film)`. Extracts on-screen text and numbers across scene stage elements, SVG assets, and text overlays.
* `cli.ts`: `registerReelCommands(program)`. Registers CLI commands for `aideos reel brief`, `aideos reel check`, and `aideos reel build`.

### `backend/transcribe.ts` (Audio & Video Transcription)
* `transcribe(src, options, deps)`: Transcribes audio or video media into word-level timings (`TranscribedWord[]`) with confidence scores, using Deepgram with local Whisper CLI fallback.
* `writeImportWords(packageDir, words)`: Writes `import_words.json` and phrase-grouped `import_captions.vtt` sidecars into the package directory.
* `readImportWords(packageDir)`: Reads transcribed words from `import_words.json` when present.
* `resolveDeepgramApiKey()`: Resolves Deepgram API key from environment variables.

### `backend/editContext/` (Edit Context Assembly & Signal Detection)
* `detectFillers(words, options)` (`detectFillers.ts`): Identifies fixed filler words ("um", "uh") and confidence-gated colloquial phrases ("like", "you know") as `FillerSpan[]`.
* `detectSilences(words, options)` (`detectSilences.ts`): Identifies silence intervals and dead-air gaps between words as `SilenceWindow[]`.
* `buildEditContext(layeredFilm, transcript, fillers, silences, options)` (`buildEditContext.ts`): Assembles pure, structured timeline context (`EditContext`) summarizing lanes, clips, media dimensions, fillers, and silences for LLM planning.

### `backend/editPlanner/` (Model-Driven AI Edit Planning, Validation, Execution & Provenance Logging)
* `editOpSchema`, `editProgramSchema` (`schema.ts`): Closed Zod discriminated union and array schema defining the checked edit operation vocabulary; see `backend/editPlanner/schema.ts` for the current operation list, including `set_caption_placement`.
* `validateEditProgram(program, context)` (`validator.ts`): Validates edit operation programs against schema constraints, timeline bounds, and dry-run layer model simulation.
* `applyEditProgram(film, program, context)` (`interpreter.ts`): Pure transactional interpreter applying `EditOp[]` to `LayeredFilm` with atomic rollback on failure.
* `planEdits(request, context, llmCaller, options)` (`planner.ts`): Model-driven planner generating and validating `EditOp[]` programs from natural language requests in a 3-attempt validate-and-repair loop.
* `appendEditProvenanceRecord(videosDir, filmId, record, source)` (`provenanceLog.ts`): Appends structured edit audit records to `videos/<slug>/edit_log.jsonl` for preview and commit events.
* `readEditProvenanceLog(videosDir, filmId)` (`provenanceLog.ts`): Reads edit provenance records for a film package, newest first.

### `src/dl/validateFilm.ts` & `scripts/validate_film.ts`
* `validateFilmAudioAndAssets(film, options)`: Validates duration sum invariant and time-sampled anchor card geometry.
* `scripts/validate_film.ts`: Standalone CLI validator (`npm run validate:film <path/to/film.json>`) validating arbitrary `film.json` files against cinematic schema and pacing constraints and printing a runsheet.

### `src/dl/performance/` & `backend/performance/` (Sparse Constrained Performances)
* Deep reference documentation in [`src/dl/performance/README.md`](../src/dl/performance/README.md).
* `types.ts`: TypeScript contracts for sparse actions, rigs, phases, limb constraints, contact attachment, and absolute-frame evaluator state (`PerformanceRig`, `ReceiveAction`, `PerformanceState`, `PerformanceEvaluator`).
* `math.ts`: Pure dependency-free vector, quaternion, slerp, smoothstep, and two-bone IK solver (`solveTwoBone`).
* `evaluate.ts`: Absolute-frame receive evaluator (`createPerformanceEvaluator`, `validatePerformance`) enforcing rigid limbs, world-space planted feet, and palm-glider contact attachment without simulation history or external dependencies.
* `receive.ts`: Sparse choreography recovered from the approved Iona catch (`createReceiveAction`, `IONA_CONTACT_ROTATION`, `IONA_FLIGHT_ROTATION`).
* `iona.ts`: The rig the receive reference was authored on (`IONA_RIG`); the library spec `characters/iona.character.json` must derive it exactly.
* `retarget.ts`: Fits the receive to any character rig (`retargetReceive`, `ReceiveRetargetError`): hips crouch by leg length, plants from the rest stance and sole socket, grips relative to the moving shoulder by arm reach, re-aimed elbow poles, then reach, hinge and rotation limits under a `fail` or `clamp` policy.
* `limits.ts`: Shared limit geometry (`limbRange`, `rotationExcess`).
* `critique.ts`: Independent numerical obligations checker (`critiquePerformance`) measuring bone length, planted feet, grip path, attachment, contact cue, seams, seek-order equality, active motion windows, pole clearance and, on character rigs, reach and joint limits.
* `backend/performance/bindReceive.ts`: Authoring boundary binding contact to narration word cues (`bindReceive`, `fitReceiveSpan`).

### `src/dl/characters/`, `src/dl/scene/characters/` & `backend/characters/` (Characters as data)
* Architecture, journeys and risks: [`docs/CHARACTER_ENGINE.md`](CHARACTER_ENGINE.md); authoring guide: [`characters/README.md`](../characters/README.md).
* `schema.ts`: Strict `aideos.character/1` Zod schema (`characterSpecSchema`, `CharacterSpec`).
* `validate.ts`: `parseCharacter` and `validateCharacterSemantics` return issues naming the field; `actionCompatibility` checks expressions and swing channels against an action.
* `hash.ts` & `sha256.ts`: Canonical JSON and a synchronous SHA-256 that runs in Node and the browser bundle (`characterHash`, `characterRigId`).
* `rig.ts` & `expand.ts`: `rigFromCharacter` (humanoid rig, sockets, limits) and `expandParts` (mirror groups and limb, torso and hand generators into tube, head, panel and facets primitives).
* `scene/characters/{build,apply,geometry,face}.ts`: `buildCharacter` (cel geometry, outlines, painted face) and `applyCharacter` (absolute per-frame assignment); `scene/props/paperGlider.ts` builds the glider.
* `backend/characters/library.ts`: Resolves ids (package `characters/` first, then the repo library) to hash-verified specs. `cli.ts`: `aideos character check|sheet`. `sheet.ts`: headless Chrome sheet renderer.
* `scripts/performance_check.ts`: CLI script (`npm run performance:check`) evaluating numerical obligations against the illustrative fixture timing.
* `scripts/performance_filmstrip.ts`: Isolated comparison filmstrip generator (`npm run performance:filmstrip`) for fixed-camera cel pixel verification.

---

## 6. Non-Linear Layer Engine & Timeline Tools (`backend/timeline/`, `src/dl/convertFilm.ts`)

* **`convertFilm.ts` (`src/dl/convertFilm.ts`)**: Lossless bidirectional converter between `Film` and `LayeredFilm` (`convertFilmToLayeredFilm`, `convertLayeredFilmToFilm`, `defaultTimelineLayers`, `CONVERTED_LAYER_IDS`), preserving multi-track `audioClips`, `videoClips`, and `overlayClips` with symmetric clip linking and on-demand lane resolution.
* **`layer_engine.ts` (`backend/timeline/layer_engine.ts`)**: Pure functional engine operating over `LayeredFilm`. Provides `importMediaAssetToLayeredFilm`, `unlinkClips`, `moveLayerClip`, `moveMultipleLayerClips`, `trimLayerClipEdge`, `rippleTrimLayerClipEdge`, `splitLayerClipAtTime`, `deleteLayerClip`, `rippleDeleteLayerClip`, and deterministic left-to-right sweep `resolveLayerCollisions`.
* **`timeline.ts`**: Pure functional operations on `Film` shots and associated audio clips (`moveShot`, `moveMultipleShots`, `trimShotEdge`, `rippleTrimShotEdge`, `splitShotAtTime`, `deleteShot`, `rippleDeleteShot`).
* **`layer_manager.ts`**: Track management functions (`addLayer`, `removeLayer`, `reorderLayers`, `setLayerVisibility`, `setLayerMuted`, `setLayerLocked`).
* **`drag_machine.ts`**: Pure pointer-drag state machine managing `move`, `trim-start`, `trim-end`, `scrub`, and `marquee` gestures with `DRAG_THRESHOLD_PX`, Escape cancellation, and zero sticky states.
* **`snap.ts`**: Magnetic snapping engine (`computeSnapPoints`, `snapTimeToTargets`) with zoom-adaptive thresholds and self-ignore boundaries.
* **`waveform.ts`**: Node-side FFmpeg audio peak extraction (`extractWaveformPeaks`, `extractAudioPeaks`) producing normalized amplitude vectors.
* **`voiceover_engine.ts`**: Browser-safe voiceover gap analysis, cue retiming, and drift calculation (`calculateNarrationDrift`).

---

## 7. Interactive Web Studio Architecture (`editor/`)

### 7 Sequential Editing Stages (`editor/src/screens/`)
* **`ScriptStage.tsx` (`ScriptEditor.tsx`)**: Screenplay markdown editor with tag parsing, Visual Studio segment cards, and Kokoro ONNX TTS voiceover synthesis.
* **`StoryStage.tsx` (`MindMap.tsx`, `NodeEditor.tsx`)**: 2D infinite spatial canvas for dragging nodes, editing labels, and connecting directed edges; dispatches spatial actions (`add_node`, `add_edge`, `add_shot`) to the Agent Bridge Hub via `/api/canvas/event`.
* **`LookStage.tsx` (`DesignView.tsx`, `Styleboard.tsx`, `CustomizationEditor.tsx`)**: Look stage sub-views for bespoke design and look plan inspection (stage, cast, treatments, LOOK.md preview, captain approval, artwork, motion, and visual swaps), canvas texture presets, typography controls, and storyboard keyframe gallery.
* **`MotionStage.tsx` (`motionTemplates.ts`)**: Custom SVG animation authoring studio with element-level timeline keyframing, motion templates, and live scrubbing.
* **`EditStage.tsx` (`TimelineEditor.tsx`, `CaptionPlacementEditor.tsx`, `InspectorPanel.tsx`, `AssetBin.tsx`, `OnCanvasAiEditor.tsx`)**: Non-linear multi-track timeline with clip dragging, Move captions mode with player overlay and bounds snapping (`CaptionPlacementEditor.tsx`), sticky snapping, magnetic ripple editing (R), linked audio-video trimming, waveform preview, track mute/hide/lock, clip/shot inspector, and model-driven AI edit panel (`OnCanvasAiEditor.tsx`) dispatching validated edit programs to Agent Bridge with live trace telemetry.
* **`CaptionsStage.tsx` (`KineticCaptionEditor.tsx`)**: Word-level subtitle karaoke editor powered by `@chenglou/pretext`.
* **`ReviewStage.tsx` (`CritiqueStudio.tsx`, `ExportProgressModal.tsx`)**: AI critique drawer executing natural-language feedback and patches via `/api/critique`, dispatching review critiques to connected agents, pacing and coverage health charts (`Charts.tsx`), and headless MP4 export progress.

### State & Integration Layer (`editor/src/state/`)
* **`useFilmProject.ts`**: Owns the active `Film` document, autosave debounce, single labelled undo/redo transaction stack, and live studio hot-reload subscribing to `film_updated` SSE events from `/api/agent/trace` to reflect external agent modifications instantly without manual refresh.
* **`useLayeredTimeline.ts`**: Derives `LayeredFilm`, executes layer engine mutations (`moveClip`, `trimClip`, `rippleTrimClip`, `splitClip`, `removeClip`, `rippleRemoveClip`), folds changes back losslessly via `convertLayeredFilmToFilm`, and computes `renderFilm` for preview and export.
* **`agentLink.ts`**: Manages browser owner key state (`readOwnerKey`, `writeOwnerKey`, `rotateOwnerKey`), remembers expected active links across server restarts (`readExpectedLink`, `writeExpectedLink`, `linkPhase`), and installs global `X-Aideos-Owner` fetch headers (`installOwnerHeader`).

### Studio Inspector & Telemetry Components (`editor/src/components/`)
* **`AgentActivityInspector.tsx`**: Live real-time agent telemetry timeline subscribing to SSE stream (`/api/agent/trace`) with filterable execution steps, live status pills (LIVE / CONNECTING / OFFLINE), and empty state.
* **`AgentConnect.tsx`**: Header badge and dialog modal supporting two linking modes (running agent session via MCP and downloadable connector), presence heartbeating, reconnecting state recovery across restarts, and live activity feeds.

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
