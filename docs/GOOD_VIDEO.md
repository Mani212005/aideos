<!-- File Description: Authoritative rubric and quality standard defining what makes a good Aideos explainer video. -->

# Good Video Definition

This document is the single source of truth for what makes a good aideos video. 

Before you make or change any video: read this document, run deterministic checks with `aideos review <slug>`, and validate through the Gemini 3.8 Flash review with the full check, `aideos all-check <slug>` (run in your own agent session) (or one review of a rendered mp4 with `aideos gemini-review <mp4>`).

## Compulsory finishing steps

Every video, in both formats, has music, sound effects and the call to action end card. They are steps of making a video, not options: delivery is refused with a plain message when any is missing. Author the music and effects in the `soundtrack` block of `design/design.json` or let `aideos design build <film>` assign the default score and effects (run `aideos audio fetch` first). The end card is appended automatically and cannot be switched off. See [Compulsory finishing steps](WORKFLOW.md#compulsory-finishing-steps-every-video).

## Pictures (the illustrated stage)

A film may add generated pictures to its one stage. The format is fixed:

- **One plate and a few objects.** One generated background plate for the whole film, and about 8 generated objects
  with transparent backgrounds that stay on the stage and change like SVG props (placed, scaled, turned and faded by
  clips, carried between shots). Never a picture per scene, never slides.
- **SVG keeps every word.** Every word, number, label, line, arrow, chart and all motion stay SVG. A picture carries no
  text of any kind: the design check reads every picture with OCR and fails any word it finds.
- **One style paragraph.** The film declares one style paragraph in `design.json` `pictures.style`; it is pasted into
  every prompt (with the fixed rules in `backend/pictures/policy.ts`), so the objects share one look.
- **Abstract objects only.** No people, faces or characters, no logos or brand marks, no real products, no named brands,
  studios or artists. The design check refuses a prompt that asks for one; the owner still looks at each new object once.
- **Provenance is kept.** Each picture is stored as `visuals/generated/<fingerprint>.png` exactly as the generator
  returned it (its provenance data and any invisible watermark included) beside `<fingerprint>.json` (prompt, date,
  seconds, tool, sha256). Never re-encode, crop or clean a stored original, never strip a watermark or provenance data;
  a cut-out is a new picture with its own `cutout` setting. State "AI-generated images" where a platform asks.
- **Pinned and repeatable.** The fingerprint is the hash of the style paragraph, the object prompt, the aspect ratio,
  the tool label and the cut-out settings, so rebuilding with unchanged prompts makes no request. The design pins each
  approved picture by `sha256`; both renderers refuse any other bytes.
- **Colour and contrast.** A picture's strong colours sit near the film accent and the plate's tone near the canvas
  (the palette rule reads pixels). Every SVG label over a picture keeps 4.5:1 contrast (3:1 when large) against the
  busiest tenth of the picture behind it; give a label its own ground over a busy plate.
- **Where pictures come from.** aideos never calls an image service. Pictures are made on the captain's Mac through
  Codex image generation and stored with `aideos pictures add <film> <picture> <file.png> --seconds <s> [--pin]`;
  `aideos pictures status <film>` lists what is cached, pinned or still to make, with each prompt.

Both renderers draw pictures: the native renderer natively (Render IR `aideos.render/3`, [docs/RENDER_IR.md](RENDER_IR.md)),
Remotion through SceneView. Phase 1 places, scales, turns and fades pictures; parallax, masks, blend modes and picture
motion beyond that are phase 2 and not available yet.

## Pass Bar
No gate fails, total >= 36/48, and every criterion >= 2. Targets are for a 60 to 120 s explainer at 1920x1080.
Final acceptance requires a Gemini 3.8 Flash review score of 9.0 or higher (out of 10.0) with all 6 hard gates passing (`aideos all-check <slug>` or `aideos gemini-review <mp4>`), verdict ACCEPT, and the captain's own watch, recorded with `aideos verdict <slug> publish|fix|reject` in `videos/<slug>/owner-verdict.json` (`aideos all-check` never writes it).

## Rubric

When a film has `design/look.json`, `aideos review` reports plan adherence as a non-gating score until it has been calibrated on the proof and two or three more films.

For a declared performance, anticipation may precede its narrated decisive word. Contact is bound
exactly to the measured word cue, with preparation and recovery checked separately. Criterion 3's
"start within 0.4 s" applies to SVG clips; for a performance the decisive moment (the hand meeting
the glider) is what must land on the word, and the review measures that contact frame. Approved
physical-action interpolation stays in `src/dl/performance/`; camera and UI motion retain their
existing easing rules. The short P0 Three integration slice uses a fixed camera and reports the
full camera/pacing rubric honestly. It is engineering evidence, not an accepted full explainer.

| # | Criterion | How to measure | Pass target | Method |
|---|---|---|---|---|
| 1 G | **One persistent stage** | element-level: of the elements visible at the end of beat k, share still visible (possibly transformed) in beat k+1; pixel-level fallback: layout correlation over 2 s | stage-clear events <= 1 per 30 s; median 2 s layout correlation >= 0.65 | deterministic (data and pixels) |
| 2 | **Carry-over with transformation** | at least 3 beat boundaries in which a named element persists and changes position, scale, shape or role (graph -> card in a flowchart); plan a distinct resulting state, finish the change during a camera hold on that object, and leave it framed for at least about 2 s | >= 1 per 20 s | deterministic from scene data + judge confirms it reads as the same object |
| 3 | **Visible cause and effect** | each narrated claim of mechanism has an animation whose start is within 0.4 s of the spoken keyword, and which moves the thing named | every beat with a verb of action | cue-vs-word timing deterministic; "does the animation show the claim" = judge |
| 4 G | **Camera that does something** | camera track with >= 1 move per 20 s; each move is a deliberate turn toward the next subject, arrives about one beat before its cue word, then holds for about 3 to 5 s; no move faster than 20% frame width per second | present, purposeful, settled | deterministic from compiled camera data; framing purpose = judge |
| 5 G | **Captions at placed position (default bottom)** | burned-in caption card at its owner-declared position, or, when no position is declared, in the format default band (widescreen 16:9: bottom 22% starting at 78%; vertical 9:16 reel: platform safe zone y 40-60%, bottom edge <= 60%, x 6-84%) for >= 95% of narrated time; text >= 36 px at 1080p (45 px default), <= 2 lines, no widows, caption words match narration, clear of stage art | pass | deterministic (OCR in the declared card or format default safe zone + word-timing diff) |
| 6 G | **Readability** | every on-screen text >= 24 px at 1080p (labels may be 20 px if non-essential), contrast >= 4.5:1, on screen >= 0.35 s per word | zero violations among essential text | deterministic (DOM/scene text measure; OCR + contrast on frames) |
| 7 G | **No overlap or clipping** | text-text and text-art intersection, off-safe-area content (96 px margin) | zero | deterministic (scene geometry) + judge for rendered edge cases |
| 8 G | **Audio sync** | each cue within 120 ms of its word; shot boundaries inside a pause; voiceover = film length within 100 ms | pass | deterministic (Whisper word times vs clip starts) |
| 9 | **Pacing** | no story hold > 3 s (the end card is excluded, see [stage timeline](REVIEW.md#stage-timeline-and-stillness)); mean beat length 5 to 12 s; no dead air > 0.7 s; narration 130 to 170 wpm | pass | deterministic (compiled stage motion, also gated by the design check before render; frame diff, silencedetect, word count) |
| 10 | **Storyline** | a one-sentence problem is stated, each beat builds on the previous (no beat could be reordered without breaking), a payoff beat restates the result with what the audience has seen | >= 3 of 4 | vision/LLM judge on the beat filmstrip + script |
| 11 | **Accuracy and honesty** | every number and label on screen is said in the narration or marked "illustrative"; computed visuals come from the real computation | zero ungrounded | deterministic (existing `honest-data` rule extended to SVG text via OCR) + judge for semantic truth |
| 12 | **Loudness and mix** | delivered audio mastering target: -16 LUFS integrated; review pass range: -18 to -14 LUFS; true peak <= -1 dBTP; music minimum gap must be >= 12 dB under narration (design target: 18 dB) | pass | Criterion 12 compares aligned 400 ms stem windows that overlap speech on the shared voice activity timeline. A minimum gap below 12 dB fails. A soundtrack without music returns absent and is not a music-gap failure; no speech windows or unavailable/failed stem measurement returns unavailable and fails. Without an audio track, criterion 12 is skipped. See [review measurements](REVIEW.md#4-the-12-criterion-rubric) and [soundtrack mixing](AUDIO_LIBRARY.md#2-soundtrack-mixing) |

### Reel supplement

Applies to the 9:16 reel only, on top of the rubric above. Writing guidance is in the [Reel hook](DIRECTOR_GUIDE.md#reel-hook) rules; the measurement is in [REVIEW.md](REVIEW.md#reel-hook-criterion-15).

#### Reel caption platform safe zone (`REEL_CAPTION_SAFE_ZONE`)

YouTube Shorts, Instagram Reels and TikTok paint persistent UI chrome over vertical 9:16 frames:
- Top header (back, search, menu): `y = 0%..8%`
- Right action-button column (like, comments, save, share, remix): `x = 87%..100%`, `y = 40%..80%`
- Bottom info block (channel handle, title, hashtags, audio/playlist chips, Analytics/Promote chips, bottom bar): `y = 62%..100%`

Every 9:16 reel places burned-in captions inside `REEL_CAPTION_SAFE_ZONE` (`src/dl/fullScreenHeroLayout.ts`, shared by the native renderer, Render IR emitter, Remotion renderer, Studio editor, design check and measured review):
- **Vertical band**: `y = 40%..60%` of frame height (`defaultY = 0.50`, bottom edge always `<= 60%`)
- **Horizontal band**: `x = 6%..84%` of frame width (`centerX = 0.45`, `width = 0.78`), keeping clear of the right-hand button column
- **Lines and type**: at most 2 lines per phrase, readable phone size (`SUBTITLE_FONT_RATIO = 0.042`, 45 px at 1080w), strong active-word highlight and dark card backing
- **Stage clearance**: the stage camera shifts upward (`REEL_STAGE_CENTER_Y_RATIO = 0.29`, and reel `stage: "inset"` occupies `y = 27%..47%`) so diagrams, characters and text cards never collide with the caption band or the 8% top header.

| # | Criterion | How to measure | Pass target | Method |
|---|---|---|---|---|
| 15 | **Reel hook** | the first spoken word's start, the word count of the first sentence, and its opening words | first word starts under 0.3 s; first sentence is 10 to 16 words; no greeting or intro opener; non-gating | deterministic (word timings and sentence punctuation); skipped when either is missing |

## Anchors for scoring (0-4)
- 0: Absent
- 2: Partly
- 4: Clearly good
