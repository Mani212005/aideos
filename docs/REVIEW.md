<!--
File Description: Documentation and usage reference for aideos deterministic video checks, Gemini 3.8 Flash video reviews, and the all-check review and repair loop.
-->

# aideos review: deterministic checks and Gemini 3.8 Flash review

Video quality verification in Aideos operates on two connected layers, and `aideos all-check` (section 3) runs
both, on the long cut and the reel, with an agent that fixes the film between rounds:
1. **Deterministic Checks (`aideos review`)**: Precise numerical measurements (OCR caption-card coverage, layout correlation, audio loudness, camera motion frequency).
2. **Gemini 3.8 Flash Native Review (`aideos gemini-review`)**: Full multimodal video and audio evaluation against the 12-criterion rubric, requiring a score of 9.0+ out of 10.0 (the mean of the individual criteria scores, see the verdict policy in section 2) with all 6 hard gates passing for acceptance.

---

## 1. Deterministic Review (`aideos review`)

`aideos review <slug|mp4>` measures a rendered video against the measurable half of the good-video
rubric and writes `review.json` (or `review.reel.json` for a reel) plus evidence frames. It is deterministic (same video, same report),
needs only `ffmpeg`, `ffprobe` and `tesseract`, and works on any mp4, not just aideos films. It is
the numbers layer: the Gemini review loop reads the same JSON as context and judges what numbers
cannot (story, whether two things are the same object, whether an animation shows its claim).
When film data is supplied, it must match the reviewed format: long reviews use the long film and reel reviews use the derived reel film (or the shared long film for an identity reel). Stage facts describe that format's whole timeline.

```bash
aideos review hnsw-explainer                       # slug: reviews every rendered format (long and reel)
aideos review hnsw-explainer --format reel          # explicit format (long or reel)
aideos review path/to/video.mp4 --film film.json --words voiceover_words.json
aideos review video.mp4 --words script.json        # narration text only: caption match and number grounding, no timings
aideos review hnsw-explainer --format reel --pacing-profile reel-fast   # opt-in reel pace window (up to 200 wpm)
npm run review -- <slug|mp4> [--format long|reel] [--pacing-profile reel-fast] [--json] [--no-ocr] [--out dir]
```

Exit code: `0` all gates passed, `1` a gate failed, `2` the review could not run (missing file,
no ffmpeg). Output: `<out>/review.json` for long, `<out>/review.reel.json` for reel (a slug writes into `videos/<slug>/`, an mp4 into
`.frames/review/<name>/`, `--out` overrides) and `<out>/review/<criterion>-<seconds>s.jpg` (or `<out>/review.reel/` for a reel) for the
moments behind each failed criterion. The schema is `ReviewReport` in `backend/review/types.ts`.

### What it measures

| # | Criterion (gate in bold) | Measured from | Pass when |
|---|---|---|---|
| 1 | **One persistent stage** | pixels (ink layout correlation with 2 s earlier, stage-clear events) and film data (beats that keep the previous elements on stage) | median correlation >= 0.65, <= 2.2 stage clears per 30 s, >= 60% of beat boundaries keep their elements |
| 2 | Carry-over with transformation | film data only: an element stays across a beat boundary and is transformed | >= 1 per 20 s |
| 13 | Look plan adherence | when `design/look.json` is available, scene motion, carried objects, camera poses, device spacing and stage treatment are checked against the plan as a non-gate score; on a character film each planned performance is checked by its evaluated contact frame against its decisive word (anticipation may start earlier, no clip at the cue is needed), its character id and version, and its actor and prop on stage in this output | all planned shots follow the plan; this rendered-output score remains non-gating until calibrated on the proof and two or three more films. Design build acceptance is a separate gate; see [Production pipeline](PRODUCTION_PIPELINE.md#look-and-design-delivery) |
| 3 | Cues aimed at spoken words | film clips against word timings, compared with chance; declared Three performances contribute their evaluated contact events | clip starts and performance contacts land on word starts clearly more often than chance |
| 4 | **Camera that does something** | film data only (the solved framing of each shot, or a scene camera track) | >= 1 move per 20 s, none faster than 20% of the frame width per second (a scene camera also fails the design check on a zoom jump over 0.8% a frame or a pan acceleration over 0.3 widths per second squared) |
| 5 | **Captions at placed position (default bottom)** | OCR of full-resolution frames every 2 s | caption band in its declared rectangle (bottom quarter when absent) in >= 60% of narrated moments, <= 2 lines, words match the narration |
| 6 | **Readability** | OCR box height (normalised to a 1080 short side) and pixel contrast | <= 58% of words under 18 px, <= 10% under 3:1 contrast |
| 7 | **No overlap or clipping** | OCR boxes overlapping, text inside the edge margin, canvas node overlap | <= 10% of sampled frames affected |
| 8 | **Audio sync** | audio vs video length, film length, shot boundaries vs word timings | lengths within 0.1 s, no shot boundary through a spoken word |
| 9 | Pacing | compiled stage motion plus frame difference (static holds, hard cuts), word timings or silence (dead air, pace) | no story hold over 3 s, <= 2 hard cuts per minute, no pause over 0.7 s, 120 to 180 wpm |
| 11 | Numbers grounded in narration | OCR numbers vs spoken numbers (digits and number words) | every on-screen number is said |
| 12 | Loudness and mix | `ebur128` on the delivered MP4; when film soundtrack data is available, isolated music and narration stems over 400 ms windows overlapping speech on the shared voice activity timeline | -18 to -14 LUFS, true peak <= -1 dBFS, and music at least 12 dB below narration (design target 18 dB) |
| 14 | **Reel delivered length** | video container, audio stream and picture durations | <= 179 s including the end card (measured duration within DELIVERY_CONFIG.reel.maxSec); evaluated on reel reviews |
| 15 | Reel hook | timed narration words (`punctuated_word` for sentence ends) | first word starts under 0.3 s, first sentence is 10 to 16 words, no greeting or intro opener; evaluated on reel reviews, non-gating |

### Stage timeline and stillness

`backend/stageTimeline.ts` owns `moving` / `holding` spans inside `story` / `end-card`
segments. It reads compiled scene and camera data in each output crop, so no video render is needed.
Design checks reject a story hold longer than three seconds with its times, format and shot ids.
Hidden or off-frame SVG animation does not count as motion. SVG rendering uses the shared
authored/animated opacity resolver; continuity and stage/review visibility use that resolver with
the shared 0.05 cutoff.

Inset checking uses the same 0.05 visibility cutoff. Before this change, an inset SVG element at
opacity 0.1 was ignored as faint art; it now counts as visible and can fail when it overlaps the
device inset region.

Measured pacing combines these scene spans with pixel freeze measurements. Both are clipped to the
story before applying the same three-second limit. A run crossing into the end card keeps only its
story portion; the fixed end-card hold is intentional. Gemini receives these same timeline facts,
and verification uses the same story boundary for silence. Films without a compiled scene still
receive pixel freeze checks. Geometry does not establish occlusion or judge animation craft.

### Reel hook (criterion 15)

`hook` runs on reel reviews only and never gates. It reads the narration's timed words: the first word's
start, the number of words up to the first sentence end (`.`, `!` or `?` on a word's `punctuated_word`,
ignoring abbreviations such as "U.S."), and whether the first sentence opens with a greeting or intro
("hey", "welcome", "in this video", "today we", "let's talk about", and similar; the list is
`GREETING_OPENERS` in `backend/review/criteria.ts`). Thresholds are `THRESHOLDS.hook` in
`backend/review/thresholds.ts`. It is `skipped`, never a pass, without timed narration or when the
words carry no sentence punctuation (a bare Whisper word list), because the first sentence then cannot be
measured. The writing rule it enforces is the [Reel hook](DIRECTOR_GUIDE.md#reel-hook) section of the director guide.

The thresholds come from the reference-video study (first word at 0.0 s, 10 to 16 word opening
statements), not from the three calibration videos, which are long cuts the check never runs on. Re-measure
on real reels before changing a value.

### Reel pacing profile (opt-in)

Criterion 9 keeps its 120 to 180 words per minute window for every review. A reel review may opt into
the `reel-fast` profile (`--pacing-profile reel-fast`, or `pacingProfile` on a `ReviewRequest`), which
raises only the upper bound to 200 words per minute (the study measured references at 192 and 202 wpm).
The lower bound is unchanged, the profile is ignored on a long review, and a report that used it records
`pacingProfile` in the pacing metrics and the window in its thresholds. Profiles live in
`THRESHOLDS.pacingProfiles`.

A character film (Three stage) is measured in the reviewed output's own crop: a cast member is on
stage when at least half of its projected posed box (outline included) lies inside that output, a
cast member no performance draws is hidden and never present, and the camera is the compiled track
projected into that output, so a pan can be a move in the reel and drift in the wide cut. Each
performance's contact is the first frame its own evaluator holds the prop; the recorded cue frame is
never trusted. `review.json` carries `stageTruth` for that output (characters drawn with id, version,
rig, and hash, hidden cast, per-shot presence, contact against the cue, camera, and the list of what is
unmeasured: pixel visibility and final occlusion, face appeal, finger contact, silhouette and weight).
Presence is projected geometry, not pixels.

Criterion 10 (storyline) is not deterministic and is left to the model judge. A criterion whose
inputs are missing is `skipped`, never `pass`: the camera is never guessed from pixels, carry-over is
never measured by pixel overlap in place, and captions are skipped for a silent video with no
narration. Every threshold lives in `backend/review/thresholds.ts`.

For a film with configured soundtrack music, criterion 12 measures music against narration from the
review mixer's isolated stems, considering only 400 ms windows with any speech overlap according to
the shared voice activity timeline documented in [Audio Library and Management Commands](AUDIO_LIBRARY.md#2-soundtrack-mixing).
Missing or unusable stem data fails the mix criterion instead of silently passing it. A film with no music skips this part
of the criterion. MP4 loudness and true peak are measured from the delivered file, including any
post-render mastering. The delivery master targets -16 LUFS integrated within 0.5 LU and -1 dBTP;
the review rubric keeps its wider -18 to -14 LUFS acceptance window.

### Two design constraints from the audit

- **Carry-over is not pixel overlap.** Overlap in place rewards a diagram that simply sits still
  (it scored the rejected video higher), so carry-over comes from element identity in film data.
- **Camera is not phase correlation.** A static dot grid and HUD dominate global correlation and hide
  every real camera move, so the camera comes from film data. A foreign mp4 reviewed without
  `--film` reports the camera as `skipped`.

### Trust a pixel-derived reference metric only after a second method

A metric measured from pixels (camera motion, ink coverage, stillness, contrast, edge density) is a
hypothesis until a second, different measurement method agrees with it. Do not put it into a style target,
a look brief or a threshold on one pass. The reference study's first camera tool called a video 80% still;
a second method on the same frames found 65% of it moving, and a style target built from the first answer
would have encoded a wrong rule. This is the same lesson as the two design constraints above (global phase
correlation hid every real camera move). Confirm with a method that fails differently (film data against
pixels, a multi-tile sub-pixel correlation with captions masked against a global one) and record both numbers.

### Calibration

`npm run calibrate:review` re-runs the three reference videos and fails unless the tool still
reproduces their recorded ordering and gate outcomes. The mp4s are the captain's own and are not in
the repo: point `AIDEOS_CALIBRATION_A` (the preferred explainer), `AIDEOS_CALIBRATION_B` (the
selected comparison explainer) and `AIDEOS_CALIBRATION_RAG` at them, optionally with `AIDEOS_CALIBRATION_A_WORDS`,
`AIDEOS_CALIBRATION_B_FILM` and `AIDEOS_CALIBRATION_B_WORDS`. Measured on 2026-10-01:

| | A (preferred) | B (selected comparison) | RAG |
|---|---|---|---|
| layout correlation, median | 0.85 | 0.69 | 0.50 |
| stage clears per 30 s | 1.7 | 2.6 | 5.5 |
| caption coverage | 81% | 0% | 0% |
| words under 18 px | 51% | 66% | 62% |
| hard cuts | 0 | 0 | 8 |
| gates | all pass | persistence (stage clears), camera, captions, readability fail | persistence, captions, readability fail |

The persistence pixel cutoff is 0.65: A (0.85), selected reference B (0.69), and the captain-
accepted DNS film (0.68 on the final render; 0.69 in the independent recomputation) pass the layout
correlation cutoff, while RAG (0.50) fails. This leaves a measured 0.15 gap on either side of the
cutoff. While reference B passes the layout correlation cutoff (0.69 >= 0.65), it still fails the
persistent-stage gate on stage clears per 30 s (2.6 > 2.2). Stage-clear and element-boundary carry
thresholds still independently catch clears and lost film objects. The DNS reading comes from the
2026-10-12 production report, sections 4 and 5.

Re-run it after changing any threshold or the pixel analysis; the thresholds were set between A and
the others with margin, and the rubric's 95% caption target is not met even by A at 2 s sampling
(captions change between samples), so the gate is 60%.

---

## 2. Gemini 3.8 Flash Video Quality Review (`aideos gemini-review`)

`aideos gemini-review <video.mp4>` evaluates a rendered mp4 video with native Gemini 3.8 Flash video and audio understanding.

```bash
aideos gemini-review videos/hnsw-explainer/renders/long.mp4
aideos gemini-review videos/hnsw-explainer/renders/reel.mp4 --film videos/hnsw-explainer/film.json
aideos gemini-review videoA.mp4 --pairwise videoB.mp4
aideos gemini-review video.mp4 --json > review.json
```

With `--json`, stdout contains only the JSON report; progress is sent to stderr. Exit code `0` means
`ACCEPT`; exit code `1` means `REVISE` or that the review command could not complete. When invoking
through npm (`npm run backend -- gemini-review`), use `npm run --silent` so npm's lifecycle banner does
not precede the JSON document.

The single-video judge reads its rubric, measured facts and JSON format from `review-brief.md` in
the isolated workspace, then watches `video.mp4`. JSON is requested in text because agy's
`--json-schema` can return empty content. Empty successful replies fail immediately.
The default reviewer model and its override order are listed in [section 5](#5-video-model-policy).
`AIDEOS_AGY_TIMEOUT` sets the hard deadline in seconds (default 1800). On POSIX,
`AIDEOS_AGY_IDLE_TIMEOUT` optionally enables idle termination in seconds; it is disabled by default
because a healthy remote model request can be quiet. When enabled, the idle check requires no stdout
or process-group CPU growth. If CPU measurement is unavailable, the hard deadline still applies. A stopped review
sends SIGTERM to the process group (or process tree on Windows), then SIGKILL after one second;
parent exit also kills the remaining tree.

### How it works
1. **Direct Video Inspection in Isolated Workspace via agy CLI**: Invokes the configured agy reviewer non-interactively in print mode with `--sandbox` within an isolated temporary directory using neutral filenames (`video.mp4` for single review and pairwise comparisons) and explicit directives to evaluate only the visual and audio stream without writing scripts, extracting frames, or accessing repository files.
2. **Deterministic Facts Extraction**: Gathers ground-truth data (caption-position OCR coverage, audio LUFS loudness, duration, framerate, camera track from `film.json` including declared `scene.camera` keyframes, and per-shot look plan facts from `design/LOOK.md` when present) and feeds them into the model prompt to prevent hallucinations.
3. **Structured Rubric Evaluation**: Grades all 12 criteria on a 0.0 to 10.0 scale, checking the 6 hard gates (persistent stage, camera purpose, captions at their placed position, readability, no overlap/clipping, audio sync).
4. **Timestamp Evidence Enforcement**: Validates that every criterion score includes concrete timestamp citations (e.g. `00:14`, `01:02`) within the video bounds. A criterion still without evidence after the last attempt is failed as unmeasured and the verdict is `REVISE`: missing evidence is never a pass.
5. **Verdict Decision** (the verdict policy, `backend/geminiReview/verdictPolicy.ts`; the captain's option C):
   - A draw's score is the **mean of its individual criteria scores**, computed by the tool. The reviewer's own overall number is kept in the report as `overallScore` for the record and never decides: on the 0.5.0 evidence the twelve criteria averaged 8.81 where the reviewer wrote 8.6.
   - When that mean is **within 0.5 of the 9.0 bar** (8.5 up to 9.5, both ends included) and the draw could still be an ACCEPT (no failed hard gate, every criterion carries timestamp evidence), **exactly one second draw** of the same video runs, never a loop, so a review has at most two scored draws (each draw may still retry its reviewer call for invalid JSON or missing timestamps, up to the existing attempt limit). A draw outside the band is settled alone, with one scored draw. If the second draw cannot run, the review is unfinished (an error), never a pass on one in-band draw.
   - With two draws the **combined score is the mean of the two draw scores**. `ACCEPT`: combined >= 9.0 and all 6 hard gates passed and every criterion had timestamp evidence in **both** draws. `REVISE`: anything else. With one draw the same rule applies to that draw alone.
   - The bar (9.0), the six hard gates and the timestamp rule are exactly as before; only how the score is computed and when a second draw runs changed. A failed hard gate still holds a draw's score at 8.5.
   - Worked example, release 0.5.0 (long film): the same bytes were ACCEPT 9.2 and then REVISE 8.6, both the reviewer's own numbers. In the second draw the criteria averaged 8.81. Say the first draw's criteria also averaged 9.2: that is inside the band, so a second draw runs, and the combined score is (9.2 + 8.81) / 2 = 9.005, which is >= 9.0, so with the gates and timestamps passing the verdict is `ACCEPT`. Had the second draw's criteria averaged 8.6, the combined score is 8.9 and the verdict `REVISE`. A first draw averaging 9.6 is an `ACCEPT` on its own and one averaging 8.4 a `REVISE` on its own, each with one scored draw. (The 0.5.0 evidence records only the reviewer's own number for the first draw, so its criteria mean is assumed here to match it.)
   - Both draws, their scores and how many scored draws ran are printed by `aideos gemini-review` ("Draws: ...") and stored in the report (`draws`, `criteriaMeanScore`, `drawNote`). Every computed score (gemini-review output, all-check rounds and summary, the acceptance summary and Export dialog) is shown by one formatter, `formatScore`: one decimal when the score is exact at one decimal (9.3), otherwise cut (never rounded up) to two decimals (8.97), so a score under the bar never reads as reaching it.
6. **Prioritized Feedback**: Generates actionable, timestamped recommendations (high, medium, low priority) on how to improve the video.
7. **Stage facts (character films)**: the facts name the stage as the measured review sees this output, in plain words (`backend/review/stageTruth.ts`): characters drawn, hidden cast, what is projected in frame per shot, each contact against its decisive word, the camera in this crop, and what no tool measured. The prompt says those facts locate geometry, not pixels, and that face appeal, finger contact and occlusion are judged from the video or not at all. Without a probed output size the stage facts and the stage camera are reported as not measured.
8. **Look Plan Check (unscored)**: If `design/LOOK.md` is present in the film package, Gemini compares each shot's planned treatment, carried objects, and cue against the video, logging any mismatch with timestamps in feedback without changing the 12 criterion scores or the verdict.

### Cross-Review Pairwise Comparison (`--pairwise`)
To eliminate model position bias and multimodal cross-alignment hallucinations when comparing two videos (e.g. comparing Aideos output against an external benchmark), `--pairwise` runs a dual-agent cross-review process:
1. **Watch Phase**: Two separate agy agents watch each video individually in isolated temporary workspaces and generate a structured JSON evaluation report (rating, likes, dislikes, neutral, timestamps).
2. **Exchange Phase**: Each agent resumes its conversation and reads the *other* video's evaluation report, scoring the competing video purely on its text-based merits.
3. **Final Scoring**: The final score for each video is the average of its watcher's rating and the competing agent's peer rating. The winner is the video with the highest average score.

---

## 3. The whole check in a background agent (`aideos all-check`)

`aideos all-check <slug>` is the single command (and the `all-check` skill, see below) that takes a film to
"good" on **both formats**: it composes render, `aideos review`, `aideos gemini-review`, the pairwise
cross-review and the fix-and-repeat loop.

All-check also maintains `videos/<slug>/acceptance.json`, with one acceptance record for each format. Each
record binds the measured result and judge draws to the hashes of the film manifest and rendered MP4, so a
changed film is reported as stale and an earlier verdict does not apply. Measured gates settle first; the
latest judge draw for the same MP4 determines the judge result, and each new draw is retained. A review whose
first draw was within 0.5 of the 9.0 bar appends its second draw to the same record (keys `round-N` and
`round-N-draw-2`); the second carries the combined score and the decision over both (section 2, verdict
decision), and the Export summary says in words that the reviewer was asked twice and which number decided.
Draws of separate reviews that disagree are still reported as a disagreement, without changing that verdict rule. Export status is summarized
against the film supplied by Studio, and may change if export preparation changes the film. See the [Studio
workflow](WORKFLOW.md#4-interactive-web-studio-workflow-editor) for what the Export dialog displays.

```bash
aideos all-check hnsw                                     # defaults: 6 rounds, 9.0 target
aideos all-check hnsw --reference ref.mp4 --rounds 8 --target 9.2
aideos all-check hnsw --agent claude                      # background agent: claude or agy
aideos all-check wait hnsw                                # block until the result file exists, print scores and paths
aideos all-check status hnsw                              # rounds so far
```

### What happens

1. **Preflight** (before any agent starts; one message listing each problem with its exact fix): the video
   package, its voiceover, ffmpeg/ffprobe, tesseract, Herdr 0.8.0+ with a reachable server, the background agent's CLI, and the agy login (the
   Gemini review runs plain `agy`, checked with `agy models`).
2. **One run per video.** `videos/<slug>/all-check/lock.json` records the Herdr socket, workspace and pane running the agent. A second
   run is refused and pointed at it. A pane that is gone or has returned to its shell makes the lock stale.
   If Herdr cannot confirm pane or process state, all-check keeps the lock and reports the query error with a retry hint;
   it never treats an indeterminate result as stale.
   A tmux-era lock is refused with its exact deletion path; remove it only after that old run is over.
3. **Launch.** The brief (`all-check/brief.md`, readable, it is exactly what the agent is told) and `launch.sh`
   are written and a new unfocused Herdr workspace named `all-check: <slug>` starts the agent with all permissions pre-approved: `claude
   --model <model> --dangerously-skip-permissions "<prompt>"` or `agy --model <model> --prompt-interactive "<prompt>"
   --dangerously-skip-permissions`. The agent and model come from the video model policy in `aideos.config.json`
   (see "Video model policy" below): Claude Sonnet 5.5, whichever agent invoked all-check. Only `--agent` / `--model`
   change it for one run. Inside Herdr, the workspace opens on the caller's server. From a plain terminal,
   it opens on the running default server. If no server is reachable, preflight tells you to start `herdr`
   and detach with `ctrl+b q`. Install Herdr with `brew install herdr`.
   Click the workspace or use the printed server-specific `herdr agent attach` command to watch or step in.
   `launch.sh` exports the caller's `HOME`, `PATH`, `AIDEOS_VIDEOS_DIR` and review model variables before starting
   the agent. Each Gemini review remains a bounded headless `agy -p` child process.
4. **The agent runs the loop** with these commands (all `aideos all-check <sub> <slug>`, also spelled
   `all-check-<sub>`): `round --format long|reel|both` renders through Remotion, backs up `film.json`
   and the reel package (`all-check/backups/`), runs the measured review and the Gemini review (the measured `review.json` or `review.reel.json` is handed to
   the reviewer as context), runs the cross-review for the long cut when `--reference` was given, and extracts stills
   every 4 s. Each render points Remotion at the requested film package and restores the previous active-film
   selection afterward, including when rendering fails. `frames --round N --format F --clean | --issue "..."` records the agent's own frame check;
   `rollback --round N` restores a backup; `finish` closes the run. Order: long until it passes, then reel, then one
   final `round --format both`. Two rules are enforced by the tool, not the prompt: a round that scores lower than
   the best earlier round (compared on the formats both measured) restores that round's `film.json` and reel package automatically
   and says "ROLLED BACK"; and a new round is refused until the previous round's frame check is recorded.
5. **Pass** = per format, the reviewer's score (the mean of the criteria scores, over both draws when two ran, section 2) is at least the target (9.0) with every hard gate passing, AND
   the measured checks pass (`aideos review`: no failed gate; soft failures are listed, not blocking), AND (long
   only) the cross-review against the reference is a win or a tie, AND the agent's frame check is clean. The agent
   never scores its own work and never writes the round records: a tool that cannot run (agy signed out, quota)
   is recorded as an error, never a pass. **All good** = one round holds a passing long and a passing reel, each at
   its own current film hash when `finish` runs (long at `film.json`, reel at `reel/film.json` or the shared film for
   an identity reel), and the reel fits the delivered length cap including the end card.
6. **Stop.** After the round budget (`--rounds`, default 6; a round past it is refused) `finish` reports the best
   round honestly and everything that still fails. When the run did not pass, `finish` also restores the best
   round's `film.json` and reel package (the replaced long manifest is kept as `all-check/backups/film.before-finish.json`; per-round reel packages remain under `all-check/backups/`) and keeps
   that round's renders as `final-long.mp4` and `final-reel.mp4`, so the package ends on the best film, not the last
   experiment. An interactive agent that stops at a summary without running `finish` is covered twice: the launch
   script runs `finish` if the agent process exits, and `all-check wait` closes the run itself from the measured
   records after 10 minutes (`--idle-min`) idle or blocked with no round running for this film. A working
   status resets the timer. Unknown agent status falls back to screen changes. A blocked agent prints an
   attach hint once. The workspace stays open for reading. On the next start of the same film, aideos closes
   its previous workspace only if every pane is provably at an idle shell.
7. **Result.** `videos/<slug>/all-check/` gets `report.md`, `result.json`, `round-N/<format>.md|.json` (scores,
   failures, reviewer feedback), the reviewer and measured reports, the rendered `round-N/<format>.mp4`, the stills
   `round-N/<format>-frames/`, `backups/film.round-N.json` and `backups/reel.round-N/`, and `final-long.mp4` + `final-reel.mp4`. A macOS notification is sent; on a pass the
   final videos open. `aideos exit` logic runs only if the studio was not already running when all-check started.
   `aideos all-check wait` exits 0 all good, 1 not all good, 3 still running at the timeout, 4 the agent pane
   closed or returned to its shell without a result.

### Rules for the background agent

It works in the main aideos folder on `videos/<slug>/` only (`videos/` is gitignored, so a git worktree would
not contain the video). A fix that needs aideos code (`src/`, `backend/`, `editor/`) goes into a treehouse worktree
and a PR, never edits on main. Scratch files (patch scripts, notes) belong in `all-check/scratch/`, never the repo
root: `launch` records the repo's dirty paths in `all-check/repo-baseline.json`, and each `round` and `finish`
lists anything new outside the package as a rule violation (in the round output, `report.md` and `result.json`).
Read `design/LOOK.md` first: a fix may change motion freely, but changing a shot's treatment or the cast means
editing `look.json` and passing `aideos look check` before the next round.

### The skill

`.agents/skills/all-check/SKILL.md` is the skill for Claude Code (`.claude/skills` is a link to `.agents/skills`)
and Antigravity (agy reads `.agents/skills/` of the project it is started in; confirmed with a real run). Asking
"run all-check on hnsw" starts the command above, waits for the result file and reports the scores and the final
video paths. The skill also lists the single commands (`aideos render`, `reel`, `review`, `gemini-review`,
`exit`) for one-off use.

---

## 4. The 12-Criterion Rubric

| # | Criterion | Hard Gate? | Description |
|---|---|---|---|
| 1 | **persistent_stage** | Yes | One unified visual stage; elements persist and evolve across beats; stage-clears <= 1 per 30s. |
| 2 | carry_over_transform | No | Named elements carry over across beat boundaries and change position, scale, shape, or role. |
| 3 | visible_cause_effect | No | Mechanism claims have animations starting within 0.4s of spoken keywords that visually demonstrate the claim. |
| 4 | **camera_purpose** | Yes | Active, purposeful camera moves (>= 1 move per 20s) framing content naturally without disorienting drift. |
| 5 | **bottom_captions** | Yes | Clean burned-in captions at the owner-declared card position (default: bottom 20-22% of the frame) for >= 95% of speech, readable size (>= 36px), matching spoken audio. |
| 6 | **readability** | Yes | High contrast (>= 4.5:1), clear font hierarchy (>= 24px), sufficient reading duration (>= 0.35s per word). |
| 7 | **no_overlap_clipping** | Yes | No text-text or text-artwork overlapping; all essential elements stay within the 96px safe margin. |
| 8 | **audio_sync** | Yes | Story cues synchronize with voiceover within 120ms; the audio and delivered picture durations agree within 100ms, including the end card. |
| 9 | pacing | No | Dynamic progression (see [Stage timeline and stillness](#stage-timeline-and-stillness)), mean beat length 5-12s, no dead air > 0.7s, speech 130-170 wpm. |
| 10 | storyline | No | Clear problem statement, logical progression where beats build on previous content, satisfying payoff beat. |
| 11 | accuracy_honesty | No | Every number, chart, and label is grounded in the narration; zero fabricated numbers or misleading visuals. |
| 12 | loudness_mix | No | Audio loudness normalized to -14 to -18 LUFS integrated, true peak <= -1 dBFS, background music ducked cleanly. |

Supplemental: When `design/look.json` is available, `aideos review` also reports supplemental criterion 13 (`plan-adherence`: Look plan adherence) as a non-gating rendered-output check (non-gate until calibrated on the proof and two or three more films). This review score is separate from the design build gate; see [Production pipeline](PRODUCTION_PIPELINE.md#look-and-design-delivery). For reel reviews, deterministic facts also enforce the hard gate `reel_length`: container duration <= 179 s including the end card. This gate overrides any model pass when exceeded.

Run `npm run eval:look -- --plans <look.json-or-directory> [--min percent]` before changing look-treatment criteria wording.

## 5. Video model policy (`aideos.config.json`)

The committed `aideos.config.json` at the repo root is the one place the video models are written down
(loader: `backend/aideosConfig.ts`):

| Role | Agent | Model | Read by |
|---|---|---|---|
| Generation and fixing | `claude` | `claude-sonnet-5-5` | `aideos all-check` (background agent launch command), server look and design (`backend/aideosConfig.ts`) |
| Reviewer | `agy` | `gemini-3.8-flash-low` | `aideos gemini-review`, `aideos all-check`, `--pairwise` (an explicit model option, then `AIDEOS_GEMINI_REVIEW_MODEL` / `GEMINI_MODEL`, still win) |

Gemini 3.1 Pro is not part of this: `forbiddenGenerationModels` lists `gemini-3.1-pro`, and `all-check` refuses it
(exit 2, with the message naming the override) unless the run passes `--allow-forbidden-model`. Per-run overrides:
`aideos all-check <slug> --agent agy --model <id>`. `--agent agy` without `--model` runs the configured reviewer model,
never agy's own default. A missing or malformed config is an error, not a silent default.

## Dots stage evidence

`review.json` stage truth and its reviewer prompt name the effective treatment
for every cast member in each shot. Review facts also include explicit treatment
spans; `dots-v1` never implies a new rig or a different action. Captions and SVG
planes remain outside the treatment. Unknown treatments fail with their field
path, and a dots resource hash mismatch requires rebuilding the design.

Compare the same action, camera, crop and absolute frames in cel and dots.
Inspect the eyes, mouth, hands and prop edges at phone size. A held pose should
have identical lossless frames and near-zero H.264 frame difference; moving
surfaces must carry their samples without sparkle or hidden-surface leaks.
The dots raster test, `backend/journeys/character_dots_pixels.journey.ts`, measures these
properties; J3/J4 in `backend/journeys/j3_j4_dots.journey.ts` checks Player/export
parity and both crops. These checks do not award facial appeal or turn short
engineering excerpts into full-film review passes. Record render seconds per
video second, peak process-tree memory and disk alongside the actual clips.

### Owner-placed captions

With film metadata, OCR checks the declared caption rectangle in each reviewed format. A phrase
crossing a cut keeps its start placement. Without placement metadata, the existing bottom-quarter
measurement and thresholds apply. Gemini facts list owner placements and locks, and its caption
gate accepts their declared position with bottom as the default. The `bottom_captions` result key
remains stable for existing report consumers.

The design check reports out-of-bounds cards and inset collisions as `caption-placement` errors.
Art intersecting an owner card produces a warning naming the art, format, shot and sampled frame;
locked cards stay fixed. The Edit caption bar uses the same geometry check for its red warning.
For CanvasGraph films, the report warns that placed-card collisions against graph art were not checked:
its 3D projection is deliberately out of scope for the collision geometry. Review of the placed position
remains the safety net for CanvasGraph films; scene-art and posed-character collision checks remain active.
Automatic placement and suggestions are outside this feature.

Caption word measurement embeds the pinned Geist fonts and runs a bounded local Chrome page.
On Linux, both synchronous and asynchronous measurement disable desktop D-Bus discovery in the
browser's environment. A bus socket that accepts a connection but never authenticates can block
Chrome startup before the page runs, even with all fonts embedded. Measuring DOM text does not
need a desktop bus. The browser still has its existing 25 second deadline; no retry is used.
