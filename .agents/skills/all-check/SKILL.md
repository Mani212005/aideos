---
name: all-check
description: Run the whole aideos video check on a film in a background agent - render long (16:9) and reel (9:16), measured review, Gemini 3.8 Flash review at the 9.0 bar, optional cross-review against a reference, fix and repeat - and report the scores and the final videos. Use when the user says "run all-check on <video>", "check this video end to end", "get <video> to 9.0 on both formats", or asks for the full review loop.
---

<!-- File Description: The all-check skill for Claude Code and Antigravity (agy): one request that launches the full aideos video check in a background agent and reports the result. -->

# all-check

One skill for the full check of a finished aideos film. It does not review in your session: it starts a
second agent in its own tmux window that renders, measures, reads the review feedback, edits the film and
repeats, while you stay free. You wait for its result file and then report the scores and the final videos.

## What it does (the pipeline it owns)

1. Renders the long cut (16:9) and the reel (9:16).
2. Measured checks (`aideos review`): OCR captions, readability, overlap, audio sync, pacing, loudness, camera.
3. Gemini 3.8 Flash review (`aideos gemini-review`, run through agy): 12-point rubric, 6 hard gates, 9.0 bar.
4. With `--reference <mp4>`: cross-review of the long cut against that video (it must win or tie).
5. The agent's own frame check: stills every few seconds, looking for clipping, overlap and off-frame content.
6. Fix, re-render, re-check. Order: get long to pass, then reel, then one final re-check of both.

A format passes only when the reviewer says 9.0+ with every gate passing AND the measured checks pass AND the
frame check is clean. The background agent never scores its own work. "All good" needs both formats to pass in one
final round on the same film. If the round budget (default 6) runs out first, it reports the best round and what still fails, restores that round's
film.json and keeps its renders as the final videos. A round that scores lower than the best so far is rolled back
automatically.

## How to run it

1. Work out from the request: the **slug** (the folder under `videos/`; if the user gave a title, run `ls videos` and pick the match, ask only if it is ambiguous), and optionally a **reference** mp4, a **round budget** and a **target** score.
2. Start it from the repo root. Do not pass `--agent` or `--model`: the background agent and model come from `aideos.config.json` (Claude Sonnet 5.5 generates and fixes, Gemini 3.8 Flash reviews), whichever agent you are running as. Gemini 3.1 Pro is refused for generation unless the user explicitly asks for it (`--agent agy --model gemini-3.1-pro-high --allow-forbidden-model`).

   ```bash
   aideos all-check <slug> [--reference <mp4>] [--rounds <n>] [--target <score>]
   ```

   If `aideos` is not on PATH, use `npx tsx backend/cli.ts all-check <slug> ...` from the repo root. The same command works from a plain terminal; there too the background agent is the one in `aideos.config.json`.
3. **If it prints "all-check cannot start"**: that is the preflight (agy signed in, video package, voiceover, ffmpeg, tesseract, tmux). Show the user that message with its exact fix and stop. Do not work around it, and do not start anything yourself.
4. **If it says all-check is already running** on that video: tell the user, point them at the window it names, and offer `aideos all-check wait <slug>`. One run per video at a time.
5. Otherwise it prints the tmux window, the brief and the result file. Tell the user the check is running and that `tmux attach` shows the agent working (they can step in).
6. Wait for the result: `aideos all-check wait <slug>` (polls the result file; prints each round as it lands). A run takes tens of minutes, so run it as a background command if your harness has one, and re-run it if it exits with 3 (still running).
7. Report from its output: for long and reel the reviewer score, whether each passed, the round used, the paths of `final-long.mp4` and `final-reel.mp4`, the report path (`videos/<slug>/all-check/report.md`), and, if it is not all good, exactly what still fails. Say plainly if it stopped on the round budget. Exit codes of `wait`: 0 all good, 1 not all good, 3 timed out (still running), 4 the agent window closed without a result. (If the agent goes quiet without finishing, `wait` closes the run itself from the measured records after 10 minutes of silence.)

On a pass the final videos open on their own and a macOS notification is sent; the tmux window stays open.

Do not edit the film yourself while the background agent runs, and never score the video yourself: only the tools' output counts.

## Output

Everything lands in `videos/<slug>/all-check/`: `brief.md` (what the agent was told), `report.md`, `result.json`,
`round-N/<format>.md|json` (scores, failures, feedback), the rendered `round-N/<format>.mp4`, the stills in
`round-N/<format>-frames/`, `backups/film.round-N.json`, and `final-long.mp4` + `final-reel.mp4`.

## Single commands (one-off use, no agent)

| Command | What it does |
|---|---|
| `aideos render` | Render the active film, 16:9, to `out/long.mp4` |
| `aideos reel` | Render the active film, 9:16, to `out/reel.mp4` |
| `aideos review <slug\|mp4>` | Measured checks only; writes `review.json`, exit 1 on a failed gate |
| `aideos gemini-review <mp4>` | Gemini 3.8 Flash review (agy), 12-point rubric, 9.0 bar |
| `aideos gemini-review <mp4> --pairwise <ref.mp4>` | Cross-review of two videos |
| `aideos review-loop <slug>` | Re-render and re-review up to N rounds, without editing the film |
| `aideos exit` | Stop the local studio |
| `aideos all-check status <slug>` | Where a run stands and the rounds so far |

`all-check` is these, composed, with an agent that fixes the film between rounds. Prefer it whenever the goal is a finished, good video.
