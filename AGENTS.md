<!--
File Description: This file defines the core guidelines, coding principles, and rules for AI agents working in this repository.
-->

# Agent Guidelines & Coding Standards

## Core Rules

1. **File Header Description**: Every file created or updated must have a header description at the very top explaining what the file does and its purpose.
2. **Function Documentation**: Every function written must have a clear, one-line comment preceding it that explains what the function is for.
3. **No Long Dashes**: Never use long dashes (such as em dashes or en dashes) anywhere: in code, UI text, video text, comments, documentation, or agent messages. Always use standard hyphens (-), colons (:), or parentheses ().
4. **Video Design System Standard**: All videos created must strictly follow the specification defined in [src/dl/README.md](src/dl/README.md). This includes:
   - **Color Palette**: 6-value palette (#0A0A0B canvas, #F5F5F5 text primary, #8A8A8E text muted, #635BFF accent max 3x/frame, rgba(245,245,245,.10) hairline depth, #101013 surface).
   - **Typography**: Geist for voice/narrative, JetBrains Mono for all system/code/numbers.
   - **Motion Easing**: Ease-out-expo cubic-bezier(0.16, 1, 0.3, 1) for all transitions.
   - **7 Animated Primitives**: TextReveal, StatCounter, CodeBlock, Card, Divider, IconLabel, ProgressBar.
   - **Single Canvas Model**: 2D infinite spatial canvas with continuous camera motion and wide payoff zooms.
5. **Great Coding Principles & Refinement**:
   - Perform quality and refinement checks to verify code logic and appearance.
   - Maintain clean, modular, well-structured, and readable code.
   - Implement robust error handling, defensive checks, and input validation.

## Video Production & Animation Workflow

1. **Audio-First Pipeline**:
   - **Script Generation**: First, draft or refine the script detailing exactly what will be spoken in the video to communicate the core concept clearly.
   - **Voice Recording Phase**: Present the script to the user and prompt/guide them to record the audio narration.
   - **Audio Analysis & Timing**: Receive the recorded audio track, determine its exact duration and timestamp cues, and lock the video timeline to the audio length.

2. **Mandatory Visual Storyboarder Preview**:
   - **No Immediate Remotion Render**: Before writing complex Remotion/React code or rendering final MP4s, generate an interactive HTML visual storyboard preview (e.g. `.lavish/video_storyboard.html`).
   - **Interactive Storyboard Review**: Launch the storyboard via `lavish-axi` so the user can visually review scene layouts, typography, 2D canvas motion, color tokens, and primitive placements in their browser before full execution.
   - **Feedback & Iteration**: Apply any visual or structural feedback on the storyboard first, and only proceed to Remotion code generation once the user approves the preview.

3. **Continuous Flow & Chained Component Addition**:
   - **No Dissected Frames**: Videos must remain continuous and fluid. Never jump between disconnected static frames or isolated cuts.
   - **Incremental Component Chaining**: Base components must stay on screen and evolve. Add new elements, inputs, layers, or cards onto existing components progressively as the explanation advances (e.g. empty UI state -> typed input -> loading state -> resultant data card).
   - **Seamless Visual Progression**: Maintain persistent UI contexts so viewers experience a unified visual story that builds naturally.

4. **Strict Audio-Visual Synchronization**:
   - **Depict Spoken Words**: Every visual cue, animation, and graphic element must directly depict and reflect what is being spoken in the narration at that precise second.
   - **Precise Cue Syncing**: Align visual triggers, highlight effects, and component additions directly with the voiceover audio timestamps.

## Claude Screenplay Intake
- `backend/scriptIntake.ts` is the single source of truth for parsing/serializing Claude-style screenplays (`## timestamp - Title` headers, `[VISUAL]`/`[NARRATION]`/`[ON SCREEN]` tag blocks, plus legacy `VO:`/`Voiceover:`/`Narrator:` conventions), extracting zero-leakage spoken narration, deterministically structuring untagged prose via `structureUntaggedProseToScript`, and compiling sub-shots and animated primitive blocks (`TextReveal`, `StatCounter`, `CodeBlock`, `Card`, `Divider`, `IconLabel`, `ProgressBar`) for Remotion using TypeSafe Jev (`backend/jev.ts`) for semantic primitive selection with confidence gating and deterministic fallback.
- It has no Node-only imports, so `editor/src/components/ScriptEditor.tsx` (browser bundle), `editor/vite.config.ts` (dev server), and `backend/audio.ts` all import it directly instead of re-implementing screenplay parsing. Extend this module rather than adding another parser copy.

## Transcription and edit context (Phase 1)

- `backend/transcribe.ts`'s `transcribe(src, opts, deps)` transcribes a video/audio source into
  word-level timings: Deepgram's prerecorded `listen` API (`smart_format`, `punctuate`,
  `filler_words`, `utterances` all on) when a key is configured, else a local Whisper CLI
  fallback. Both paths return the same `TranscribedWord[]` shape (the existing `WordInfo` plus a
  per-word `confidence`), so downstream code never needs to know which backend ran. The network
  fetch, the ffmpeg extraction and the Whisper subprocess are all injectable via `deps`, mirroring
  the `llmCaller` injection convention elsewhere, so tests exercise real routing/parsing logic
  without ever touching the network or a real ASR process. `writeImportWords` persists the result
  to `videos/<slug>/import_words.json` (`{words: TranscribedWord[]}`, each carrying a `filler`
  flag once a detection pass has run) plus `import_captions.vtt` via `audio.ts`'s `buildCaptionsVtt`.
- `backend/editContext/` holds the pure signal-detection and context-assembly modules
  `detectFillers`, `detectSilences` and `buildEditContext`, each taking plain data and a
  `TranscribedWord[]`/`LayeredFilm` and returning a typed result with no I/O. `detectFillers`
  always flags a fixed strong-filler lexicon ("um", "uh", ...) and only flags a context-dependent
  word or phrase ("like", "you know") when the ASR backend's own confidence for every word in the
  span falls below a threshold, so a clearly-spoken "I like this" is never touched.
- `backend/audio.ts`'s `resolveAudioSourcePath` resolves candidates against both `process.cwd()`
  and a `REPO_ROOT` computed from `__dirname`. The editor dev server is launched with
  `cd editor && npm run dev`, so its `process.cwd()` is `editor/`, not the repo root every other
  caller (the pipeline CLI, `npm test`) runs from; a cwd-only lookup silently failed to find any
  asset resolved from inside the editor (media upload playback, footage audio peaks, and now
  transcription) whenever the source was a relative path like `media/<file>`. Any new code that
  resolves a repo-relative asset path from within `editor/vite.config.ts` should reuse this helper
  rather than building its own `process.cwd()`-relative lookup.

## Per-Video Package Layout
- Every video is a self-contained package under `videos/<slug>/`: `film.json` (authoritative manifest; see `src/dl/videoPackageLoader.ts`), `script.md`, `voiceover.wav` + `voiceover_words.json`, `footage/<shotId>.mp4` (GPU B-roll), and `visuals/`. `script.md`, `voiceover.wav`, and `footage/` are gitignored build artifacts (see `.gitignore`), like the media exclusions they replaced.
- `src/dl/films/<slug>.ts` is a generated shadow of `videos/<slug>/film.json`, kept only because a handful of tests (`backend/timeline/layer_model.test.ts`, `backend/visual_pipeline/phase_c.test.ts`) import named film exports from it directly, and because Remotion's CLI render / `src/dl/activeFilm.ts` bundle reads it. Never hand-edit content into only one of the two; use `backend/pipeline/filmStore.ts`'s `readFilm`/`writeFilm`/`wireFootageIntoFilm` from any backend code, or `editor/vite.config.ts`'s same-named helpers from the dev server. The two emit an identical module format on purpose.
- `public/videos` is a symlink to `../videos`. Vite's own `publicDir` static serving won't follow it (its `sirv`-based middleware does a realpath containment check), so `editor/vite.config.ts` serves `/videos/*` with an explicit range-aware middleware. `staticFile('videos/<slug>/...')` resolves through that same URL path for both the editor's Remotion `<Player>` preview and any consumer that fetches it directly.
- The `src/dl/films/<slug>.ts` shadow can drift from its authoritative `film.json` when only one side was ever hand-edited (found stale em dashes in several shadows that the JSON no longer had). To resync a drifted shadow, regenerate it from `film.json` using the exact format `writeFilm`/`filmModule` in `editor/vite.config.ts` produce (`import type { Film } from "../schema";` + `export const <camelCaseId>Film: Film = <JSON.stringify(film, null, 2)>;`), rather than hand-editing the `.ts` file.

## Production Pipeline
- `backend/pipeline/run.ts`'s `runProduction` is the one programmatic entry point from a script to finished mp4s (intake, narrate, design, b-roll, assemble, render, verify), with typed progress, per-stage resume via `videos/<slug>/run-state.json`, and stage-tagged errors. `backend/mcp/server.ts` exposes the same thing as MCP tools over stdio. Both are documented in [docs/PRODUCTION_PIPELINE.md](docs/PRODUCTION_PIPELINE.md); drive a film through `runProduction` rather than chaining the older staged commands by hand.
- `backend/pipeline/director.ts`'s `runDirector` is the auto-prompt entry point above `runProduction`: it drafts a screenplay from a raw prompt with an LLM briefed on [docs/DIRECTOR_GUIDE.md](docs/DIRECTOR_GUIDE.md), validates the draft with `backend/scriptIntake.ts`'s own parser (retrying a rejected draft with the specific reason fed back), then hands a passing draft to `runProduction` unchanged. `transformProseToScreenplay` transforms raw untagged prose into a structured Claude screenplay with visual and narration beats via LLM with validation retry and code fence stripping. `generateScreenplay` is the injection point tests use instead of a real model call; the real path always calls the model, so the plan is never a canned or templated screenplay. Reachable via `npm run backend -- direct "<prompt>"` or `aideos direct "<prompt>"`.
- Narration is assembled in the sample domain (`backend/pcm.ts`), never by concatenating encoded files: trim, boundary fade, exact gap insertion and peak normalization on Float32 samples. That is what keeps segment offsets exact and boundaries click-free, and `backend/voiceover_stutter.test.ts` holds each defect class closed. Speech synthesis backends live in `backend/tts.ts`; Kokoro is the offline default and runs in a separate process (`backend/kokoroWorker.mjs`) because its voice-file resolution and ONNX thread pool both break under the TypeScript loader.
- Components must read colour through `useTokens()` from `src/dl/tokens.ts`, not the module-level `PALETTE`/`rule()`/`FAINT`/`SUNKEN` constants: those are derived from the paper-white theme and paint near-black text on the dark canvases every film actually uses. `useLayout().label()` now resolves its muted colour from the rendering theme too, so mono labels are correct without each call site overriding `color`.
- `src/dl/camera.ts` rounds cumulative timeline position, not individual shot durations, and `CanvasGraph`'s camera transform needs `transform-origin: 0 0` to agree with `solveCam`/`projectBox`. Both are load-bearing for audio-visual sync and framing; see the comments at each site before changing them.

## Rule 3 (No Long Dashes) and screenplay parsing
- `backend/scriptIntake.ts` legitimately matches literal em/en dash characters as part of normalizing user-authored screenplay input (e.g. bare timestamp headers like "0:00" through "0:20" followed by a dash-separated title). To keep the module free of literal dash bytes while preserving that behavior, it and its test (`backend/claude_script_intake.test.ts`) use `\u2014`/`\u2013` escapes inside regex and template-literal fixtures instead of the raw characters. Follow the same pattern (escape sequence, not raw character) whenever dash-handling code or its test fixtures genuinely need to represent an em/en dash.

## Scene graph and custom SVG animation
- The scene engine renders a static `.svg` asset plus a separate declarative animation timeline. The clip format, its rules and the determinism contract are documented in [src/dl/scene/README.md](src/dl/scene/README.md); read that before touching `src/dl/scene/**`.
- `src/dl/scene/**` is browser bundle code and must stay free of Node imports, because Remotion bundles it. The filesystem half lives in `src/dl/scene/validateSceneNode.ts` and `backend/scene/loadSceneAssets.ts`, which are the Node-only modules by design. `SceneView` therefore takes asset source text as a prop rather than reading it.
- Rasterize review stills with headless Chrome via `backend/scene/renderStill.ts`, never `qlmanage`: qlmanage ignores the document aspect ratio and emits a square thumbnail, so stills made with it are a misleading record of the frame. `renderFrameStill` verifies the PNG dimensions and throws if they are wrong.
- Anything a model generates into `videos/<slug>/visuals/` passes `backend/scene/generateSvg.ts` first. Its validators enforce every rule the prompt states (mandated viewBox, centre-60% containment, well-formedness, frame-driven purity, self-containment) and the synthesis entry points retry with the errors fed back. Add a rule to the validator, not only to the prompt: a rule that is only asked for is not enforced.

## Scene films (a film whose canvas is a scene)

- A film's canvas is either the node graph (`film.canvas`) or a vector scene (`film.scene`), never
  both: `src/dl/Film.tsx` renders `SceneStage` in place of `CanvasGraph` when `scene` is present.
  `videos/still-talking/` is the worked example; its [README](videos/still-talking/README.md)
  covers the staging conventions and the rebuild commands.
- One `Scene` spans the whole film, not one per shot. That is what makes continuity real, because
  the engine holds each element's last value until another clip takes over. Shots then carry only
  the text cards that overlay it.
- `SceneView` is pure and cannot read disk, so committed assets reach the Remotion bundle through
  the generated `src/dl/scene/assets/svgSources.generated.ts`. Regenerate it with
  `npx tsx backend/scene/buildSvgSources.ts` whenever a `videos/*/visuals/*.svg` changes.
- Compose a scene film on a **square** scene space (1920 x 1920). Each format takes a 1080-wide
  strip through the centre, so the shared safe area is the centre 1080 square; the wide cut also
  sees the left and right wings, and the reel also sees the top and bottom bands. `SceneStage`
  covers rather than contains, so a scene of any other aspect would be cropped, not letterboxed.
- Two rules the engine cannot check, both enforced by the `Timeline` builder in
  `backend/stillTalking/scene.ts`: a clip must start from the value the previous clip on that
  property left behind (otherwise the value snaps on screen), and one element may only ever be
  given one transform `origin` (the compiler applies the last origin it sees to every frame).
- Aim a cue at a spoken word, not at a fraction of its shot: the payoff word of a sentence is
  usually near its end. `buildScene`'s `word()` helper reads the narration's own offsets and throws
  when the phrase is no longer in that shot, so rewriting a line cannot silently mis-time the film.
- Chrome drawn over a scene needs its own ground. A node graph leaves the bottom of the frame
  empty, but a star field will put a dot straight through a glyph of the chapter rail, so `Rail`
  carries its own scrim rather than trusting what is behind it.
- Opacity has one trap worth knowing: an authored `opacity` attribute and a clip that drives
  opacity both want the same attribute. The compiled state wins only when a clip actually drives
  it (`SvgElementState.opacityDriven`), so an element authored `opacity="0"` can be faded fully in,
  and an element authored faint can be translated without being forced opaque.

## Editor design system (editor/**)

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
  in `editor/src/components/`. `editor/src/App.tsx` owns navigation, playback and selection only.

## Imported video and standalone overlay clips

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

## Editor state and the timeline layer model

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
- `backend/timeline/voiceover_engine.ts` is imported by the browser bundle and must stay free of Node
  built-ins. ffmpeg-based waveform extraction lives in `backend/timeline/waveform.ts`; the editor
  fetches peaks via `/api/audio/peaks` and falls back to in-browser decoding (`editor/src/components/timeline/useAudioPeaks.ts`).
- Every `backend/timeline/*.test.ts` file is wired into the root `npm test` script. Keep it that way:
  suites that are not listed there silently rot.

## Frame safe areas and the palette guard

- `src/dl/fullScreenHeroLayout.ts` owns all `fullScreenHero` geometry and is the single
  definition of `SUBTITLE_BAND_TOP_RATIO`, the top of the reel's burned-in caption card. Both
  hero paths use it (`AnalogyInset` in `src/dl/devices.tsx` and `Dynamic3DHeroOverlay` in
  `src/dl/Film.tsx`) and `KineticSubtitles` derives its "bottom" position from it, so caption
  placement and the thing it must avoid come from one number. Put new frame-safe-area geometry
  there rather than re-deriving it in a component: it is a plain module with no Remotion
  imports, which is what makes it unit testable in `backend/fullScreenHeroLayout.test.ts`.
- `backend/design_language_palette.test.ts` walks `src/dl/**` and fails on colour literals
  outside the locked palette (6-digit hex, 3-digit hex and `rgb()`/`rgba()` alike) or on
  typefaces other than Geist and JetBrains Mono. Files that predate the guard are listed in its
  `KNOWN_DRIFT` ledger, which is shrink-only: a listed file that becomes clean fails the test
  until it is removed from the list. Subtrees with their own enforcement (`films/`, `scene/`,
  `tokens.ts`) are excluded and say why in the file.

## AI Video Editing Core (Phase 2)

- `backend/editPlanner/schema.ts` defines the closed Zod discriminated union `EditOp` representing the entire editing vocabulary (text overlays, slides, caption track, filler word removal, dead air removal, range trim, splitting, moving clips, clip speed, volume, mute/hide lanes, accent, theme, reordering). Unknown op kinds are rejected.
- `backend/editPlanner/validator.ts`'s `validateEditProgram(ops, context)` enforces semantic timeline bounds, entity references, and runs a dry-run simulation against `validateLayeredFilm`.
- `backend/editPlanner/interpreter.ts`'s `applyEditProgram(film, ops, context)` is a pure transactional interpreter mapping `EditOp[]` to timeline and voiceover engine operations with atomic rollback on failure.
- `backend/editPlanner/planner.ts`'s `planEdits(request, context, llmCaller)` uses a 3-attempt validate-then-repair loop feeding validation errors back to the model, returning `{ plan, ops }`.
- `editor/src/components/OnCanvasAiEditor.tsx` renders the model-driven AI edit panel with dry-run-then-apply UX, folding committed edits through `convertLayeredFilmToFilm` for a single undo step.
- `backend/mcp/server.ts` exposes `aideos_edit_film` so connected coding agents can drive edits or serve as the planning brain.

## Maintaining this file
- This file is managed by agents. Add rules only when a task produces durable, project-intrinsic knowledge useful to almost every future session.
- Keep it concise. Prefer pointers to authoritative files over copying details.
- When updating, check if this section exists and add it if missing.




