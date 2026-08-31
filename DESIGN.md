<!--
File Description: System architecture and design specification for the Aideos Web Editor application.
-->

# Aideos Web Editor: System Architecture & Design Specification 🎬⚡

> **Explainer Video Engine as Data**  
> *A Decoupled Spatial Mind Map, Multi-Track Timeline & Deterministic 3D Rendering Editor*

---

## 📌 Executive Overview & Core Philosophy

**Aideos Web Editor** is an enterprise-grade interactive web application designed for creating, editing, and rendering high-production explainer videos as structured data. Rather than traditional timeline video editors that rely on manual keyframing and opaque video tracks, Aideos treats video as a **single infinite spatial canvas with continuous camera motion and deterministic 3D rendering**.

The editor UI runs locally on Vite (`http://localhost:3001`), connecting a React 19 single-page application directly to `@remotion/player`, `@remotion/three`, and a local Node.js backend.

### Architectural Directives
1. **Single Canvas Model**: 2D/3D infinite spatial canvas with continuous camera panning, zoom-in payoffs, and anchor tracking across two responsive aspect ratios (`Long` 1920x1080 and `Reel` 1080x1920).
2. **Audio-First Pipeline**: Audio narration duration locks the video timeline length, with kinetic word-level subtitles powered by `@chenglou/pretext`.
3. **Deterministic 3D Engine**: Three.js rendering via `@remotion/three` and R3F with frame-synced Selective Bloom (`CinematicComposer`), sRGB ACESFilmic tone mapping, Draco compressed 3D GLTF loaders, 3-point studio lighting, and custom GLSL shaders.
4. **Zero-Hallucination Design System**: Strict adherence to the 6-value color palette (`#0A0A0B` canvas, `#F5F5F5` primary text, `#8A8A8E` muted text, `#635BFF` accent), Geist typography for narration, and JetBrains Mono for system metrics.

---

## 📐 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           AIDEOS WEB EDITOR SHELL                               │
│                         (React 19 + TailwindCSS + Vite)                         │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
    ┌───────────────────┬────────────────┼───────────────────┬───────────────────┐
    ▼                   ▼                ▼                   ▼                   ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ SCRIPT STUDIO │ │ SPATIAL MAP   │ │ TIMELINE &    │ │ PRETEXT       │ │ 3D SHADER     │
│ EDITOR        │ │ MIND MAP      │ │ TRIMMER       │ │ CAPTIONS      │ │ ENGINE        │
├───────────────┤ ├───────────────┤ ├───────────────┤ ├───────────────┤ ├───────────────┤
│ • ScriptText  │ │ • Node Drag   │ │ • Multi-Track │ │ • Word Sync   │ │ • @remotion/  │
│ • Visual Notes│ │ • Edge Connect│ │ • Vertical    │ │ • Kinetic     │ │   three + R3F │
│ • Voiceover   │ │ • Zoom-Out    │ │   Resizer     │ │   Highlight   │ │ • UnrealBloom │
│   Trigger     │ │   Anchors     │ │ • Shot Dur    │ │ • Subtitle FX │ │ • OutputPass  │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └───────┬───────┘
        │                 │                 │                 │                 │
        └─────────────────┴─────────────────┼─────────────────┴─────────────────┘
                                            │
                                            ▼
                           REMOTION PLAYER & EXPORT ENGINE
        (Local WebGL Canvas Preview | Headless MP4 Renderer via Node.js API)
```

---

## ⚙️ 7 Core Editor Subsystems

### 1. Script Studio Layer (`ScriptEditor.tsx`)
- **Purpose**: Narrative authoring studio where creators write spoken scripts, structure explanation blocks, and define visual direction cues per shot.
- **Backend Sync**: Automatically triggers ElevenLabs/Kokoro TTS voiceover generation and derives timeline duration locks.

### 2. Spatial Mind Map Layer (`MindMap.tsx`)
- **Purpose**: Interactive 2D spatial canvas rendering the underlying graph topology (`CanvasNode` and `CanvasEdge`).
- **Logic**: Allows creators to reposition spatial anchors in 2D space, connect directed edges, and preview camera pan/zoom trajectories.

### 3. Deterministic 3D Engine Layer (`ThreeFoundation.tsx` & `CinematicComposer.tsx`)
- **Purpose**: Renders high-fidelity 3D scenes, shader clusters, and PBR models.
- **Pipeline**:
  - `ThreeFoundation`: Wraps R3F `<ThreeCanvas>` with `useAsyncResourceGuard()` gating (`delayRender` / `continueRender`).
  - `CinematicComposer`: Applies `EffectComposer` post-processing with `UnrealBloomPass` light bleeding, `N8AOPass` ambient occlusion, and sRGB `OutputPass` color conversion.
  - `StudioLighting`: 3-point studio light rig (Key, Fill, Rim) with `PCFSoftShadowMap` shadows (`2048x2048`) and HDRI environment map reflections (`RGBELoader`).

### 4. Interactive Timeline & Trimmer Layer (`TimelineEditor.tsx`)
- **Purpose**: Multi-track visual timeline for scrubbing frames, adjusting shot durations, and seeking playhead positions.
- **Features**: Features a vertical split resizer drag handle allowing creators to adjust timeline height dynamically.

### 5. Pretext Kinetic Captions Layer (`KineticCaptionEditor.tsx`)
- **Purpose**: Word-level kinetic subtitle editor powered by `@chenglou/pretext`.
- **Logic**: Syncs individual word timestamps directly with voiceover audio for active keyword highlighting.

### 6. Studio Theme Customizer (`CustomizationEditor.tsx` & `Styleboard.tsx`)
- **Purpose**: Allows real-time customization of accent colors (`#635BFF`), background canvas presets (`smooth-dark`, `paper-white`, `blueprint`, `charcoal`), and typography styles (`geist`, `mono`, `space-grotesk`).

### 7. Export Engine Modal (`ExportProgressModal.tsx`)
- **Purpose**: Communicates with the local Node.js backend (`/api/export`) to invoke Remotion CLI headless rendering and auto-trigger browser MP4 downloads.

### 8. Global AI Critique & Feedback Assistant (`GlobalFeedbackWidget.tsx`)
- **Purpose**: Floating chatbot assistant accessible across all editor screens for applying natural-language critiques, script polishing, shot retiming, and visual theme adjustments via `/api/critique`.

---

## 💻 Tech Stack Summary

- **Frontend Shell**: React 19, Vite, TailwindCSS, Lucide Icons, `@remotion/player`.
- **3D Graphics Stack**: `@remotion/three`, Three.js, React Three Fiber (R3F), `three-stdlib`, `DRACOLoader`, `RGBELoader`.
- **Typography & Motion Engine**: `@chenglou/pretext`, Remotion `useCurrentFrame()`, `interpolate()`, `spring()`.
- **Backend & CLI Tools**: Node.js, `tsx`, Express REST API, Remotion CLI.
