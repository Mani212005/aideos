---
name: all-check
description: Run the whole aideos video check on a film, fixing it in your own session - render long (16:9) and reel (9:16), measured review, Gemini 3.8 Flash review at the 9.0 bar, optional cross-review against a reference, fix and repeat - and report the scores and the final videos. Use when the user says "run all-check on <video>", "check this video end to end", "get <video> to 9.0 on both formats", or asks for the full review loop.
---

<!-- File Description: The all-check skill for Claude Code and Antigravity (agy): one request that sets up the full aideos video check and runs it in the session you are in. -->

# all-check

One skill for the full check of a finished aideos film. It starts no second agent: the session you run it from
(your own harness and model) renders, measures, reads the review feedback, edits the film and repeats, so the
fixes are made by the same agent that makes the film. A replacement agent is started only when no agent session
is running (for example from a plain terminal), and it inherits the harness and model recorded for the film.

## What it does (the pipeline it owns)

1. Renders the long cut (16:9) and the reel (9:16). Every render must carry music, sound effects and the end card; a film without them is refused with a message naming the missing piece (fix it with `aideos design build <slug>` after `aideos audio fetch`).
2. Measured checks (`aideos review`): OCR captions, readability, overlap, audio sync, pacing, loudness, camera.
3. Gemini 3.8 Flash review (`aideos gemini-review`, run through agy): 12-point rubric, 6 hard gates, 9.0 bar.
4. With `--reference <mp4>`: cross-review of the long cut against that video (it must win or tie).
5. The agent's own frame check: stills every few seconds, looking for clipping, overlap and off-frame content.
6. Fix, re-render, re-check. Order: get long to pass, then reel, then one final re-check of both.

A format passes only when the reviewer says 9.0+ with every gate passing AND the measured checks pass AND the
frame check is clean. The fixing agent never scores its own work. "All good" needs both formats to pass in one
final round, each matching its own current film hash, with the reel fitting the delivered cap including the end card. If the round budget (default 6) runs out first, it reports the best round and what still fails, restores that round's
film.json and reel package and keeps its renders as the final videos. A round that scores lower than the best so far is rolled back
automatically.

## How to run it

1. Work out from the request: the **slug** (the folder under `videos/`; if the user gave a title, run `ls videos` and pick the match, ask only if it is ambiguous), and optionally a **reference** mp4, a **round budget** and a **target** score.
2. Start it from the repo root. Do not pass `--agent` or `--model`: from your own agent session nothing new is started and you do the fixing with your own model; the Gemini 3.8 Flash reviewer comes from `aideos.config.json`. `--agent`/`--model` are for starting a replacement agent on purpose. Gemini 3.1 Pro is refused for generation unless the user explicitly asks for it (`--agent agy --model gemini-3.1-pro-high --allow-forbidden-model`).

   ```bash
   aideos all-check <slug> [--reference <mp4>] [--rounds <n>] [--target <score>]
   ```

   If `aideos` is not on PATH, use `npx tsx backend/cli.ts all-check <slug> ...` from the repo root. The same command works from a plain terminal if the default Herdr server is running. Inside Herdr it uses the current server. Herdr 0.8.0+ is required (`brew install herdr`); start `herdr` and detach with `ctrl+b q` before launching from a plain terminal.
3. **If it prints "all-check cannot start"**: that is the preflight (agy signed in, video package, voiceover, ffmpeg, tesseract; Herdr 0.8.0+ only when a replacement agent must be started). Show the user that message with its exact fix and stop. Do not work around it.
4. **If it says all-check is already running** on that video: tell the user, point them at the session or workspace it names, and offer `aideos all-check wait <slug>`. One run per video at a time.
5. **In-session (the normal case)**: it prints that no new agent was started and that this session runs the rounds. Read `videos/<slug>/all-check/brief.md` and follow it: run `aideos all-check round <slug> --format long`, read the reviewer's REVISE feedback in the command output, fix the film yourself, record the frame check, repeat, then reel, then the final re-check and `aideos all-check finish <slug>`. When a round is run from another terminal, its feedback is typed into this session's Herdr pane instead.
6. **Origin session still running (you ran it from a plain terminal)**: it prints that no new agent was started, runs the first round and says whether its review was sent to the live originating session. Do not start another agent.
6b. **Replacement agent (the recorded session is verified gone)**: it prints the Herdr workspace, the pane, the attach command, the brief and the result file, and says the replacement inherits the film's recorded agent and model. If no session is recorded it refuses and says to pass `--agent`/`--model`. Wait for the result: `aideos all-check wait <slug>` (re-run it if it exits with 3, still running).
7. Report from the result: for long and reel the reviewer score, whether each passed, the round used, the paths of `final-long.mp4` and `final-reel.mp4`, the report path (`videos/<slug>/all-check/report.md`), and, if it is not all good, exactly what still fails. Say plainly if it stopped on the round budget. Exit codes of `wait`: 0 all good, 1 not all good, 3 timed out (still running), 4 the agent pane closed or returned to its shell without a result. (If a replacement agent goes quiet without finishing, `wait` closes the run itself from the measured records after 10 minutes idle or blocked with no round running; a run in your own session is never closed that way.)

On a pass the final videos open on their own and a macOS notification is sent; the Herdr workspace stays open. The next start of the same film closes that previous workspace only when every pane is at an idle shell.

Never score the video yourself: only the tools' output counts. If a replacement agent is running, do not edit the film while it does.

## Output

Everything lands in `videos/<slug>/all-check/`: `brief.md` (what the agent was told), `report.md`, `result.json`,
`round-N/<format>.md|json` (scores, failures, feedback), the rendered `round-N/<format>.mp4`, the stills in
`round-N/<format>-frames/`, `backups/film.round-N.json`, and `final-long.mp4` + `final-reel.mp4`.

## Single commands (one-off use, no agent)

These render or download final videos, so run them only when the user explicitly asked for that in the terminal; the default is drafts and stills.

| Command | What it does |
|---|---|
| `aideos render` | Render the active film, 16:9, to `videos/<slug>/renders/long.mp4` |
| `aideos reel` | Render the active film, 9:16, to `videos/<slug>/renders/reel.mp4` |
| `aideos review <slug\|mp4>` | Measured checks only; writes `review.json` (or `review.reel.json`), exit 1 on a failed gate |
| `aideos gemini-review <mp4>` | Gemini 3.8 Flash review (agy), 12-point rubric, 9.0 bar |
| `aideos gemini-review <mp4> --pairwise <ref.mp4>` | Cross-review of two videos |
| `aideos exit` | Stop the local studio |
| `aideos all-check status <slug>` | Where a run stands and the rounds so far |

`all-check` is these, composed, with an agent that fixes the film between rounds. Prefer it whenever the goal is a finished, good video.
