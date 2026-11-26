<!-- File Description: Verification evidence log for Phase 2 step P2.4b of the native renderer: the paper-fibers theme texture (paper-white, parchment, charcoal) drawn natively for node-graph films, as the flat darkening Chrome actually draws, behind the theme textures journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: the paper grain texture (P2.4b)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p24b-paper-fibers`
- **Scope**: `backend/renderIr/emitThemeTexture.ts` (the `paper-fibers` lowering, `canvasBehindGraph`), `backend/renderIr/emit.ts` (`nativeSupport`: every textured theme is drawn for node-graph films and refused over a scene; the node-graph backdrop colour), `backend/renderIr/emitNodeGraph.ts` (doc of the backdrop colour), fixtures `node-graph-paper` and `node-graph-charcoal`, the `theme_textures` journey (two more fixtures), docs. No Render IR change (the `/7` underlay is reused), no renderer change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (node-graph films on `paper-white`, `parchment` and `charcoal`, the default theme of a film with none, now render natively in `auto`; scene films on any textured theme stay on Remotion).

## What Chrome draws

`Film.tsx` draws the paper grain as `feTurbulence` lit by `feDiffuseLighting`, then `feBlend mode="multiply" in="SourceGraphic"`
over it, where `SourceGraphic` is the rect's default black fill: black multiplied by anything is black, so the filter's output
is the black rect, at the rect's 0.8 opacity, in the texture layer at 0.28. Measured in Chrome (swangle), the texture alone over
each canvas colour: one flat colour over the whole frame, standard deviation 0 (paper-white 248, 246, 240 becomes 193, 191, 187;
parchment 190, 186, 182; charcoal 14, 14, 16). It is lowered to exactly that: a black rect at 0.8 in the underlay at 71/255, the
8-bit opacity Chrome composites (0.28 itself gives 192, one level off).

## The backdrop

The first native pass on the light theme was far off (paper-white long 285 0.96493, 44 of 92 frames under the bar; charcoal
6 frames, lowest 0.99310): a card's `backdrop-filter` blurs what lies behind it, the canvas already darkened by the grain, and the
canvas's backdrop copy started from the theme's canvas colour. For a uniform texture the copy now starts from the darkened
colour (`canvasBehindGraph`); the pattern textures are unchanged.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg, every 15th frame of each delivered video

| Fixture | Frames (0 to 645 long and reel, long 660 to 749) | Under 0.995 | Lowest |
| --- | --- | --- | --- |
| node-graph-paper (paper-white) | 92 | 0 | long 285 0.99513, long 270 0.99521 |
| node-graph-charcoal (charcoal) | 92 | 0 | long 270 0.99559, long 285 0.99573 |

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/theme_textures.journey.ts`: native chosen for all four theme fixtures and both formats; all 84 frames at or above 0.995 (204 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the sweeps above |
| Expect / golden test for complex output | PASS | no golden or expect change; the blueprint and dot-grid fixtures emit the same documents as before |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; no assertion edited |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts`, `emitNodeGraph.test.ts`, `renderIr.test.ts`, `backend/rendererSelection.test.ts`, `backend/nativeRenderer.test.ts`, `scripts/ciJourneyShards.test.ts`, `backend/themeBinding.test.ts` | PASS (19, 2, 5, 12, 10, 4, 11, 18) | |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- --all` | PASS | the new fixtures included |
| `npx tsx scripts/check_tests_wired.ts`, `npm run typecheck`, `npx eslint` on the changed files | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/theme_textures.journey.ts` | PASS (1) | 204 s, four fixtures |

## Test changes

- `backend/journeys/theme_textures.journey.ts`: two more fixtures (`node-graph-paper`, `node-graph-charcoal`) with the same
  frames and bar; weight 230 s in `scripts/ciJourneyShards.ts`.
- New fixtures `test_fixtures/packages/node-graph-paper` and `node-graph-charcoal`.
- No assertion, tolerance, threshold, bar or golden is edited, loosened or removed. The existing test that a textured scene
  film is refused (`emit.test.ts`) passes unchanged: the refusal now covers every textured theme over a scene.

## Fix attempts

- Attempts used: 1 / 3 (the card backdrop starts from the darkened canvas).
