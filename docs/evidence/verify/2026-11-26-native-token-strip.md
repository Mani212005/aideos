<!-- File Description: Verification evidence log for Phase 2 step P2.5b of the native renderer: the TokenStrip device alone in an inset panel and under a headline on the frame stage, drawn natively behind the token_strips journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: the TokenStrip device (P2.5b)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p25b`
- **Scope**: `backend/renderIr/emit.ts` (`nativeSupport` accepts a TokenStrip alone in an inset or under a TextReveal, refuses one alone on the frame stage and one whose caption would wrap (`tokenStripTooWide`, `MONO_ADVANCE_EM`); `tokenStripLayout`, `tokenStripNodes`; `columnTops` takes the second block), the fixture `test_fixtures/packages/token-strips`, the journey `backend/journeys/token_strips.journey.ts`, its weight, docs. No Render IR change, no renderer change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (scene films with a TokenStrip device in an inset, and films with a headline over a TokenStrip, now render natively in `auto`; films without a TokenStrip emit the same documents).

## Why this slice

After P2.5a, the compiler's own device paths are the look plan's inset devices and `buildBlocksForShotVisual`'s headline plus
device card. `ProgressBar` was looked at first and set aside: the film schema does not allow it in an inset (`INSET_BLOCKS`).
Of the chart devices, TokenStrip is plain HTML (text and boxes), so it needs no IR change.

## What Chrome draws, measured

- The strip's layout and sweep, from devices.tsx (described in `docs/NATIVE_RENDERER.md`, P2.5b).
- JetBrains Mono advances at the chip sizes (30.24 and 21.6 px) equal the native shaper's (40-glyph runs within 1/64 px); the
  label size 16.8 px is about 0.09% narrower in Chrome (the same effect as Body at 33.6 px), which only nudges a caption's
  centring.
- Blink pixel-snaps a box's background and border; `line-height: normal` is round(ascent) + round(descent) (28 px at 21.6 px,
  where the native metrics give 29). Before these two, the reel's device card was lowest at 0.99553; after, 0.99833 overall.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

`token-strips`, long and reel: frame 45, every 6th frame 92 to 236 and 332 to 476, 239, 300, 479, 520, and the end card (600,
659): 114 frames, none under 0.995; lowest long 218 0.99833.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/token_strips.journey.ts`: native chosen for both formats; all 33 frames at or above 0.995 (36 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the frame sweep above (scratch, outside the repo) |
| Expect / golden test for complex output | PASS | no golden or expect change; films without a TokenStrip emit the same documents |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; no assertion edited |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts` | PASS (20, 2) | |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- token-strips` | PASS | one honest-data warning (the device card's tokens are illustrative) |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/token_strips.journey.ts` | PASS (1) | 36 s |

## Still refused (planned)

- A TokenStrip alone on the frame stage, under anything but a headline, or with a caption that wraps; every other device.

## Test changes

- New journey `backend/journeys/token_strips.journey.ts` (weight 50 s in `scripts/ciJourneyShards.ts`) and fixture
  `test_fixtures/packages/token-strips`.
- No assertion, tolerance, threshold, bar or golden is edited, loosened or removed.

## Fix attempts

- Attempts used: 2 / 3 (pixel-snapped chip boxes; Blink's normal line height).
