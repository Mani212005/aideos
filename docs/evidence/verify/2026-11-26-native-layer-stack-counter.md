<!-- File Description: Verification evidence log for Phase 2 step P2.5d of the native renderer: a LayerStack whose k / n counter gains a digit mid-sweep (10 or more bars, the schema default 32) drawn natively, its label column widening and the centred stack moving as in Remotion, behind the layer_stacks journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: the LayerStack counter gaining a digit (P2.5d)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p25d-counter`
- **Scope**: `backend/renderIr/emit.ts` (`layerStackNodes` draws the stack once per label column width over that width's frames; `CHROME_MONO_ADVANCE_SIZE` and `chromeMonoAdvanceSize` for the column's label widths; the P2.5c refusal of a counter that gains a digit is lifted), the layer-stacks fixture's device card (twelve bars), the `layer_stacks` journey (three more frames), its weight, docs. No Render IR change, no renderer change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Low (LayerStacks of 10 or more bars with short labels, the schema default included, now render natively in `auto`; a stack with one column width emits the same document as before).

## Why this slice

Firstmate msg 039: the next lowest-risk measurable slice. P2.5c refused this case (review finding) and named it as the
follow-up; the schema's default `count` is 32, so it covers the common anonymous stack.

## What Chrome draws, measured

- The label column (`flex: none`) is as wide as its widest line at each step; at k = 10 the counter gains a digit and, when it is
  the widest line, the column widens and the centred stack moves left by half a label character.
- Chrome's mono advance at 16.8 px is 10.0688 px (300-glyph runs; the native shaper gives 10.08), equal to the native shaper's at
  16.7813 px; at 12 px it is exact. With native widths the stack's left edge after the shift was 676.49 (snapped to 676, Chrome
  677), putting 24 frames under the bar (lowest long 428 0.99335); measured at Chrome's advance size, all pass.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

`layer-stacks` (device card: twelve bars, labels "Out" and "In"), long and reel: the P2.5c frame set plus every 2nd frame 430 to
470: 142 frames, none under 0.995; lowest long 110 0.99840.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/layer_stacks.journey.ts`: native chosen for both formats; all 39 frames at or above 0.995 (42 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the frame sweep above (scratch, outside the repo) |
| Expect / golden test for complex output | PASS | no golden or expect change; a stack with one column width emits the same document |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; no assertion edited |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts` | PASS (23) | the P2.5c refusal tests pass unchanged |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- layer-stacks` | PASS | |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/layer_stacks.journey.ts` | PASS (1) | 42 s |

## Test changes

- `backend/journeys/layer_stacks.journey.ts`: the fixture's device card stack goes from eight to twelve bars (labels "Out" and
  "In") so its counter gains a digit mid-shot; frames 426, 440 and 460 added in both formats; same bar. Weight 55 s.
- No assertion, tolerance, threshold, bar or golden is edited, loosened or removed. No test asserted the lifted refusal.

## Fix attempts

- Attempts used: 1 / 3 (label widths at Chrome's mono advance size).
