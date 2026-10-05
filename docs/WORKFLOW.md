<!-- File Description: End-to-end architecture and video production workflow specification for Aideos. -->

# Aideos: Complete Architecture & Video Production Workflow

This document details the complete end-to-end workflow of the Aideos Explainer Video Engine, explaining the 4 core design language axioms, the 5-stage automated audio-first produce pipeline, the interactive web studio, and video rendering.

---

## 1. The 4 Fundamental Design Language Axioms

Aideos is engineered around 4 strict architectural invariants:

1. **Films are Pure Data (`videos/<slug>/film.json`, with generated `src/dl/films/*.ts` shadows)**:
   - No React runtime logic, side-effects, or random math inside film definitions. Every film is a pure, serializable JSON data structure conforming strictly to `filmSchema` (`src/dl/schema.ts`).
2. **Master Clock Audio Spine**:
   - Video duration is never guessed. The synthesized voiceover audio is the immutable master clock of the film. Total shot durations must sum to the voiceover length within a strict tolerance of $\pm 50\text{ms}$.
3. **Derived Camera Framing**:
   - The virtual camera never uses hardcoded pixel offsets. Viewport centers, zoom factors, and bounding boxes are mathematically derived from continuous 2D node coordinates $(x, y, w, h)$ on the spatial canvas graph.
4. **Declared Palette with Semantic Theme Tokens**:
   - Colors map to semantic tokens (`canvas`, `surface`, `ink`, `muted`, `hairline`, `accent`) with a measured contrast floor. Switching themes (e.g. Archival Paper, Blueprint, Charcoal, Warm Editorial) recolors scenes and cards with measured contrast and harmony.

---

## 2. End-to-End Workflow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: SCREENPLAY                                                         │
│  • Raw Prompt / Technical Topic -> Director drafts a Claude screenplay       │
│  • Or a hand-written screenplay ([VISUAL], [NARRATION], [ON SCREEN] beats)   │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Script Text
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: AUDIO-FIRST TIMING SPINE ENGINE                                    │
│  • Shot-scoped segmentation & Neural / Kokoro audio synthesis                │
│  • Raw silence trimming & 200ms inter-shot rhythm pause -> voiceover.wav     │
│  • Word-level forced timestamp alignment -> captions.vtt                     │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Master Audio Duration & Captions
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: SEMANTIC VISUAL SYNC & 7-RULE PACING GATE                          │
│  • Evaluates narration meaning at each second -> Selects visual blocks        │
│  • Enforces Pacing Gate: Max 25s hold, no consecutive repeats, 60s breathers │
│  • Emits the shot list in film.json (durations, camera moves, and stages)    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Verified Shotlist
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 4: SPATIAL CANVAS GRAPH & SCENE ASSEMBLY                              │
│  • Computes 2D node coordinates (x, y, w, h) & directed edges               │
│  • Assembles visual devices, camera framing, and canvas stations             │
│  • Compiles authoritative film.json data model and syncs activeFilm.ts       │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Compiled Film Data
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 5: REMOTION RENDER ENGINE & INTERACTIVE STUDIO                        │
│  • Web Editor UI (localhost:3001, CLI: aideos) with 80% Scene Inspector      │
│  • Landscape Long Render (out/long.mp4, 1920x1080 @ 30 FPS)                  │
│  • Vertical Reel Render (out/reel.mp4, 1080x1920 @ 30 FPS)                   │
│  • Kinetic Subtitle Karaoke + Dynamic Audio Music Ducking                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Step-by-Step Pipeline Execution

### Stage 1: Screenplay (`backend/pipeline/director.ts`, `backend/scriptIntake.ts`)
1. **Intake**: Receives a technical topic (`aideos direct "<prompt>"`) or a hand-written Claude screenplay (`aideos film --script`).
2. **Director Draft**: For a topic, an LLM briefed on [docs/DIRECTOR_GUIDE.md](DIRECTOR_GUIDE.md) drafts a screenplay, and `backend/scriptIntake.ts` validates it before production starts.
3. **Output**: `videos/<slug>/script.md` containing the timestamped beats with visual direction, narration, and on-screen text.

### Stage 2: Audio Synthesis & Alignment (`backend/audio.ts`, `backend/pcm.ts`, `backend/tts.ts`)
1. **Shot-Scoped Segmentation**: Splits script text by Claude screenplay tags (`[NARRATION]`), paragraphs, or explicit shot arrays into discrete shot-scoped narration segments without slicing internal sentence punctuation or leaking visual tags.
2. **TTS Synthesis & Chunking**: Synthesizes speech per shot segment via Kokoro-82M ONNX (offline default), Google Cloud Neural Audio, or macOS say using sentence-boundary splitting.
3. **Sample-Domain Assembly & Normalization**: Trims silence samples from Float32 buffers, applies short boundary fades to eliminate stitch clicks, inserts exact whole-sample pauses between shot boundaries, normalizes peak amplitude, and writes `voiceover.wav`.
4. **Alignment & Cues**: Derives exact word-level millisecond start/end timestamps, written to `captions.vtt` and `voiceover_words.json`.

### Stage 3: Semantic Visual Choice (`backend/pipeline/design.ts`, `backend/jev.ts`)
1. **Semantic Match**: Inspects each spoken sentence to determine the best visual presentation:
   - Showing a browser, terminal, or UI -> `DeviceCard`
   - Explaining memory allocation or arrays -> `MatrixGrid`
   - Highlighting big performance numbers -> `StatCounter`
   - Showing token sequences -> `TokenStrip`
2. **Custom SVG Animation (`src/dl/scene/`)**:
   - For custom vector scenes, animates static SVG documents via declarative element-level timelines (`src/dl/scene/svgAnimation.ts`) with audio-first retiming (`src/dl/scene/sceneTiming.ts`).
3. **Pacing Invariant Verification (`src/dl/schema.ts`, `scripts/validate_film.ts`)**:
   - First shot must cut (`move: "cut"`).
   - No device hold exceeds 25 seconds.
   - No consecutive repeats of the same device block without a canvas/text reset.
   - Viewer receives a text beat breather every 60-90 seconds.

### Stage 4: Spatial Graph & Canvas Layout (`src/dl/CanvasGraph.tsx`)
1. **2D Node Layout**: Positions concept nodes on the continuous spatial graph with bounding boxes $(x, y, w, h)$.
2. **Camera Framing**: Solves continuous camera framing and zoom targets across canvas nodes.
3. **Package Assembly**: Assembles self-contained video package under `videos/<slug>/` (`film.json`, `script.md`, `voiceover.wav`, `footage/`, `visuals/`) loaded by `src/dl/videoPackageLoader.ts`.

### Stage 5: Remotion Video Rendering (`src/dl/Film.tsx`)
1. **Compositions**:
   - `Long`: 1920x1080 landscape video for YouTube, desktop, and documentation.
   - `Reel`: 1080x1920 vertical format for mobile, TikTok, and social shorts.
2. **Audio Stack**:
   - Dynamic ducking: Automatically attenuates background music when narration is speaking and restores volume during breath gaps.
   - Kinetic Subtitles: Synchronized word-level karaoke text reveal across both Long and Reel formats positioned in the bottom safe area with active theme accent color (default "bottom", or disabled via "off").

3. **Autonomous Production Pipeline (`backend/pipeline/run.ts`, `backend/pipeline/director.ts`)**:
   - See [docs/PRODUCTION_PIPELINE.md](PRODUCTION_PIPELINE.md) and [docs/DIRECTOR_GUIDE.md](DIRECTOR_GUIDE.md) for the unified entry points coordinating intake, narrate, design, b-roll, assemble, render, and verify, or auto-prompting a film directly from a natural language topic.

---

## 4. Interactive Web Studio Workflow (`editor/`)

The Aideos Web Studio runs on `http://localhost:3001` (launched with `npm run editor` or the global terminal command `aideos`), presenting a 7-stage Neobrutalism editing interface:

1. **Stage 1: Script (`ScriptStage.tsx`)**: Write and edit screenplay narration text in Full Screenplay markdown, interactive Visual Studio beat cards, or Spoken Text view, with automatic Remotion sub-shot compilation and instant multi-provider TTS voiceover generation (Kokoro, Deepgram, Google Cloud TTS, macOS say).
2. **Stage 2: Story (`StoryStage.tsx`)**: Drag and drop nodes across the 2D infinite spatial canvas, edit card labels, route directed edges, and solve camera zoom anchors, automatically streaming canvas actions to connected coding agents.
3. **Stage 3: Look (`LookStage.tsx`)**: Storyboard gallery with paper texture presets (Blueprint, Archival White, Charcoal), typography controls, and accent color pickers.
4. **Stage 4: Motion (`MotionStage.tsx`)**: Custom SVG movie animation authoring studio with element-level timeline keyframing, motion templates (staged entry, pulse, draw-on strokes), and frame-synchronized preview.
5. **Stage 5: Edit (`EditStage.tsx`)**: Non-linear multi-track timeline displaying audio waveforms, track controls (lock, mute, hide), clip dragging with sticky snapping, transition selectors, unified clip/shot inspector, and model-driven AI edit panel connected to Agent Bridge.
6. **Stage 6: Captions (`CaptionsStage.tsx`)**: Word-level subtitle karaoke editor powered by `@chenglou/pretext` for phrase locks and keyword highlight timing.
7. **Stage 7: Review (`ReviewStage.tsx`)**: AI Critique Studio drawer for natural-language feedback with Agent Bridge dispatch, SVG data visualization charts (coverage map, duration distribution, pacing metrics), and headless Remotion MP4 export.
8. **Persistent Preview & Controls**: 60 FPS Remotion preview player with 16:9 Long and 9:16 Vertical Reel aspect ratio toggling, transport controls, and live studio hot-reload reflecting agent updates in real time.

---

## 5. CLI Commands Reference

| Command | Action | Output Artifact |
| :--- | :--- | :--- |
| `aideos` | Launches and opens interactive web studio | `http://localhost:3001/` |
| `aideos exit` | Gracefully stops the local dev server | Terminal output |
| `aideos validate` | Runs strict schema & pacing validation | Runsheet & status in terminal |
| `aideos render` | Renders long-form landscape video | `out/long.mp4` (1920x1080) |
| `aideos reel` | Renders vertical reel video | `out/reel.mp4` (1080x1920) |
| `aideos studio` | Opens native Remotion Studio UI | Remotion Studio browser tab |
| `aideos test` | Executes full automated verification suite | Test TAP results |
| `aideos produce` | Runs audio-first produce pipeline | `voiceover.wav`, `captions.vtt`, `film.ts` |
| `aideos direct "<prompt>"` | Auto-prompt: LLM director plans and produces a complete film from a prompt | `out/<slug>-long.mp4`, `out/<slug>-reel.mp4` |
| `aideos review <slug\|mp4>` | Runs deterministic quality review checks | `<out>/review.json`, evidence stills |
| `aideos gemini-review <mp4>` | Evaluates video against 12-criterion rubric via Gemini 3.8 Flash (agy) | Terminal score & verdict, JSON |
| `aideos all-check <slug>` | Full check and repair in background agent (long and reel, 9.0+ bar) | `videos/<slug>/all-check/`, final MP4s |
| `npm run backend -- film` | Autonomous pipeline (intake, narrate, design, b-roll, assemble, render, verify) | `out/<slug>-long.mp4`, `out/<slug>-reel.mp4` |
| `npm run validate:film <path>` | Standalone invariant validator for arbitrary film manifests | Runsheet & status in terminal |
| `npm run backend -- mcp` | Starts Model Context Protocol (MCP) server over stdio | MCP stdio interface |
