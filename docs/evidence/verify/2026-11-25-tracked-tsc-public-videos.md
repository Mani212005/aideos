<!-- File Description: Verification evidence for the root tracked-source typecheck regression test. -->

# Verification Evidence: Root typecheck ignores untracked film scratch

- **Date**: 2026-11-25
- **Branch / PR**: `fm/aideos-tsc-ignores-film-scratch` (pre-PR handoff)
- **Scope**: CI, Test Wiring & Static Enforcement; `scripts/typecheck_tracked.test.ts`
- **Risk tier**: Low

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | The regression is in the static typecheck; the test runs the installed TypeScript CLI against a throwaway git checkout and then the tracked-source check. |
| Property test for new invariants | N/A | No new pure invariant was introduced. |
| Differential test on replacement | PASS | The test compares stock `tsc` discovery with `typecheckTracked` for the incident paths. |
| Expect / golden test for complex output | N/A | No complex structured or rendered output changed. |
| No sleeps | PASS | No waits or delays were added. |
| No mocks of thing under test | PASS | The test runs the real TypeScript CLI and tracked-source check. |
| Protected suites unloosened | PASS | No protected assertion, tolerance, timeout, or golden changed. |
| Weak-test audit | PASS | No tests removed. |
| Independent review | PENDING | Awaiting the instructed no-mistakes review. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --test --test-concurrency=1 scripts/typecheck_tracked.test.ts` | PASS (exit 0) | 7 tests passed. The new case verifies stock `tsc` reports both `public/videos/diagram-parts/all-check/scratch/stray.ts` and `public/videos/diagram-parts/author/build_design.ts`, while `typecheckTracked` accepts the tracked source. |
| `npm run typecheck` | PASS (exit 0) | 628 tracked root files checked. |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.

## Artifacts and links

- No external artifacts.
