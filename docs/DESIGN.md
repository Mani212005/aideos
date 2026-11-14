<!--
File Description: System architecture and design specification for the Aideos Web Editor application.
-->

# Aideos Web Editor: System Architecture & Design Specification 🎬⚡

> **Explainer Video Engine as Data**  
> *A Decoupled Spatial Mind Map, Non-Linear Multi-Track Timeline & Deterministic Rendering Studio*

---

## 📌 Executive Overview & Core Philosophy

**Aideos Web Editor** is an enterprise-grade interactive web application designed for authoring, staging, timing, and rendering high-production explainer videos as structured data. Rather than traditional timeline video editors that rely on manual keyframing and opaque video tracks, Aideos treats video as a **single infinite spatial canvas with continuous camera motion, generative SVG animations, and deterministic 2D rendering**.

The editor UI runs locally on Vite (`http://localhost:3001` for dev, `http://localhost:3002` for stable), connecting a React 19 single-page application directly to `@remotion/player`, the non-linear layer engine (`backend/timeline/`), and the backend production pipeline.

### Architectural Directives
1. **Single Canvas Model**: 2D infinite spatial canvas with continuous camera panning, zoom-in payoffs, and anchor tracking across two responsive aspect ratios (`Long` 1920x1080 and `Reel` 1080x1920).
2. **Audio-First Pipeline**: Audio narration duration locks the story timeline; each delivered video always appends its configured end card, and delivery refuses a video without music, sound effects or the end card. Kinetic word-level subtitles measure their words with `@remotion/layout-utils` `measureText`, the same measurer the renderer and the caption checks use.
3. **Dual Design System Separation**:
   - **Rendered Video Design System (`src/dl/README.md`)**: The output video is strictly governed by a per-film declared palette with a measured contrast floor, Geist + JetBrains Mono typography, and `ease-out-expo` motion.
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
│ • Claude   │ │ • Node Drag│ │ • Accent    │ │ • Keyframe  │ │ • Waveforms│ │   Highlight │ │ • Health & │
│   Intake   │ │ • Directed │ │   Color    │ │   Timeline │ │ • Drag     │ │ • Phrase   │ │   Pacing   │
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
- **Purpose**: Narrative authoring studio where creators write their script as a plain story (paragraphs, optional `#Start`/`#Conclusion` markers) with the agent's visual and on-screen notes as collapsible notes beside each paragraph, and see every narration change the user or the agent makes.
- **Claude Intake & Sub-Shots**: Parses timestamped sections, `[VISUAL]`, `[NARRATION]`, and `[ON SCREEN]` tag blocks with zero tag leakage into spoken dialogue, two-way sync, and automatic sub-shot compilation via `backend/scriptIntake.ts`. A user's plain-text story (paragraphs, optional `#Start` or `#Conclusion` markers) is converted deterministically into the internal tagged structure with no agent (`plainTextToTaggedScript`), keeping narration verbatim with empty visual and on-screen slots for the agent to fill.
- **Audio Synthesis**: Triggers multi-provider voiceover generation (local Kokoro, Deepgram, Google Cloud TTS, macOS say) and locks timeline duration boundaries. Narration lines are cached under `voiceover_lines/` by content fingerprint (`backend/voiceLines.ts`), so regenerating re-records only changed lines.
- **Auto-Prompt Agent**: Directly dispatches directing instructions to the connected terminal coding agent via `/api/prompt-agent`, with idempotent task reuse on repeated clicks (an existing task counts as open only while younger than `OPEN_AFTER_TIMEOUT_MS`, 10 minutes, measured from when the task was created or last sent, regardless of whether it is pending, claimed, or timed out with a sent pane, so the same prompt is never typed twice inside that window; after the window a click creates a new task) and single-flight execution guards, displaying live queue status and badges (queued, sending, sent, already queued, already sent, not sent) as the per-pane queue waits for the agent to become idle.

### 2. Story Stage (`StoryStage.tsx` / `MindMap.tsx` / `NodeEditor.tsx`)
- **Purpose**: Interactive 2D spatial canvas rendering the underlying graph topology (`CanvasNode` and `CanvasEdge`).
- **Features**: Allows creators to drag spatial anchors in 2D space, connect directed edges, edit concept card properties, preview camera pan/zoom trajectories, and automatically dispatches spatial actions (`add_node`, `add_edge`, `add_shot`) to connected coding agents via `/api/canvas/event`.

### 3. Look Stage (`LookStage.tsx` / `DesignView.tsx` / `Styleboard.tsx` / `CustomizationEditor.tsx`)
- **Purpose**: Visual styling, look planning, and storyboard gallery combining bespoke design/look inspection, theme customization, and keyframe inspection.
- **Features**:
  - **Design View (`DesignView.tsx`)**: Inspects the film's look plan (`design/look.json`, `LOOK.md` preview), stage, persistent cast, per-shot treatments (`scene`, `scene+card`, `device`, `footage`), captain look approval (`approveLookPlan`), scene artwork, motion timeline, and honest visual swaps (`POST /api/design/:id/shots/:shot/visual`).
  - **Theme Customization (`CustomizationEditor.tsx`)**: Allows background canvas texture selection (`paper-white`, `blueprint`, `charcoal`, `parchment`), accent color customization, and typography configuration (`geist`, `mono`, `space-grotesk`).
  - **Styleboard Gallery (`Styleboard.tsx`)**: Per-shot storyboard cards with direct keyframe inspection.

### 4. Motion Stage (`MotionStage.tsx`)
- **Purpose**: Dedicated authoring studio for custom SVG movie animations and element-level keyframing.
- **Features**: Live scrubbing of declarative SVG timelines, element ID discovery, pre-built motion templates (staged entry, pulse, draw-on strokes, vector paths) drawn in the film's bound accent, and audio-first retiming against spoken narration.

### 5. Edit Stage (`EditStage.tsx` / `TimelineEditor.tsx` / `captions/CaptionObject.tsx` / `InspectorPanel.tsx` / `AssetBin.tsx`)
- **Purpose**: Non-linear multi-track timeline editor with direct manipulation, track controls, and clip inspection.
- **Features**:
  - **Movable Caption Object (`captions/CaptionObject.tsx`)**: Direct-manipulation caption card in the preview (click to select without playback, drag for the whole video, edge resize handles, drag snap guides, format copying, and default position restoration).
  - **Pure Pointer-Drag Machine (`backend/timeline/drag_machine.ts`)**: Manages `move`, `trim-start`, `trim-end`, `scrub`, and `marquee` gestures with pixel-based thresholds and Escape-key cancellation.
  - **Magnetic Ripple Editing**: Auto-shifts downstream clips when trimming or deleting to close or prevent dead gaps (toggle via toolbar or `R` shortcut).
  - **Linked Audio-Video Trimming**: Automatically trims and shifts associated audio and video clips in lockstep.
  - **Track Controls**: Independent layer locking, muting, hiding, reordering, and track addition.
  - **Magnetic Snapping (`backend/timeline/snap.ts`)**: Snaps clip boundaries to playhead, markers, and other clips with self-ignore and zoom-adaptive thresholds.
  - **Audio Waveforms (`src/components/timeline/useAudioPeaks.ts`)**: Server pre-computed peak fetching (`/api/audio/peaks`) with Web Audio API fallback rendered directly on clip bodies.
  - **Inspector Panel**: Unified sidebar for shot editing, transition selection (`TransitionEditor.tsx`), clip adjustments, and asset bin management.
  - **Model-Driven AI Editor Panel (`OnCanvasAiEditor.tsx`)**: Interprets natural-language editing instructions into discrete, validated `EditOp` sequences with dry-run preview, atomic rollback, and automatic dispatch across Agent Bridge channels.

### 6. Captions Stage (`CaptionsStage.tsx` / `KineticCaptionEditor.tsx`)
- **Purpose**: Word-level caption timing editor: word text and per-word frame ranges. Caption position is not set here: click the captions in the Edit preview and drag them.
- **Features**: Syncs individual word timestamps directly with voiceover audio and seeks the preview to a word.

### 7. Review Stage (`ReviewStage.tsx` / `CritiqueStudio.tsx` / `ExportProgressModal.tsx`)
- **Purpose**: Final quality assurance, pacing inspection, AI critique drawer, and video export.
- **Features**:
  - **Data Visualizations (`src/components/ui/Charts.tsx`)**: Renders script-to-timeline coverage maps, shot duration distribution, narration vs silence density, and pacing health metrics in pure SVG.
  - **AI Critique Drawer**: Interactive assistant for applying natural-language feedback and generating atomic film patches via `/api/critique`, with full task dispatch to connected coding agents.
  - **Export Modal**: See the [Studio workflow](WORKFLOW.md#4-interactive-web-studio-workflow-editor) for the Export dialog behavior.

---

## 💻 Tech Stack Summary

- **Frontend Shell**: React 19, Vite, TailwindCSS, Lucide Icons, `@remotion/player`.
- **UI Design System**: Neobrutalism tokens (`tokens.css`), custom UI primitives (`src/components/ui/`), bone paper palette.
- **Timeline Engine**: Pure TypeScript non-linear geometry (`backend/timeline/`), pure drag state machine (`drag_machine.ts`), sticky snapping (`snap.ts`).
- **Vector Graphics**: Pure SVG scene engine (`src/dl/scene/`).
- **Typography & Motion**: Remotion `@remotion/layout-utils` `measureText`, Remotion `useCurrentFrame()`, `interpolate()`, `spring()`.
- **Backend & CLI**: Node.js, `tsx`, Express REST API, Remotion CLI.

## Editor rules detail (moved from AGENTS.md)

### Editor design system (editor/**)

- The editor chrome has its own design system, entirely separate from the rendered-video design
  language in `src/dl/README.md`. Tokens live in `editor/src/styles/tokens.css`, are exposed to
  Tailwind through `editor/tailwind.config.js`, and are consumed through the primitives in
  `editor/src/components/ui/`. Never hard-code a hex value in an editor component: add or use a token.
- The editor is a light application end to end. The one dark token is `--nb-matte`, reserved for the
  matte directly behind the video frame and for previews *of* rendered video (for example the kinetic
  caption preview). Everything else is paper, sunken paper or ink.
- Tailwind's JIT caches generated classes: after editing `tailwind.config.js` or adding a token,
  restart the Vite dev server or new utility classes silently resolve to their defaults.
- Screens live in `editor/src/screens/` (one per stage in the left rail) and compose the components

### Imported video and standalone overlay clips

- `Film` carries `videoClips`/`overlayClips` arrays (`src/dl/schema.ts`), mirroring the `audioClips`
  pattern: they are the authority for `video`/`image`/`text`/non-derived-`subtitle` layer clips once
  any exist, written out by `convertLayeredFilmToFilm` and read back by `convertFilmToLayeredFilm`
  (`src/dl/convertFilm.ts`) with `linkedClipId` kept symmetric between a video clip and its footage
  audio counterpart in `audioClips`. A derived subtitle clip (from the voiceover words) is recognized
  by its synthesized id (`clip-sub-<n>-...`) and never written out; only a standalone caption cue is.
- `src/dl/Film.tsx`'s `FilmView` renders `film.videoClips` as full-bleed `<Sequence>`/`<OffthreadVideo>`
  layers *behind* everything else, making the enclosing canvas background transparent (and skipping
  the paper-grain/blueprint-grid/dot textures) whenever any exist, so the existing canvas/shot content
  composites on top of the user's own footage instead of hiding it. `film.overlayClips` render above
  that as simple text/image cards. Both are no-ops on a film with neither array, so every pre-existing
  film renders unchanged. This is the one render tree both the editor's `<Player>` preview and the
  Remotion CLI export (`Video.tsx` wraps `FilmView`) share, so a compositor change here reaches both.
- `backend/timeline/layer_engine.ts`'s `importMediaAssetToLayeredFilm` always creates/uses a dedicated
  `layer-audio-footage` lane for imported footage audio; it must never fall back to matching
  `layer-audio-spine`, or the collision resolver ripples the import behind an existing voiceover clip.
- `/api/media/upload` (`editor/vite.config.ts`) probes width/height/fps for a video via a second
  `ffprobe` call and returns them alongside `duration`; `AssetBin`'s `MediaAsset` and `EditStage`'s
  `insertAsset` thread `width`/`height` through to `importMediaAssetToLayeredFilm` so an imported
  video's dimensions are known without re-probing.

### Editor state and the timeline layer model

- `editor/src/state/useFilmProject.ts` owns the open film, the single labelled undo history and
  autosave. Screens never mutate the film directly: they call `commit(nextFilm, label)` so one user
  gesture is always one undo step.
- `editor/src/state/useLayeredTimeline.ts` is the only path from editor UI into
  `backend/timeline/layer_engine.ts` and `layer_manager.ts`. It derives a `LayeredFilm`, applies one
  engine operation, folds the result back with `convertLayeredFilmToFilm(next, film)` and commits it.
  It also exposes `renderFilm`, the film with hidden lanes removed and muted lanes silenced, which is
  what both the preview player and export use so the two always agree.
- `convertLayeredFilmToFilm` takes the originating Film as a `base` argument. Passing it is required
  for a lossless round trip: captions, voiceover metadata and per-shot fields the layer model does not
  model are carried through from that base.
- The pointer-drag state machine is pure and lives in `backend/timeline/drag_machine.ts` (not in the
  editor) so its transitions can be regression tested in `drag_machine.test.ts`. The timeline attaches
  its window pointer listeners unconditionally; attaching them only while a drag is open leaves a race
  in which a fast release is missed and the gesture sticks.
- The editor must not import `src/dl/films/*`. Those modules are rewritten on every autosave, so
  importing them makes Vite hot-reload the whole page mid-edit. `editor/vite.config.ts` also lists
  them (and `videos/**`) under `server.watch.ignored` for the same reason.
- `src/dl/validateLayeredFilm.ts` and `backend/editPlanner/interpreter.ts` run in the page (the AI edit Apply gesture), so they
  must stay free of Node built-ins and `process`: the on-disk source check lives in `backend/timeline/layerAssetCheck.ts`.
  A Node import on a browser path passes every Node test and only fails in Chrome, so `backend/editPlanner/browserSafety.test.ts`
  bundles the apply path and the whole studio and fails on an externalized module, and `backend/journeys/j3_studio_edit.journey.ts`
  clicks Apply Edits in a real browser.
- `backend/timeline/voiceover_engine.ts` is imported by the browser bundle and must stay free of Node
  built-ins. ffmpeg-based waveform extraction lives in `backend/timeline/waveform.ts`; the editor
  fetches peaks via `/api/audio/peaks` and falls back to in-browser decoding (`editor/src/components/timeline/useAudioPeaks.ts`).
- `npm test` discovers every `backend/**/*.test.ts` and `scripts/**/*.test.ts` by glob, so a new suite is run
