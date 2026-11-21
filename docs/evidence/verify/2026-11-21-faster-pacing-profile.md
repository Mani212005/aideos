<!-- File Description: Verification evidence log for the 2026-11-21 house pacing profile (narration 1.2x, tighter gaps and pace gates). -->

# Verification Evidence: house pacing profile (1.2x narration, faster edit)

- **Date**: 2026-11-21
- **Branch / PR**: `fm/aideos-faster-pacing-profile`
- **Scope**: Feature Map rows "Voiceover & Narration" (`backend/audio.ts`, `backend/pcm.ts`, `backend/tts.ts`, `backend/voiceLines.ts`), "Review Gates, Design Check & All-Check" (`backend/review/`, `backend/stageTimeline.ts`, `backend/geminiReview/rubric.ts`), "2D Scene Engine, SceneKit" (`backend/sceneKit/voiceover.ts`), Studio voiceover route (`editor/vite.config.ts`), new `backend/pacingProfile.ts`
- **Risk tier**: Medium (changes the narration pace of every new film and tightens the design-check story hold from 3 s to 2.5 s)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `j2_retime` (re-narration with the tone voice, now stretched 1.2x), `j7_review_truth`, fixture `design:check --all`; plus a real-voice run of the `sample-explainer` fixture through `produceAudioPipeline` with local Kokoro (below) |
| Property test for new invariants | PASS | `timeStretch` keeps pitch, lands on round(n / rate) samples and adds no seam at 0.8x and 1.2x (`backend/voiceover_stutter.test.ts`); also checked by hand at 1.3x and 1.5x |
| Differential test on replacement | PASS | Stretch quality compared with ffmpeg `atempo` (the reference WSOLA) on the same take by speech-to-text: WSOLA 8.6% WER vs `atempo` 9.0% |
| Expect / golden test for complex output | N/A | No new structured output or rendered frames; no render was made (a render is a final export) |
| No sleeps in tests | PASS | None added |
| No mocks of thing under test | PASS | The real pipeline, cache and criteria run; only the synthesizer is injected |
| Protected suites unloosened | PASS | Every changed number is stricter or a deliberate captain pace change: story hold 3 -> 2.5 s, dead air 0.7 -> 0.6 s, camera move per 20 -> 17 s, carry-over floor 1 per 20 -> 1 per 17 s, hard cuts per minute 2 -> 2.4, reel hook first word 0.3 -> 0.25 s, wpm window 120-180 -> 145-215, mean beat ceiling 12 -> 10 s (no floor), reel-fast ceiling 200 -> 240 wpm; camera speed cap, captions, readability, overlap, audio sync and reel caption safe zone unchanged |
| Weak-test audit | PASS | The opt-in `reel-fast` profile was kept and rescaled (200 -> 240 wpm); its three tests are restored with only the numbers the new windows force; the house pace window test and a mean beat ceiling test were added |
| Independent review | PENDING | `no-mistakes` pipeline, run when firstmate asks |
| Evidence log written | PASS | This file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npm run -s typecheck` | PASS (exit 0) | 582 tracked files |
| `npx tsc -b` in `editor/` | PASS (exit 0) | editor build type pass |
| `npx tsx scripts/check_headers.ts` | PASS | 662 files |
| `node --test` on 11 files (`audio`, `voiceLines`, `voiceover_stutter`, `sync`, `review/review`, `review/music`, `stageTimeline`, `goodVideoRubric`, `geminiReview/geminiReview`, `endCard/voice`, `claude_script_intake`) | PASS after 3 test updates | `review.test` camera move count and two `stageTimeline` tests encoded the old 3 s hold and 20 s move rule; updated to the new rule, naming the decision |
| `node --test` on 21 files (design check, pictures, inset stage, theme binding, hold push, design spec, delivery gate, caption placement, dots, reel cut x4, film acceptance, verdict policy, vision judge, study, Jev batch, director invariants, design Jev, pipeline) | PASS (exit 0) | |
| `node --test backend/review/hook.test.ts` | PASS | 12 tests |
| `node --test backend/journeys/j2_retime.journey.ts` | PASS (exit 0) | |
| `node --test backend/journeys/j7_review_truth.journey.ts` | PASS (exit 0) | |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- --all` | PASS (exit 0) | all 8 fixture films pass the 2.5 s story hold |

## Before and after on one fixture film (`test_fixtures/packages/sample-explainer`, 14 shots, 226 words)

Narrated through the real `produceAudioPipeline` with local Kokoro (`af_heart`), the film retimed to each take, then
the data-only criteria and the design check run on it. No video was rendered, so the pixel and OCR criteria are not
measured here.

| | Before (Kokoro 0.75, gaps 200/900/110 ms) | After, native rate (Kokoro 0.9, house gaps) | After, stretch path (0.75 voice re-paced 1.2x, house gaps) |
| --- | --- | --- | --- |
| Duration | 131.3 s | 100.7 s (-23.3%) | 109.5 s (-16.6%, exactly 1.2x) |
| Narration pace | 103 wpm | 135 wpm | 124 wpm |
| Beats / mean beat | 14 / 9.4 s | 14 / 7.2 s | 14 / 7.8 s |
| Shot changes per minute | 5.9 | 7.7 | 7.1 |
| Camera moves owed (one per 17 s) | 7 (6 under the old 20 s rule) | 5 | 6 |
| Dead air over 0.6 s | 0 | 0 | 0 |
| Speech-to-text WER (faster-whisper small.en) | 9.8% | 8.1% | 8.6% (ffmpeg `atempo` 1.2x: 9.0%) |
| Content words misheard | 0 | 0 | 0 |
| Design check | PASS | PASS | PASS |
| Audio sync (gate) | PASS | PASS | PASS |
| Camera (gate) | FAIL | FAIL | FAIL |
| Pacing (non-gate) | FAIL: 103 wpm (also under the old 120 floor) | FAIL: 135 wpm | FAIL: 124 wpm |

Every WER error is a spelling artefact of the comparison ("twenty twenty two" heard as "2022", "Midjourney" as
"mid journey", "hardcoded" as "hard coded", "U-Net" as "unet"), identical across variants; speeding up lost no word.
The camera failure is the fixture's own node-graph cut (1.25 frame widths per second) and is the same at every pace.
Kokoro `af_heart` at 0.75 already ran under the old 120 wpm floor, so the pacing failure of the before and stretch
columns is not new. The shipped Kokoro default is now 1.05 (below), which passes pacing.

### Kokoro default speed sweep

Same fixture, `produceAudioPipeline` with local Kokoro `af_heart` at the house gaps:

| Kokoro speed | Narration pace | Clears the 145 wpm floor |
| --- | --- | --- |
| 0.9 | 135 wpm | no |
| 0.95 | 140 wpm | no |
| 1.0 | 144 wpm | no |
| 1.05 | 147 wpm | yes (92.2 s, mean beat 6.6 s, design check pass) |

Speech-to-text WER (faster-whisper small.en): 6.8% at 1.05, 8.1% at 1.0, 9.8% before (0.75, old gaps), so 1.05 is no
less clear. `DEFAULT_KOKORO_SPEED` is 1.05.

Which path passes: the Kokoro path passes pacing at the shipped default. The stretch path (the cloned voice) was
measured on this fixture with a Kokoro 0.75 stand-in and lands 124 wpm, below the floor. The cloned voice's own
natural rate was not measurable on this host (the `vcd` service was not running), so whether the owner voice reaches
145 wpm at 1.2x is unverified and must be measured with the real voice.

## Fix attempts

- `timeStretch` first draft left one seam at sample 8 (the zero-weight start of the first window); fixed by taking the first frame's rising half at full weight. Attempts used: 1 / 3.

## Weak-test removals

- None. `backend/review/hook.test.ts`: the three `reel-fast` pacing profile tests are kept with only the forced numbers changed (145 to 215 default window; 231 wpm passes reel-fast up to 240; a 250 wpm narration fails it).

## Artifacts and links

- Evidence run, takes and scores (outside the repo): `/home/mani/aideos-linux-home/data/aideos-faster-pacing-profile/evidence/` (`results.json`, `intelligibility.json`, `before_after.ts`, `intelligibility.py`)

## Follow-ups

- `aideos-voicelines-prune-old-keys`: recordings in `voiceover_lines/` made under the old plain cache key (before the `|stretch=<rate>` suffix) are orphaned and never pruned.
- `aideos-intelligibility-check`: a repeatable speech-to-text round trip in the repo; the clarity numbers here were measured once outside it.
