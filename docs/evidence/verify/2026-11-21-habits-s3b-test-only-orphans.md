<!-- File Description: Verification evidence log for deleting test-only dead code after habits slice 3 (slice 3b) and the AGENTS.md fact correction. -->

# Verification Evidence: delete test-only orphans (habits slice 3b)

- **Date**: 2026-11-21
- **Branch / PR**: fm/aideos-habits-s3b-test-only-orphans (PR URL is added by the pipeline)
- **Scope**: Feature Map row "Voiceover & Narration" (`backend/audio.ts`, `backend/transcribe.ts`), the Agent Bridge dispatcher, `backend/designSpec/shotTools.ts`, `backend/study/audio.ts`, docs, and the AGENTS.md lines this change made wrong
- **Risk tier**: Low (only code with no production caller is deleted; `getAgentSession` and `retimeAudioSync` stay because production reaches them)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | No user-facing workflow changes: every deleted function had no caller outside tests (checked with git grep on current main) |
| Property test for new invariants | N/A | No new invariant |
| Differential test on replacement | N/A | No implementation is replaced |
| Expect / golden test for complex output | N/A | No new structured output |
| No sleeps in tests | PASS | No test waits were added |
| No mocks of thing under test | PASS | The three dispatch tests now write the session file the way `bin/aideos` does, and run the real `dispatchTask` |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden was changed |
| Weak-test audit | PASS | Removals listed below |
| Independent review | PENDING | The no-mistakes pipeline runs after this commit |
| Evidence log written | PASS | This file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npm run lint` | PASS (exit 0) | headers 660 files OK, eslint src OK, typecheck 580 files no errors |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/designSpec/shotTools.test.ts backend/agentBridge/agentBridge.test.ts backend/agentBridge/autoPrompt.test.ts backend/agentBridge/paneDelivery.test.ts backend/study/study.test.ts backend/editContext/editContext.test.ts` | PASS (exit 0) | 68 pass, 0 fail |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/audio.test.ts` | PASS (exit 0) | 14 pass, 0 fail |
| `npx tsx scripts/check_tests_wired.ts` | PASS (exit 0) | all tracked test files are run |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- `backend/transcribe.test.ts` (whole file, 7 tests): each one exercised only the deleted `transcribe()`, `writeImportWords()` or `resolveDeepgramApiKey()`, driven through injected fetch, ffmpeg and Whisper fakes (tests of a mock).
  - "transcribe: uses the Deepgram path and its injected fetch": tested the deleted function against its own fake fetch.
  - "transcribe: falls back to the injected Whisper runner": same, for the Whisper fake.
  - "transcribe: a failed Deepgram response throws": same, for a fake 401 response.
  - "resolveDeepgramApiKey: reads DEEPGRAM_API_KEY from the environment": the deleted function only echoed an env var, and nothing but `transcribe()` called it.
  - "writeImportWords: writes import_words.json and a caption sidecar": tested the deleted function (no production writer is left).
  - "transcribe: cleans up temporary directory after transcription finishes": tested cleanup inside the deleted function.
  - "transcribe: cleans up temporary directory when transcription fails": same, on the failure path.
- `backend/designSpec/shotTools.test.ts` "ShotTools: a swap draws authored data, and refuses with the reason when it cannot": exercised only the deleted `swapShotVisual`. Its honesty rules stay covered through the live `authorDeviceData` and `buildBlocksForShotVisual` tests in `backend/pipeline/deviceData.test.ts` and `design_jev.test.ts`.
- Changed, not removed: `backend/audio.test.ts` "retimeAudio retimes audio across 0.8x..2.0x" now calls `retimeAudioSync` directly, because the async `retimeAudio` wrapper it called is deleted. The assertions are unchanged.
- Changed, not removed: three dispatch tests (`agentBridge.test.ts`, `autoPrompt.test.ts`, `paneDelivery.test.ts`) call `writeAgentSessionFile` (new `backend/testSupport/agentSessionFile.ts`) instead of `setAgentSession`. Assertions are unchanged.

## Artifacts and links

- Handoff: /home/mani/aideos-linux-home/data/aideos-habits-s3b-test-only-orphans/handoff.md
