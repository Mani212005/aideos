<!-- File Description: Verification evidence for the caption placement Chrome test flake. -->

# Verification Evidence: Caption placement Chrome test flake

- **Date**: 2026-11-26
- **Branch / PR**: fm/aideos-captionplacement-flake-chrome-launch
- **Scope**: Chrome measurement (serialized sync/async parity check) in `backend/captionPlacement.test.ts`.
- **Risk tier**: Low

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | No production behavior changed; the edit serializes overlapping browser startups in a unit test. The protected caption journey was not changed. |
| Property test for new invariants | N/A | No new invariant introduced. |
| Differential test on replacement | N/A | No implementation replaced. |
| Expect / golden test for complex output | N/A | No structured or rendered output changed. |
| No sleeps | PASS | No waits added. |
| No mocks of thing under test | PASS | Chrome measurement remains real in both targeted suites. |
| Protected suites unloosened | PASS | No journey, assertion, timeout, tolerance, or golden was weakened. |
| Weak-test audit | PASS | The sync/async parity assertion in `captionPlacement.test.ts` is kept. The async result is awaited first, so the two Chrome launches never overlap. The sync call then runs on a fresh instance of `captionMeasurements` (module cache deleted before `require`), so its measurement cache is empty and it launches its own Chrome; the comparison stays independent. No production code changed. |
| Independent review | PENDING | The required no-mistakes review follows the commit handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| Three sequential runs of `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/captionPlacement.test.ts` (parity assertion kept, serialized, fresh-module sync call) | PASS (exit 0) | 41/41 each; 6.9 s, 8.9 s, 7.8 s. Load average 1.6/2.1/2.5 after the runs. |
| Perturbation check: sync result temporarily overridden for `RunnerParityWordQZ731`, then `--test-name-pattern="review phrase measurement"` | FAIL as expected | The assertion detects a sync/async divergence. Perturbation reverted; final diff contains none. |
| `git diff --check` | PASS (exit 0) | No whitespace errors. |

## Fix attempts

- Attempts used: 1/3. Source inspection showed the async Chrome launch was not awaited before the synchronous launch; three sequential runs after serializing the calls passed.

## Weak-test removals

- None. The parity assertion was kept and serialized.
