<!-- File Description: Verification evidence entry for the change that makes the owner's cloned voice the voice of choice for every test, script and design check. -->

# Verification Evidence: Voice of choice everywhere

- **Date**: 2026-11-21
- **Branch / PR**: `fm/aideos-voice-of-choice-everywhere` (PR URL assigned when pushed by `no-mistakes`)
- **Scope**: Feature Map rows `Voiceover & Narration` and `Review Gates, Design Check & All-Check`. New `backend/voiceOfChoice.ts` and design rule `voice-of-choice`; new `backend/testSupport/fakeVcd.ts` (deterministic fake of the local `vcd` service, installed by the npm test preload); test, journey and script narrators moved from `tone`, `kokoro` and `say` to the owner voice; vcd error hints, CLI and MCP help; docs (README, GOOD_VIDEO, WORKFLOW, PRODUCTION_PIPELINE, RELEASES, CONTEXT, Feature Map).
- **Risk tier**: Medium (shared test preload wraps `globalThis.fetch` for one loopback address; protected journeys now request `vcd` instead of `tone`; the design check gains a rule that fails old packages narrated by another voice unless overridden).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `runProduction` through the real narrate stage, real vcd client and real `createTtsBackend` against the fake service (`pipeline.test.ts`, 50/50; `character_resume.journey.ts`); CLI subprocess runs (`aideos film`, direct executable and launcher) also narrate through the fake via `NODE_OPTIONS`. |
| Property test for new invariants | N/A | No new pure math or parser; the narrator reader is a closed table of real recorded strings. |
| Differential test on replacement | PASS | The fake keeps the tone placeholder's pacing (150 words a minute, 0.4 s floor), asserted sample-exact in `voiceOfChoice.test.ts`, so journey timings that were tuned on tone narration do not move. |
| Expect / golden test for complex output | N/A | No rendered or structured output changed. |
| No sleeps in tests | PASS | No sleeps added; the fake has no timers. |
| No mocks of thing under test | PASS | The real vcd client, backend factory and design check run; only the network edge is faked, and the fake is itself checked against the client's error codes. |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden loosened. Journey and test narrator values changed in place (listed in the PR under Test changes). |
| Weak-test audit | PASS | None removed. |
| Independent review | PENDING | Scheduled via `no-mistakes` upon handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/voiceOfChoice.test.ts` | PASS (6/6) | New tests. |
| Same runner on `backend/pipeline/pipeline.test.ts` | PASS (50/50) | First run failed 2 CLI subprocess tests because a spawned child had no fake service (it would have reached a real service on a machine that has one); fixed with `voiceOfChoiceChildEnv`, rerun 50/50. |
| Same runner on `backend/reelCut/build.test.ts`, `backend/mcp/mcp.test.ts`, `backend/pipeline/director.test.ts`, `backend/screenplay_lines.test.ts`, `backend/designCheck/designCheck.test.ts`, `backend/endCard/voice.test.ts`, `backend/voiceLines.test.ts`, `backend/reelCut/splice.test.ts`, `backend/reelCut/spliceGlide.test.ts`, `scripts/release_resume.test.ts` | PASS | 11, 5, 10, 16, 46, 4, 7, 7, 8 and 28 tests. |
| Same runner on `backend/journeys/character_resume.journey.ts` | PASS (1/1) | The only journey that reaches narrate and design without a render; the other journeys are left to the pipeline. |
| `npm run ci -- static` | PASS | 9/9 steps (headers, tests wired, eslint, tsc, editor build). |

## Fix attempts

- Attempts used: 2 / 3 (eslint `react-hooks/rules-of-hooks` flagged the `use...` name of the install helper: renamed to `installVoiceOfChoiceForTests`; CLI subprocess tests lacked the fake: added `voiceOfChoiceChildEnv`).

## Weak-test removals

- None.

## Artifacts and links

- Feature Map: [docs/verify/FEATURE_MAP.md](../../verify/FEATURE_MAP.md)
- Reference section: [Voice of choice](../../PRODUCTION_PIPELINE.md#voice-of-choice)
