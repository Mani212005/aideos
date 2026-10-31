<!--
File Description: Reference for the Aideos production pipeline - the single programmatic entry
point that takes a script to finished mp4s, the stages it moves through, how resuming works, and
the MCP tool surface that exposes the same thing to an agent.
-->

# Production pipeline

A production run plans the look, builds a scene film and renders both deliverable formats.
The default inline mode returns actionable authoring stops when no coding agent is listening.

```ts
import { runProduction } from "./backend/pipeline/run";

const result = await runProduction(
  { script, title: "Speculative Decoding", slug: "speculative-decoding", broll: true },
  (event) => console.log(event.stage, event.status, event.message, event.progress),
);

// Inspect result.status before consuming outputs; needs_look / needs_design include nextSteps.
result.outputs; // [{ format: "long", path: "videos/speculative-decoding/renders/long.mp4", ... }, ...]
```

The same thing from a terminal:

```bash
npm run backend -- film \
  --script-file videos/my-video/script.md \
  --title "My Video" \
  --slug my-video \
  --broll --formats long,reel
```

`runProduction` is the only entry point that needs to be called. Everything below it is an
implementation detail, and every type it takes or returns lives in `backend/pipeline/types.ts`.

## Stages

| Stage      | What it does                                                                        | What it writes                                     |
| ---------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| `intake`   | Parses the screenplay, rejects an empty or unparseable one                            | `videos/<slug>/script.md`                           |
| `narrate`  | Synthesizes narration and derives the timing spine every later stage is locked to     | `voiceover.wav`, `captions.vtt`, `voiceover_words.json`, `narration.json` |
| `look`     | Writes the measured look brief and validates the plan through the selected delivery mode | `design/LOOK_BRIEF.md`, `look.json`, `LOOK.md` |
| `design`   | Compiles treatments from the accepted look and builds a checked scene design | `design/BRIEF.md`, `base-film.json`, `status.json`, `film.json` and its shadow |
| `reel`     | Builds condensed reel narration and a derived film with checked shot drops, or reuses the long for an identity reel | `videos/<slug>/reel/film.json`, `status.json`, and its `src/dl/films/<slug>.reel.ts` shadow; cut mode also writes reel narration and word timings |
| `broll`    | Renders GPU footage for the flagged shots and fetches the clips                       | `videos/<slug>/footage/<shotId>.mp4`                |
| `assemble` | Wires each clip into its shot as a full-screen inset                                 | `film.json` and its `src/dl/films/<slug>.ts` shadow |
| `render`   | Installs the film as active, drives Remotion for each requested format, then measures and masters each MP4 audio track | `src/dl/activeFilm.ts`, `videos/<slug>/renders/<format>.mp4`, `<format>.mp4.master.json`, `description-credits.txt` by default |
| `verify`   | Probes the rendered files and writes contact sheets across the whole duration         | `videos/<slug>/review/<format>-sheet.jpg`          |

Progress arrives through the second argument to `runProduction`: one `ProductionProgress` per
event, carrying the stage, its status, a human-readable message, an optional 0..1 fraction within
the stage, and milliseconds since the run began.

Rendered paths are returned in `result.outputs`. By default they are written inside the video
package at `videos/<slug>/renders/<format>.mp4`. When `ProductionRequest.outDir` is set, each file
is written as `<outDir>/<slug>-<format>.mp4` instead.

After each render, the master stage measures the delivered MP4 with `ebur128` and targets -16 LUFS
integrated within 0.5 LU and true peak at or below -1 dBTP. If limiting is needed, it encodes an AAC
candidate while copying the video stream, remeasures that encoded MP4, adjusts gain from its measured
loudness, and tightens the limiter if encoded true peak remains above -1 dBTP. It retries up to five
times. Only a candidate meeting both targets replaces the original render; otherwise mastering fails
and the original is retained. The per-format `.master.json` records the measurement and result. If the
source has no measurable audible loudness, mastering is skipped, the original render is retained, and
the pipeline reports a warning. The render stage also writes
`description-credits.txt` from required attributions across the delivered Long and Reel soundtracks;
it is empty when no credits are required.

A failure throws a `ProductionError` whose `stage` field names where it happened, so a caller
never has to guess which part of the chain broke. An authoring stop returns a result instead:
`status: "needs_look"`, `"needs_design"`, or `"needs_reel_cut"`, with `nextSteps` naming the brief, the file to write,
the check command, and the instruction to rerun. Both `film` and `direct` exit with code 3.

## Look and design delivery

`ProductionRequest.design` and `--design <mode>` use the same policy for look and design:

| Mode | Behavior |
| --- | --- |
| `inline` (default) | Deliver through agent link, a recorded tmux pane, or steering inbox and wait for validated output. With no listener or a timeout, return the authoring stop to the invoking agent. |
| `agent` | Require a delivered coding agent; missing delivery or a timeout fails the stage. |
| `server` | Ask the configured Claude generation model (`aideos.config.json`'s `videoModels.generation`) for JSON, validate, and feed errors back for bounded retries. An exhausted retry returns an authoring stop. |
| `templates` | Explicitly compile a node-graph template film, stamped `design.source = "templates"`. |

`--no-bespoke` and `bespoke: false` select templates. Other modes never fall through to templates.
Server generation uses the Claude CLI in text-only print mode, with tools disabled. The injected
`designLlmCaller` handles both look and design for deterministic tests; `skipAgent` disables live delivery.

Every explainer gets a persistent scene. The look's scene shots suppress cards, scene+card shots
keep short copy over the stage, and device shots use the named device in an inset. Device data
still has to pass the narration honesty checks; a refused device keeps the scene plus its card copy
and records a warning in `design/visual-choices.json`.

`aideos look check` checks look shot and cast beat ids against `film.json`, cue phrases against each
shot's narration, each character performance's `character` (`{id, version, hash}`: it must resolve
to a checked spec at that version; a changed hash within the version is a warning and design and
render rebuild), its decisive shot and its one-to-one match with a design performance, and cast ids against `design.json` asset ids or SVG element ids when those inputs
exist. It reports which checks are waiting on inputs that are not available yet. Cast ids use
lowercase letters, digits, and hyphens, and one id can be represented by elements across several
design assets. The palette allows the locked colours plus the film's one accent.

`aideos design build` checks a package's look when one exists: shot coverage, declared cast in artwork,
changing SVG clips on carried objects inside scene shots starting within 0.4s of their spoken cue,
matching inset device overrides and camera keyframes. For a declared Three performance, anticipation
must start before its decisive word and the evaluated contact must land on that word; no clip at the
cue is required. Builds record provenance in `design/status.json`,
defaulting CLI builds to `hand-built` (`--source <who>` overrides). Older packages without a look can
still build directly; new production runs require one before design.

## Soundtrack

`Film.soundtrack` records music sections, measured narration intervals, mix levels,
sound effects, and credits. `src/dl/Soundtrack.tsx` is shared by the Studio preview and Remotion
render. The [workflow soundtrack overview](WORKFLOW.md#2-soundtrack-mixing) links to the full
[Audio Library and Management Commands](AUDIO_LIBRARY.md#2-soundtrack-mixing) reference. Use
`aideos audio fetch` to download listed assets, `aideos audio verify` to check the cache, and
`aideos audio import <id> <file>` to import a manual asset. Manifest entries can include SHA256
hashes to lock asset identity. The reference covers the manifest, mix behavior, chapter breath timing,
and speech measurements.

The optional `soundtrack` block in `design/design.json` authors cue-based music sections and effects.
`aideos design check` validates the authored soundtrack; Studio edits are checked before they are
committed to the Long film. A design-authored soundtrack resolves its cues against Reel timing. If
there is no authored soundtrack in `design.json`, an existing `film.soundtrack` carries into the
Reel, while a generated default score is recomputed for Reel timing. Reel builds map standalone
clips through kept shots and retime, trim, and split linked video audio to follow its video. Loose
audio clips keep their source timing.

For default scoring, cache behavior, and soundtrack authoring and checks, see [Audio Library and
Management Commands](AUDIO_LIBRARY.md#2-soundtrack-mixing).

## Reel cut delivery

`ProductionRequest.reel` governs reel delivery in the API. It defaults to the design policy, with templates mapped to inline. The `film` CLI uses inline reel delivery by default; `aideos reel build` exposes an explicit `--delivery` option:

| Mode | Behavior |
| --- | --- |
| `inline` (CLI default) | Return `status: "needs_reel_cut"` with actionable next steps. This mode does not dispatch to an agent or wait for output. |
| `agent` | Dispatch the reel-cut task to a connected coding agent and wait for validated output. Feed check and cap failures back for up to three attempts; missing delivery or a timeout fails the stage. |
| `server` | Ask the configured generation model to write or repair `cut.json`, feeding check and cap failures back for up to three attempts. |

The Reel is a separate 9:16 delivery made from the Long film's picture and design. If the Long delivery, including its Reel end card when enabled, is at most 179 seconds, it is an identity reel and reuses the Long narration. Otherwise, the cut has condensed narration for the kept shots and uses the Long narration backend, voice, and speed. The hard cap is 179 seconds for the full delivery; an enabled end card counts toward it. The default writing target is 170 seconds, also counting any enabled card. The defaults and end-card span come from `src/dl/delivery.ts` and `backend/reelCut/schema.ts`.

### Author and check a cut

Reel cuts support scene and node-graph films; legacy actor films are not supported. `aideos reel brief <slug>` reads the Long film and available design and look plans, then writes `videos/<slug>/reel/REEL_BRIEF.md`. The brief lists each shot's source narration hash, exact phrases to retain, visible text and numbers, motion floor, and whether the shot is decisive. The editable source is `videos/<slug>/reel/cut.json` with schema `aideos.reelcut/1`: include every Long shot exactly once and in order, either with condensed narration or an explicit drop and reason. Preserve the first-shot hook, last-shot payoff, decisive performances, locked phrases, and every on-screen number that remains visible. Condense across shots before dropping one.

`aideos reel check <slug>` is deterministic and read-only. It checks the cut schema, shot coverage and order, stale Long narration hashes, phrase locks, spoken numbers, drops, the estimated full-delivery budget, and each shot's camera motion floor. New content words trigger warnings for owner review. A kept shot with imported media also warns that numbers inside that media are not checked and must be reviewed by the owner; other failed constraints are errors. A passing estimate does not replace the measured build check: synthesis supplies actual shot durations, then design and delivery checks run against the compiled Reel. AI-authored cuts can render before the captain records approval; approval is optional and does not gate rendering. These authoring rules and checks landed in [merged PR 134](https://github.com/Mani212005/aideos/pull/134).

### Build and review

The build uses a valid cut to synthesize condensed narration, retime the shared design and picture, check the compiled Reel design, and write the derived package under `videos/<slug>/reel/`. Reel captions use the new narration while film-level and kept-shot owner placements carry over from Long. Shared design cues resolve against Reel word timings, and end cues resolve to the Reel story end. Dropped scene shots collapse to zero-length cue spans; if that would collapse a visible animation into a snap, the design check fails and names the shot and element. A failed or stale build records its status and cannot be used for rendering. With the default inline delivery, an over-cap film without a valid cut returns `needs_reel_cut` and next steps; agent and server modes can author or repair the cut. The production pipeline's `reel` stage does the same work as `aideos reel build` and can make an identity reel without a cut.

```bash
# Write the brief and validate an authored cut. The maximum can be lowered below 179 seconds.
aideos reel brief <slug> [--max-sec 179] [--target-sec 170]
aideos reel check <slug> [--max-sec 179] [--target-sec 170] [--json]

# Build an identity reel or compile a checked cut.
aideos reel build <slug> [--delivery inline|agent|server]

# Run production through both output formats. The film CLI uses inline reel delivery by default.
npm run backend -- film --script-file videos/<slug>/script.md \
  --title "<title>" --slug <slug> --formats long,reel

# Review every rendered format, or request the Reel alone.
aideos review <slug>
aideos review <slug> --format reel
```

`aideos review` writes a separate measured report and evidence for each rendered format. Read the Reel report (`review.reel.json`) for Reel-specific facts, including the delivered-length gate; the review command defaults to every rendered format. See [Review](REVIEW.md) for the criteria, artifacts, and review workflow. This measured review is separate from the optional Gemini visual review and from captain approval of the cut.

Studio's Edit-stage Reel controls are described in the [Studio workflow](WORKFLOW.md#4-interactive-web-studio-workflow-editor). The reel rebuild endpoint accepts POST requests only from a same-origin loopback Studio page and rejects example-package writes. This restriction applies only to reel rebuilds; it is not general Studio authentication.

Standalone `videoClips` and `overlayClips` are mapped from source time onto the reel timeline through the kept shots and capped to each shot's shortened narration duration. A clip spanning dropped shots is split into one clip per kept contiguous portion, and clips with no retained portion are omitted. Linked imported-audio clips are retimed, trimmed and split to match their video clips; other `audioClips` keep their source timing.

This clip retiming behavior was added in [merged PR 153](https://github.com/Mani212005/aideos/pull/153). Default Reel soundtrack scoring is documented in [Audio Library and Management Commands](AUDIO_LIBRARY.md#2-soundtrack-mixing) and [merged PR 159](https://github.com/Mani212005/aideos/pull/159); this section does not duplicate the scoring rules.

The reel stage fingerprints the long film, narration and word timings, reel cut, design inputs and artwork, and delivery settings. Changes to those inputs invalidate the derived reel. The cut records a narration hash for each long shot; when a long narration line changes, the reel check marks that shot stale until its reel line and source hash are rewritten.

## Resuming

Every stage records a fingerprint of its inputs in `videos/<slug>/run-state.json`. On the next run
with the same slug, a stage whose fingerprint still matches and whose outputs are still on disk is
skipped. Change the script and narration re-runs; change nothing and a crashed run picks up where
it stopped. `resume: false` ignores the cache entirely, and `force: ["design"]` re-runs one stage
while reusing earlier stages and invalidating every later stage.

The look fingerprint includes script and measured durations. The design fingerprint includes the
look hash (look.json plus the content of every character it names, `lookPlanFingerprint`) plus the
design spec, its artwork, the narration word timings of a stage design and each character spec it
resolves, so authoring edits and character edits reopen design and invalidate later stages while
intake, narration and look are reused. A cached design is rebuilt under the source recorded on the
film (`agent`, `server-model` or `hand-built`), so an unchanged rerun writes the identical film and
reuses assembly and the render. Verify always probes the outputs again. Resuming also revalidates the plan
and rebuilds existing design.json: a missing or invalid artifact cannot reuse a completed stage.
Whenever design recompiles, it refreshes base-film.json so a prior snapshot cannot restore old
narration, timing or treatments.

`stopAfter` returns `status: "stopped"` after a named stage, which is how you inspect the film design before
paying for GPU time or a render.

## Auto-prompt: producing from a raw prompt

`backend/pipeline/director.ts`'s `runDirector` is the entry point above `runProduction` for when
there is no screenplay yet, only an idea. It drafts one with an LLM briefed on
[`docs/DIRECTOR_GUIDE.md`](DIRECTOR_GUIDE.md), validates the draft against the same grammar
`backend/scriptIntake.ts` parses, retries a rejected draft with the specific reason fed back to the
model, and hands a passing draft to `runProduction` unchanged:

```bash
npm run backend -- direct "Why attention scales quadratically" --broll --formats long,reel
```

`aideos direct "<prompt>"` does the same from the CLI launcher. See docs/DIRECTOR_GUIDE.md section 4
for the details; the plan is always model-driven, so there is no canned screenplay in the path.

## Narration

`backend/audio.ts` synthesizes each shot's narration, assembles the pieces in the sample domain,
and returns the exact timing spine the film is built from. Trimming, boundary fades, gap insertion
and peak normalization all happen on samples rather than on encoded files, so the reported segment
offsets are exact and nothing is stitched across a sample-rate or channel-layout mismatch. The
default pause is 200 ms between narration segments and 900 ms before a segment that opens a new
chapter. For tagged screenplays, chapter boundaries are inferred from narration-bearing sections;
scene-film voiceover beats can provide chapter names explicitly. Both pause lengths and explicit
chapter-start flags can be overridden through the audio options. The longer chapter breath gives
later music changes room to land between spoken lines. The assembled audio is then normalized to
-16 integrated LUFS with -1 dB true-peak headroom via FFmpeg
loudnorm to satisfy the review loudness standard without changing its duration. See
`backend/pcm.ts` for the sample-domain helpers and `backend/voiceover_stutter.test.ts` for the
defect classes that are held closed by regression tests.

Backends live in `backend/tts.ts`. Kokoro-82M runs locally through ONNX with no API key and is the
default, configured with a default pace multiplier of 0.75 (`DEFAULT_KOKORO_SPEED`) to keep explainer
narration within the measured review pacing limit (`AIDEOS_TTS_SPEED` or `--speed` overrides);
`AIDEOS_TTS` or the `ttsBackend` option pins `google`, `say` or the offline `tone`
placeholder instead. Kokoro runs in a separate process (`backend/kokoroWorker.mjs`) because it
resolves its voice files relative to its own module directory and because the ONNX thread pool
aborts the process on teardown when loaded inside the TypeScript loader.

## B-roll

In explicit templates mode, shots are flagged for footage by a `[VISUAL]` beat containing a footage marker (`B-roll:`,
`footage`, `live action`, `cinematic plate`). The design stage only accepts a beat whose narration
fits inside one clip with a second to spare - a clip shorter than its shot renders black for the
remainder - and spreads the remaining budget across the film rather than bunching clips together.

Rendering runs through `backend/engine/`; see `backend/engine/RUNBOOK.md` for the GPU box. Verify
the loop before a full run:

```bash
npm run backend -- engine-test "<prompt>" --engine ssh-wangp --seconds 5
```

Look-planned films reserve the footage treatment until framed b-roll is supported; their stage stays visible.

The assemble stage drops any clip that came back shorter than its shot and records a warning rather
than shipping a black tail.

## MCP server

```bash
npm run backend -- mcp        # stdio transport
```

Tools:

| Tool                     | Purpose                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `aideos_produce_film`    | Start a run. Returns a `runId` immediately.                                 |
| `aideos_run_status`      | Poll a run: current stage, progress, recent messages, and the final result.  |
| `aideos_list_runs`       | Every run this server process has started.                                  |
| `aideos_list_films`      | Video packages on disk, with shot count, duration and B-roll status.        |
| `aideos_get_film`        | The validated film manifest for one package.                               |
| `aideos_edit_film`       | Plan and execute natural-language edits on a video package with rollback.   |
| `aideos_list_edit_log`   | Return the full provenance audit trail for a film's AI edit operations.    |
| `aideos_get_pending_tasks`| Fetch pending directing, voiceover, screenplay, and editing tasks.         |
| `aideos_claim_task`      | Claim a pending task to begin execution and prevent hybrid fallback.       |
| `aideos_complete_task`   | Mark a claimed agent task as completed with summary and execution results. |
| `aideos_report_step`     | Report execution step, tool call, or validation check to live Agent Trace. |
| `aideos_look_brief`      | Fetch the look planning brief for a film package before creating picture assets. |
| `aideos_look_check`      | Validate design/look.json and write design/LOOK.md.                         |
| `aideos_design_brief`    | Fetch the design brief for a film package.                                 |
| `aideos_read_file`       | Read a film look plan, design spec, SVG visual, or status JSON file.        |
| `aideos_write_file`      | Write design/look.json, design.json or visuals SVG in a film package.      |
| `aideos_design_build`    | Compile design.json, run design checks, and write the passing film.        |
| `aideos_design_check`    | Run design checks (schema, palette, typography, pacing, honest numbers).   |
| `aideos_frame_stills`    | Fetch sampled 1920x1080 review stills as images with frame metadata.       |
| `aideos_submit_frame_review` | Submit notes, suggestions, and image-text similarity scores.           |
| `aideos_wait_for_task`   | Wait for and receive the next studio task (remote agent-link sessions).    |

A full render takes tens of minutes, so `aideos_produce_film` never blocks: it starts the run in
the background and hands back a `runId` for the caller to poll. The design mode defaults to `inline`.
When authoring is needed, `aideos_run_status` reports `status: "needs_look"`, `"needs_design"`, or `"needs_reel_cut"` alongside
actionable `nextSteps`. For `needs_look`, call `aideos_look_brief`, write `design/look.json` with
`aideos_write_file`, validate with `aideos_look_check`, then call `aideos_produce_film` again with the same
slug. For `needs_design`, read `design/BRIEF.md`, write `design/design.json` and its SVGs, compile with
`aideos_design_build`, then rerun `aideos_produce_film`. For `needs_reel_cut`, read `reel/REEL_BRIEF.md`, write
`reel/cut.json`, validate with `aideos reel check <slug>`, compile with `aideos reel build <slug>`, and rerun.
Run records live in the server process, so
`aideos_run_status` only knows about runs that process started; the durable record is
`videos/<slug>/run-state.json`, which is also what makes a restarted run resumable.

## Verification

The `verify` stage probes each rendered file with ffprobe, measures audio levels and silence with
ffmpeg, and writes a twelve-frame contact sheet sampled evenly across the whole duration to
`videos/<slug>/review/`. It records warnings rather than failing, so a run always produces something
to look at: wrong frame size, a picture length that differs by more than a second from the
narration plus that format's end card when enabled (`src/dl/delivery.ts`), a missing audio stream,
clipping, or more than two and a half seconds of silence during the story.

`analyseAudio` and `contactSheet` in `backend/pipeline/render.ts` are exported, so the same checks
can be run against any file.

## Preserve owner caption placement

`film.captionPlacement` and `shot.captionPlacement` hold independent `long` and `reel` cards.
Each card records normalized `x` (centre), `y` (top), `w` (width), and `locked`.
Missing placement fields retain the legacy centred bottom card. Missing `w` keeps the auto-width
shrink-to-content card after Lock, movement and shot-scope changes; the editor and collision checks
reserve its full 86% band. Explicit `w` values from 0 through 1 are clamped by format to the
minimum and maximum; omitted `w` remains auto-sized. A shot exception overrides its film-wide card only in the specified format, and the
renderer fixes placement and wrapping at each phrase's start.

Both film writers use `carryCaptionPlacement` in `src/dl/captionPlacement.ts`. Rebuilds preserve
omitted entries and cannot change locked entries. The studio's save endpoint is the owner writer,
so the studio owner may move or reset a locked caption, including through undo. The existing studio
endpoint trusts its local editor caller and has no separate authorization layer. Locks bind checked
agent edits and rebuilds, not owner writes. A rebuild that removes a shot with an owner exception
fails with `caption-placement` and names the shot instead of losing the exception.

Agents and the MCP AI edit flow use `set_caption_placement` through the transactional edit
interpreter. The operation takes `format`, `scope` (`{kind:"film"}` or `{kind:"shot",shotId}`),
and `placement` (`{x,y,w}` or `{preset:"top"|"middle"|"bottom"}`). Locked targets are refused.
