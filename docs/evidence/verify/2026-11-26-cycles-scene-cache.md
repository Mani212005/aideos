<!-- File Description: Verification evidence for the Studio import cycle and scene cache changes. -->

# Verification Evidence: Studio cycle and scene cache

- **Date**: 2026-11-26
- **Branch**: fm/aideos-habits-s15-cycles-hooks
- **Scope**: Studio Cut / Edit and 2D Scene Engine in the Feature Map.
- **Risk tier**: Medium (shared render path).

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PENDING | Journey runs reserved for the validation pipeline by the task resource limit. |
| Property test for new invariants | PASS | Generated capacities and distinct source sequences check eviction and reuse. |
| Differential test on replacement | PASS | Existing SVG animation suite checks stable rendered output and repeatability. |
| Expect / golden test for complex output | PENDING | Protected golden journeys reserved for the validation pipeline. |
| No sleeps in tests | PASS | None introduced. |
| No mocks of thing under test | PASS | Real cache and SVG parser exercised. |
| Protected suites unloosened | PASS | No existing assertions changed. |
| Weak-test audit | PASS | No tests removed. |
| Independent review | PENDING | no-mistakes pipeline after firstmate instruction. |
| Evidence log written | PASS | This file. |

## Commands run and results

- `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/scene/documentCache.test.ts backend/scene/svgAnimation.test.ts`: PASS, 17 tests; the subsequent cache-only run with the generated cases passed 2 tests.
- `npm run ci -- static`: PASS; existing lint and bundle-size warnings were reported. Root typecheck includes tracked files only.
- Runtime relative-import graph scan: no multi-file cycles detected after extracting Studio formats. The scan excluded type-only edges and unresolved aliases.

## Fix attempts

- None.

## Weak-test removals

- None.
