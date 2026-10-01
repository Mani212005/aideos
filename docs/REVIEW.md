<!--
File Description: Documentation and usage reference for the aideos review deterministic video checks and good-video rubric.
-->

# aideos review: deterministic checks on a rendered video

`aideos review <slug|mp4>` measures a rendered video against the measurable half of the good-video
rubric and writes `review.json` plus evidence frames. It is deterministic (same video, same report),
needs only `ffmpeg`, `ffprobe` and `tesseract`, and works on any mp4, not just aideos films. It is
the numbers layer: the Gemini review loop reads the same JSON as context and judges what numbers
cannot (story, whether two things are the same object, whether an animation shows its claim).

```
aideos review hnsw-explainer                       # slug: finds out/<slug>-long.mp4, film.json, voiceover_words.json
aideos review path/to/video.mp4 --film film.json --words voiceover_words.json
aideos review video.mp4 --words script.json        # narration text only: caption match and number grounding, no timings
npm run review -- <slug|mp4> [--json] [--no-ocr] [--out dir]
```

Exit code: `0` all gates passed, `1` a gate failed, `2` the review could not run (missing file,
no ffmpeg). Output: `<out>/review.json` (a slug writes into `videos/<slug>/`, an mp4 into
`.frames/review/<name>/`, `--out` overrides) and `<out>/review/<criterion>-<seconds>s.jpg` for the
moments behind each failed criterion. The schema is `ReviewReport` in `backend/review/types.ts`.

## What it measures

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

## Two design constraints from the audit

- **Carry-over is not pixel overlap.** Overlap in place rewards a diagram that simply sits still
  (it scored the rejected video higher), so carry-over comes from element identity in film data.
- **Camera is not phase correlation.** A static dot grid and HUD dominate global correlation and hide
  every real camera move, so the camera comes from film data. A foreign mp4 reviewed without
  `--film` reports the camera as `skipped`.

## Calibration

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

## Limits

It cannot decide that a metaphor is good or the story interesting. OCR sees only text, so overlap
between artwork and text, and caption quality beyond presence, size, line count and word match,
need the model judge. Grounding is noisy on charts (axis ticks are numbers nobody speaks), which is
why it is a soft criterion and never a gate.
