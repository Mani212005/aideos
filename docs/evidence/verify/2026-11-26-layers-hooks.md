<!-- File Description: Verification evidence for layer boundaries and motion hooks. -->

# Verification Evidence: layer boundaries and motion hooks

- **Date**: 2026-11-26
- **Branch**: fm/aideos-habits-s15b-layers-hooks
- **Scope**: Studio captions, rendering and scene engine, production pipeline, design checks and static enforcement in the Feature Map.
- **Risk tier**: Medium - motion timing and caption planning affect rendered frames; the remaining edits relocate shared modules and types.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PENDING | Journey runs are reserved for the instructed no-mistakes pipeline. |
| Property test for new invariants | N/A | No new mathematical invariant; existing targeted suites exercised the unchanged timeline and scene rules. |
| Differential test on replacement | PARTIAL | 500 generated shot timelines matched the original timing implementation. Motion and caption frame parity remains for the pipeline's journeys and goldens. |
| Expect / golden test for complex output | PENDING | Existing protected render goldens are reserved for the pipeline. |
| No sleeps in tests | PASS | No tests or waits added. |
| No mocks of thing under test | PASS | No mocks added. |
| Protected suites unloosened | PASS | No assertions, tolerances, timeouts or goldens changed. |
| Weak-test audit | PASS | No tests removed. |
| Independent review | PENDING | The instructed no-mistakes pipeline will review the committed change. |
| Evidence log written | PASS | This record. |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/timeline/timeline.test.ts backend/captionPlacement.test.ts backend/designCheck/designCheck.test.ts backend/scene/scene.test.ts backend/scene/svgAnimation.test.ts backend/video_package.test.ts` | PASS | 148 tests, fixture videos directory. |
| `npm run ci -- static` | PASS | Completed before the follow-up hook-warning fixes and caption observer refinement; existing fast-refresh and unused-catch warnings remain. |
| `./node_modules/.bin/eslint editor/src/components/ReelPanel.tsx editor/src/components/SoundtrackPanel.tsx` | PASS | Checks the two follow-up warning fixes; the caption observer was linted separately. |
| `npm --prefix editor run build` | PASS | Final build includes the warning fixes and caption observer refinement. |
| `./node_modules/.bin/tsx /tmp/aideos-timing-parity.ts` | PASS | 500 generated inputs against the original timeline module. |
| ESLint stdin restriction probe | PASS | A browser film import of backend audio is rejected. |
| TypeScript import graph scan | PASS | 441 production files under src, backend, editor/src (tests, journeys, testSupport and scripts excluded). Static imports, re-exports, type-only imports, `import type`, `import("...")` type references and dynamic imports all count as edges. Result: 0 multi-file strongly connected components. The earlier scan missed one 9-file component through `backend/pipeline/types.ts`; it is now broken by the leaf modules `backend/pipeline/deliveryTypes.ts` and `backend/visionJudge/types.ts`. |
| `tsc --noEmit -p .`, `eslint backend/pipeline backend/visionJudge backend/designSpec backend/reelCut`, `tsc -b` in `editor` | PASS | After the leaf-type extraction. |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/visionJudge/visionJudge.test.ts backend/designSpec/designer.test.ts backend/designSpec/motionRequests.test.ts backend/pipeline/pipeline.test.ts backend/reelCut/*.test.ts` | PASS | 143 tests. |

## Fix attempts

- The first focused run exposed a missing runtime import after extracting SVG animation constants. Imported the constants and reran the suite successfully.
- The first editor build after extracting design contracts found an unused type import. Removed it and rebuilt successfully.

## Weak-test removals

- None.
