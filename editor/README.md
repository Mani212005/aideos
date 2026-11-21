<!-- File Description: Architectural overview, design system guide, and stage reference for the Aideos Web Editor client. -->

# Aideos Web Editor

The Aideos Web Editor is an interactive web studio for authoring, arranging, timing, and previewing motion-graphic explainer films as pure data documents. It connects a React 19 single-page application directly to the Remotion preview player, the non-linear timeline layer engine, and the backend production pipeline.

---

## 🎨 Design System (direction "Strip")

The editor chrome uses a dedicated design system, entirely decoupled from the rendered video design language in `src/dl/README.md`:

- **Light Palette**: A light grey ground (`--nb-paper`, `#f3f4f6`) with white surfaces (`--nb-paper-2`, `--nb-paper-3`), ink text (`--nb-ink`, `--nb-ink-soft`) and one accent (`--nb-select`, `#4b43e0`, 6.6:1 on white). The one dark token (`--nb-matte`) is strictly reserved for the video canvas matte directly behind the video preview. The prefix `nb` is a historical name and has no style meaning.
- **Geometry**: 1px hairline borders in `--nb-line`, one 8px corner radius (`--nb-radius`), spacing steps of 4, 8, 12, 16, 24 and 32 px. There are no shadows except one 1px shadow under the picture (`--nb-shadow-frame`).
- **Feedback**: Colour and opacity changes on hover and press, a 2px accent focus ring, and ease-out-expo motion (`cubic-bezier(0.16, 1, 0.3, 1)`, 160ms).
- **Typography**: Geist for words at 12, 13, 15, 20 and 28 px, and JetBrains Mono at 12 px for all numeric timecodes, frame counters, durations, and system metrics.
- **Film accent**: The film's own accent (`theme.accentChosen`) is bound inline by the components that draw it, such as the AI edit Plan button. It is not an editor token.
- **Shared Primitives (`src/components/ui/`)**: All components consume handcrafted UI primitives (`Button`, `Panel`, `Field`, `Feedback`, `Badge`, `Tabs`, `Toolbar`) styled via CSS variables in `src/styles/tokens.css` and configured in `tailwind.config.js`.

---

## 🧭 One Shell: Films Home, 4 Lenses, Agent Sheet

The editor is one shell: a header (Films, Undo, Redo, Agent, Save, Export), a lens bar (`components/shell/LensBar.tsx`, aria-label "Production stages") and one surface. The surface is the Films home (`components/shell/FilmsHome.tsx`: every film with its state chip, and the Start box, `StartBox.tsx`: one story field and a Start button that names the film from the first words) or one of 4 lenses in `src/screens/`: Words, Look, Cut and Check. The ids in the URL hash are `films`, `script`, `look`, `cut` and `review`. The old `#edit`, `#motion` and `#captions` links open Cut, Look and Cut. The Agent sheet (`components/shell/AgentSheet.tsx`) links an agent, shows its live work and the last task. There is no right inspector, shot inspector, transition editor or New project dialog:

1. **Script (`ScriptStage.tsx` / `ScriptEditor.tsx`)**: Story-first paragraph authoring with collapsible visual and on-screen notes, visible narration change list, zero-leakage spoken dialogue extraction, per-line TTS voiceover generation (Kokoro, Deepgram, Google Cloud TTS, macOS say), and Auto-Prompt agent dispatching with live queue delivery tracking. A repeated Auto-Prompt click reuses the open task; an existing task counts as open only while younger than `OPEN_AFTER_TIMEOUT_MS` (10 minutes, `backend/agentBridge/paneDelivery.ts`, measured from when the task was created or last sent) regardless of whether it is pending, claimed, or timed out with a sent pane, after which a click creates a new task.
2. **Look (`LookStage.tsx` / `DesignView.tsx` / `LookAsk.tsx` / `LookChoices.tsx` / `LookFootage.tsx`)**: One lens, no sub-views: the look plan (`DesignView.tsx`: stage, cast, captain approval via `approveLookPlan`, the shots with their artwork), the film's accent and background (`LookChoices.tsx`) and the footage action for a shot that needs footage (`LookFootage.tsx`). Ask (`LookAsk.tsx`) is the one agent box: it shows the chosen shot as a looping picture and sends the text to the connected agent as a design task for that shot, with the state of the last Ask and Undo.
3. **Cut (`EditStage.tsx` / `TimelineEditor.tsx` / `captions/CaptionObject.tsx` / `OnCanvasAiEditor.tsx`)**: Multi-track non-linear timeline editor with audio waveform visualizations, track controls (lock, mute, hide), captions as a direct-manipulation object in the preview (click to select, drag for the whole video), magnetic ripple editing (R), linked audio-video clip trimming, clip panel on the right (select a clip for its numbers; a caption word clip edits its text), a footer with the clip and lane count, and model-driven AI edit panel (dry-run-then-apply EditOp program execution). Audio imported from the asset bin goes to the Music lane, creating it when needed, so it does not ripple narration on the Voiceover lane. Music lane audio plays at a reduced level in the preview and is dynamically ducked under narration in rendered output.
4. **Check (`CheckStage.tsx` / `CheckExport.tsx`)**: one lens that answers whether the film can go out. It shows the state of the film (Draft, Fail, Pass, Old, OK), the 6 hard gates and the reviewer score against the 9.0 bar from `acceptance.json` (`backend/filmAcceptance/checkView.ts`), a fix list, and Export (Export, Start, Cancel, Download) with the real renderer progress.

---

## ⚙️ State Management & Timeline Layer Engine

- **Project State (`src/state/useFilmProject.ts`)**: Manages the open `Film` document, automated background saving to `videos/<slug>/film.json`, and an atomic single-transaction labelled undo/redo history.
- **Layered Timeline Bridge (`src/state/useLayeredTimeline.ts`)**: Converts `Film` into a `LayeredFilm`, applies pure engine mutations (including magnetic ripple trims and ripple deletes) via `backend/timeline/layer_engine.ts`, and folds changes back losslessly using `convertLayeredFilmToFilm(layered, baseFilm)`.
- **Pure Pointer-Drag Machine (`backend/timeline/drag_machine.ts`)**: Pure state machine managing timeline gestures (`move`, `trim-start`, `trim-end`, `scrub`, `marquee`) with pixel-based drag thresholds, Escape-key cancel recovery, and zero sticky-drag states.
- **Audio Peak Extraction (`src/components/timeline/useAudioPeaks.ts`)**: Fetches pre-computed waveform envelope peaks from `/api/audio/peaks` with fallback to in-browser Web Audio API decoding without pulling Node child processes into the browser bundle.
- **Agent sheet (`src/components/shell/AgentSheet.tsx`)**: Links an agent (your running agent or a connector), polls the link status as the tab heartbeat, and subscribes to Server-Sent Events (`/api/agent/trace`) while open to show the work of the connected coding agent and the pipeline (queued, running, done, failed).
- **Model-Driven AI Editing Core (`src/components/OnCanvasAiEditor.tsx`, `backend/editPlanner/`)**: Translates natural-language edit requests into closed `EditOp` sequences, validates semantic constraints, previews planned changes to the user, and atomically applies changes through `applyEditProgram` as a single undo step.
- **Terminal Agent Prompt Queue (`src/state/paneDelivery.ts`, `backend/agentBridge/paneDelivery.ts`)**: Tracks live Auto-Prompt terminal delivery status via `/api/prompt-agent/queue`, polling state transitions (queued, sending, sent, failed, duplicate) as the backend waits for the terminal agent to become idle before typing.
- **Auto-Prompt State & Single-Flight Guard (`src/state/autoPromptState.ts`)**: Pure state rules for the Auto-Prompt button, dropping concurrent duplicate clicks while a request is in flight (`createSingleFlight`) and resolving delivery badge labels and tones (`autoPromptBadge`).

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
