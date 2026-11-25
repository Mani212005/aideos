<!-- File Description: Verification evidence log for habits slice 10: bound external I/O with one child-process runner, replace execSync, and harden the Studio HTTP file routes and editor fetch hooks. -->

# Verification Evidence: habits slice 10 (bound external I/O, replace execSync, harden HTTP boundaries)

- **Date**: 2026-11-25
- **Branch / PR**: fm/aideos-habits-s10-bound-io (PR URL added by the pipeline)
- **Scope**: Feature Map rows "Studio Media Upload & Imported Footage" (`editor/vite.config.ts` file routes, `backend/studioRequest.ts`), "2D Scene Engine, SceneKit" (`backend/sceneKit/whisperWords.py`), "CI, Test Wiring & Static Enforcement" (`backend/proc.ts`, `scripts/*`), plus the child-process call sites in the Export, Voiceover, Soundtrack, Review and Study rows
- **Risk tier**: Medium (47 source and test files change, but each call-site edit only adds a time limit; a limit can only fire on a hung child)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `backend/studioRequestLive.test.ts` boots the real Studio dev server and now requests files with plain, encoded and broken escapes, a normal file and a Range request (206). No journey was run: the machine runs many workers and the full journeys belong to the pipeline |
| Property test for new invariants | N/A | `resolveInside` has a handful of enumerated escapes, no input space worth generating |
| Differential test on replacement | PASS | `execSync` to `execFileSync` and every `spawnSync`/`execFileSync` to the bounded wrapper: 382 existing tests over the touched modules (allCheck, study, media, review, sceneKit, geminiReview, designCheck, compare, pipeline render, audio, tts, soundtrack, scripts checks) pass unchanged |
| Expect / golden test for complex output | N/A | no new structured output |
| No sleeps in tests | PASS | the timeout tests use a 300 ms limit on a child that would sleep 10 minutes and assert it is killed; no fixed waits |
| No mocks of the thing under test | PASS | `proc.test.ts` runs real child processes; `whisperWordsArgs.test.ts` runs the real script with system python3 |
| Protected suites unloosened | PASS | no assertion, tolerance, timeout or golden weakened; only additions to `studioRequestLive.test.ts` |
| Weak-test audit | PASS | none removed |
| Independent review | PENDING | no-mistakes pipeline |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npm run lint` (= `npm run ci -- static`) | PASS (exit 0) | headers, tests wired, eslint, tsc root, oxlint, editor build, ruff check and format (ruff 0.17.0 via uvx) |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/proc.test.ts backend/studioRequest.test.ts backend/sceneKit/whisperWordsArgs.test.ts` | PASS | 14 tests |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/studioRequestLive.test.ts` | PASS | live Studio server |
| 32 targeted test files over the touched modules, `--test-concurrency=1` | PASS | 382 tests, 0 failed, 0 skipped |

## Rust defensive guards (report row 10, H-13)

All four named sites were checked on current main and are already guarded by commit a465a752 (#266), so no Rust file changes in this slice and no new Rust test is needed (`native/aideos-render/tests/bad_colours.rs` covers the colour guard):

| Site | Guard on main |
| --- | --- |
| `native/aideos-render/src/video.rs:321` | `duration.checked_sub(1)` returns an error for a film with 0 frames instead of underflowing |
| `native/aideos-render/src/main.rs:267` | `run_measure` treats an empty parent path as the current directory |
| `native/aideos-render/src/raster/mod.rs:51` | `ir_color` is a total function; the loader schema guarantees the colour format |
| `native/aideos-render/src/raster/stage3d/mod.rs:248` | a node listed before its parent returns an error instead of indexing past the posed graph |

## Long-running child limit

`backend/sceneKit/voiceover.ts` runs local whisper (`python3 whisperWords.py`) with an explicit 4 hour limit instead of the 30 minute default, and a timeout reports "whisper timed out" with the program, file and limit (via `isProcTimeout`) instead of a bare failure.

## Fix attempts

- Attempts used: 1 / 3 (`ruff format --check` wanted one expression in `whisperWords.py` wrapped; formatted with the pinned ruff).

## Weak-test removals

- None.

## Artifacts and links

- Slice 10 of `/home/mani/aideos-linux-home/data/aideos-code-habits-neon/report.md` section 2.
