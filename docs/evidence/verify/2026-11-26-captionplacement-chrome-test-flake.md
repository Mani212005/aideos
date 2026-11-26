<!-- File Description: Verification evidence for the caption placement Chrome test flake. -->

# Verification Evidence: Caption placement Chrome test flake

- **Date**: 2026-11-26
- **Branch / PR**: fm/aideos-captionplacement-test-flake
- **Scope**: Chrome measurement in `backend/captionPlacement.test.ts`; Studio Captions row in `docs/verify/FEATURE_MAP.md`.
- **Risk tier**: Low

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | No production behavior changed; the edit removes overlapping browser startups from a unit test. The protected caption journey was not changed. |
| Property test for new invariants | N/A | No new invariant introduced. |
| Differential test on replacement | N/A | No implementation replaced. |
| Expect / golden test for complex output | N/A | No structured or rendered output changed. |
| No sleeps | PASS | No waits added. |
| No mocks of thing under test | PASS | Chrome measurement remains real in both targeted suites. |
| Protected suites unloosened | PASS | No journey, assertion, timeout, tolerance, or golden was weakened. |
| Weak-test audit | PASS | Removed the sync/async parity assertion from `captionPlacement.test.ts`: both calls shared the same cache, so it compared cached output instead of independently measuring both paths; it also started two Chrome processes concurrently. |
| Independent review | PENDING | The required no-mistakes review follows the commit handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/captionPlacement.test.ts` (before change) | PASS (exit 0) | 41/41 tests; 11.0 s. |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/captionPlacement.test.ts` (after change) | PASS (exit 0) | 41/41 tests; 15.6 s. |
| Three sequential reruns of `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/captionPlacement.test.ts` | PASS (exit 0) | 41/41 each; 9.6 s, 14.4 s, and 11.3 s. Host load average was 3.67/4.03/3.06 before the run and 3.10/3.83/3.07 after, on the 12-core worker. |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/review/captionMeasurements.test.ts` | PASS (exit 0) | 2/2 real Chrome measurement cases, sync and async; 4.2 s. |
| `git diff --check` | PASS (exit 0) | No whitespace errors. |

## Fix attempts

- Attempts used: 1/3. Source inspection showed the async Chrome launch was not awaited before the synchronous launch; the first targeted rerun after removing the overlapping launch passed. Three additional sequential runs under the worker's ambient load also passed.

## Weak-test removals

- `backend/captionPlacement.test.ts`: removed its sync/async parity assertion because the shared font-size cache made the second call return the first call's measurements, while the async launch was still in flight.

## Artifacts and links

- `backend/review/captionMeasurements.test.ts` separately launches each API in its own worker, preserving real coverage for both sync and async measurements.
