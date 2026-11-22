<!-- File Description: Verification evidence log for scaling the 10 s film minimum by the house pace. -->

# Verification Evidence: film minimum length scaled by the house pace

- **Date**: 2026-11-22
- **Branch / PR**: fm/aideos-film-min-duration-pace
- **Scope**: `src/dl/schema.ts` (floor and message), `backend/pacingProfile.ts` (`minFilmSecAt`, `HOUSE_PACE.minFilmSec`), `backend/newProjectFilm.ts`, `backend/designSpec/brief.ts`, docs; Feature Map rows "Studio Words" and "Production Pipeline & Director"
- **Risk tier**: Low (the floor only gets lower at the house pace, so no film that parsed before is refused; 1.0x keeps 10 s)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | Full journeys are not run by workers on this machine (brief); the real schema is exercised by the new boundary tests and by `newProjectFilm.test.ts`, which runs the Start box compile path |
| Property test for new invariants | N/A | One arithmetic rule with two pinned values; boundary tests cover it |
| Differential test on replacement | N/A | No implementation replaced; at rate 1 the floor equals the old constant (asserted) |
| Expect / golden test for complex output | N/A | No structured output or golden changed |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | tests parse real films through the real schema |
| Protected suites unloosened | PASS | no assertion, tolerance or golden changed; one test title reworded in `newProjectFilm.test.ts` |
| Weak-test audit | PASS | none removed |
| Independent review | PENDING | no-mistakes pipeline, to run on firstmate's instruction |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/filmMinDuration.test.ts backend/newProjectFilm.test.ts backend/designSpec/*.test.ts src/dl/schemaIssues.test.ts backend/video_package.test.ts` | PASS (55 tests, 0 fail) | |
| `node ... --test backend/pipeline/pipeline.test.ts backend/pipeline/director.test.ts backend/schema_legacy_blocks.test.ts backend/chapters.test.ts` | PASS (70 tests, 0 fail) | |
| `npx eslint src/dl/schema.ts backend/pacingProfile.ts backend/newProjectFilm.ts backend/filmMinDuration.test.ts backend/designSpec/brief.ts` | PASS | |
| `npx tsc --noEmit -p .`, `tsx scripts/check_headers.ts`, `tsx scripts/check_tests_wired.ts` | PASS | |
| `npx tsc -b editor/tsconfig.node.json` | 8 errors, identical on clean main | pre-existing in `editor/vite.config.ts` narrowing, none in touched files |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.

## Artifacts and links

- Boundary tests: `backend/filmMinDuration.test.ts` (scripts of 23/24 words at 1.0x around 10 s, 22/23 words at 1.2x around 8.3 s).
