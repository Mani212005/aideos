<!-- File Description: End-to-end architecture and video production workflow specification for Aideos. -->

# Aideos: Complete Architecture & Video Production Workflow

This document details the complete end-to-end workflow of the Aideos Explainer Video Engine, explaining the 4 core design language axioms, the 5-stage automated audio-first produce pipeline, the interactive web studio, and video rendering.

---

## 1. The 4 Fundamental Design Language Axioms

Aideos is engineered around 4 strict architectural invariants:

1. **Films are Pure Data (`src/dl/films/*.ts`, `videos/<slug>/film.json`)**:
   - No React runtime logic, side-effects, or random math inside film definitions. Every film is a pure, serializable JSON data structure conforming strictly to `filmSchema` (`src/dl/schema.ts`).
2. **Master Clock Audio Spine**:
   - Video duration is never guessed. The synthesized voiceover audio is the immutable master clock of the film. Total shot durations must sum to the voiceover length within a strict tolerance of $\pm 50\text{ms}$.
3. **Derived Camera Framing**:
   - The virtual camera never uses hardcoded pixel offsets. Viewport centers, zoom factors, and bounding boxes are mathematically derived from continuous 2D node coordinates $(x, y, w, h)$ on the spatial canvas graph.
4. **Strict 6-Value Semantic Design System**:
   - Every color in the video is mapped to 6 semantic tokens (`canvas`, `surface`, `ink`, `muted`, `hairline`, `accent`). This guarantees that switching themes (e.g. Archival Paper, Blueprint, Charcoal, Warm Editorial) instantly recolors every scene, character, and card with 100% harmony.

---

## 2. End-to-End Workflow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: IDEATION & DRAMATIC TREATMENT                                      │
│  • Raw Prompt / Technical Topic -> Staged LLM Reasoning Chain                │
│  • Emits treatment.json (5 Chapters, Core Claims, Visual Directions)         │
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
│  • Emits shotlist.json (Shots, durations, camera moves, and stages)          │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Verified Shotlist
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 4: SPATIAL CANVAS GRAPH & VECTOR RIG ASSEMBLY                         │
│  • Computes 2D node coordinates (x, y, w, h) & directed edges               │
│  • Assembles pure TypeScript Character Rigs (Astro Guide, Tech Architect)    │
│  • Compiles final film.ts data model and updates activeFilm.ts               │
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

### Stage 1: Ideation & Treatment Layer (`backend/ideation/`)
1. **Intake**: Receives technical topic or raw script outline.
2. **Staged Prompts**: LLM generates a 5-chapter dramatic arc:
   - Chapter 1: The Hook (Provocative thesis or counter-intuitive claim)
   - Chapter 2: Core Concept (Deconstructing the foundational principle)
   - Chapter 3: Architecture & Topology (Deep mechanism breakdown)
   - Chapter 4: Benchmark & Payoff (Quantifiable metric proof or comparison)
   - Chapter 5: Conclusion & Future Outlook
3. **Output**: `videos/<slug>/treatment.json` containing chapter claims, narration lines, and visual direction notes.

### Stage 2: Audio Synthesis & Alignment (`backend/audio.ts`, `backend/pcm.ts`, `backend/tts.ts`)
1. **Shot-Scoped Segmentation**: Splits script text by Claude screenplay tags (`[NARRATION]`), paragraphs, or explicit shot arrays into discrete shot-scoped narration segments without slicing internal sentence punctuation or leaking visual tags.
2. **TTS Synthesis & Chunking**: Synthesizes speech per shot segment via Kokoro-82M ONNX (offline default), Google Cloud Neural Audio, or macOS say using sentence-boundary splitting.
3. **Sample-Domain Assembly & Normalization**: Trims silence samples from Float32 buffers, applies short boundary fades to eliminate stitch clicks, inserts exact whole-sample pauses between shot boundaries, normalizes peak amplitude, and writes `voiceover.wav`.
4. **Alignment & Cues**: Derives exact word-level millisecond start/end timestamps, written to `captions.vtt` and `voiceover_words.json`.

### Stage 3: Semantic Visual Sync Gate (`backend/sync.ts`)
1. **Semantic Match**: Inspects each spoken sentence to determine the best visual presentation:
   - Explaining a human guide or greeting -> `CharacterBeat`
   - Showing a browser, terminal, or UI -> `DeviceCard`
   - Explaining memory allocation or arrays -> `MatrixGrid`
   - Highlighting big performance numbers -> `StatCounter`
   - Conceptual trade-offs -> `ComparisonView`
2. **Bespoke Generative SVG Synthesis & Animation (`backend/scene/generateSvg.ts`, `src/dl/scene/`)**:
   - For custom visual directions, synthesizes theme-harmonized React SVG components or static animatable `.svg` assets into `videos/<slug>/visuals/` via generate-validate-repair loops.
   - Validates geometric invariants (Rule V-4 explicit `viewBox` and `preserveAspectRatio="xMidYMid meet"`, Rule V-2 middle-60% viewport centering, addressable element IDs, self-containment, and frame-driven determinism).
   - Animates static SVG documents via declarative element-level timelines (`src/dl/scene/svgAnimation.ts`) with audio-first retiming (`src/dl/scene/sceneTiming.ts`).
3. **Pacing Invariant Verification (`src/dl/validateFilm.ts`)**:
   - First shot must cut (`move: "cut"`).
   - No device hold exceeds 25 seconds.
   - No consecutive repeats of the same device block without a canvas/text reset.
   - Viewer receives a text beat breather every 60-90 seconds.

### Stage 4: Spatial Graph & Character Rigs (`src/dl/characters/`, `src/dl/CanvasGraph.tsx`)
1. **2D Node Layout**: Positions concept nodes on the continuous spatial graph with bounding boxes $(x, y, w, h)$.
2. **Character Rigging**: Pure TypeScript vector rigs (`astronaut.ts`, `developer.ts`) provide 2-level hierarchical kinematic transforms.
3. **Keyframe Interpolation**: Evaluates pose keyframes via `ease-out-expo` (`motion.ts`) across normalized progress $t \in [0, 1]$.
4. **Package Assembly**: Assembles self-contained video package under `videos/<slug>/` (`film.json`, `script.md`, `voiceover.wav`, `footage/`, `shotlist.json`, `treatment.json`, `visuals/`) loaded by `src/dl/videoPackageLoader.ts`.

### Stage 5: Remotion Video Rendering (`src/dl/Film.tsx`)
1. **Compositions**:
   - `Long`: 1920x1080 landscape video for YouTube, desktop, and documentation.
   - `Reel`: 1080x1920 vertical format for mobile, TikTok, and social shorts.
2. **Audio Stack**:
   - Dynamic ducking: Automatically attenuates background music when narration is speaking and restores volume during breath gaps.
   - Kinetic Subtitles: Synchronized word-level karaoke text reveal in vertical Reel format positioned in the bottom safe area with active theme accent color.

3. **Autonomous Production Pipeline (`backend/pipeline/run.ts`, `backend/pipeline/director.ts`)**:
   - See [docs/PRODUCTION_PIPELINE.md](PRODUCTION_PIPELINE.md) and [docs/DIRECTOR_GUIDE.md](DIRECTOR_GUIDE.md) for the unified entry points coordinating intake, narrate, design, b-roll, assemble, render, and verify, or auto-prompting a film directly from a natural language topic.

---

## 4. Interactive Web Studio Workflow (`editor/`)

The Aideos Web Studio runs on `http://localhost:3001` (launched with `npm run editor` or the global terminal command `aideos`), presenting a 7-stage Neobrutalism editing interface:

1. **Stage 1: Script (`ScriptStage.tsx`)**: Write and edit screenplay narration text in Full Screenplay markdown, interactive Visual Studio beat cards, or Spoken Text view, with automatic Remotion sub-shot compilation and instant Kokoro TTS voiceover generation.
2. **Stage 2: Story (`StoryStage.tsx`)**: Drag and drop nodes across the 2D infinite spatial canvas, edit card labels, route directed edges, and solve camera zoom anchors, automatically streaming canvas actions to connected coding agents.
3. **Stage 3: Look (`LookStage.tsx`)**: Storyboard gallery with 1-click character gesture posing (`Wave`, `Point`, `Think`, `Celebrate`), paper texture presets (Blueprint, Archival White, Charcoal), typography controls, and accent color pickers.
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
| `aideos ideate "<topic>"` | Runs staged LLM dramatic ideation | `treatment.json` |
| `aideos direct "<prompt>"` | Auto-prompt: LLM director plans and produces a complete film from a prompt | `out/<slug>-long.mp4`, `out/<slug>-reel.mp4` |
| `npm run backend -- film` | Autonomous pipeline (intake, narrate, design, b-roll, assemble, render, verify) | `out/<slug>-long.mp4`, `out/<slug>-reel.mp4` |
| `npm run validate:film <path>` | Standalone invariant validator for arbitrary film manifests | Runsheet & status in terminal |
| `npm run backend -- mcp` | Starts Model Context Protocol (MCP) server over stdio | MCP stdio interface |
