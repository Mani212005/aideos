<!-- File Description: Verification evidence log for habits slice 11, the film contract's discriminated clip schemas, the single scene schema and its derived types, and the removed double casts. -->

# Verification Evidence: discriminated clip schemas, one scene schema, no scene double casts (slice 11)

- **Date**: 2026-11-25
- **Branch / PR**: fm/aideos-habits-s11-schemas
- **Scope**: Feature Map rows "Studio Cut / Edit" (layered clip schema, AI edit dry run, Studio round trip of audio clip volume), "2D Scene Engine, SceneKit, Inset Stage & Design System" (scene schema and types, camera easing, line-endpoint clips), "Export & Rendering" (Render IR emit and native renderer: casts replaced by a checked scene accessor), "Condensed Reel Cut" (dead legacy-actor error removed), "Studio Media Upload & Imported Footage / Overlay Clips" (overlay clip schema)
- **Risk tier**: Medium (the film schema now refuses four inputs it used to let through: a clip payload of the wrong kind, an unknown camera easing name, legacy 2D actors, and a captions string that is not a named mode ("bottom", "off", "kinetic", "auto"), empty, or inline WebVTT with a "-->" cue; it now accepts line-endpoint clips and keeps asset tracks and sub-groups it used to drop)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | Before/after reproduction through the real render-path parser `parseFilm` and the layered clip schema on unmodified main and on this branch (see Commands). Journeys run only in the pipeline on this shared machine. |
| Property test for new invariants | N/A | The owner repo rule is to add no tests unprompted; the invariants are covered by the before/after reproduction below and the existing suites. |
| Differential test on replacement | PASS | The reproduction script ran against an unmodified main snapshot and this branch; every behaviour difference is listed under Risk tier. |
| Expect / golden test for complex output | N/A | No new structured or rendered output; no golden touched. |
| No sleeps in tests | N/A | No test added. |
| No mocks of thing under test | PASS | The reproduction runs the real schemas, `parseFilm` and `convertFilm` on the committed `test_fixtures/packages/inset-stage/film.json`. |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden changed. Fixture literals in 6 test files gained the field the schema defaults (`channel` on an audio payload, `size` on a text payload) because the typed clip union no longer lets an audio payload pass as a video payload; the values equal what parsing fills in. |
| Weak-test audit | PASS | No weak test found in the touched suites; none removed. |
| Independent review | PENDING | To be run by the no-mistakes pipeline. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npx tsx repro.mts <main snapshot>` (scratch, outside the repo) | 9 of 9 bugs reproduce | audio payload loses `channel`/`gainDb`; image loses `x`/`y`/`scale`; an audio clip with a text payload parses; a subtitle overlay loses its frames; asset `tracks`/`subGroups` dropped; an `x2` clip refused; camera easing `"easeOut"` accepted; a legacy actor accepted; audio volume 1.6 clamps to 1 |
| `npx tsx repro.mts <branch>` | 9 of 9 fixed | every payload field kept, mismatch refused, tracks and sub-groups kept, `x2` accepted, easing and actor refused with the field path, volume 1.6 kept |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 <64 targeted files>` | PASS (711/711, exit 0) | editPlanner, timeline, reelCut, scene, renderIr, sceneKit, designSpec, review, visionJudge, designCheck, editContext, stage, schema and round-trip suites |
| `npx tsc --noEmit -p tsconfig.json` | PASS | after `npm run ensure:generated` |
| `node ... --test backend/scene/cameraTrack.test.ts backend/holdPush.test.ts` | PASS | re-run after dropping the camera easing cast in `cameraTrack.ts` |
| `npx tsc --noEmit -p editor/tsconfig.app.json` and `-p editor/tsconfig.node.json` | PASS | |
| `npx eslint <touched src, backend and editor files>` | PASS | `LEGACY_ANY` shrank: `backend/editPlanner/validator.ts` and `editor/src/components/OnCanvasAiEditor.tsx` have no `any` left |
| `npx tsx scripts/check_headers.ts` | PASS | 710 files |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.

## Artifacts and links

- Reproduction script and outputs: `/home/mani/aideos-linux-home/data/aideos-habits-s11-schemas/` (`repro.mts`, `repro-before.txt`, `repro-after.txt`, `targeted-tests.tap`).
