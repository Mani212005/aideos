<!-- File Description: Verification evidence log for the Studio and src audit hotfix batch (undo, accent, LayerStack, VTT numbers, request hygiene, dead UI). -->

# Verification Evidence: Studio and src audit hotfix batch

- **Date**: 2026-11-21
- **Branch / PR**: fm/aideos-cleanup-studio-hotfixes (PR link is added by the pipeline)
- **Scope**: Feature Map rows Studio Cut / Edit, Studio Captions, Studio Media Upload, 2D Scene Engine and Design System, Hosted Studio. Audit items ES-P0-01, 02, 05, 06, 07, 10 (rest), ES-P1-03, ES-P2-01 (part), 03, 04.
- **Risk tier**: Medium (LayerStack drawing and the strict accentAt touch the render path; no golden frame lands on a LayerStack shot)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `npm run smoke:studio` (3 runs after the last edit): new case sends one Ctrl+Z, Ctrl+Shift+Z and Ctrl+Z to the Cut lens and requires exactly one edit per press. Fails on the old duplicate handler, passes on the fix. Live Studio server test `backend/studioRequestLive.test.ts` fails on old `vite.config.ts` (path climb returned 200), passes now. Browser before/after screenshots in the task data dir. |
| Property test for new invariants | PASS | `backend/captionsParser.test.ts`: seeded 200-run round trip of numeric and text words through `captionWordsToVtt` and `generateWordsFromFilm` (texts in order for any cue size, exact frames at one word per cue). |
| Differential test on replacement | PASS | `src/dl/performance/math.ts` `normalizeQ` and `slerp` rewritten without casts: 200000 seeded random cases are bit identical to the old implementation (scratch script, not committed). Old `parseVtt` vs new on numeric cues recorded in the PR. |
| Expect / golden test for complex output | N/A | No golden frame lands on a LayerStack shot (sample-explainer goldens are frames 273, 1365, 2457; its LayerStack shot is 11.13 s to 18.89 s). Goldens were not run or regenerated. |
| No sleeps in tests | PASS | New unit tests have no waits. The smoke journey keeps its polling-on-a-condition style with deadlines; the preview capture now waits for `document.fonts.status` and for two identical captures instead of a fixed 500 ms. |
| No mocks of thing under test | PASS | Unit tests run the real parser, guard and body reader; the live test starts the real dev server. |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden was loosened. `scripts/smoke_studio.ts` only gained a case and a stricter capture wait. |
| Weak-test audit | PASS | One test replaced by a stronger one (see below). No other test removed. |
| Independent review | PENDING | Runs in the no-mistakes pipeline started by firstmate. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npm run ci -- static` | PASS | headers, tests wired, eslint, tsc root, oxlint, editor build, ruff |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 <17 targeted files>` | PASS (175 tests) | captions, palette, theme, performance, studio guard, request limits, accent, deviceData, shotTools |
| `npm run smoke:studio` | PASS x3 | after the fix; FAIL on old TimelineEditor handler |
| `npm run performance:check` | PASS (exit 0) | after the math rewrite |

## Fix attempts

- Smoke preview equality check failed once in 7 runs (1.543% of pixels). Measured cause: the node tag "01 / 02" was drawn in a fallback face because JetBrains Mono had not loaded at capture time (zoomed crops of `frame-45-first.png` and `frame-45-again.png`). Fixed once by waiting for the fonts and for a stable picture; 3 clean runs after.
- Attempts used: 1 / 3.

## Weak-test removals

- `backend/captionWordEdit.test.ts` "an edit that cannot be read back returns an error and no film": asserted the digit-avoidance workaround for the `parseVtt` bug (the "number word" error); replaced by a stronger test that a number word keeps its own timing and a retyped number saves.

## Artifacts and links

- Screenshots and probe notes: /home/mani/aideos-linux-home/data/aideos-cleanup-studio-hotfixes/shots/
