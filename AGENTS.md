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
- `backend/scriptIntake.ts` is the single source of truth for parsing/serializing Claude-style screenplays (`## timestamp - Title` headers, `[VISUAL]`/`[NARRATION]`/`[ON SCREEN]` tag blocks, plus legacy `VO:`/`Voiceover:`/`Narrator:` conventions), extracting zero-leakage spoken narration, and compiling sub-shots/on-screen `TextReveal` blocks for Remotion.
- It has no Node-only imports, so `editor/src/components/ScriptEditor.tsx` (browser bundle), `editor/vite.config.ts` (dev server), and `backend/audio.ts` all import it directly instead of re-implementing screenplay parsing. Extend this module rather than adding another parser copy.

## Per-Video Package Layout
- Every video is a self-contained package under `videos/<slug>/`: `film.json` (authoritative manifest; see `src/dl/videoPackageLoader.ts`), `script.md`, `voiceover.wav` + `voiceover_words.json`, `footage/<shotId>.mp4` (GPU B-roll), and `visuals/`. `script.md`, `voiceover.wav`, and `footage/` are gitignored build artifacts (see `.gitignore`), like the media exclusions they replaced.
- `src/dl/films/<slug>.ts` is a generated shadow of `videos/<slug>/film.json`, kept only because a handful of tests (`backend/timeline/layer_model.test.ts`, `backend/visual_pipeline/phase_c.test.ts`) import named film exports from it directly, and because Remotion's CLI render / `src/dl/activeFilm.ts` bundle reads it. Never hand-edit content into only one of the two; `editor/vite.config.ts`'s `readFilm`/`writeFilm` helpers are the one place that keeps them in sync, use them (or `wireFootageIntoFilm`) instead of writing either file directly.
- `public/videos` is a symlink to `../videos`. Vite's own `publicDir` static serving won't follow it (its `sirv`-based middleware does a realpath containment check), so `editor/vite.config.ts` serves `/videos/*` with an explicit range-aware middleware. `staticFile('videos/<slug>/...')` resolves through that same URL path for both the editor's Remotion `<Player>` preview and any consumer that fetches it directly.
- The `src/dl/films/<slug>.ts` shadow can drift from its authoritative `film.json` when only one side was ever hand-edited (found stale em dashes in several shadows that the JSON no longer had). To resync a drifted shadow, regenerate it from `film.json` using the exact format `writeFilm`/`filmModule` in `editor/vite.config.ts` produce (`import type { Film } from "../schema";` + `export const <camelCaseId>Film: Film = <JSON.stringify(film, null, 2)>;`), rather than hand-editing the `.ts` file.

## Rule 3 (No Long Dashes) and screenplay parsing
- `backend/scriptIntake.ts` legitimately matches literal em/en dash characters as part of normalizing user-authored screenplay input (e.g. bare timestamp headers like "0:00" through "0:20" followed by a dash-separated title). To keep the module free of literal dash bytes while preserving that behavior, it and its test (`backend/claude_script_intake.test.ts`) use `\u2014`/`\u2013` escapes inside regex and template-literal fixtures instead of the raw characters. Follow the same pattern (escape sequence, not raw character) whenever dash-handling code or its test fixtures genuinely need to represent an em/en dash.

## Scene graph and custom SVG animation
- The scene engine renders a static `.svg` asset plus a separate declarative animation timeline. The clip format, its rules and the determinism contract are documented in [src/dl/scene/README.md](src/dl/scene/README.md); read that before touching `src/dl/scene/**`.
- `src/dl/scene/**` is browser bundle code and must stay free of Node imports, because Remotion bundles it. The filesystem half lives in `src/dl/scene/validateSceneNode.ts` and `backend/scene/loadSceneAssets.ts`, which are the Node-only modules by design. `SceneView` therefore takes asset source text as a prop rather than reading it.
- Rasterize review stills with headless Chrome via `backend/scene/renderStill.ts`, never `qlmanage`: qlmanage ignores the document aspect ratio and emits a square thumbnail, so stills made with it are a misleading record of the frame. `renderFrameStill` verifies the PNG dimensions and throws if they are wrong.
- Anything a model generates into `videos/<slug>/visuals/` passes `backend/scene/generateSvg.ts` first. Its validators enforce every rule the prompt states (mandated viewBox, centre-60% containment, well-formedness, frame-driven purity, self-containment) and the synthesis entry points retry with the errors fed back. Add a rule to the validator, not only to the prompt: a rule that is only asked for is not enforced.

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
  decodes waveforms in the browser instead (`editor/src/components/timeline/useAudioPeaks.ts`).
- Every `backend/timeline/*.test.ts` file is wired into the root `npm test` script. Keep it that way:
  suites that are not listed there silently rot.

## Maintaining this file
- This file is managed by agents. Add rules only when a task produces durable, project-intrinsic knowledge useful to almost every future session.
- Keep it concise. Prefer pointers to authoritative files over copying details.
- When updating, check if this section exists and add it if missing.



