<!-- File Description: Verification evidence log for Phase 2 step P2.2c of the native renderer: flat node-graph films drawn natively, behind a parity journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: node-graph films drawn natively (P2.2c)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p22c-blur-flip`
- **Scope**: `backend/renderIr/emit.ts` (`nativeSupport` accepts node-graph films with the flat or top-down camera; the `nodeGraphCanvas` opt-in is removed), `backend/renderIr/emitNodeGraph.ts` (header), `backend/renderIr/emitNodeGraph.test.ts` and `backend/renderIr/emit.test.ts` (see Test changes), the new journey `backend/journeys/node_graph_native.journey.ts`, its weight in `scripts/ciJourneyShards.ts`, and docs. No renderer, IR or golden change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (render jobs now draw a flat node-graph film natively instead of on Remotion; every other film is unchanged, and the kill switch and the `remotion` mode still send any film to Remotion).

## What changes for users

A node-graph film (no `film.scene`) whose every shot uses the `flat` (or `top-down`) camera angle, and that passes the
rest of `nativeSupport` (the `smooth-dark` theme, the only one without a texture; `frame` and `none` panels; TextReveal
and StatCounter blocks, one per shot; no footage or overlay clips), is now drawn by the native renderer in `auto`. The
CSS 3D camera angles stay refused until P2.3.

## The reference and how the bar was reached

The parity reference is Remotion's Chrome with `AIDEOS_GL=swangle` (CI, the goldens and every native parity number), as
firstmate decided. The two frames under the bar at P2.2b (long 45 and long 250) were closed by two earlier PRs, each
landed on its own: the TextReveal underline on whole pixels (#322) and layer restores that round like Chrome's GPU
raster (#324). The large-deviation blur was measured against swangle and is not what held the bar:

| Measured against swangle | Result |
| --- | --- |
| CSS `box-shadow`, black on white, deviation fitted from the profile | exact Gaussian of deviation blur / 2 up to 128 device px (80, 96, 110, 120, 128: ratio 1.005); capped at about 128 above (150 fits 128, 200 fits 129; a 40 px shadow at a 6.9 zoom, nominal 138, fits 127.5) |
| SVG `feGaussianBlur` | exact Gaussian, no cap (100: 0.994, 150: 0.999, 200: 1.021, 138: 1.000 of nominal) |
| native `feGaussianBlur` (Skia CPU, three-box approximation) | fitted 0.97 of nominal; at 2 deviations 0.0157 against the Gaussian's 0.0228, zero by 2.5 |

A GPU-shaped Gaussian and the 128 px cap would each change how scene artwork filters draw (P2.1), and neither is
needed for the bar, so neither is in this change.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg (above the caption band)

`test_fixtures/packages/node-graph-flat`, the journey's measured frames (the end-card frames 700 and 640 are measured by
the journey run itself):

| Frame | long | reel |
| --- | --- | --- |
| 20 | 0.99872 | 0.99915 |
| 45 | 0.99860 | 0.99911 |
| 60 | 0.99792 | 0.99904 |
| 100 | 0.99821 | 0.99850 |
| 150 | 0.99821 | 0.99797 |
| 250 | 0.99570 | 0.99666 |
| 255 | 0.99623 | 0.99689 |
| 330 | 0.99646 | 0.99761 |
| 345 | 0.99654 | 0.99776 |
| 420 | 0.99949 | 0.99915 |
| 435 | 0.99949 | 0.99930 |
| 520 | 0.99812 | 0.99862 |
| 525 | 0.99832 | 0.99850 |

The whole delivered video, every 15th frame (0 to 645, long and reel: 88 frames) plus the long end card (660 to 735
every 15 frames and 749): all at or above 0.995; lowest long 270 at 0.99565, lowest reel 285 at 0.99667, end card
0.99883 to 0.99890.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/node_graph_native.journey.ts`: the renderer choice picks native for both formats and all 28 frames clear 0.995 (44 s on the Linux laptop) |
| Property test for new invariants | N/A | a support decision, pinned by the emitter tests and the journey |
| Differential test on replacement | PASS | the journey and the sweep above: native against Remotion's own stills |
| Expect / golden test for complex output | PASS | no golden or expect file changes; the emitter's IR for scene films is untouched |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion; the journey's Remotion renderer stub only proves it is not chosen |
| Protected suites unloosened | PASS | the stage bar is `STAGE_SSIM_MIN` (0.995) unchanged; no frame is left out |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emitNodeGraph.test.ts`, `emit.test.ts`, `emit.expect.test.ts`, `backend/rendererSelection.test.ts`, `backend/nativeRenderer.test.ts`, `backend/renderIr/dots.test.ts`, `stage3d.test.ts`, `scripts/ciJourneyShards.test.ts` | PASS (4, 19, 2, 10, 4, 6, 6, 11) | |
| `npx tsx scripts/check_tests_wired.ts` | PASS | the new journey runs under `test:journeys` |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/node_graph_native.journey.ts` | PASS (1) | 44 s |
| scratch sweeps (outside the repo) | PASS | the tables above |

## Caveat: the GL backend

A default Remotion render (`AIDEOS_GL` unset, `angle`) on a host without a GPU falls back to Chrome's software raster,
which paints CSS shadows and layers with Skia's truncating 8-bit blitters. Native matches the swangle reference, not that
fallback: against software Chrome the same frames differ by up to one level over the dark shadows.

## Test changes

- `backend/renderIr/emitNodeGraph.test.ts`, first test: it asserted that a node-graph film is refused unless the canvas is
  opted in (a reason naming P2.2c). Firstmate's decision (P2.2c) turns node-graph films on, and the opt-in is removed, so
  it now asserts the flat fixture film has no refusal in either format; the isometric refusal is kept. The other tests
  no longer pass the removed `nodeGraphCanvas` flag.
- `backend/renderIr/emit.test.ts` ("a film the native renderer cannot draw is refused with every reason"): it asserted that
  the probe film without its scene is refused as a node-graph film. Since P2.2c that film is drawn, so it now asserts no
  refusal, and that the same film with an isometric camera is refused with the node-graph camera-angle reason (the
  node-graph refusal path stays covered).
- New journey `backend/journeys/node_graph_native.journey.ts` (firstmate asked for the 0.995 journey over all measured
  frames), weighted 50 s in `scripts/ciJourneyShards.ts`.
- No tolerance, threshold, bar, golden or frame selection is loosened.

## Fix attempts

- Attempts used: 0 / 3.
