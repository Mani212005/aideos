<!-- File Description: Verification evidence log for ducking library sound effects under narration (owner feedback 2026-11-22 item 2b). -->

# Verification Evidence: library effects duck under narration

- **Date**: 2026-11-22
- **Branch / PR**: `fm/aideos-narrator-clarity-mix`
- **Scope**: Feature Map row "Soundtrack, Audio Library & Mastering" (`src/dl/audio/sectionMixer.ts`, `src/dl/Soundtrack.tsx`, `backend/renderIr/emit.ts`); docs `docs/AUDIO_LIBRARY.md`, `docs/NATIVE_RENDERER.md`
- **Risk tier**: Low (one new gain factor on library effects, only below 1, only around measured speech; music, narration and mastering are unchanged)

## Why

The owner heard the music overpower the narration at times in the 2026-11-22 test-quality delivery. A read-only measurement of the delivered `long.mp4` and `reel.mp4` against their own narration stems shows the music bed is not the main cause. The worst clarity seconds all fall where a chapter-cut effect (mostly `sweep-tech`) runs into the next spoken line. Effects were never ducked, and the music review (criterion 12) renders its stems without effects, so the review could not see this.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `backend/journeys/j14_soundtrack.journey.ts` (studio soundtrack journey, real mixer) |
| Property test for new invariants | N/A | The new gain reuses the existing voice state machine and ramp; the per-frame IR check covers every frame of two effects |
| Differential test on replacement | PASS | `speechGain` refactored onto a shared ramp: D6 golden unchanged (-18.0 dB duck, -18.0 section, end card -8.0); the new behavioural test run on origin/main's mixer fails (no duck) and passes on this branch |
| Expect / golden test for complex output | PASS | `backend/soundtrack.golden.test.ts` passes unchanged |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real Remotion render of the shared `Soundtrack` and real `emitRenderIr`; inputs are synthetic tones only, no voice recordings |
| Protected suites unloosened | PASS | no assertion, tolerance, timeout, golden or review threshold changed |
| Weak-test audit | PASS | audited `backend/sectionMixer.test.ts` and the ducking cases in `backend/voiceActivity.test.ts`; none weak, none removed |
| Independent review | PENDING | no-mistakes pipeline |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/soundtrackEffectDuck.test.ts` | PASS (1/1) | after: effect in gap -21.9 dB (capped level -21.8), under speech -39.8 dB, voice -19.9 dB: speech-to-effect 19.8 dB |
| same test with origin/main `sectionMixer.ts`, `Soundtrack.tsx`, `emit.ts` | FAIL as expected | before: effect under speech -21.7 dB, speech-to-effect 1.8 dB |
| `... --test backend/renderIr/emit.test.ts backend/voiceActivity.test.ts backend/sectionMixer.test.ts` | PASS (23/23) | includes the new native effect envelope case |
| `... --test backend/soundtrack.golden.test.ts` | PASS (1/1) | D6 numbers unchanged |
| `... --test --test-reporter=tap backend/journeys/j14_soundtrack.journey.ts` | PASS (1/1) | 88 s |
| `npm run lint` | PASS | headers, eslint, tracked typecheck |
| `npx tsc --noEmit -p .` | PASS | |

Delivered-film what-if (read-only offline remix of the real delivered mixes, effects re-added with the shipped envelope; the shipped TypeScript envelope matched the analysis mirror to 0.0 dB on both films):

| Film, seconds near an effect | SII-style mean / min | voice minus rest p10 / min | STOI (whole story) |
| --- | --- | --- | --- |
| long, delivered | 0.834 / 0.318 | 7.5 / 6.3 dB | 0.984 |
| long, effects ducked | 0.925 / 0.713 | 17.4 / 14.1 dB | 0.9887 |
| reel, delivered | 0.826 / 0.302 | 7.4 / 3.2 dB | 0.9761 |
| reel, effects ducked | 0.896 / 0.661 | 14.8 / 13.8 dB | 0.9813 |

## Fix attempts

- Attempts used: 1 / 3 for the new test fixture (a pure sine voice has a 3 dB crest factor, so the narration-peak cap kept the effect too quiet to mask; a six-syllables-a-second envelope gives the speech-like 13 dB crest that real narration has).

## Weak-test removals

- None.

## Artifacts and links

- Measurement scripts, raw JSON and handoff: `/home/mani/aideos-linux-home/data/aideos-narrator-clarity-mix/` (outside the repo; no audio written)
