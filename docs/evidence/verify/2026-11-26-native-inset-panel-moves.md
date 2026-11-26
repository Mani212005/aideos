<!-- File Description: Verification evidence log for Phase 2 step P2.6b of the native renderer: the inset panel on the first shot and the inset panel that opens on a camera move (its open and close fade and delayed content) drawn natively, behind the inset_panel journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: the inset panel on a camera move (P2.6b)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p26b-inset`
- **Scope**: `backend/renderIr/emit.ts` (`nativeSupport` no longer refuses a first-shot inset or an inset on a camera move; `insetMotion`: the panel's open and close opacity and the content column's fade; the blocks start at the content's start), the fixture `test_fixtures/packages/inset-moves`, the journey `backend/journeys/inset_panel.journey.ts` (a second fixture), its weight, docs. No Render IR change, no renderer change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (scene films whose inset shots open on a camera move, the form compiled films use, now render natively in `auto`; the cut form of P2.6a emits the same document).

## Why this slice

`backend/pipeline/design.ts` gives every shot a `pan` unless it is the first or starts a chapter, so a compiled film's inset
shots open on a move; P2.6a drew only the cut form.

## What Chrome draws, measured

`Film.tsx` `Stage`, for a shot that is not a cut and not the first: panel opacity `min(1, 1.4 * open) * (1 - close)`, `open` =
ease-out-expo over 900 ms from the shot's start, `close` = the same over its last 420 ms; the content column's opacity is linear
from 55% to 100% of the move, and the blocks' own entrance starts at 55% of the move (rounded to a frame). The first shot is
drawn still. Mid-fade pixels in Chrome and native agree exactly (long frame 152, panel 15, 15, 17 in both; frame 258 the number
75, 69, 189 in both).

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

`inset-moves`, long and reel: frames 0, 45, 89, 120, every second frame 150 to 180, 200, 240, every second frame 250 to 268,
269, 280, 330, 359, and the end card (420, 449): 76 frames, none under 0.995; lowest long 45 0.99847.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/inset_panel.journey.ts`: native chosen for both fixtures and formats; all 54 frames at or above 0.995 (57 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the sweep above |
| Expect / golden test for complex output | PASS | no golden or expect change; the cut form emits the same document |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; see Test changes |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts`, `backend/insetStage.test.ts`, `backend/rendererSelection.test.ts`, `backend/designCheck/designCheck.test.ts` | PASS (20, 2, 6, 10, 46) | |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- inset-moves` | PASS | |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/inset_panel.journey.ts` | PASS (1) | 57 s, two fixtures |

## Still refused (planned)

- An inset with no block, an inset in a node-graph film (no scene), an inset holding anything but one StatCounter.

## Test changes

- `backend/renderIr/emit.test.ts`, the P2.6a inset test (added on Firstmate decision 032 to keep unmeasured inset forms
  refused): the first-shot and camera-move cases change from "refused by name" to "native" (`deepEqual(..., [])`, the same exact
  assertion the measured form already used), because P2.6b measures both behind the journey. The camera-move case puts the
  counter on the probe's `closing` shot, which already opens on a pan (a pan on the `count` shot cannot start its chapter). The
  empty-inset and node-graph refusals are unchanged.
- `backend/journeys/inset_panel.journey.ts`: a second fixture (`inset-moves`, 33 frames) with the same bar; weight 75 s.
- New fixture `test_fixtures/packages/inset-moves`.
- No tolerance, threshold, bar or golden is edited, loosened or removed.

## Fix attempts

- Attempts used: 0 / 3 (the first pass matched).
