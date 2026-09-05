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

### Stage 2: Audio Synthesis & Alignment (`backend/audio.ts`)
1. **Shot-Scoped Segmentation**: Splits script text by paragraphs or explicit shot arrays into discrete shot-scoped narration segments without slicing internal sentence punctuation.
2. **TTS Synthesis & Chunking**: Synthesizes speech per shot segment via Google Cloud Neural Audio or Kokoro ONNX using an 800-character chunking threshold with sentence-boundary splitting.
3. **Silence Trimming & Concat**: Trims leading and trailing raw silence samples from audio buffers and inserts a single controlled 200ms pause between distinct shot boundaries before merging into `voiceover.wav`.
4. **Alignment**: Derives exact word-level millisecond start/end timestamps, written to `captions.vtt`.

### Stage 3: Semantic Visual Sync Gate (`backend/sync.ts`)
1. **Semantic Match**: Inspects each spoken sentence to determine the best visual presentation:
   - Explaining a human guide or greeting -> `CharacterBeat`
   - Showing a browser, terminal, or UI -> `DeviceCard`
   - Explaining memory allocation or arrays -> `MatrixGrid`
   - Highlighting big performance numbers -> `StatCounter`
   - Conceptual trade-offs -> `ComparisonView`
2. **Bespoke Generative SVG Synthesis (`backend/scene/generateSvg.ts`)**:
   - For custom visual directions, synthesizes theme-harmonized React SVG components into `videos/<slug>/visuals/`.
   - Validates geometric invariants (Rule V-4 explicit `viewBox` and `preserveAspectRatio="xMidYMid meet"`, center 60% viewport rule).
3. **Pacing Invariant Verification (`src/dl/validateFilm.ts`)**:
   - First shot must cut (`move: "cut"`).
   - No device hold exceeds 25 seconds.
   - No consecutive repeats of the same device block without a canvas/text reset.
   - Viewer receives a text beat breather every 60-90 seconds.

### Stage 4: Spatial Graph & Character Rigs (`src/dl/characters/`, `src/dl/CanvasGraph.tsx`)
1. **2D Node Layout**: Positions concept nodes on the continuous spatial graph with bounding boxes $(x, y, w, h)$.
2. **Character Rigging**: Pure TypeScript vector rigs (`astronaut.ts`, `developer.ts`) provide 2-level hierarchical kinematic transforms.
3. **Keyframe Interpolation**: Evaluates pose keyframes via `ease-out-expo` (`motion.ts`) across normalized progress $t \in [0, 1]$.
4. **Package Assembly**: Assembles self-contained video package under `videos/<slug>/` (`film.json`, `shotlist.json`, `treatment.json`, `visuals/`) loaded by `src/dl/videoPackageLoader.ts`.

### Stage 5: Remotion Video Rendering (`src/dl/Film.tsx`)
1. **Compositions**:
   - `Long`: 1920x1080 landscape video for YouTube, desktop, and documentation.
   - `Reel`: 1080x1920 vertical format for mobile, TikTok, and social shorts.
2. **Audio Stack**:
   - Dynamic ducking: Automatically attenuates background music when narration is speaking and restores volume during breath gaps.
   - Kinetic Subtitles: Synchronized word-level karaoke text reveal.

---

## 4. Interactive Web Studio Workflow (`editor/`)

The Aideos Web Studio runs on `http://localhost:3001` (launched with the global terminal command `aideos`):

* **📝 Script Studio**: Write and edit shot narration text, generate voiceovers, and inspect word timings.
* **🗺️ Spatial Map**: Drag and drop nodes across the 2D infinite canvas, edit labels, and route directed edges.
* **🎞️ Timeline & Trimmer**: Multi-track timeline displaying audio waveforms, shot cuts, and live playhead scrubbing.
* **🎨 Studio Theme**: Select paper textures (Blueprint, Archival White, Charcoal), typography, and accent colors.
* **📐 Styleboard**: Keyframe gallery with 1-click visual mode switcher and an **80% screen Scene Inspector Modal** to customize character gestures (`Wave`, `Point`, `Think`, `Celebrate`).
* **⚡ Transitions**: Configure paper-rip, cut, pan, and zoom camera transition curves.
* **💬 Pretext Captions**: Word-level subtitle editor.
* **🤖 AI Feedback Assistant**: Global floating chatbot to adjust script pacing, shot timings, themes, and visual parameters in natural language.
* **🎬 Video Layer**: Real-time 60 FPS Remotion preview player with instant MP4 export.

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
| `aideos test` | Executes full 35-test verification suite | Test TAP results |
| `aideos produce` | Runs audio-first produce pipeline | `voiceover.wav`, `captions.vtt`, `film.ts` |
| `aideos ideate "<topic>"` | Runs staged LLM dramatic ideation | `treatment.json` |
