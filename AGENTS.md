<!--
File Description: This file defines the core guidelines, coding principles, and rules for AI agents working in this repository.
-->

# Agent Guidelines & Coding Standards

## Before you make a video

- Read `docs/GOOD_VIDEO.md` before you make or change any video.
- Run `aideos review <slug>` after that.
- Attach the generated per-format review reports to your handoff.
- Run `aideos review <slug|mp4>` on any video you make. Attach the report.
- `aideos review` exits 1 on a failed gate. It exits 2 when it cannot run.

## Drafts and final export

- Default to drafts and stills.
- Run a final export only when the user says so in the terminal.
- These commands make a final export: `aideos render`, `aideos reel`, `aideos film` or `aideos direct` with `--final-export`, `aideos_produce_film` with `finalExport`, and the studio export API.
- Fetch or download a rendered video only when the user says so in the terminal.
- The user decides in the studio. The order is Export, then Start.
- The user can Cancel at any time. A Download button shows when the export ends.
- See `backend/exportJobs.ts`.
- `aideos direct` and `aideos film` stop at a draft after `assemble` unless you pass `--final-export`.

## Look first

- Decide the look before you make any picture.
- Read `docs/GOOD_VIDEO.md`.
- `aideos look brief` writes `design/LOOK_BRIEF.md` for each package.
- Until that brief exists, follow the six questions and criteria in the plan docs.
- Write or inspect `videos/<slug>/design/look.json` before you author `design.json` or SVGs.
- Make each new explainer a scene film.
- Keep one visible stage.
- Name the objects that carry between shots.
- Choose each shot's treatment from the plan.
- Prefer scene motion.
- Put a precise device in an inset that leaves the stage visible. Or redraw it as SVG parts on the stage.
- Never paint a full panel or card over the stage.
- When a run reports `needs_look`, `needs_design` or `needs_reel_cut`, complete the named plan, design or cut. Then rerun the same command.
- Do not use `--design templates` unless someone explicitly requests a template film.
- The look plan owns treatment and cast.
- `docs/DIRECTOR_GUIDE.md` owns screenplay direction.
- The look checker owns plan validity.
- Keep the proof taste notes: make camera motion smoother. Move captions slightly upward.

## Code rules

- Put a header comment at the very top of every code file you create or update.
- The header has three fields: "File Description: <description>", "Inputs and outputs: <inputs> -> <outputs>", "Used by: <callers or entry point>".
- Put a clear one-line comment before every function. The comment says what the function is for.
- Never use long dashes (em dash or en dash) anywhere. This covers code, UI text, video text, comments, documentation and agent messages.
- Use hyphens (-), colons (:) or parentheses () instead.
- When dash-handling code or its test fixtures must show a dash, write the `\u2014` or `\u2013` escape. Never write the raw character.
- Run quality and refinement checks on code logic and appearance.
- Keep code clean, modular, well structured and readable.
- Add robust error handling, defensive checks and input validation.

## Video design standard

- Follow `src/dl/README.md` strictly for all videos.
- Palette: each film declares its palette with a measured contrast floor.
- Type: use Geist for voice and narrative. Use JetBrains Mono for all system text, code and numbers.
- Motion: use ease-out-expo `cubic-bezier(0.16, 1, 0.3, 1)` for all transitions.
- The 7 animated primitives are TextReveal, StatCounter, CodeBlock, Card, Divider, IconLabel and ProgressBar.
- Canvas: one 2D infinite spatial canvas with continuous camera motion and wide payoff zooms.
- Read colour through `useTokens()` from `src/dl/tokens.ts`.
- Do not use the module-level `PALETTE`, `rule()`, `FAINT` or `SUNKEN` constants.
- Keep `src/dl/camera.ts` rounding the cumulative timeline position, not single shot durations.
- Keep `transform-origin: 0 0` on the `CanvasGraph` camera transform.
- Both camera items are load-bearing. Read the comments at each site before you change them.

## Video workflow

### Audio first

- Draft or refine the script first. It states exactly what the video says.
- Show the script to the user. Guide them to record the narration.
- Take the recorded audio. Find its exact duration and timestamp cues.
- Lock the timeline to the audio length.

### Continuous flow

- Keep videos continuous and fluid.
- Never jump between disconnected static frames or isolated cuts.
- Keep base components on screen and let them evolve.
- Add new elements, inputs, layers or cards onto existing components as the explanation advances.
- Keep persistent UI context. The viewer sees one unified visual story.

### Audio and visual sync

- Make every visual cue, animation and graphic show what the narration says at that second.
- Align visual triggers, highlights and component additions with the voiceover timestamps.

## Screenplay intake and Jev

- Use `backend/scriptIntake.ts` as the single source of truth to parse and serialize screenplays.
- Extend it. Never add another parser copy.
- Keep it free of Node-only imports. The browser bundle, the dev server and `backend/audio.ts` import it.
- Pass tagged scripts through unchanged.
- Convert plain text with `plainTextToTaggedScript` (deterministic).
- Leave `[VISUAL]` and `[ON SCREEN]` slots empty. Agents fill only those.
- Use `backend/jev.ts` as the one shared decision client. Never fork a second client.
- Reuse the endpoint, timeout and mock shape of `backend/jev.ts`.
- Ask Jev once per film, not once per beat. Use `prefetchShotVisualAnswers` and `prefetchPrimitiveAnswers`.
- Gate each answer with `resolveShotVisual` or `resolvePrimitive` against the live state of the beat.
- Never call `selectShotVisual` or `selectPrimitive` in a per-beat loop.
- Run `npm run eval:visuals [-- --jev]` before you change a threshold, the criteria wording or the model.
- Add a labelled eval case only for a bad pick the captain identified. Use the captain's label.
- `compileFilmFromScreenplayAsync` is the compile path. The design stage of `run.ts` uses it.
- The Jev endpoint is text-only. It cannot judge rendered stills.
- SVG asset routing is not part of the compile path.
- Detail: `docs/PRODUCTION_PIPELINE.md`, section "Agent rules detail (moved from AGENTS.md)".

## Transcription and edit context

- `transcribe()` returns the same `TranscribedWord[]` shape for Deepgram and for Whisper.
- Keep the network fetch, the API key, ffmpeg and the Whisper subprocess injectable through `deps`.
- Never let a test touch the network, .env files or a real ASR process.
- Keep the `backend/editContext/` modules pure: plain data in, typed result out, no I/O.
- `detectFillers` always flags the fixed strong-filler words.
- `detectFillers` flags context words ("like", "you know") only when the ASR confidence is below the threshold.
- In `editor/vite.config.ts`, resolve a repo-relative asset path with `resolveAudioSourcePath` from `backend/audio.ts`.
- Never build your own `process.cwd()` lookup for that.
- Detail: `docs/PRODUCTION_PIPELINE.md`, section "Agent rules detail (moved from AGENTS.md)".

## Video packages and generated files

- Never commit personal videos.
- Each video is a package under `videos/<slug>/`. The whole `videos/` tree is gitignored. `AIDEOS_VIDEOS_DIR` moves it.
- Only `examples/hello-scene/` ships.
- Never read or write a path under `videos/` directly.
- Use `getVideosDir()`, `resolvePackageDir()` or `resolveRepoAssetPath()` from `src/dl/videoPackageLoader.ts`.
- Or use `readFilm` and `writeFilm` from `backend/pipeline/filmStore.ts`.
- Never let tests touch personal videos. `npm test` preloads `backend/testSupport/fixtureVideosDir.ts`.
- Add fixtures to `test_fixtures/`. Never copy a real video in.
- Never hand-edit the generated shadows: `src/dl/films/<slug>.ts`, `src/dl/activeFilm.ts` and `src/dl/scene/assets/svgSources.generated.ts`.
- `ensureGenerated` (`npm run ensure:generated`) rebuilds them.
- Write films with `readFilm`, `writeFilm` and `wireFootageIntoFilm` from `backend/pipeline/filmStore.ts`. The same-named helpers in `editor/vite.config.ts` also work.
- `public/videos` is a tracked symlink to `../videos`.
- Vite serves `/videos/*` through its own range-aware middleware. Use `staticFile('videos/<slug>/...')`.
- Write voiceover audio and captions into the video package. `produceAudioPipeline` does this. Never copy them into `public/`.
- Detail, and the list of gitignored files: `videos/README.md`.

## Production pipeline

- Drive a film through `runProduction` in `backend/pipeline/run.ts`. It is the one programmatic entry point from a script to finished mp4s.
- `runDirector` in `backend/pipeline/director.ts` drafts a screenplay from a raw prompt.
- `runDirector` checks the draft with the `scriptIntake.ts` parser. It passes a good draft to `runProduction` unchanged.
- Never use `transformProseToScreenplay`. It is deprecated and unused.
- Convert a user's plain-text story with `plainTextToTaggedScript`. Never let a model reformat it.
- Use `generateScreenplay` only as the test injection point.
- The real path always calls the model. Never use a canned or templated plan.
- Assemble narration in the sample domain (`backend/pcm.ts`). Never concatenate encoded files.
- Run Kokoro in its own process (`backend/kokoroWorker.mjs`).
- `/api/generate-voiceover` synthesizes through `backend/voiceSynthesis.ts`.
- Skip Kokoro on hosts under 1.5 GB. `AIDEOS_KOKORO=1` or `AIDEOS_KOKORO=0` overrides the skip.
- Return 503 with per-provider reasons when all synthesis fails.
- Read `docs/CI.md` for the render stage disk guard and its fixed PNG settings.
- Read `docs/AUDIO_LIBRARY.md#2-soundtrack-mixing` for soundtrack mixing and audio commands.
- Read `docs/PRODUCTION_PIPELINE.md` for the full pipeline.

## Scene engine and scene films

- Read `src/dl/scene/README.md` before you touch `src/dl/scene/**`.
- Keep `src/dl/scene/**` free of Node imports. Remotion bundles it.
- `SceneView` takes asset source text as a prop. It never reads disk.
- The Node-only modules are `src/dl/scene/validateSceneNode.ts` and `backend/scene/loadSceneAssets.ts`.
- Rasterize review stills with `backend/scene/renderStill.ts` (headless Chrome). Never use `qlmanage`.
- A film canvas is the node graph (`film.canvas`) or a vector scene (`film.scene`). Never use both.
- Use one `Scene` for the whole film. Do not use one per shot.
- Shots carry only the text cards that overlay the scene.
- Run `npm run ensure:generated` when a `visuals/*.svg` changes.
- Compose a scene film on a square 1920 x 1920 scene space.
- The centre 1080 square is the shared safe area.
- Start each clip from the value that the previous clip left on that property. If not, the value snaps.
- Give one element only one transform `origin`.
- `Timeline.camera()` enforces camera track continuity.
- Build new scene films on `backend/sceneKit/`. Write no kit code of your own.
- Keep topic scenes in the folder of the film.
- `lyric()` throws when a row no longer matches the narration or overflows.
- Add the new words of a film with `measureWords.ts`. It merges.
- Aim a cue at a spoken word, not at a fraction of its shot.
- `createCues(timing).word()` throws when the phrase is no longer in that shot.
- Give chrome that you draw over a scene its own ground. Example: the `Rail` scrim.
- The compiled opacity wins only when a clip drives opacity (`SvgElementState.opacityDriven`).
- Fit the whole bounding box of an asset in the exclusive band of its format, with margin.
- Compute the local bounding box. Do not use only the anchor point.
- Characters are data (`aideos.character/1`).
- Author, check and draw characters with `characters/README.md` and `aideos character check|sheet`.
- Read `docs/CHARACTER_ENGINE.md` for the architecture.
- After a spec edit, re-stamp its hash with `--stamp`.
- After you edit an engine file listed in `src/dl/scene/rigs/registry.ts`, run `npx tsx scripts/freeze_stage_resources.ts`.
- Read `docs/THREE_STAGE_P0.md` for Three stage contracts, resource freezes, cue binding and stage review evidence.
- Run rendering tests and fixture tests one after another. Both rewrite the generated active-film module.
- Detail: `src/dl/scene/README.md`, section "Scene engine and scene film rules (moved from AGENTS.md)".

## Design check and design build

- Run `aideos design check <film...>` on every film design. It is the single gate.
- Use `npm run design:check -- <film> [--all] [--stills] [--json]` for the npm form.
- When the user chose the project theme (`theme.accentChosen`), keep that accent as the only accent.
- Leave `easing` off camera keyframes.
- Bespoke designs are data: `videos/<id>/design/design.json` plus SVGs in `visuals/`.
- Run `aideos design brief <id>`, then `aideos design build <id>`.
- The build writes the film only on PASS. Every build starts from `design/base-film.json`.
- `ProductionRequest.design` selects inline, agent, server or explicit templates delivery. Inline is the default.
- Follow the `needs_look` or `needs_design` result. Rerun the same command.
- Choose templates only when someone explicitly requests them. The exception is a legacy compiler test.
- Node tests skip live agent delivery. They keep the inline stop.
- Keep each module that the editor dev server reaches safe to bundle as ESM.
- Do not use a bare `require.main === module` guard. Use the `typeof require` form.
- Do not import the Remotion bundler or renderer there. Do not re-export `backend/sceneKit/reviewStills.ts` from the kit index.
- Add each standard rule that the captain approves to the design check. Add a failing case in `designCheck.test.ts`. Do not add it only to a prompt.
- Never give template charts or visual blocks canned data.
- `deviceData.ts` refuses a block that shows a word or number the beat never says.
- `buildBlocksForPrimitive` never invents stand-ins.
- StatCounter needs narrated numbers. CodeBlock needs inline code. ProgressBar needs explicit percentages. If not, fall back to TextReveal.
- The studio Look > Design swap and redesign use the same honesty check.
- Detail: `docs/REVIEW.md`, section "Agent rules detail (moved from AGENTS.md)".

## Frame safe areas and the palette guard

- Put all `fullScreenHero` geometry in `src/dl/fullScreenHeroLayout.ts`.
- That file owns `SUBTITLE_BAND_TOP_RATIO` (0.78). Put new frame-safe-area geometry there.
- Keep that file free of Remotion imports.
- Use `stage: "inset"` for a device in a scene film. Use exactly one device or counter.
- The inset device draws in `getInsetRegion` and never dims the scene.
- The `inset` design check rule fails visible scene art in that region.
- Never add a colour literal outside the locked palette in `src/dl/**`.
- Never add a typeface other than Geist and JetBrains Mono in `src/dl/**`.
- `backend/design_language_palette.test.ts` checks both. The `KNOWN_DRIFT` list only shrinks.
- Detail: `src/dl/README.md`, section "Frame safe areas and the palette guard (moved from AGENTS.md)".

## Owner caption placement

- Before you change captions, film writers, timeline conversion or review bands, read the owner caption sections.
- They are in `src/dl/README.md`, `docs/PRODUCTION_PIPELINE.md` and `docs/REVIEW.md`.
- `src/dl/captionPlacement.ts` owns resolution, gesture bounds and carry-forward.
- Use the checked `set_caption_placement` edit operation.
- Journey J13 exercises both formats.

## Imported video and overlay clips

- `film.videoClips` and `film.overlayClips` are the authority for those clips when any exist.
- Keep `linkedClipId` symmetric between a video clip and its footage audio clip.
- Never write a derived subtitle clip (id `clip-sub-<n>-...`) out.
- `FilmView` renders `videoClips` behind everything and `overlayClips` above.
- One render tree serves the editor preview and the Remotion CLI export.
- In `importMediaAssetToLayeredFilm`, always use the `layer-audio-footage` lane for footage audio.
- Never fall back to `layer-audio-spine`.
- `/api/media/upload` probes width, height and fps with a second `ffprobe` call.
- Pass those values through `AssetBin` and `EditStage`.
- Detail: `docs/DESIGN.md`, section "Editor rules detail (moved from AGENTS.md)".

## Editor

- The editor design system is separate from `src/dl/README.md`.
- Tokens are in `editor/src/styles/tokens.css`. Primitives are in `editor/src/components/ui/`.
- Never hard-code a hex value in an editor component. Add or use a token.
- The editor is a light application end to end.
- Use the one dark token `--nb-matte` only behind the video frame and for previews of rendered video.
- Restart the Vite dev server after you edit `tailwind.config.js` or add a token.
- Put screens in `editor/src/screens/`. `editor/src/App.tsx` owns navigation, playback and selection only.
- `useFilmProject.ts` owns the open film, the undo history and autosave.
- Never mutate the film in a screen. Call `commit(nextFilm, label)`. One user gesture is one undo step.
- Use `useLayeredTimeline.ts` as the only path from editor UI into `layer_engine.ts` and `layer_manager.ts`.
- Pass `renderFilm` to both the preview and the export.
- Pass the originating Film as `base` to `convertLayeredFilmToFilm`.
- Keep the pointer-drag state machine pure in `backend/timeline/drag_machine.ts`.
- Attach the window pointer listeners of the timeline unconditionally.
- Never import `src/dl/films/*` in the editor.
- Keep `src/dl/validateLayeredFilm.ts` and `backend/editPlanner/interpreter.ts` free of Node built-ins and `process`.
- Put on-disk source checks in `backend/timeline/layerAssetCheck.ts`.
- Keep `backend/timeline/voiceover_engine.ts` free of Node built-ins.
- Put ffmpeg waveform code in `backend/timeline/waveform.ts`.
- `npm test` finds every `backend/**/*.test.ts` and `scripts/**/*.test.ts` by glob.
- `scripts/check_tests_wired.ts` fails for a test file that no script runs.
- CI runs `npm run smoke:studio`. It fails on a blank page, an uncaught exception, a `console.error` or a Vite client error.
- `AIDEOS_SMOKE_REQUIRED=1` makes a missing Chrome a failure.
- Detail: `docs/DESIGN.md`, section "Editor rules detail (moved from AGENTS.md)", and `docs/CI.md`.

## Edit planner, agent bridge and agent link

- `EditOp` in `backend/editPlanner/schema.ts` is a closed union. Reject unknown op kinds.
- `backend/agentBridge/` is the single hub for outbound dispatch to connected agents.
- The studio reaches the coding agent of the user through `backend/agentLink/store.ts`.
- This is the only way that the hosted studio has an agent.
- Send a task to the connected agent only when the request carried the owner key.
- Pass `ownerKey: ownerOf(req)` from every new dispatching route in `editor/vite.config.ts`.
- Confine the linked agent to the aideos MCP tools at `POST /api/mcp`.
- Keep new link state derivable from a token or the owner key. Never keep it in memory or on disk.
- The connector treats any 5xx, timeout or 404 as transient. It never exits on those.
- Never add a second concurrent agent per owner without a routing design. Tasks must not run twice.
- Keep the studio stage in the URL hash.
- `buildSvgSources` rewrites the generated index only when artwork changed.
- Keep backend code valid for `npm --prefix editor run build` (`tsc -b` over `editor/tsconfig.node.json`).
- That build forbids constructor parameter properties, enums, namespaces and extensionless dynamic `import()` in backend code.
- `tsc --noEmit -p editor` alone does not catch these. The lint gate includes the build.
- Write asset `svgSource` paths repo-relative. The Node resolvers fall back to the repo root.
- Detail: `docs/WORKFLOW.md`, section "Agent integration detail (moved from AGENTS.md)".

## Review

- Take camera and carry-over from film data and element identity. Never take them from pixels.
- Mark a criterion with missing inputs `skipped`. Never mark it a pass.
- Keep every threshold in `backend/review/thresholds.ts`.
- Re-run `npm run calibrate:review` after you change a threshold.
- Review a character film in the own crop of each output. `backend/review/stageTruth.ts` is the one per-output summary.
- Run `aideos all-check <slug>` for the whole review in one background agent.
- Take pass or fail only from the tool-written records in `videos/<slug>/all-check/`. Never score or write them yourself.
- Fix code through a treehouse worktree and a PR. Never fix it on main.
- Inject every outside effect of all-check (Herdr, agy, render, notifications, studio). Keep it that way for new steps.
- Extend `cleanModelJsonResponse`. Never parse reviewer JSON anywhere else.
- Detail: `docs/REVIEW.md`, section "Agent rules detail (moved from AGENTS.md)".

## Vision judge

- Render the stills once through `backend/scene/renderStill.ts` into `.frames/<id>/judge/`.
- Never use `qlmanage`. Never use a browser on localhost.
- Give Jev text only.
- Do not fork a second client. Do not add a Gemini step to this loop.
- The judge never writes a film. Only a passing `buildDesign` writes a film.
- When image reviews and embeddings are absent, skip the vision judge cleanly. Do not evaluate text alone.
- Ask the primitive pick by communicative job. The pick must name the spoken phrase it serves (`servesPhrase`).
- Detail: `docs/REVIEW.md`, section "Agent rules detail (moved from AGENTS.md)".

## Video model policy

- Generate and fix with Claude Sonnet 5.5 (`claude`, `claude-sonnet-5-5`).
- Review with Gemini 3.8 Flash (`agy`).
- Do not use Gemini 3.1 Pro for generation unless the captain explicitly asks.
- Never hard-code a video model. Read `aideos.config.json` through `backend/aideosConfig.ts`.
- `aideos all-check` launches its agent from that config with an explicit `--model`.
- Per-run `--agent` and `--model` override the config.
- A forbidden generation model needs `--allow-forbidden-model`.
- See `docs/REVIEW.md`, section 5.

## Gemini review loop (9.0+ bar)

- Validate every rendered video through the Gemini 3.8 Flash review.
- Use `aideos all-check <slug>` or `aideos gemini-review <mp4>`.
- The 12-criterion rubric has 6 hard gates: persistent stage, camera purpose, bottom captions, readability, no overlap or clipping, audio sync.
- The model must give timestamp evidence for every criterion.
- Claim done only when Gemini rates the video 9.0 or higher and all 6 hard gates pass (verdict ACCEPT).
- On REVISE, read the feedback and the timestamp citations. Iterate on the film or design. Re-render.
- Review rounds persist under `videos/<slug>/gemini-review/` (`round-N.json`, `latest.json`). Git ignores them.
- Detail: `docs/REVIEW.md`, section "Agent rules detail (moved from AGENTS.md)".

## Tests

- Do not add tests on your own. A test you write only restates your own reading of the task.
- The source of truth is the captain's decisions, the committed golden frames, the design check rules and the journeys.
- Add or change a test only in these three cases:
  - The captain asks for it.
  - The captain states a new rule. The test encodes exactly that rule and names the decision.
  - You fix a bug that the captain or a user hit. Its end-to-end reproduction becomes a journey case.
- Never loosen, re-point or delete an existing assertion, timeout, tolerance or golden-frame selection to make a run green.
- If you think a test is wrong, leave it failing. Say so in the PR description under "Test changes". Give the reason for the captain to decide.
- A flaky test is a bug in readiness, warm-up, a network download or shared state. Fix the cause.
- A retry or a longer wait is not a fix. Name the measured cause first.

## Maintaining this file

- Agents manage this file.
- Add a rule only when a task produces durable, project-intrinsic knowledge. It must help almost every future session.
- Keep this file concise. Prefer pointers to authoritative files over copied detail.
- When you update this file, check that this section exists. Add it if missing.
