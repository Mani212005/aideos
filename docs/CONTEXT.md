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

### Production Pipeline, Auto-Prompt Director & MCP Server (`backend/pipeline/`, `backend/mcp/`)
* Deep reference documentation in [`docs/PRODUCTION_PIPELINE.md`](PRODUCTION_PIPELINE.md) and [`docs/DIRECTOR_GUIDE.md`](DIRECTOR_GUIDE.md).
* `runProduction(request, onProgress)` (`backend/pipeline/run.ts`): Single typed programmatic entry point driving `intake`, `narrate`, `design`, `broll`, `assemble`, `render`, `verify`.
* `runDirector(request, onProgress)` (`backend/pipeline/director.ts`): Auto-prompt entry point above `runProduction` that drafts a Claude screenplay from a raw prompt with an LLM and produces it end to end.
* `draftScreenplay(prompt, options)` (`backend/pipeline/director.ts`): Drafts and validates a Claude screenplay from a natural language prompt, retrying rejected drafts with feedback.
* `transformProseToScreenplay(prose, options)` (`backend/pipeline/director.ts`): Automatically transforms raw untagged prose into a structured Claude screenplay with visual and narration beats via LLM with validation retries and code fence stripping.
* `buildProseTransformSystemInstruction()` (`backend/pipeline/director.ts`): Assembles the system instruction for transforming raw prose into structured scenes, visual directions, on-screen text, and narration beats.
* `compileFilmFromScreenplayAsync(script, narration, shotDurations, options, jevOptions)` (`backend/pipeline/design.ts`): The design stage's compile path. Compiles screenplay and narration spine into a validated `Film`, asking Jev `selectShotVisual` (see `backend/jev.ts`) only for beats that could take a device, and emitting a device only when `backend/shotVisualCues.ts` finds its data in the narration and the beat has on-screen copy to headline it.
* `renderFormat(slug, format, options)` (`backend/pipeline/render.ts`): Drives Remotion render with headless verification and contact sheet generation.
* `startMcpServer(options)` / `createMcpServer(options)` (`backend/mcp/server.ts`): Exposes the production pipeline, design tools, agent bridge, and remote agent link loop (`aideos_wait_for_task`) as an MCP stdio/HTTP server with tools `aideos_produce_film`, `aideos_run_status`, `aideos_list_runs`, `aideos_list_films`, `aideos_get_film`, `aideos_edit_film`, `aideos_get_pending_tasks`, `aideos_claim_task`, `aideos_complete_task`, `aideos_report_step`, `aideos_design_brief`, `aideos_read_file`, `aideos_write_file`, `aideos_design_build`, `aideos_design_check`, `aideos_frame_stills`, `aideos_submit_frame_review`, and `aideos_wait_for_task`.

### `backend/pipeline/filmStore.ts`
* `ROOT`: Absolute path to project root directory.
* `readFilm(slug)`: Reads and parses `videos/<slug>/film.json` as authoritative `Film`.
* `writeFilm(slug, film)`: Validates and persists `Film` to both `videos/<slug>/film.json` and its shadow `src/dl/films/<slug>.ts` module simultaneously, and broadcasts `traceBus.notifyFilmUpdated` for live Studio synchronization.
* `setActiveFilm(slug)`: Points `src/dl/activeFilm.ts` at the target film package.
* `wireFootageIntoFilm(slug, shotId, relPath, promptText)`: Wires rendered B-roll video clip into a shot as an `AnalogyInset` block and saves to both storage targets.

### `backend/pipeline/deviceData.ts` (Model-Authored Chart & Metaphor Data)
* `authorDeviceData(requests, caller)`: Authors and validates data for complex chart devices (`TokenStrip`, `Plot`, `MatrixGrid`, `Distribution`, `LayerStack`, `ScaleBar`) via batched LLM generation, refusing any block that fails validation or uses ungrounded labels/numbers.
* `checkDeviceHonesty(block, source)`: Verifies that all labels, tokens, ticks, and numbers shown by an authored block or metaphor are grounded in the beat's spoken narration or on-screen copy.
* `groundMetaphorContent(raw, source)`: Validates model-authored `MetaphorViewer` payloads against schema constraints, ensures no default fallback fields were omitted, and verifies beat honesty.

### `backend/agentBridge/` (Connected Agent Bridge Hub & Multi-Channel Dispatcher)
* `traceBus` (`backend/agentBridge/traceBus.ts`): Global singleton in-process telemetry and live film update bus (`TraceBus`) collecting and streaming execution steps (`recordStep`, `updateStep`, `getRecentSteps`, `subscribe`, `clear`) and broadcasting real-time film change notifications (`onFilmUpdate`, `notifyFilmUpdated`, `filmSubscriberCount`) across coding agents, Studio clients, AI edit planning, neural TTS synthesis, GPU B-roll rendering, and invariant validation.
* `formatStepTimestamp(date)`, `generateStepId()` (`backend/agentBridge/traceBus.ts`): Formatting and identifier helpers for trace steps.
* `dispatchTask(opts)`: Dispatches rich task context across all active channels (Firstmate steering inbox, MCP task queue, local file/tmux) with automatic hybrid timeout fallback.
* `buildTaskContext(opts, rootDir)`: Assembles full working context payload (script, film manifest, audio spine, word timings, director guide ref, design invariants).
* `buildDirectingPrompt(opts, context)`: Formats structured directing prompts for connected coding agents from Studio events (`canvas_updated`, `critique`, `ai_edit`, `narrate_audio`, `script_updated`, `produce_film`, `custom_directive`).
* `taskQueue`: Global in-memory lifecycle manager for agent tasks (`createTask`, `claimTask`, `completeTask`, `failTask`, `timeoutTask`, `listPendingTasks`, `listAllTasks`, `addListener`).
* `writeFirstmateInboxMessage(task, targetInboxDir)`: Writes sequential steering message file (`001.msg`, `002.msg`, ...) to Firstmate agent inbox.
* `dispatchLocalAndTmux(prompt, opts)`: Writes `.aideos_task.md` and pastes prompt into active tmux agent pane.
* `cancelFallbackTimer(taskId)`, `clearAllFallbackTimers()`: Manages and clears active fallback timer callbacks.
* `getAgentSession()`, `setAgentSession(info)`: Reads and persists active agent session metadata (`.aideos_session.json`).

### `backend/agentLink/` (Headless Coding Agent Link & Connector Hub)
* `AgentLinkStore` (`backend/agentLink/store.ts`): State store for signed pairing tokens, owner keys, heartbeat tracking, and connected agent long-poll queues with single-agent-per-owner replacement tracking (`startPairing`, `startAgentPairing`, `claim`, `authenticate`, `replacementNote`, `isConnector`, `endReason`, `status`, `disconnect`, `heartbeat`, `enqueue`, `next`, `report`, `recordActivity`, `activity`).
* `buildAgentInstructions(agent, apiUrl, token)` (`backend/agentLink/connectInstructions.ts`): Generates agent-native MCP configuration commands and the paste-in prompt for Claude Code, Antigravity, Codex, and OpenCode.
* `remoteTaskPrompt(taskId, prompt)` (`backend/agentLink/prompt.ts`): Maps studio task instructions onto the sandboxed MCP tool interface for headless agents.
* `aideos-connect.mjs` (`scripts/aideos-connect.mjs`): Standalone dependency-free connector script linking local coding agents (Claude, Antigravity, Codex, OpenCode) to the studio via long-polling, supporting `--model provider/model` overrides, free-tier refusal diagnostics (`taskFailureHint`), quiet reconnect notes (`createReconnectNotes`), indented agent output (`indentAgentOutput`), duration formatting (`formatElapsed`), and real-time tool call streaming.

### `backend/agentPrompter.ts` (Auto-Prompter Facade)
* Delegates backwards-compatible prompter APIs (`getAgentSession`, `setAgentSession`, `buildDirectingPrompt`, `dispatchPromptToAgent`) directly to `backend/agentBridge/`.

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
* `judgeFilm(filmId, options)` (`backend/visionJudge/judge.ts`): Judges a designed scene film's rendered frames through 5-7 frame sampling, coding agent critique and image-text similarity scoring, per-frame embedding logging, and text-only Jev rulings.
* `judgeAndRepair(filmId, options)` (`backend/visionJudge/judge.ts`): Bounded repair loop handing exact failure errors back to synthesis for automated fixing.
* `describeFailure(sample, narration)` (`backend/visionJudge/judge.ts`): Formats exact error string from a failed sample and suggestions for synthesis retry.
* `renderSamples(filmId, film, options)` (`backend/visionJudge/sampler.ts`): Samples every 5-7th frame and rasterizes each once to a verified 1920x1080 PNG via headless Chrome.
* `sampleFrameNumbers(totalFrames, options)`, `clampStride(stride)`, `describeFrame(film, frame)` (`backend/visionJudge/sampler.ts`): Frame index sampling helpers with 5-7 stride clamping and frame narration/on-screen metadata extraction.
* `writeAgentReview(filmId, raw, now)`, `readAgentReview(filmId, since)` (`backend/visionJudge/agentReview.ts`): Validates and persists/reads the coding model's frame review (`design/judge/agent-report.json`).
* `appendEmbeddingLog(filmId, entries)` (`backend/visionJudge/agentReview.ts`): Appends per-frame similarity scores and thresholds to `design/judge/embedding-log.jsonl`.

### `backend/mcp/designTools.ts` (Design & Review MCP Tools)
* `registerDesignTools(server)`: Registers sandboxed MCP tools for reading briefs (`aideos_design_brief`), inspecting design files (`aideos_read_file`), writing design specs and SVGs (`aideos_write_file`), building designs (`aideos_design_build`), validating against design rules (`aideos_design_check`), fetching sampled review stills (`aideos_frame_stills`), and submitting coding model frame reviews (`aideos_submit_frame_review`).

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

### `src/dl/validateFilm.ts` & `scripts/validate_film.ts`
* `validateFilm(film)`: Runs Zod schema parsing and structural integrity assertions.
* `validatePacingInvariants(film)`: Enforces max 25s hold, no consecutive device repeats, and text breathers every 60-90s.
* `validateFilmAudioAndAssets(film, projectDir)`: Enforces duration sum invariant ($\sum \text{Shots} = \text{Audio} \pm 50\text{ms}$) and confirms audio asset presence.
* `scripts/validate_film.ts`: Standalone CLI validator (`npm run validate:film <path/to/film.json>`) validating arbitrary `film.json` files against all 19 cinematic invariants and printing a runsheet.

---

## 7. Non-Linear Layer Engine & Timeline Tools (`backend/timeline/`, `src/dl/convertFilm.ts`)

* **`convertFilm.ts` (`src/dl/convertFilm.ts`)**: Lossless bidirectional converter between `Film` and `LayeredFilm` (`convertFilmToLayeredFilm`, `convertLayeredFilmToFilm`, `defaultTimelineLayers`, `CONVERTED_LAYER_IDS`), preserving multi-track `audioClips`, `videoClips`, and `overlayClips` with symmetric clip linking and on-demand lane resolution.
* **`layer_engine.ts` (`backend/timeline/layer_engine.ts`)**: Pure functional engine operating over `LayeredFilm`. Provides `importMediaAssetToLayeredFilm`, `unlinkClips`, `moveLayerClip`, `moveMultipleLayerClips`, `trimLayerClipEdge`, `rippleTrimLayerClipEdge`, `splitLayerClipAtTime`, `deleteLayerClip`, `rippleDeleteLayerClip`, and deterministic left-to-right sweep `resolveLayerCollisions`.
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
* **`StoryStage.tsx` (`MindMap.tsx`, `NodeEditor.tsx`)**: 2D infinite spatial canvas for dragging nodes, editing labels, and connecting directed edges; dispatches spatial actions (`add_node`, `add_edge`, `add_shot`) to the Agent Bridge Hub via `/api/canvas/event`.
* **`LookStage.tsx` (`Styleboard.tsx`, `CustomizationEditor.tsx`)**: Storyboard keyframe gallery, 1-click character gesture posing, canvas texture selection, and typography styling.
* **`MotionStage.tsx` (`motionTemplates.ts`)**: Custom SVG animation authoring studio with element-level timeline keyframing, motion templates, and live scrubbing.
* **`EditStage.tsx` (`TimelineEditor.tsx`, `InspectorPanel.tsx`, `AssetBin.tsx`, `OnCanvasAiEditor.tsx`)**: Non-linear multi-track timeline with clip dragging, sticky snapping, magnetic ripple editing (R), linked audio-video trimming, waveform preview, track mute/hide/lock, clip/shot inspector, and model-driven AI edit panel (`OnCanvasAiEditor.tsx`) dispatching validated edit programs to Agent Bridge with live trace telemetry.
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
