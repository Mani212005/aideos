<!-- File Description: Verification evidence log for P2.2b of the native renderer: the node-graph canvas emitter (flat camera), opt-in, with its measured parity against Remotion. -->

# Verification Evidence: node-graph canvas emitter (P2.2b)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p22b-nodegraph`
- **Scope**: `backend/renderIr/emitNodeGraph.ts` (new), `backend/renderIr/irValues.ts` (helpers moved out of emit.ts), `backend/renderIr/emit.ts` (a stage part per canvas kind, the `nodeGraphCanvas` opt-in, node-graph frame panels without the scene scrim band), `test_fixtures/packages/node-graph-flat/` (synthetic fixture), `backend/renderIr/emitNodeGraph.test.ts`, docs. Feature Map rows: Export & Rendering (Render IR emitter).
- **Risk tier**: Low (opt-in only: `nativeSupport` still refuses node-graph films and no render job sets the opt-in; scene films emit byte for byte as before, which the captured emit expect files and the native golden IR confirm).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | the fixture emitted through the real emitter with the native measurer, staged and drawn by the release binary, and rendered by Remotion (scratch journeys outside the repo; numbers below) |
| Property test for new invariants | N/A | the emitter's rules are fixed mappings; the camera mapping is checked against `camera.ts` at every story frame of both formats |
| Differential test on replacement | PASS | native against Remotion, 26 frames (below); the camera against `projectBox` in `emitNodeGraph.test.ts` |
| Expect / golden test for complex output | PASS | `emit.expect.test.ts` unchanged (scene films emit as before); native golden IR regenerates byte-identical |
| No sleeps in tests | PASS | none |
| No mocks of thing under test | PASS | the emitter runs for real with the existing fake measurer |
| Protected suites unloosened | PASS | no existing assertion changed |
| Weak-test audit | PASS | none removed; a draft test that only restated two constants (packet speed, panel dim) was dropped before commit |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Parity against Remotion (SSIM by ffmpeg, stage crop above the caption band)

`test_fixtures/packages/node-graph-flat`, frames 20, 60, 100, 150, 250, 330, 420, 520 and every shot midpoint 45, 255, 345,
435, 525 (13 frames), long and reel: 26 frames, 24 at or above 0.995.

| Frame | long | reel |
| --- | --- | --- |
| 20 | 0.99611 | 0.99802 |
| 45 | **0.99359** | 0.99807 |
| 60 | 0.99650 | 0.99790 |
| 100 | 0.99716 | 0.99789 |
| 150 | 0.99774 | 0.99770 |
| 250 | **0.99465** | 0.99623 |
| 255 | 0.99520 | 0.99617 |
| 330 | 0.99590 | 0.99735 |
| 345 | 0.99546 | 0.99731 |
| 420 | 0.99788 | 0.99811 |
| 435 | 0.99755 | 0.99786 |
| 520 | 0.99817 | 0.99900 |
| 525 | 0.99829 | 0.99866 |

Below the bar: long 45 (the opening headline over the 3%-dimmed canvas, visually identical) and long 250 (a lit card at a
6.9 zoom). Cause: the tails of the large blurs (accent glow, drop shadows and backdrop, 100 to 140 px on screen) are about
one level off over wide dark areas, the CPU triple-box blur against Chrome's GPU Gaussian (P2.1), plus text anti-aliasing
on dark ground. One lit card's shadows alone, at zoom 4: SSIM 0.9987. Node-graph films therefore stay refused natively
until P2.2c. (An earlier status count of "26 of 28" counted frame 150 twice; it is 24 of 26 distinct frames.)

Found and fixed while measuring (each moved several frames by thousandths): Chrome draws the `1.5px` border at 1 px;
line boxes keep 21.6 px with baselines rounded; the chip is pixel-snapped; the backdrop blur is drawn; wrapped TextReveal
rows start at the block's left (merged separately, #318).

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/renderIr/*.test.ts backend/nativeRenderer.test.ts backend/rendererSelection.test.ts` | PASS (65) | includes the 4 new emitter tests |
| `npx tsc --noEmit -p .`, `npx eslint` on the changed TS files | PASS | |
| scratch parity journeys (outside the repo) | see table | `/home/mani/aideos-linux-home/data/aideos-native-phase2-nodegraph/p22b/` |

## Test changes

- None to existing tests. New: `backend/renderIr/emitNodeGraph.test.ts` (4 tests) and its fixture
  `test_fixtures/packages/node-graph-flat/film.json`.

## Fix attempts

- Attempts used: 0 / 3.
