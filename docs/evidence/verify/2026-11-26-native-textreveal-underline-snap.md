<!-- File Description: Verification evidence log for the native emitter's TextReveal underline pixel snap (the accent underline is placed on whole pixels, as Blink paints it). -->

# Verification Evidence: native TextReveal underline pixel snap

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-underline-snap`
- **Scope**: `backend/renderIr/emit.ts` (`textRevealNodes` and a one-line rounding helper), the two captured emit expect files, the still-talking native golden IR (long and reel) and one line of `docs/NATIVE_RENDERER.md`. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (the accent underline of a TextReveal moves by under half a pixel, towards where Remotion draws it; nothing else in any document changes).

## The defect

TextReveal's accent underline is an absolutely positioned span with `transform: scaleX(draw)`. Blink rounds the paint
offset of an element whose transform is not a pure translation to whole pixels and drops the fractional part (the
subpixel accumulation is not propagated through a scale), so the underline's box paints at its rounded layout position.
The native emitter placed it at the fractional layout position. Measured on the node-graph-flat fixture at long frames
45 and 60: Chrome's layout puts the underline's top at 692.5625 (`getBoundingClientRect`, same as the emitter), but its
painted top, fitted from the sub-pixel coverage of its edges, is 0.45 px lower in both frames once the frame's drift scale
is undone, which is 693 - 692.5625 = 0.4375 times the drift scale. The emitter now rounds the underline's x and y the way
Blink's `ToRoundedVector2d` does (half away from zero); its width and height stay exact.

Found while matching node-graph films (Phase 2 step P2.2c): it was the main cause of node-graph-flat long 45 staying
under the 0.995 bar.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | still-talking (a committed scene fixture with two accent underlines) and node-graph-flat, emitted and drawn by the release binary and rendered by Remotion (scratch journeys, outside the repo) |
| Property test for new invariants | N/A | a fixed rounding of one placement, pinned by the captured IR |
| Differential test on replacement | PASS | native against Remotion before and after (tables below) |
| Expect / golden test for complex output | PASS | the two captured emit expect files and the still-talking golden IR regenerated and reviewed node by node: only the four underline placements move (below); every other golden IR is byte-identical; every native golden frame is byte-identical (`AIDEOS_NATIVE_GOLDEN_UPDATE=1` rewrote no PNG: the golden frames do not show these underlines) |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | the emitter runs for real (the emit tests' measurer is the existing fake) |
| Protected suites unloosened | PASS | see Test changes |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## The golden change, shown explicitly

`native/aideos-render/fixtures/golden/still-talking/render.{long,reel}.json`: exactly four values move, every other node,
track and top-level field is identical (compared node by node against HEAD):

| Format | Node | Placement before | after |
| --- | --- | --- | --- |
| long | `card-0-b0-w1-underline` | x 881.6792, y 619.9840 | x 882, y 620 |
| long | `card-24-b0-w3-underline` | x 1054.0240, y 577.2 | x 1054, y 577 |
| reel | `card-0-b0-w1-underline` | x 484.0512, y 956.56 | x 484, y 957 |
| reel | `card-24-b0-w3-underline` | x 607.1599, y 926 | x 607, y 926 |

Widths and heights are unchanged. No golden frame (still-talking long 924 and 2773, reel 1848) shows either underline,
so no golden PNG changes and the golden tolerance is untouched.

## Native against Remotion

still-talking, a window around each underline (26 px tall, the underline's width plus 6 px each side): mean absolute
channel difference against the Remotion still, and the underline's centre line (coverage-weighted):

| Frame | Window difference before | after | Centre y Remotion | before | after |
| --- | --- | --- | --- | --- | --- |
| long 40 | 0.757 | 0.633 | 620.50 | 620.50 | 620.50 |
| long 60 | 0.773 | 0.649 | 620.50 | 620.50 | 620.50 |
| long 4540 | 2.283 | 0.284 | 577.50 | 577.55 | 577.50 |
| long 4560 | 2.284 | 0.285 | 577.50 | 577.55 | 577.50 |
| reel 40 | 5.342 | 0.832 | 957.50 | 957.06 | 957.50 |
| reel 60 | 5.342 | 0.832 | 957.50 | 957.06 | 957.50 |
| reel 4540 | 0.673 | 0.665 | 926.50 | 926.50 | 926.50 |
| reel 4560 | 0.673 | 0.665 | 926.50 | 926.50 | 926.50 |

The whole-stage SSIM of these still-talking frames moves by at most 0.00025 (long 4540: 0.99562 to 0.99566; reel 40:
0.99595 to 0.99620; none goes down), because the underline is a small part of the frame.

node-graph-flat with the node-graph canvas opted in (`nodeGraphCanvas`, not yet used for users), stage SSIM:

| Frame | Before | After |
| --- | --- | --- |
| long 45 | 0.99359 | 0.99503 |
| long 60 | 0.99650 | 0.99683 |
| reel 45 | 0.99807 | 0.99841 |
| reel 60 | 0.99790 | 0.99833 |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run goldens:native:ir` (then the wiped golden frames and MANIFEST restored from git) | PASS | only `still-talking/render.{long,reel}.json` differ |
| `cargo test --release -p aideos-render --test golden` | PASS (2) | with the new golden IR |
| `AIDEOS_NATIVE_GOLDEN_UPDATE=1 cargo test --release -p aideos-render --test golden` | PASS | no golden PNG rewritten differently |
| `AIDEOS_UPDATE_EXPECT=1 node ... --test backend/renderIr/emit.expect.test.ts` | PASS (2) | the probe film's underline: long x 802.08, y 619.98 to 802, 620; reel x 427.2, y 956.56 to 427, 957 |
| `node ... --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts`, `emitNodeGraph.test.ts`, `backend/timelineResults.expect.test.ts`, `backend/rendererSelection.test.ts`, `backend/nativeRenderer.test.ts` | PASS (19, 2, 4, 3, 10, 4) | |
| scratch journeys (outside the repo) | PASS | the tables above |

## Test changes

- `test_fixtures/expect/render-ir/native-probe.long.json` and `native-probe.reel.json`: regenerated; only the accent
  underline's placement changes (to whole pixels).
- `native/aideos-render/fixtures/golden/still-talking/render.long.json` and `render.reel.json`: regenerated; only the
  four underline placements in the table above change. No golden frame changes.
- No assertion, tolerance, timeout or golden-frame selection is edited.

## Fix attempts

- Attempts used: 0 / 3.
