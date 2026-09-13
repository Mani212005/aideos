<!-- File Description: Architectural overview, design system guide, and stage reference for the Aideos Neobrutalism Web Editor client. -->

# Aideos Web Editor

The Aideos Web Editor is an interactive web studio for authoring, arranging, timing, and previewing motion-graphic explainer films as pure data documents. It connects a React 19 single-page application directly to the Remotion preview player, the non-linear timeline layer engine, and the backend production pipeline.

---

## 🎨 Neobrutalism Design System

The editor chrome uses a dedicated Neobrutalism design system, entirely decoupled from the rendered video design language in `src/dl/README.md`:

- **Light Paper Palette**: Pure light presentation using bone paper tokens (`--nb-paper`, `--nb-surface`, `--nb-subtle`, `--nb-ink`, `--nb-muted`, `--nb-accent`). The one dark token (`--nb-matte`) is strictly reserved for the video canvas matte directly behind the video preview.
- **Physical Geometry**: Thick hard borders (2-4px), 0px border radius, visible grid seams, and hard blur-free offset box shadows (`shadow-[3px_3px_0_var(--nb-border)]`).
- **Tactile Feedback**: Chunky button depression on press (`translate-x-[2px] translate-y-[2px]`), prominent focus outlines, and snappy interactions.
- **Typography**: Heavy geometric headings with JetBrains Mono for all numeric timecodes, frame counters, durations, and system metrics.
- **Shared Primitives (`src/components/ui/`)**: All components consume handcrafted UI primitives (`Button`, `Panel`, `Modal`, `Field`, `Feedback`, `Badge`, `Charts`, `Tabs`, `Toolbar`) styled via CSS variables in `src/styles/tokens.css` and configured in `tailwind.config.js`.

---

## 🧭 7-Stage Left Rail Architecture

The editor interface is organized into 7 sequential editing stages located in `src/screens/`:

1. **Script (`ScriptStage.tsx` / `ScriptEditor.tsx`)**: Screenplay markdown editor, visual shot beat cards, zero-leakage spoken dialogue extraction, and Kokoro TTS audio generation.
2. **Story (`StoryStage.tsx` / `MindMap.tsx`)**: 2D infinite spatial canvas for positioning concept nodes, wiring directed relationship edges, and inspecting camera framing targets.
3. **Look (`LookStage.tsx` / `Styleboard.tsx` / `CustomizationEditor.tsx`)**: Storyboard gallery, one-click character gesture posing, background canvas texture pickers, and typography styling.
4. **Motion (`MotionStage.tsx`)**: Authoring studio for bespoke SVG movie animations, element-level timeline keyframing, and pre-built motion templates.
5. **Edit (`EditStage.tsx` / `TimelineEditor.tsx`)**: Multi-track non-linear timeline editor with audio waveform visualizations, track controls (lock, mute, hide), clip trimming, and clip inspector.
6. **Captions (`CaptionsStage.tsx` / `KineticCaptionEditor.tsx`)**: Word-level kinetic subtitle editor with audio-synchronized keyword highlighting and phrase locks.
7. **Review (`ReviewStage.tsx` / `CritiqueStudio.tsx` / `ExportProgressModal.tsx`)**: AI Critique Studio drawer for natural-language feedback, project health and pacing analytics charts, and headless MP4 render progress.

---

## ⚙️ State Management & Timeline Layer Engine

- **Project State (`src/state/useFilmProject.ts`)**: Manages the open `Film` document, automated background saving to `videos/<slug>/film.json`, and an atomic single-transaction labelled undo/redo history.
- **Layered Timeline Bridge (`src/state/useLayeredTimeline.ts`)**: Converts `Film` into a `LayeredFilm`, applies pure engine mutations via `backend/timeline/layer_engine.ts`, and folds changes back losslessly using `convertLayeredFilmToFilm(layered, baseFilm)`.
- **Pure Pointer-Drag Machine (`backend/timeline/drag_machine.ts`)**: Pure state machine managing timeline gestures (`move`, `trim-start`, `trim-end`, `scrub`, `marquee`) with pixel-based drag thresholds, Escape-key cancel recovery, and zero sticky-drag states.
- **Browser Audio Peak Extraction (`src/components/timeline/useAudioPeaks.ts`)**: Decodes normalized audio waveform peaks directly in the browser via Web Audio API without pulling Node child processes into the browser bundle.

---

## 🚀 Development Commands

```bash
# Start Vite dev server for the editor
npm run dev

# Run oxlint across editor sources
npm run lint

# Build production bundle with TypeScript typecheck
npm run build
```
