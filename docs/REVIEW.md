<!--
File Description: Documentation and usage reference for aideos deterministic video checks, Gemini 3.8 Flash video reviews, and the iterative review loop.
-->

# aideos review: deterministic checks and Gemini 3.8 Flash review loop

Video quality verification in Aideos operates on two connected layers:
1. **Deterministic Checks (`aideos review`)**: Precise numerical measurements (OCR caption band coverage, layout correlation, audio loudness, camera motion frequency).
2. **Gemini 3.8 Flash Native Review (`aideos gemini-review` & `aideos review-loop`)**: Full multimodal video and audio evaluation against the 12-criterion rubric, requiring a score of 9.0+ out of 10.0 with all 6 hard gates passing for acceptance.

---

## 1. Deterministic Review (`aideos review`)

`aideos review <slug|mp4>` measures a rendered video against the measurable half of the good-video
rubric and writes `review.json` plus evidence frames. It is deterministic (same video, same report),
needs only `ffmpeg`, `ffprobe` and `tesseract`, and works on any mp4, not just aideos films. It is
the numbers layer: the Gemini review loop reads the same JSON as context and judges what numbers
cannot (story, whether two things are the same object, whether an animation shows its claim).

```bash
aideos review hnsw-explainer                       # slug: finds out/<slug>-long.mp4, film.json, voiceover_words.json
aideos review path/to/video.mp4 --film film.json --words voiceover_words.json
aideos review video.mp4 --words script.json        # narration text only: caption match and number grounding, no timings
npm run review -- <slug|mp4> [--json] [--no-ocr] [--out dir]
```

Exit code: `0` all gates passed, `1` a gate failed, `2` the review could not run (missing file,
no ffmpeg). Output: `<out>/review.json` (a slug writes into `videos/<slug>/`, an mp4 into
`.frames/review/<name>/`, `--out` overrides) and `<out>/review/<criterion>-<seconds>s.jpg` for the
moments behind each failed criterion. The schema is `ReviewReport` in `backend/review/types.ts`.

### What it measures

| # | Criterion (gate in bold) | Measured from | Pass when |
|---|---|---|---|
| 1 | **One persistent stage** | pixels (ink layout correlation with 2 s earlier, stage-clear events) and film data (beats that keep the previous elements on stage) | median correlation >= 0.75, <= 2.2 stage clears per 30 s, >= 60% of beat boundaries keep their elements |
| 2 | Carry-over with transformation | film data only: an element stays across a beat boundary and is transformed | >= 1 per 20 s |
| 3 | Cues aimed at spoken words | film clips against word timings, compared with chance | clip starts land on word starts clearly more often than chance |
| 4 | **Camera that does something** | film data only (the solved framing of each shot, or a scene camera track) | >= 1 move per 20 s, none faster than 20% of the frame width per second |
| 5 | **Bottom captions** | OCR of full-resolution frames every 2 s | caption band in the bottom quarter in >= 60% of narrated moments, <= 2 lines, words match the narration |
| 6 | **Readability** | OCR box height (normalised to a 1080 short side) and pixel contrast | <= 58% of words under 18 px, <= 10% under 3:1 contrast |
| 7 | **No overlap or clipping** | OCR boxes overlapping, text inside the edge margin, canvas node overlap | <= 10% of sampled frames affected |
| 8 | **Audio sync** | audio vs video length, film length, shot boundaries vs word timings | lengths within 0.1 s, no shot boundary through a spoken word |
| 9 | Pacing | frame difference (static holds, hard cuts), word timings or silence (dead air, pace) | no hold over 3 s, <= 2 hard cuts per minute, no pause over 0.7 s, 120 to 180 wpm |
| 11 | Numbers grounded in narration | OCR numbers vs spoken numbers (digits and number words) | every on-screen number is said |
| 12 | Loudness and mix | `ebur128` | -18 to -14 LUFS, true peak <= -1 dBFS |

Criterion 10 (storyline) is not deterministic and is left to the model judge. A criterion whose
inputs are missing is `skipped`, never `pass`: the camera is never guessed from pixels, carry-over is
never measured by pixel overlap in place, and captions are skipped for a silent video with no
narration. Every threshold lives in `backend/review/thresholds.ts`.

### Two design constraints from the audit

- **Carry-over is not pixel overlap.** Overlap in place rewards a diagram that simply sits still
  (it scored the rejected video higher), so carry-over comes from element identity in film data.
- **Camera is not phase correlation.** A static dot grid and HUD dominate global correlation and hide
  every real camera move, so the camera comes from film data. A foreign mp4 reviewed without
  `--film` reports the camera as `skipped`.

### Calibration

`npm run calibrate:review` re-runs the three reference videos and fails unless the tool still
reproduces the captain's comparison. The mp4s are the captain's own and are not in the repo: point
`AIDEOS_CALIBRATION_A` (the preferred explainer), `AIDEOS_CALIBRATION_B` (the rejected aideos
explainer) and `AIDEOS_CALIBRATION_RAG` at them, optionally with `AIDEOS_CALIBRATION_A_WORDS`,
`AIDEOS_CALIBRATION_B_FILM` and `AIDEOS_CALIBRATION_B_WORDS`. Measured on 2026-10-01:

| | A (preferred) | B (rejected) | RAG |
|---|---|---|---|
| layout correlation, median | 0.85 | 0.69 | 0.50 |
| stage clears per 30 s | 1.7 | 2.6 | 5.5 |
| caption coverage | 81% | 0% | 0% |
| words under 18 px | 51% | 66% | 62% |
| hard cuts | 0 | 0 | 8 |
| gates | all pass | persistence, camera, captions, readability fail | persistence, captions, readability fail |

Re-run it after changing any threshold or the pixel analysis; the thresholds were set between A and
the others with margin, and the rubric's 95% caption target is not met even by A at 2 s sampling
(captions change between samples), so the gate is 60%.

---

## 2. Gemini 3.8 Flash Video Quality Review (`aideos gemini-review`)

`aideos gemini-review <video.mp4>` evaluates a rendered mp4 video with native Gemini 3.8 Flash video and audio understanding.

```bash
aideos gemini-review out/hnsw-explainer-long.mp4
aideos gemini-review out/video.mp4 --film videos/hnsw-explainer/film.json
aideos gemini-review videoA.mp4 --pairwise videoB.mp4
```

### How it works
1. **Direct Video Inspection in Isolated Workspace via agy CLI**: Invokes the agy CLI agent running Gemini 3.8 Flash (e.g. `gemini-3.8-flash-high`) non-interactively in print mode with `--sandbox` within an isolated temporary directory using neutral filenames (`video.mp4` for single review and pairwise comparisons) and explicit directives to evaluate only the visual and audio stream without writing scripts, extracting frames, or accessing repository files.
2. **Deterministic Facts Extraction**: Gathers ground-truth data (bottom captions OCR coverage, audio LUFS loudness, duration, framerate, camera track from `film.json`) and feeds them into the model prompt to prevent hallucinations.
3. **Structured Rubric Evaluation**: Grades all 12 criteria on a 0.0 to 10.0 scale, checking the 6 hard gates (persistent stage, camera purpose, bottom captions, readability, no overlap/clipping, audio sync).
4. **Timestamp Evidence Enforcement**: Validates that every criterion score includes concrete timestamp citations (e.g. `00:14`, `01:02`) within the video bounds.
5. **Verdict Decision**:
   - `ACCEPT`: Overall score >= 9.0 and all 6 hard gates passed.
   - `REVISE`: Overall score < 9.0 or any hard gate failed.
6. **Prioritized Feedback**: Generates actionable, timestamped recommendations (high, medium, low priority) on how to improve the video.

### Cross-Review Pairwise Comparison (`--pairwise`)
To eliminate model position bias and multimodal cross-alignment hallucinations when comparing two videos (e.g. comparing Aideos output against an external benchmark), `--pairwise` runs a dual-agent cross-review process:
1. **Watch Phase**: Two separate agy agents watch each video individually in isolated temporary workspaces and generate a structured JSON evaluation report (rating, likes, dislikes, neutral, timestamps).
2. **Exchange Phase**: Each agent resumes its conversation and reads the *other* video's evaluation report, scoring the competing video purely on its text-based merits.
3. **Final Scoring**: The final score for each video is the average of its watcher's rating and the competing agent's peer rating. The winner is the video with the highest average score.

---

## 3. Iterative Review Loop (`aideos review-loop`)

`aideos review-loop <slug>` automates the render -> review -> refine iteration loop until Gemini rates the video 9.0 or higher.

```bash
aideos review-loop hnsw-explainer
aideos review-loop hnsw-explainer --target-score 9.2 --max-rounds 8
aideos review-loop hnsw-explainer --reference benchmarks/reference-a.mp4
```

### Review Loop Workflow
1. **Render**: Renders the latest film manifest (`npm run render` or `npm run render:reel`).
2. **Review**: Executes Gemini 3.8 Flash review and logs the evaluation.
3. **Persist**: Stores round outcomes under `videos/<slug>/gemini-review/round-N.json` and updates `videos/<slug>/gemini-review/latest.json`.
4. **Evaluate Acceptance**:
   - If overall score >= 9.0 (default target) and all gates pass (and pairwise reference check passes if `--reference` is set): the loop terminates with success (exit code 0).
   - If verdict is `REVISE` and remaining rounds exist: the feedback and timestamp citations guide agent or human iteration on the film before the next render and review round.
   - If max rounds exceeded without passing: exits with code 1.

---

## 4. The 12-Criterion Rubric

| # | Criterion | Hard Gate? | Description |
|---|---|---|---|
| 1 | **persistent_stage** | Yes | One unified visual stage; elements persist and evolve across beats; stage-clears <= 1 per 30s. |
| 2 | carry_over_transform | No | Named elements carry over across beat boundaries and change position, scale, shape, or role. |
| 3 | visible_cause_effect | No | Mechanism claims have animations starting within 0.4s of spoken keywords that visually demonstrate the claim. |
| 4 | **camera_purpose** | Yes | Active, purposeful camera moves (>= 1 move per 20s) framing content naturally without disorienting drift. |
| 5 | **bottom_captions** | Yes | Clean burned-in captions in the bottom 22% band for >= 95% of speech, readable size (>= 36px), matching spoken audio. |
| 6 | **readability** | Yes | High contrast (>= 4.5:1), clear font hierarchy (>= 24px), sufficient reading duration (>= 0.35s per word). |
| 7 | **no_overlap_clipping** | Yes | No text-text or text-artwork overlapping; all essential elements stay within the 96px safe margin. |
| 8 | **audio_sync** | Yes | Visual cues synchronize with voiceover within 120ms; voiceover and video durations agree within 100ms. |
| 9 | pacing | No | Dynamic progression with no static holds > 3s, mean beat length 5-12s, no dead air > 0.7s, speech 130-170 wpm. |
| 10 | storyline | No | Clear problem statement, logical progression where beats build on previous content, satisfying payoff beat. |
| 11 | accuracy_honesty | No | Every number, chart, and label is grounded in the narration; zero fabricated numbers or misleading visuals. |
| 12 | loudness_mix | No | Audio loudness normalized to -14 to -18 LUFS integrated, true peak <= -1 dBFS, background music ducked cleanly. |

