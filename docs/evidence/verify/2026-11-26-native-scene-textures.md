<!-- File Description: Verification evidence log for Phase 2 step P2.4c of the native renderer: theme textures (the paper grain, the blueprint grid) under a vector scene film drawn natively in the /7 underlay, behind the scene_textures journey at 0.995 on every measured frame against the swangle reference; a Three stage on a textured theme stays refused. -->

# Verification Evidence: theme textures over a scene (P2.4c)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p24c-scene-textures`
- **Scope**: `backend/renderIr/emit.ts` (`nativeSupport` refuses a textured theme only over a Three stage; the texture underlay is emitted for vector scene films too), the fixtures `test_fixtures/packages/scene-paper-white` and `scene-blueprint`, the journey `backend/journeys/scene_textures.journey.ts`, its weight, `backend/renderIr/emit.test.ts` (see Test changes), docs. No Render IR change (the `/7` underlay is reused), no renderer change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (vector scene films on a textured theme now render natively in `auto`, as `/7` documents with the texture underlay; untextured scene films emit the same documents).

## Why this slice

Firstmate msg 041: the next lowest-risk measurable slice. Two candidates were set aside after measuring the facts: the anchor
panel (it unblocks screenplay-intake films, but `newProjectFilmTheme` gives new studio projects `cameraAngle: "isometric"`, so
those films stay blocked by P2.3) and Plot and the other SVG devices (an svg node is not allowed in the overlay, so they need a
Render IR version, `/8`). Textured scene films were refused only as unmeasured since P2.4a (Firstmate decision 028: refused
with a test until measured).

## What Chrome draws

`Film.tsx` draws the texture layer under the stage for every film; a scene's background asset usually covers the frame, so
the texture shows only where the scene leaves the canvas bare. The native underlay sits in the same place, so the emitter adds
it to a vector scene film exactly as to a node-graph film.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

| Fixture | Frames (0 to 375 long and reel every 15th, long 390 to 479) | Under 0.995 | Lowest |
| --- | --- | --- | --- |
| scene-paper-white | 59 | 0 | long 120 0.99847 |
| scene-blueprint | 59 | 0 | at or above 0.99847 |

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/scene_textures.journey.ts`: native chosen for both fixtures and formats; all 42 frames at or above 0.995 (71 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the frame sweep above (scratch, outside the repo) |
| Expect / golden test for complex output | PASS | no golden or expect change; untextured films emit the same documents |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; see Test changes |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts` | PASS (23) | |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- scene-paper-white` and `scene-blueprint` | PASS | |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/scene_textures.journey.ts` | PASS (1) | 71 s, two fixtures |

## Test changes

- `backend/renderIr/emit.test.ts`, the "a film the native renderer cannot draw is refused with every reason" test: the case
  added in P2.4a (Firstmate decision 028: a textured scene film refused with a test until measured) changes from "the native
  probe scene film on the blueprint theme is refused" to `deepEqual(nativeSupport(...), [])` (the same exact assertion the
  untextured case uses), because P2.4c measures it behind the journey. A new assertion keeps the unmeasured case refused: the
  Three-stage fixture `legacy-iona-p0` on the blueprint theme is refused by the "texture over a Three stage" reason.
- New journey `backend/journeys/scene_textures.journey.ts` (weight 90 s in `scripts/ciJourneyShards.ts`) and fixtures
  `test_fixtures/packages/scene-paper-white` and `scene-blueprint`.
- No tolerance, threshold, bar or golden is edited, loosened or removed.

## Fix attempts

- Attempts used: 0 / 3 (the first pass matched).
