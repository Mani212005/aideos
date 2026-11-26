<!-- File Description: Verification evidence for the caption placement Chrome test flake. -->

# Verification Evidence: Caption placement Chrome test flake

- **Date**: 2026-11-26
- **Branch / PR**: fm/aideos-captionplacement-flake-chrome-launch
- **Scope**: Chrome measurement (serialized sync/async parity check) in `backend/captionPlacement.test.ts`; Studio Captions row in `docs/verify/FEATURE_MAP.md`.
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
| Weak-test audit | PASS | The sync/async parity assertion in `captionPlacement.test.ts` is kept unchanged in strength. The async result is now awaited before the sync call, so the two Chrome launches no longer overlap. The module-level measurement cache is shared, so the sync call reads the widths the awaited async call cached; the assertion keeps its original form and can no longer race two Chrome launches. |
| Independent review | PENDING | The required no-mistakes review follows the commit handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| Three sequential runs of `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/captionPlacement.test.ts` (parity assertion restored and serialized) | PASS (exit 0) | 41/41 each; 7.6 s, 7.7 s, 7.4 s. Load average about 2.9 on the 12-core worker. |
| `git diff --check` | PASS (exit 0) | No whitespace errors. |

## Fix attempts

- Attempts used: 1/3. Source inspection showed the async Chrome launch was not awaited before the synchronous launch; three sequential runs after serializing the calls passed.

## Weak-test removals

- None. The parity assertion was kept and serialized.
