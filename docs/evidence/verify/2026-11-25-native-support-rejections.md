<!-- File Description: Verification evidence for film-only native support rejection checks. -->

# Verification Evidence: Native support rejection checks

- **Date**: 2026-11-25
- **Branch**: fm/aideos-native-support-emit-rejections
- **Scope**: Export and Rendering feature row; renderer selection and Render IR emission.
- **Risk tier**: Medium. Previously accepted malformed or unsupported films now choose Remotion or fail early in forced-native mode.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PENDING | The RenderJob selection test uses renderer stand-ins; no full video render was authorized. The existing journeys will run in the pipeline. |
| Property test for new invariants | PASS | Enumerated every declared SVG animation property against actual IR validation in both formats; asset ID cases are also checked against that validator. |
| Differential test on replacement | N/A | The existing implementation is extended, not replaced. The rejection checks are compared with the emitted IR validator. |
| Expect / golden test for complex output | N/A | No new complex output or baseline. |
| No sleeps in tests | PASS | None introduced. |
| No mocks of thing under test | PASS | The support check, IR validator and RenderJob selection run for real; only rendering and delivery services are stand-ins in the selection test. |
| Protected suites unloosened | PASS | No existing assertion, timeout, tolerance or golden changed. |
| Weak-test audit | PASS | No tests removed. |
| Independent review | PENDING | The no-mistakes pipeline is required after firstmate's instruction. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/renderIr/emit.test.ts backend/rendererSelection.test.ts` | PASS | 28 tests; targeted log in task data directory. |
| `./node_modules/.bin/eslint backend/renderIr/emit.ts backend/renderIr/emit.test.ts backend/rendererSelection.test.ts` | PASS | Exit 0. |
| `npm run typecheck` | PASS | 628 tracked root files checked. |
| `./editor/node_modules/.bin/tsc --noEmit -p editor/tsconfig.node.json` | PASS | Exit 0 with the editor's TypeScript 6.0.3. |
| `./node_modules/.bin/tsc --noEmit -p editor/tsconfig.node.json` | FAIL | Exit 2 with root TypeScript 5.9.3, which is not the editor's compiler; errors also occur in unchanged files. The editor's compiler passes the same check. |

## Fix attempts

- The initial differential test used zero as a scale value in a directly modified IR track, which violates that IR track's positive scale constraint. Changed the shared candidate to a valid value and reran: pass. No protected assertion was changed.

## Weak-test removals

- None.
