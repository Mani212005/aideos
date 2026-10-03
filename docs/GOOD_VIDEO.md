<!-- File Description: Authoritative rubric and quality standard defining what makes a good Aideos explainer video. -->

# Good Video Definition

This document is the single source of truth for what makes a good aideos video. 

Before you make or change any video: read this document, run deterministic checks with `aideos review <slug>`, and validate through the Gemini 3.8 Flash review loop with `aideos review-loop <slug>` (or the full background agent check with `aideos all-check <slug>`).

## Pass Bar
No gate fails, total >= 36/48, and every criterion >= 2. Targets are for a 60 to 120 s explainer at 1920x1080.
Final acceptance requires a Gemini 3.8 Flash review score of 9.0 or higher (out of 10.0) with all 6 hard gates passing (`aideos all-check <slug>`, `aideos review-loop <slug>`, or `aideos gemini-review <mp4>`), verdict ACCEPT, and the captain's own watch.

## Rubric

| # | Criterion | How to measure | Pass target | Method |
|---|---|---|---|---|
| 1 G | **One persistent stage** | element-level: of the elements visible at the end of beat k, share still visible (possibly transformed) in beat k+1; pixel-level fallback: layout correlation over 2 s | stage-clear events <= 1 per 30 s; median 2 s layout correlation >= 0.75 | deterministic (data and pixels) |
| 2 | **Carry-over with transformation** | at least 3 beat boundaries in which a named element persists and changes position, scale, shape or role (graph -> card in a flowchart) | >= 1 per 20 s | deterministic from scene data + judge confirms it reads as the same object |
| 3 | **Visible cause and effect** | each narrated claim of mechanism has an animation whose start is within 0.4 s of the spoken keyword, and which moves the thing named | every beat with a verb of action | cue-vs-word timing deterministic; "does the animation show the claim" = judge |
| 4 G | **Camera that does something** | camera track (data) with >= 1 move per 20 s, each move changes what is framed (not a drift); no move faster than 20% frame width per second | present, purposeful | deterministic from camera data; purpose = judge |
| 5 G | **Bottom captions** | burned-in caption band in the bottom 22% for >= 95% of narrated time, text >= 36 px at 1080p, <= 2 lines, no widows, caption words match narration | pass | deterministic (OCR on band + word-timing diff) |
| 6 G | **Readability** | every on-screen text >= 24 px at 1080p (labels may be 20 px if non-essential), contrast >= 4.5:1, on screen >= 0.35 s per word | zero violations among essential text | deterministic (DOM/scene text measure; OCR + contrast on frames) |
| 7 G | **No overlap or clipping** | text-text and text-art intersection, off-safe-area content (96 px margin) | zero | deterministic (scene geometry) + judge for rendered edge cases |
| 8 G | **Audio sync** | each cue within 120 ms of its word; shot boundaries inside a pause; voiceover = film length within 100 ms | pass | deterministic (Whisper word times vs clip starts) |
| 9 | **Pacing** | no beat holds an unchanged frame > 3 s; mean beat length 5 to 12 s; no dead air > 0.7 s; narration 130 to 170 wpm | pass | deterministic (frame diff, silencedetect, word count) |
| 10 | **Storyline** | a one-sentence problem is stated, each beat builds on the previous (no beat could be reordered without breaking), a payoff beat restates the result with what the audience has seen | >= 3 of 4 | vision/LLM judge on the beat filmstrip + script |
| 11 | **Accuracy and honesty** | every number and label on screen is said in the narration or marked "illustrative"; computed visuals come from the real computation | zero ungrounded | deterministic (existing `honest-data` rule extended to SVG text via OCR) + judge for semantic truth |
| 12 | **Loudness and mix** | -14 to -18 LUFS integrated, true peak <= -1 dBFS, music >= 12 dB under voice | pass | deterministic (`ebur128`) |

## Anchors for scoring (0-4)
- 0: Absent
- 2: Partly
- 4: Clearly good
