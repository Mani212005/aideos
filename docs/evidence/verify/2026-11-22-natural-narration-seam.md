<!-- File Description: Verification evidence entry for the natural-narration take-selection seam and the blind A/B listening-set format. -->

# Verification Evidence: Natural narration seam and listening-set format

- **Date**: 2026-11-22
- **Branch / PR**: `fm/aideos-narrator-naturalness` (PR URL assigned when pushed by `no-mistakes`)
- **Scope**: Feature Map row `Voiceover & Narration`. New `backend/narrationTakes.ts` (take selector, naturalness scorer plug-in, gates, cache key) and `backend/narrationListening.ts` (blind A/B manifest, key, results, verdict); optional `takeSelector` and `onTakeChoice` on `ProduceAudioOptions` and optional `synthesizeTake` on `TtsBackend` in `backend/audio.ts` and `backend/tts.ts`; `docs/NATURAL_NARRATION.md`.
- **Risk tier**: Low (every new path is opt-in; with no selector the voice key, the synthesis call and the stored lines are exactly as before, and `vcdClient.ts` and `voiceSynthesis.ts` are untouched).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `produceAudioPipeline` runs for real (line store, assembly, ffmpeg loudness) with a fake owner-voice backend: three takes per line, the natural one stored, reused on rerun, re-recorded when the selector changes. No journey reaches this opt-in path; none run. |
| Property test for new invariants | N/A | The one new piece of maths, the sign test, is asserted against hand-computed exact values; the side balance and seeded reproducibility are asserted over 200 fixed-seed items. No generator library added. |
| Differential test on replacement | N/A | Nothing replaced. The no-selector path is asserted unchanged by a test that fails if `synthesizeTake` is called or the key differs from `lineVoiceKey(backend, 1)`. |
| Expect / golden test for complex output | N/A | No rendered or golden output. |
| No sleeps in tests | PASS | None. |
| No mocks of the thing under test | PASS | Selection, gates, cache key, line store and the narration pipeline run for real; only the synthesizer and scorer are injected fakes (a fake owner voice, per the rule that no test calls the real service). |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden touched. |
| Weak-test audit | PASS | None removed; none of the new tests assert on a mock. Two mutations (reverse the score order, remove the early stop) were each caught by 2 failing tests. |
| Independent review | PENDING | Scheduled via `no-mistakes` on handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/narrationTakes.test.ts backend/narrationListening.test.ts` | PASS (20/20) | First run 16/20: four mistakes in the new tests themselves (a clipped full-scale take is also "too-hot", the dead-air fixture was also slow, one assertion used another set's key), plus one real bug in `audio.ts` (a take-aware backend was used on the no-selector path; fixed so the plain path calls `synthesize`). |
| Same runner adding `backend/voiceLines.test.ts`, `backend/audio.test.ts`, `backend/voiceOfChoice.test.ts`, `backend/voiceover_stutter.test.ts` | PASS (69/69) | Neighbouring narration tests unchanged and green. |
| `npx tsx scripts/check_headers.ts`, `scripts/check_tests_wired.ts`, `scripts/typecheck_tracked.ts` | PASS | 678 headers valid; all tests wired; no type errors. |
| `npx eslint backend/narrationTakes.ts backend/narrationListening.ts` | PASS | No output. |
| `npx tsc -b tsconfig.node.json` (run inside `editor/`) | PASS | The editor build constraints (no enums, namespaces or constructor parameter properties in backend code) hold. |

## Fix attempts

- Attempts used: 1 / 3 for the pipeline bug above; the test-fixture mistakes were corrected in the same round.

## Weak-test removals

- None.

## Artifacts and links

- Feature Map: [docs/verify/FEATURE_MAP.md](../../verify/FEATURE_MAP.md)
- Reference: [Natural narration](../../NATURAL_NARRATION.md)
