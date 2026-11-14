<!-- File Description: End-to-end architecture and video production workflow specification for Aideos. -->

# Aideos: Complete Architecture & Video Production Workflow

This document details the complete end-to-end workflow of the Aideos Explainer Video Engine, explaining the 4 core design language axioms, the 5-stage automated audio-first produce pipeline, the interactive web studio, and video rendering.

---

## 1. The 4 Fundamental Design Language Axioms

Aideos is engineered around 4 strict architectural invariants:

1. **Films are Pure Data (`videos/<slug>/film.json`, with generated `src/dl/films/*.ts` shadows)**:
   - No React runtime logic, side-effects, or random math inside film definitions. Every film is a pure, serializable JSON data structure conforming strictly to `filmSchema` (`src/dl/schema.ts`).
2. **Master Clock Audio Spine**:
   - Story duration is never guessed. The synthesized voiceover audio is the master clock for the story, and total shot durations must sum to the voiceover length within $\pm 50\text{ms}$. Each delivered format always appends its configured end card after the story; no film can disable it.
3. **Derived Camera Framing**:
   - The virtual camera never uses hardcoded pixel offsets. Viewport centers, zoom factors, and bounding boxes are mathematically derived from continuous 2D node coordinates $(x, y, w, h)$ on the spatial canvas graph.
4. **Declared Palette with Semantic Theme Tokens**:
   - Colors map to semantic tokens (`canvas`, `surface`, `ink`, `muted`, `hairline`, `accent`) with a measured contrast floor. Switching themes (e.g. Archival Paper, Blueprint, Charcoal, Warm Editorial) recolors scenes and cards with measured contrast and harmony.

---

## Compulsory finishing steps (every video)

Three things are part of making every video, not options. Delivery is refused with a plain-language message naming the missing piece when a Long or a Reel lacks any of them (`backend/deliveryGate.ts`, `aideos design build` (which warns), `runProduction` before any frame renders, `npm run render`, the all-check render and the Studio export).

1. **Music**: a soundtrack for the whole delivered video. Author it in the `soundtrack` block of `design/design.json`, or let `aideos design build <film>` assign the deterministic default score from the audio library.
2. **Sound effects**: effects on real visual events (chapter cuts, counters, cards, the end card). Author them in the same block, or let `aideos design build <film>` place the default effects.
3. **The call to action end card**: appended after the story in both formats by delivery itself, with its copy and length from `aideos.config.json`. It cannot be switched off for a film: `aideos end-card <film> off` is refused, and an old per-film `endCard.enabled: false` is ignored.

Run `aideos audio fetch` once before the first design build, because the default music and effects only use verified cached library items; without the cache the gate refuses the film and says so.

---

## 2. End-to-End Workflow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: SCREENPLAY                                                         │
│  • Raw Prompt / Technical Topic -> Director drafts a Claude screenplay       │
│  • Or your own story: plain paragraphs (#Start, #Conclusion markers ok)      │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Script Text
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: AUDIO-FIRST TIMING SPINE ENGINE                                    │
│  • Shot-scoped segmentation & Neural / Kokoro audio synthesis                │
│  • Silence trimming & chapter-aware pauses (see Production Pipeline)         │
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
│  • Web Editor UI (dev: 3001, stable: 3002) with 80% Scene Inspector          │
│  • Landscape Long Render (videos/<slug>/renders/long.mp4, 1920x1080 @ 30 FPS) │
│  • Vertical Reel Render (videos/<slug>/renders/reel.mp4, 1080x1920 @ 30 FPS)  │
│  • Kinetic Subtitle Karaoke + Dynamic Audio Music Ducking                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Step-by-Step Pipeline Execution

### Stage 1: Screenplay (`backend/pipeline/director.ts`, `backend/scriptIntake.ts`)
1. **Intake**: Receives a technical topic (`aideos direct "<prompt>"`), the user's own plain-text story, or a hand-written Claude screenplay (`aideos film --script`). A plain-text story is converted to the internal tagged form by Aideos itself (`plainTextToTaggedScript`, deterministic, no agent); the agent only fills the visual and on-screen slots.
2. **Director Draft**: For a topic, an LLM briefed on [docs/DIRECTOR_GUIDE.md](DIRECTOR_GUIDE.md) drafts a screenplay, and `backend/scriptIntake.ts` validates it before production starts.
3. **Output**: `videos/<slug>/script.md` containing the timestamped beats with visual direction, narration, and on-screen text.

### Stage 2: Audio Synthesis & Alignment (`backend/audio.ts`, `backend/pcm.ts`, `backend/tts.ts`)
1. **Shot-Scoped Segmentation**: Splits script text by Claude screenplay tags (`[NARRATION]`), paragraphs, or explicit shot arrays into discrete shot-scoped narration segments without slicing internal sentence punctuation or leaking visual tags.
2. **TTS Synthesis & Chunking**: Synthesizes speech per shot segment via Kokoro-82M ONNX (offline default, default speed 0.75 for measured explainer pacing), Google Cloud Neural Audio, or macOS say using sentence-boundary splitting. Each narration line is stored under `videos/<slug>/voiceover_lines/` keyed by a content fingerprint (its words plus the voice, pace and chunk limit, `backend/voiceLines.ts`), so regenerating re-records only changed lines and reuses every other recording.
3. **Sample-Domain Assembly & Normalization**: Trims silence samples from Float32 buffers, applies short boundary fades to eliminate stitch clicks, inserts exact whole-sample pauses between shot boundaries, normalizes peak amplitude, applies loudness normalization to -16 integrated LUFS (-1 dB true peak), and writes `voiceover.wav`.
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
3. **Package Assembly**: Assembles self-contained video package under `videos/<slug>/` (`film.json`, `script.md`, `voiceover.wav`, `voiceover_lines/`, `narration_log.json`, `footage/`, `visuals/`) loaded by `src/dl/videoPackageLoader.ts`.

### Stage 5: Remotion Video Rendering (`src/dl/Film.tsx`)
1. **Compositions**:
   - `Long`: 1920x1080 landscape video for YouTube, desktop, and documentation.
   - `Reel`: 1080x1920 vertical format for mobile, TikTok, and social shorts.
2. **Audio Stack**:
   - <a id="2-soundtrack-mixing"></a>`src/dl/Soundtrack.tsx` is shared by Studio preview and rendered output. The shared voice activity timeline drives music ducking and music review windows; see [Audio Library and Management Commands](AUDIO_LIBRARY.md#2-soundtrack-mixing) for its speech, pause, and gap behavior. Layered timeline conversions preserve soundtrack metadata alongside explicit audio clips.
   - Kinetic Subtitles: Synchronized word-level karaoke text reveal across Long and Reel, using the active theme accent. Captions default to the bottom; owner placements can vary by format and shot. See [caption placement](../src/dl/README.md#owner-caption-cards). Captions can also be disabled with "off".

3. **Autonomous Production Pipeline (`backend/pipeline/run.ts`, `backend/pipeline/director.ts`)**:
   - See [docs/PRODUCTION_PIPELINE.md](PRODUCTION_PIPELINE.md) and [docs/DIRECTOR_GUIDE.md](DIRECTOR_GUIDE.md) for the unified entry points coordinating intake, narrate, look, design, b-roll, assemble, render, and verify, or auto-prompting a film directly from a natural language topic.

---

## 4. Interactive Web Studio Workflow (`editor/`)

The Aideos Web Studio runs locally on `http://localhost:3001` for dev and `http://localhost:3002` for stable (launched with `npm run editor` or the channel launchers; see [Local releases](RELEASES.md)), presenting a 7-stage Neobrutalism editing interface:

1. **Stage 1: Script (`ScriptStage.tsx`)**: Write the story as plain paragraphs (the tagged form stays internal, and Aideos converts plain text itself, never an agent), with the agent's visual and on-screen notes as collapsible notes beside each paragraph, a visible narration change list, automatic Remotion sub-shot compilation and per-line multi-provider TTS voiceover generation that re-records only changed lines (Kokoro, Deepgram, Google Cloud TTS, macOS say).
2. **Stage 2: Story (`StoryStage.tsx`)**: Drag and drop nodes across the 2D infinite spatial canvas, edit card labels, route directed edges, and solve camera zoom anchors, automatically streaming canvas actions to connected coding agents.
3. **Stage 3: Look (`LookStage.tsx`)**: Sub-views for bespoke design and look plans (`DesignView.tsx`: stage, cast, shot treatments, LOOK.md preview, captain approval via `approveLookPlan`, artwork, motion, and honest visual swaps), project theme customization (`CustomizationEditor.tsx`: paper textures, typography, accent color), and storyboard keyframe gallery (`Styleboard.tsx`).
4. **Stage 4: Motion (`MotionStage.tsx`)**: Custom SVG movie animation authoring studio with element-level timeline keyframing, motion templates (staged entry, pulse, draw-on strokes), and frame-synchronized preview.
5. **Stage 5: Edit (`EditStage.tsx`)**: Non-linear multi-track timeline displaying audio waveforms, track controls (lock, mute, hide), clip dragging with sticky snapping, transition selectors, unified clip/shot inspector, and model-driven AI edit panel connected to Agent Bridge. Its Reel controls show delivered length against the 179-second cap, the kept/dropped shots and condensed narration, backend reel checks, and a 9:16 preview; owners can rebuild through the existing reel delivery path.
6. **Stage 6: Captions (`CaptionsStage.tsx`)**: Word-level caption timing editor for word text and frame ranges. To move captions, click them in the Edit preview and drag.
7. **Stage 7: Review (`ReviewStage.tsx`)**: AI Critique Studio drawer for natural-language feedback with Agent Bridge dispatch, and SVG data visualization charts (coverage map, duration distribution, pacing metrics).
8. **Persistent Preview & Controls**: 60 FPS Remotion preview player with 16:9 Long and 9:16 Vertical Reel aspect ratio toggling, transport controls, and live studio hot-reload reflecting agent updates in real time.
9. **Studio Export (`ExportProgressModal.tsx`, `useExportJob.ts`)**: Clicking Export in the header opens a dialog on a Start screen with the review status of the supplied film. Start waits for that read-only lookup to finish; if the lookup fails, the dialog says review status is unavailable and export remains available. The status can change if export preparation changes the film. Nothing renders until Start is pressed. Progress follows actual renderer frame counts, Cancel stops the render and deletes the partial video, the close cross hides the dialog while rendering (reopened via a header progress chip), and a finished render shows an explicit Download button (no automatic download). When the reviewer was asked twice about the exported bytes, the status says so in words (how many times, the two scores and the combined score that decided). See [Review](REVIEW.md#3-the-whole-check-in-a-background-agent-aideos-all-check) for acceptance record semantics.

---

## 5. CLI Commands Reference

| Command | Action | Output Artifact |
| :--- | :--- | :--- |
| `aideos` | Asks which coding agent to connect first, then starts the web studio and opens it in the browser | `http://localhost:3002/` (stable) or `http://localhost:3001/` (dev); see [Local releases](RELEASES.md) |
| `aideos-dev` | Launches updating dev studio on reserved dev port | `http://localhost:3001/`; see [Local releases](RELEASES.md) |
| `aideos-stable` | Launches stable studio or copies films into stable | `http://localhost:3002/`; see [Local releases](RELEASES.md) |
| `aideos version / which` | Shows channel, release tag, commit and checkout path | Terminal output; see [Local releases](RELEASES.md) |
| `aideos exit` | Gracefully stops the active channel's dev server | Terminal output |
| `aideos validate` | Runs strict schema & pacing validation | Runsheet & status in terminal |
| `aideos look brief <film>` | Writes look planning brief answering the 6 look questions | `videos/<film>/design/LOOK_BRIEF.md` |
| `aideos look check <film> [--json]` | Validates look.json against schema and semantic rules; writes LOOK.md on PASS | `videos/<film>/design/LOOK.md` |
| `aideos design brief <film>` | Writes bespoke design brief for scene compilation | `videos/<film>/design/BRIEF.md` |
| `aideos design check <film>` | Validates bespoke film design and renders review stills | Terminal report, `.frames/<film>/` |
| `aideos design build <film> [--source agent\|server-model\|hand-built] [--request <id>]` | Compiles bespoke design and writes film on PASS (`--request` records the build as the answer to that open design request; see the [production pipeline reference](PRODUCTION_PIPELINE.md#resuming)), completing the compulsory music and sound effects with the default soundtrack, and warning while the film is not deliverable | `videos/<film>/film.json` (including the default music and effects), `reel/film.json` when a derived reel exists, `renders/description-credits.txt`, `design/status.json` |
| `aideos render` | Renders long-form landscape video | `videos/<slug>/renders/long.mp4` (1920x1080) |
| `aideos reel` | Renders vertical reel video | `videos/<slug>/renders/reel.mp4` (1080x1920) |
| `aideos reel brief <film> [--max-sec <seconds>] [--target-sec <seconds>]` | Writes the condensed narration brief with locks, hashes and motion budgets | `videos/<film>/reel/REEL_BRIEF.md` |
| `aideos reel check <film> [--max-sec <seconds>] [--target-sec <seconds>] [--json]` | Checks the authored reel cut without changing source data; see the [production pipeline reference](PRODUCTION_PIPELINE.md#reel-cut-delivery) for limits | Terminal report |
| `aideos reel build <film> [--delivery <mode>]` | Compiles condensed reel cut into derived reel film and audio | `videos/<film>/reel/film.json`, `voiceover.wav`, `status.json` |
| `aideos end-card <film> on` | Re-stamps the compulsory end card on one film (`off` is refused: every video has it) | Updated `videos/<film>/film.json` |
| `aideos studio` | Opens native Remotion Studio UI | Remotion Studio browser tab |
| `aideos test` | Executes full automated verification suite | Test TAP results |
| `aideos produce` | Runs audio-first produce pipeline | `voiceover.wav`, `captions.vtt`, `film.ts` |
| `aideos direct "<prompt>" [--final-export]` | Auto-prompt: LLM director plans and produces a draft film from a prompt, stopping after `assemble`; `--final-export` (only when the user explicitly asked) also renders and verifies | Draft: `videos/<slug>/film.json`, narration and design. With `--final-export`: `videos/<slug>/renders/long.mp4`, `videos/<slug>/renders/reel.mp4` (or `<outDir>/<slug>-<format>.mp4` when `--out` is set) |
| `aideos review <slug\|mp4> [--format <format>]` | Runs deterministic quality review checks (default reviews every rendered format) | `<out>/review.json`, `review.reel.json`, evidence stills |
| `aideos gemini-review <mp4>` | Evaluates video against 12-criterion rubric via Gemini 3.8 Flash (agy) | Terminal score & verdict, JSON |
| `aideos all-check <slug>` | Full check and repair in background agent (long and reel, 9.0+ bar) | `videos/<slug>/all-check/`, final MP4s |
| `aideos film [--final-export]` (or `npm run backend -- film`) | Autonomous pipeline (intake, narrate, look, design, reel, b-roll, assemble), stopping at a draft; `--final-export` (only when the user explicitly asked) also runs render and verify | Draft: `videos/<slug>/film.json`, narration and design. With `--final-export`: `videos/<slug>/renders/long.mp4`, `videos/<slug>/renders/reel.mp4` (or `<outDir>/<slug>-<format>.mp4` when `--out` is set) |
| `aideos connect` | Connects local coding agent via one-time pairing code | Connected agent session |
| `npm run validate:film <path>` | Standalone invariant validator for arbitrary film manifests | Runsheet & status in terminal |
| `npm run backend -- mcp` | Starts Model Context Protocol (MCP) server over stdio | MCP stdio interface |
| `npm run release <version>` | Runs full acceptance and promotes an approved stable release | Promoted tag and stable branch; see [Local releases](RELEASES.md) |
| `npm run release:setup` | Sets up independent local stable clone and channel launchers | Cloned stable checkout and launchers; see [Local releases](RELEASES.md) |

Reel-cut behavior, delivery modes, timing limits, shot-drop rules and review guidance are documented in [the production pipeline reference](PRODUCTION_PIPELINE.md#reel-cut-delivery).

## Agent integration detail (moved from AGENTS.md)

### AI Video Editing Core (Phases 2-4)

- `backend/editPlanner/schema.ts` defines the closed Zod discriminated union `EditOp` representing the entire editing vocabulary (text overlays, lower-thirds, slides, caption track, filler word removal, dead air removal, range trim, splitting, moving clips, clip speed, volume, mute/hide lanes, accent, theme, reordering). Unknown op kinds are rejected.
- `backend/editPlanner/validator.ts`'s `validateEditProgram(ops, context)` enforces semantic timeline bounds, entity references, and runs a dry-run simulation against `validateLayeredFilm`.
- `backend/editPlanner/interpreter.ts`'s `applyEditProgram(film, ops, context)` is a pure transactional interpreter mapping `EditOp[]` to timeline and voiceover engine operations with atomic rollback on failure. Supports `add_lower_third` for broadcast-style name/role callout cards, and synchronous video/audio clip speed adjustments.
- `backend/editPlanner/planner.ts`'s `planEdits(request, context, llmCaller)` uses a 3-attempt validate-then-repair loop feeding validation errors back to the model, returning `{ plan, ops }`.
- `backend/editPlanner/provenanceLog.ts`'s `appendEditProvenanceRecord` / `readEditProvenanceLog` records an append-only JSON Lines audit trail to `videos/<slug>/edit_log.jsonl` capturing natural-language requests, generated plans, resolved ops, repair attempts, dry-run status, and source tags, queryable via `GET /api/edit-log` and MCP tool `aideos_list_edit_log`.
- `editor/src/components/OnCanvasAiEditor.tsx` renders the model-driven AI edit panel with dry-run-then-apply UX, folding committed edits through `convertLayeredFilmToFilm` for a single undo step.

### Connected Agent Bridge Hub (Phase 2)

- `backend/agentBridge/` is the single authoritative hub for multi-channel outbound dispatch to connected AI coding agents.
- `backend/agentBridge/dispatcher.ts`'s `dispatchTask` sends rich context payloads (script, audio timings, film manifest, director invariants) across Channel A (Firstmate steering inbox `FIRSTMATE_STEERING_INBOX` / `AIDEOS_AGENT_INBOX`), Channel B (MCP pull queue `aideos_get_pending_tasks`), and Channel C (tmux / local task file `.aideos_task.md`).
- Hybrid Fallback (Decision 1): Unclaimed pending tasks trigger in-process fallback execution after `DEFAULT_AGENT_TIMEOUT_MS` (15s) timeout, defused when an agent claims the task via `aideos_claim_task` or `taskQueue.claimTask`.

### Agent link (`aideos connect`)

- The studio reaches the owner's own coding agent through `backend/agentLink/store.ts`: the header's Connect agent dialog (`editor/src/components/AgentConnect.tsx`) gets a one-time pairing code and gives the browser an owner key (sent as `X-Aideos-Owner` on every studio API call by `editor/src/state/agentLink.ts`); `scripts/aideos-connect.mjs` (dependency-free, also served at `/api/agent-link/connect.mjs`, `aideos connect`, `npm run connect`) claims the code and long-polls `/api/agent-link/next`. This is the only way the hosted studio has an agent: Render has no terminal.
- `dispatchTask` sends a task to the connected agent only when the request carried the owner key it was paired with, and then skips tmux and the inbox so nothing runs twice. Pass `ownerKey: ownerOf(req)` from every new dispatching route in `editor/vite.config.ts`.
- Two ways to link: the user's own running agent (primary: the studio shows one MCP add command plus a paste-in line, and the agent loops on the remote-only `aideos_wait_for_task` tool in its own visible session) or the downloadable connector, which runs each task headless in an empty scratch folder and prints a plain activity view (task, tool calls from `/api/agent-link/activity`, result) with retries collapsed to one calm line. Either way the agent is confined to the aideos MCP tools served statelessly at `POST /api/mcp` (`createMcpServer({ remote: true, link })`, which drops the production-run tools; design file access is limited by `backend/mcp/designTools.ts`). Connector confinement: Claude runs with `--tools ""`; Antigravity with `--sandbox` (its MCP server is registered globally with `agy mcp add`); Codex with `--sandbox read-only`; OpenCode with edit/bash/webfetch denied. `--model provider/model` overrides the run model for opencode (`run --model`) and agy (`--model`); without it the agent's default applies, and a free-tier refusal is reported with a re-pair hint instead of a bare exit code.
- The link must survive restarts: the hosted backend runs on a free-plan container whose filesystem is wiped on every restart, redeploy and spin-down (a Kokoro synthesis OOM-restarts it too). So `backend/agentLink/store.ts` never depends on stored state: tokens are HMAC-signed and self-describing (key: `AIDEOS_LINK_SECRET`, else derived from a provider key, else a local file), the connection table is rebuilt from the next authenticated call, and the connector treats any 5xx, timeout or 404 as transient and never exits on it. A link ends only on Disconnect (the browser also rotates its owner key, which keeps old tokens dead across a restart), a replacing pairing, or the owner's browser not polling `/api/agent-link/status` for the 5 minute grace (`LINK_PRESENCE_GRACE_MS`): that status poll is the tab's heartbeat. Keep new link state derivable from a token or the owner key, not memory or disk.
- One agent per owner: pairing again replaces the previous connection, and the takeover is explicit on both ends (`claim` returns what was replaced, the old connector's next poll 401s with `replacedBy`, the pairing dialog warns while a code is pending). Never add a second concurrent agent per owner without a routing design: tasks must not run twice.
- The Motion stage defaults to Motion you describe (`editor/src/components/DescribeMotion.tsx`, `backend/designSpec/motionRequests.ts`): a described motion for one shot is a shot-focused `design_film` task to the connected agent (server model fallback via `designWithServerModel`), logged with a snapshot of the design it replaced (`design/motion-requests.json`, `design/history/`) for Revert. A failing build only settles a request once the agent's task has ended, because agents iterate. Tests inject `dispatch`.
- The studio keeps its stage in the URL hash, and `buildSvgSources` only rewrites the generated index when artwork changed: a design build otherwise made Vite reload the page and threw the user back to the first stage.
- Vercel runs `npm --prefix editor run build` (`tsc -b` over `editor/tsconfig.node.json` too), which checks every backend module the dev server reaches with `erasableSyntaxOnly` and ESM module rules: no constructor parameter properties, enums or namespaces, and no extensionless dynamic `import()` in backend code. It is in the lint gate; `tsc --noEmit -p editor` alone does not catch these.
- Asset `svgSource` paths are repo-relative; the Node resolvers fall back to the repo root because the editor server's cwd is `editor/`.

### Live Real-Time Agent Trace Telemetry (Phase 3)

- `backend/agentBridge/traceBus.ts` is the in-process event bus collecting trace steps from external coding agents, the bridge dispatcher, and in-process pipeline stages (AI-edit planner, neural TTS, GPU B-roll, invariant validation).
- Server endpoints in `editor/vite.config.ts`: `GET /api/agent/trace` streams live trace steps to the studio via Server-Sent Events (SSE), and `POST /api/agent/trace/step` records server-side pipeline steps.
- MCP tool `aideos_report_step` in `backend/mcp/server.ts` enables connected coding agents to report reasoning, tool calls, and invariant checks into the unified trace timeline.
- `editor/src/components/AgentActivityInspector.tsx` renders live SSE telemetry with real-time status indicators (LIVE/CONNECTING/OFFLINE), phase filtering, and an honest empty state when idle.

### Bi-Directional Canvas & Edit Loop (Phase 4)

- User actions across the three canvas surfaces (Canvas node additions in `editor/src/screens/StoryStage.tsx`, On-Canvas AI-edit requests in `editor/src/components/OnCanvasAiEditor.tsx`, and Review Critique Studio in `editor/src/components/CritiqueStudio.tsx`) dispatch tasks with rich video context to the connected coding agent via `backend/agentBridge/dispatcher.ts` and emit live telemetry steps to `traceBus`.
- Instant studio hot-reload: When `videos/<slug>/film.json` is modified on disk by an agent or written via `backend/pipeline/filmStore.ts` / `writeFilm`, `traceBus.notifyFilmUpdated` broadcasts `event: film_updated` over the SSE `/api/agent/trace` stream. `editor/src/state/useFilmProject.ts` receives the event and updates the open film live without a manual refresh.
- `backend/agentBridge/canvasLoop.test.ts` covers the complete bi-directional loop, fallback handling, and instant studio update path.
