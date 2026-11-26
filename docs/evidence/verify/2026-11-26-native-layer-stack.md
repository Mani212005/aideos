<!-- File Description: Verification evidence log for Phase 2 step P2.5c of the native renderer: the LayerStack device alone in an inset panel and under a headline on the frame stage, drawn natively behind the layer_stacks journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: the LayerStack device (P2.5c)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p25c`
- **Scope**: `backend/renderIr/emit.ts` (`nativeSupport` accepts a LayerStack alone in an inset or under a TextReveal, refuses one alone on the frame stage and one with a `prompt`; `layerStackNodes`, `blinkNormalLineHeight`, `snapBox`; a headline over a LayerStack sits at the stage's top), the fixture `test_fixtures/packages/layer-stacks`, the journey `backend/journeys/layer_stacks.journey.ts`, its weight, docs. No Render IR change, no renderer change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (scene films with a LayerStack device in an inset, and films with a headline over a LayerStack, now render natively in `auto`; films without a LayerStack emit the same documents).

## Why this slice

Firstmate msg 037: continue with the next lowest-risk measurable slice. Of the remaining devices, LayerStack is plain HTML (mono
text and boxes, no new IR capability); MatrixGrid, Distribution and Math need the italic serif font the native renderer does not
vendor, ScaleBar needs a growing rounded bar the IR cannot animate, and the empty-chapter rail needs an IR version and unblocks
nothing yet (those fixtures are isometric, P2.3).

## What Chrome draws, measured

The layout and sweep from devices.tsx are described in `docs/NATIVE_RENDERER.md` (P2.5c). The first native pass applied what
P2.5b measured (pixel-snapped boxes, Blink's `line-height: normal`) and matched without a fix.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

`layer-stacks`, long and reel: frame 45, every 6th frame 92 to 236 and 332 to 476, 239, 300, 479, 520, and the end card (600,
659): 114 frames, none under 0.995; lowest long 110 0.99840.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/layer_stacks.journey.ts`: native chosen for both formats; all 33 frames at or above 0.995 (36 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the frame sweep above (scratch, outside the repo) |
| Expect / golden test for complex output | PASS | no golden or expect change; films without a LayerStack emit the same documents |
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
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- layer-stacks` | PASS | |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/layer_stacks.journey.ts` | PASS (1) | 36 s |

## Still refused (planned)

- A LayerStack alone on the frame stage, under anything but a headline, or with a `prompt`; one whose stack, gap and label column do not fit the column (Remotion shrinks the stack); a named bar whose label and dimension do not fit one line in the bar; a named stack whose minimum bar heights exceed its inset's content height; a named stack under a headline on the frame stage; the other devices.

## Test changes

- `backend/renderIr/emit.test.ts`: one new test asserting each height refusal by its reason (Firstmate decision 038: each
  refusal asserted with a clear reason) and that the layer-stacks fixture shapes stay native.
- New journey `backend/journeys/layer_stacks.journey.ts` (weight 50 s in `scripts/ciJourneyShards.ts`) and fixture
  `test_fixtures/packages/layer-stacks`.
- No assertion, tolerance, threshold, bar or golden is edited, loosened or removed.

## Fix attempts

- Attempts used: 0 / 3 (the first pass matched).
