<!--
File Description: Reference for the Aideos production pipeline - the single programmatic entry
point that takes a script to finished mp4s, the stages it moves through, how resuming works, and
the MCP tool surface that exposes the same thing to an agent.
-->

# Production pipeline

One call turns a narration script into a finished film in both deliverable formats.

```ts
import { runProduction } from "./backend/pipeline/run";

const result = await runProduction(
  { script, title: "Speculative Decoding", slug: "speculative-decoding", broll: true },
  (event) => console.log(event.stage, event.status, event.message, event.progress),
);

result.outputs; // [{ format: "long", path: "out/speculative-decoding-long.mp4", ... }, ...]
```

The same thing from a terminal:

```bash
npm run backend -- film \
  --script-file videos/speculative-decoding/script.md \
  --title "Speculative Decoding" \
  --slug speculative-decoding \
  --broll --formats long,reel
```

`runProduction` is the only entry point that needs to be called. Everything below it is an
implementation detail, and every type it takes or returns lives in `backend/pipeline/types.ts`.

## Stages

| Stage      | What it does                                                                        | What it writes                                     |
| ---------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| `intake`   | Parses the screenplay, rejects an empty or unparseable one                            | `videos/<slug>/script.md`                           |
| `narrate`  | Synthesizes narration and derives the timing spine every later stage is locked to     | `voiceover.wav`, `captions.vtt`, `voiceover_words.json`, `narration.json` |
| `design`   | Compiles the screenplay plus the spine into a validated film, picking each shot's visual with Jev (heuristic fallback) | `film.json` and its `src/dl/films/<slug>.ts` shadow |
| `broll`    | Renders GPU footage for the flagged shots and fetches the clips                       | `videos/<slug>/footage/<shotId>.mp4`                |
| `assemble` | Wires each clip into its shot as a full-screen inset                                 | `film.json` and its `src/dl/films/<slug>.ts` shadow |
| `render`   | Installs the film as active and drives Remotion for each requested format            | `src/dl/activeFilm.ts`, `out/<slug>-long.mp4`, `out/<slug>-reel.mp4` |
| `verify`   | Probes the rendered files and writes contact sheets across the whole duration         | `out/review/<slug>/<format>-sheet.jpg`              |

Progress arrives through the second argument to `runProduction`: one `ProductionProgress` per
event, carrying the stage, its status, a human-readable message, an optional 0..1 fraction within
the stage, and milliseconds since the run began.

A failure throws a `ProductionError` whose `stage` field names where it happened, so a caller
never has to guess which part of the chain broke.

## Resuming

Every stage records a fingerprint of its inputs in `videos/<slug>/run-state.json`. On the next run
with the same slug, a stage whose fingerprint still matches and whose outputs are still on disk is
skipped. Change the script and narration re-runs; change nothing and a crashed run picks up where
it stopped. `resume: false` ignores the cache entirely, and `force: ["design"]` re-runs one stage
while reusing the rest.

`stopAfter` ends a run cleanly after a named stage, which is how you inspect the film design before
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
offsets are exact and nothing is stitched across a sample-rate or channel-layout mismatch. See
`backend/pcm.ts` for the sample-domain helpers and `backend/voiceover_stutter.test.ts` for the
defect classes that are held closed by regression tests.

Backends live in `backend/tts.ts`. Kokoro-82M runs locally through ONNX with no API key and is the
default; `AIDEOS_TTS` or the `ttsBackend` option pins `google`, `say` or the offline `tone`
placeholder instead. Kokoro runs in a separate process (`backend/kokoroWorker.mjs`) because it
resolves its voice files relative to its own module directory and because the ONNX thread pool
aborts the process on teardown when loaded inside the TypeScript loader.

## B-roll

Shots are flagged for footage by a `[VISUAL]` beat containing a footage marker (`B-roll:`,
`footage`, `live action`, `cinematic plate`). The design stage only accepts a beat whose narration
fits inside one clip with a second to spare - a clip shorter than its shot renders black for the
remainder - and spreads the remaining budget across the film rather than bunching clips together.

Rendering runs through `backend/engine/`; see `backend/engine/RUNBOOK.md` for the GPU box. Verify
the loop before a full run:

```bash
npm run backend -- engine-test "<prompt>" --engine ssh-wangp --seconds 5
```

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
| `aideos_get_pending_tasks`| Fetch pending directing, voiceover, screenplay, and editing tasks.         |
| `aideos_claim_task`      | Claim a pending task to begin execution and prevent hybrid fallback.       |
| `aideos_complete_task`   | Mark a claimed agent task as completed with summary and execution results. |
| `aideos_report_step`     | Report execution step, tool call, or validation check to live Agent Trace. |

A full render takes tens of minutes, so `aideos_produce_film` never blocks: it starts the run in
the background and hands back a `runId` for the caller to poll. Run records live in the server
process, so `aideos_run_status` only knows about runs that process started; the durable record is
`videos/<slug>/run-state.json`, which is also what makes a restarted run resumable.

## Verification

The `verify` stage probes each rendered file with ffprobe, measures audio levels and silence with
ffmpeg, and writes a twelve-frame contact sheet sampled evenly across the whole duration to
`out/review/<slug>/`. It records warnings rather than failing, so a run always produces something
to look at: wrong frame size, picture and narration lengths disagreeing by more than a second,
a missing audio stream, clipping, or more than two and a half seconds of silence.

`analyseAudio` and `contactSheet` in `backend/pipeline/render.ts` are exported, so the same checks
can be run against any file.
