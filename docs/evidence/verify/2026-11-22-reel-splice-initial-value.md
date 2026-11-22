<!-- File Description: Verification evidence log for the reel splice fix that keeps a slot's initial value when its dropped clips net to zero. -->

# Verification Evidence: reel splice keeps the initial value of zero-net slots

- **Date**: 2026-11-22
- **Branch / PR**: fm/aideos-reel-splice-initial-value (PR URL added by the pipeline)
- **Scope**: `backend/designSpec/compile.ts` (splice `settle`), `backend/reelCut/splice.test.ts`. Feature Map row: Condensed Reel Cut.
- **Risk tier**: Low (only a spliced reel compile changes; a cut that drops nothing and every long film compile byte-identically)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | No journey builds a condensed reel cut (Feature Map: partly covered). The regression test compiles a real cut through `compileReel` on the fixture package. |
| Property test for new invariants | N/A | One narrow rule, covered by a fixture case |
| Differential test on replacement | N/A | Nothing replaced; the existing "drops nothing compiles byte-identically" test still passes |
| Expect / golden test for complex output | N/A | No golden touched |
| No sleeps in tests | PASS | None added |
| No mocks of thing under test | PASS | Real `compileReel` and `compileDesign` |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden changed |
| Weak-test audit | PASS | None removed |
| Independent review | PENDING | no-mistakes pipeline |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/reelCut/splice.test.ts` | PASS | 8/8. The new test fails (expected 1 clip, got 0) with `compile.ts` reverted. |
| same runner on `backend/reelCut/spliceGlide.test.ts backend/designSpec/designSpec.test.ts` | PASS | 23/23 |
| `npx tsc --noEmit -p .` | PASS | no output |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.

## Artifacts and links

- Render report Bug 1: `/home/mani/aideos-linux-home/data/aideos-test-video-render/out/report.md`
