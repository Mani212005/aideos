<!-- File Description: Verification evidence log for Phase 2 step P2.8b of the native renderer: the ScaleBar device drawn natively as an svg node in the Render IR /8 overlay, alone in an inset and under a headline, with the svg's box pixel-snapped as Blink paints a replaced element, behind the scale_bars journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: the ScaleBar device (P2.8b)

- **Date**: 2026-11-27
- **Branch / PR**: `fm/aideos-native-p28b-scalebar`
- **Scope**: `backend/renderIr/emitScaleBar.ts` (new: the generated asset and its element tracks), `backend/renderIr/emit.ts` (`nativeSupport` accepts a ScaleBar alone in an inset or under a TextReveal; `scaleBarNodes`, `scaleBarHeight`; the shared `meetFit` (with the svg box pixel-snapped) and `svgDeviceNode`, which Plot now uses too; `columnTops` takes a ScaleBar), the fixture `test_fixtures/packages/scale-bars`, the journey `backend/journeys/scale_bars.journey.ts`, its weight, docs. No Render IR change (`/8`), no renderer change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (films with a ScaleBar in an inset or under a headline now render natively in `auto`; Plot documents change by the snapped svg box, re-measured below; every other film emits the same document).

## Why this slice

Firstmate msg 043: the next block family on `/8`, lowest-risk measurable first. ScaleBar is the simplest of the remaining svg
devices without the serif font.

## What Chrome draws, measured

- The device and its layout as described in `docs/NATIVE_RENDERER.md` (P2.8b). The bar's pill is drawn as a round-capped stroke
  revealed by its dash offset, which is exactly a rect `grow * 472` wide with rounded ends of radius 2.5 while the bar is at
  least 5 units wide.
- Blink paints the svg (a replaced element) at its pixel-snapped box. From the fractional column position the long device card
  measured 0.99408 (frame 470); with the box snapped, 0.99866.
- The snap applies to Plot too (one shared `meetFit`): the plots fixture re-measured on its 120-frame set, all at or above 0.995;
  frame-card frames rose (reel 350 0.99848 to 0.99875), the long inset's lowest moved from 0.99834 to 0.99831.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

`scale-bars`, long and reel: frame 45, every 4th frame 92 to 236 and 330 to 476, 239, 300, 479, 520, and the end card (600, 659):
162 frames, none under 0.995; lowest long 108 0.99848.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/scale_bars.journey.ts`: native chosen for both formats; all 39 frames at or above 0.995 (41 s); `plots.journey.ts` passes unchanged (40 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the frame sweeps above (scratch, outside the repo) |
| Expect / golden test for complex output | PASS | no golden or expect change; films without a Plot or ScaleBar emit the same documents |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; no assertion edited |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts` | PASS | |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- scale-bars` | PASS | two honest-data warnings (the fixture's illustrative ticks) |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/scale_bars.journey.ts` and `plots.journey.ts` | PASS (1, 1) | 41 s, 40 s |

## Still refused (planned)

- A ScaleBar alone on the frame stage or with any block but a headline; AttentionArcs, VectorSpace and Distribution (next, one
  PR per family); MatrixGrid, Math and the serif Distribution (Firstmate decision 042).

## Test changes

- New journey `backend/journeys/scale_bars.journey.ts` (weight 55 s in `scripts/ciJourneyShards.ts`) and fixture
  `test_fixtures/packages/scale-bars`.
- No assertion, tolerance, threshold, bar or golden is edited, loosened or removed.

## Fix attempts

- Attempts used: 1 / 3 (the svg box pixel-snapped).
