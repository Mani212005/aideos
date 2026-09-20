<!--
File Description: System architecture and design specification for the Aideos Web Editor application.
-->

# Aideos Web Editor: System Architecture & Design Specification 🎬⚡

> **Explainer Video Engine as Data**  
> *A Decoupled Spatial Mind Map, Non-Linear Multi-Track Timeline & Deterministic Rendering Studio*

---

## 📌 Executive Overview & Core Philosophy

**Aideos Web Editor** is an enterprise-grade interactive web application designed for authoring, staging, timing, and rendering high-production explainer videos as structured data. Rather than traditional timeline video editors that rely on manual keyframing and opaque video tracks, Aideos treats video as a **single infinite spatial canvas with continuous camera motion, generative SVG animations, and deterministic 3D/2D rendering**.

The editor UI runs locally on Vite (`http://localhost:3001`), connecting a React 19 single-page application directly to `@remotion/player`, the non-linear layer engine (`backend/timeline/`), and the backend production pipeline.

### Architectural Directives
1. **Single Canvas Model**: 2D/3D infinite spatial canvas with continuous camera panning, zoom-in payoffs, and anchor tracking across two responsive aspect ratios (`Long` 1920x1080 and `Reel` 1080x1920).
2. **Audio-First Pipeline**: Audio narration duration locks the video timeline length, with kinetic word-level subtitles powered by `@chenglou/pretext`.
3. **Dual Design System Separation**:
   - **Rendered Video Design System (`src/dl/README.md`)**: The output video is strictly governed by the 6-value theme palette (`#0A0A0B` canvas, `#F5F5F5` primary text, `#8A8A8E` muted text, `#635BFF` accent), Geist + JetBrains Mono typography, and `ease-out-expo` motion.
   - **Editor Chrome Neobrutalism Design System (`editor/src/styles/tokens.css`)**: The editor application is a pure light-themed interface with bone paper tones (`--nb-paper`, `--nb-surface`, `--nb-subtle`), 2-4px hard borders, 0px border radius, and hard offset shadows. The only dark surface is `--nb-matte`, reserved for the video canvas matte behind the preview player.
4. **Pure Data Non-Linear Layer Model**: Timeline operations (move, trim, split, ripple, layer mute/hide/lock) are pure functions over `LayeredFilm` that round-trip losslessly to `Film` JSON documents.

---

## 📐 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   AIDEOS WEB EDITOR SHELL                                   │
│            (React 19 + TailwindCSS + Neobrutalism UI Primitives + Vite Dev Server)          │
│                      [Top Bar: Transport | Timecode | Aspect Ratio | Undo/Redo]             │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │
    ┌──────────────┬──────────────┬────────────┼─────────────┬──────────────┬──────────────┐
    ▼              ▼              ▼            ▼             ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ 1. SCRIPT  │ │ 2. STORY   │ │ 3. LOOK    │ │ 4. MOTION  │ │ 5. EDIT    │ │ 6. CAPTIONS│ │ 7. REVIEW  │
│ STAGE      │ │ STAGE      │ │ STAGE      │ │ STAGE      │ │ STAGE      │ │ STAGE      │ │ STAGE      │
├────────────┤ ├────────────┤ ├────────────┤ ├────────────┤ ├────────────┤ ├────────────┤ ├────────────┤
│ • Markdown │ │ • 2D Spatial│ │ • Styleboard│ │ • Custom SVG│ │ • Layered  │ │ • Word Sync│ │ • Critique │
│   Screenplay│ │   Mind Map │ │   Gallery  │ │   Animation│ │   Timeline │ │ • Kinetic   │ │   Studio   │
│ • Claude   │ │ • Node Drag│ │ • Character│ │ • Keyframe  │ │ • Waveforms│ │   Highlight │ │ • Health & │
│   Intake   │ │ • Directed │ │   Posing   │ │   Timeline │ │ • Drag     │ │ • Phrase   │ │   Pacing   │
│ • Spoken VO│ │   Edges    │ │ • Theme    │ │ • Motion   │ │   Machine  │ │   Locks    │ │ • Headless │
│   Extract  │ │ • Camera   │ │   Customizer│ │   Templates│ │ • Inspector│ │ • Subtitle │ │   MP4 Export│
│ • TTS Synth│ │   Anchors  │ │ • Typography│ │ • Frame-Sync│ │ • Asset Bin │ │   Timing   │ │   Progress │
└─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
      │              │              │              │              │              │              │
      └──────────────┴──────────────┴───────┬──────┴──────────────┴──────────────┴──────────────┘
                                            │
                                            ▼
                    STATE LAYER: useFilmProject + useLayeredTimeline
               (Single-Transaction Labelled Undo/Redo | Lossless Film Round-Trip)
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
         BACKEND TIMELINE ENGINE                         REMOTION PREVIEW PLAYER
     (layer_engine | drag_machine | snap)          (Browser WebGL Player | MP4 Renderer)
```

---

## ⚙️ 7 Core Editor Stages (`editor/src/screens/`)

### 1. Script Stage (`ScriptStage.tsx` / `ScriptEditor.tsx`)
- **Purpose**: Narrative authoring studio where creators write spoken scripts, structure explanation blocks, and define visual direction cues per shot using raw screenplay markdown or interactive Visual Studio cards.
- **Claude Intake & Sub-Shots**: Parses timestamped sections, `[VISUAL]`, `[NARRATION]`, and `[ON SCREEN]` tag blocks with zero tag leakage into spoken dialogue, two-way sync, and automatic sub-shot compilation via `backend/scriptIntake.ts`. Untagged plain prose is automatically structured into scenes with visual directions via Director LLM transformation with deterministic heuristic fallback (`structureUntaggedProseToScript`), preventing zero-shot parse failures.
- **Audio Synthesis**: Triggers Kokoro ONNX TTS voiceover generation and locks timeline duration boundaries.

### 2. Story Stage (`StoryStage.tsx` / `MindMap.tsx` / `NodeEditor.tsx`)
- **Purpose**: Interactive 2D spatial canvas rendering the underlying graph topology (`CanvasNode` and `CanvasEdge`).
- **Features**: Allows creators to drag spatial anchors in 2D space, connect directed edges, edit concept card properties, and preview camera pan/zoom trajectories.

### 3. Look Stage (`LookStage.tsx` / `Styleboard.tsx` / `CustomizationEditor.tsx`)
- **Purpose**: Visual styling and storyboard gallery combining theme customization with keyframe inspection.
- **Features**: Allows 1-click character gesture posing (`Wave`, `Point`, `Think`, `Celebrate`), background canvas texture selection (`paper-white`, `blueprint`, `charcoal`, `parchment`), and typography configuration (`geist`, `mono`, `space-grotesk`).

### 4. Motion Stage (`MotionStage.tsx`)
- **Purpose**: Dedicated authoring studio for custom SVG movie animations and element-level keyframing.
- **Features**: Live scrubbing of declarative SVG timelines, element ID discovery, pre-built motion templates (staged entry, pulse, draw-on strokes, vector paths), and audio-first retiming against spoken narration.

### 5. Edit Stage (`EditStage.tsx` / `TimelineEditor.tsx` / `InspectorPanel.tsx` / `AssetBin.tsx`)
- **Purpose**: Non-linear multi-track timeline editor with direct manipulation, track controls, and clip inspection.
- **Features**:
  - **Pure Pointer-Drag Machine (`backend/timeline/drag_machine.ts`)**: Manages `move`, `trim-start`, `trim-end`, `scrub`, and `marquee` gestures with pixel-based thresholds and Escape-key cancellation.
  - **Magnetic Ripple Editing**: Auto-shifts downstream clips when trimming or deleting to close or prevent dead gaps (toggle via toolbar or `R` shortcut).
  - **Linked Audio-Video Trimming**: Automatically trims and shifts associated audio and video clips in lockstep.
  - **Track Controls**: Independent layer locking, muting, hiding, reordering, and track addition.
  - **Magnetic Snapping (`backend/timeline/snap.ts`)**: Snaps clip boundaries to playhead, markers, and other clips with self-ignore and zoom-adaptive thresholds.
  - **Audio Waveforms (`src/components/timeline/useAudioPeaks.ts`)**: Server pre-computed peak fetching (`/api/audio/peaks`) with Web Audio API fallback rendered directly on clip bodies.
  - **Inspector Panel**: Unified sidebar for shot editing, transition selection (`TransitionEditor.tsx`), clip adjustments, and asset bin management.
  - **Model-Driven AI Editor Panel (`OnCanvasAiEditor.tsx`)**: Interprets natural-language editing instructions into discrete, validated `EditOp` sequences with dry-run preview and atomic rollback.

### 6. Captions Stage (`CaptionsStage.tsx` / `KineticCaptionEditor.tsx`)
- **Purpose**: Word-level kinetic subtitle editor powered by `@chenglou/pretext`.
- **Features**: Syncs individual word timestamps directly with voiceover audio, configures phrase boundaries, and previews kinetic text highlights.

### 7. Review Stage (`ReviewStage.tsx` / `CritiqueStudio.tsx` / `ExportProgressModal.tsx`)
- **Purpose**: Final quality assurance, pacing inspection, AI critique drawer, and video export.
- **Features**:
  - **Data Visualizations (`src/components/ui/Charts.tsx`)**: Renders script-to-timeline coverage maps, shot duration distribution, narration vs silence density, and pacing health metrics in pure SVG.
  - **AI Critique Drawer**: Interactive assistant for applying natural-language feedback and generating atomic film patches via `/api/critique`.
  - **Export Modal**: Headless Remotion CLI rendering with live progress bars and automatic MP4 download triggers.

---

## 💻 Tech Stack Summary

- **Frontend Shell**: React 19, Vite, TailwindCSS, Lucide Icons, `@remotion/player`.
- **UI Design System**: Neobrutalism tokens (`tokens.css`), custom UI primitives (`src/components/ui/`), bone paper palette.
- **Timeline Engine**: Pure TypeScript non-linear geometry (`backend/timeline/`), pure drag state machine (`drag_machine.ts`), sticky snapping (`snap.ts`).
- **3D & Vector Graphics**: Three.js, React Three Fiber (R3F), pure SVG scene engine (`src/dl/scene/`), 2-level kinematic character rigs (`src/dl/characters/`).
- **Typography & Motion**: `@chenglou/pretext`, Remotion `useCurrentFrame()`, `interpolate()`, `spring()`.
- **Backend & CLI**: Node.js, `tsx`, Express REST API, Remotion CLI.
