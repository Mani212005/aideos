<!-- File Description: Verification evidence log for the shared character fixture builder used by the J4, J5 and character_pixels journeys and the native goldens. -->

# Verification Evidence: one shared builder for the J5 and character_pixels film fixtures

- **Date**: 2026-11-25
- **Branch / PR**: fm/aideos-journey-fixture-shared-builder (PR URL added by the pipeline)
- **Scope**: `backend/testSupport/characterFilms.ts` now owns the package copy and the design and look edits; `character_pixels.journey.ts`, `j4_character_crops.journey.ts` and `j3_j5_stage.journey.ts` call it instead of carrying their own copies. Feature Map rows: Characters & 3D Three Stage, Export & Rendering, Golden frame & audio suites (file lists unchanged).
- **Risk tier**: Low (test support and journey setup only, no product code, no assertion changed)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS (partly) | J4 crops journey ran green through the real `buildDesign`. character_pixels and J3/J5 need WebGL2 and were not run in full here (see below); the pipeline runs them. |
| Property test for new invariants | N/A | No new invariant, a refactor of fixture setup. |
| Differential test on replacement | PASS | Old module (HEAD) vs new module: film.json, base-film.json, design.json, look.json, characters folder and built film are byte-identical for pixels-stage-pip, pixels-stage-marlo and journey-three-characters. Output in the task data dir (differential.txt). |
| Expect / golden test for complex output | N/A | No new output. Goldens untouched. |
| No sleeps in tests | PASS | None added. |
| No mocks of the thing under test | PASS | Real `buildDesign`. |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden changed. |
| Weak-test audit | PASS | No test removed (none of the touched journey assertions is weak). |
| Independent review | PENDING | The no-mistakes pipeline reviews the diff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npx eslint` on the 4 touched files | PASS | clean |
| `npx tsc --noEmit -p .` | PASS | clean |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/journeys/j4_character_crops.journey.ts backend/renderIr/stage3d.test.ts backend/renderIr/dots.test.ts` | PASS | 13 tests, 0 failed, 0 skipped |
| same runner on `backend/journeys/character_pixels.journey.ts` | host limit | the `sheet` test passed; the stage-stills test built both packages through `buildDesign` and then stopped at the Remotion render: "WebGL2 context is unavailable" (this host has no software GL). Not caused by the change. |

## Fix attempts

- Attempts used: 0 / 3

## Weak-test removals

None.

## Independent review

Pending: no-mistakes pipeline.
