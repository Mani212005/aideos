<!-- File Description: Verification evidence entry for consolidating the studio's film store into backend/pipeline/filmStore.ts and refusing a corrupt film.json. -->

# Verification Evidence: One film store, no silent fallback on a corrupt film.json

- **Date**: 2026-11-22
- **Branch / PR**: `fm/aideos-habits-s05-filmstore` (PR URL assigned when pushed by `no-mistakes`)
- **Scope**: Feature Map rows `Studio Cut / Edit (... autosave, sync)` and `Studio Media Upload & Imported Footage`. `editor/vite.config.ts` drops its own `readFilm`/`writeFilm`/`wireFootageIntoFilm`, `diskFilmRevision`, module writer and all four shadow-module regexes, and calls `backend/pipeline/filmStore.ts`. The store gains `readStoredFilm` (film plus revision), `CorruptFilmError`, and a `beforeWrite` option (the studio soundtrack persist). Footage wiring lives once in `src/dl/footageWiring.ts` (pipeline, studio server and Look lens; caption limit 80, the schema's). `POST /api/films/:id` returns the film as written. The studio names a film it cannot open instead of silently showing the placeholder.
- **Risk tier**: Medium (every studio film read and write now goes through the pipeline's store; behaviour differences are listed below).

## Behaviour differences (intended)

- A corrupt `film.json` is an error everywhere (`GET` and `POST /api/films/:id` answer 500 `corrupt_film`, `writeFilm` refuses), never a read of the older shadow.
- The studio always writes the shadow module (before, only when one already existed); `ensureGenerated` already wrote them for every package.
- Voiceover shot rescaling reads the authoritative `film.json`, not the shadow module.
- B-roll wiring from the studio server updates an existing inset caption from the shot direction, the same way the Look lens does; missing film or shot is now logged as an error instead of a silent return.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | Dev server on a scratch `AIDEOS_VIDEOS_DIR` with a package copied from `examples/hello-scene`. Before: corrupt `film.json` gave `GET` 200 with the stale shadow and every save 409. After: `GET`/`POST` 500 `corrupt_film` with the file path; studio page shows the reason in a toast; after restoring the file, `GET` 200 and `POST` 200 whose returned film, `rev` and on-disk bytes agree, shadow updated. |
| Property test for new invariants | N/A | No new math or parser invariant; the rule is one fixed condition. |
| Differential test on replacement | N/A | The studio copy is deleted, not ported; the pipeline store it now uses is covered by its existing tests. |
| Expect / golden test for complex output | PASS | `backend/pipeline/filmJson.expect.test.ts` unchanged and green. |
| No sleeps in tests | PASS | None added. |
| No mocks of the thing under test | PASS | The new test writes and corrupts a real fixture package. |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden touched. |
| Weak-test audit | PASS | None removed. One test added (`readFilm refuses a corrupt film.json ...`), naming the captain's slice decision. |
| Independent review | PENDING | Scheduled via `no-mistakes` on handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npx tsc -b` (in `editor/`) | PASS | Node config (vite.config.ts) and app. |
| `npx tsx scripts/typecheck_tracked.ts` | PASS | 617 files. |
| `npx tsx scripts/check_headers.ts` | PASS | 699 headers. |
| `npx eslint` on touched backend/src files, `npx oxlint` on touched editor files | PASS | |
| `node --test` pipeline, filmJson.expect, captionPlacement, filmAcceptance, video_package, design_language_palette, endCard/voice, timeline/imported_footage | PASS (141/141) | Includes the new corrupt-file test. |
| `node --test` studioSaveAssets, studioRequestLive, filmSyncMachine | PASS (30/30) | Live save route on the real dev server. |
| New test with the silent fallback restored in `readStoredFilm` | FAIL (1) | Proves the test catches the old behaviour; file restored. |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.
