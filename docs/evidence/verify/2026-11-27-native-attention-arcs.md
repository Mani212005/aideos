<!-- File Description: Verification evidence log for Phase 2 step P2.8c of the native renderer: the AttentionArcs device drawn natively as an svg node in the Render IR /8 overlay, alone in an inset and under a headline, behind the attention_arcs journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: the AttentionArcs device (P2.8c)

- **Date**: 2026-11-27
- **Branch / PR**: `fm/aideos-native-p28c`
- **Scope**: `backend/renderIr/emitAttentionArcs.ts` (new: the generated asset and its dash offset tracks), `backend/renderIr/emit.ts` (`nativeSupport` accepts an AttentionArcs alone in an inset or under a TextReveal and refuses a note that would wrap; `attentionArcsNodes`; a headline over an AttentionArcs sits at the stage's top), the fixture `test_fixtures/packages/attention-arcs`, the journey `backend/journeys/attention_arcs.journey.ts`, its weight, docs. No Render IR change (`/8`), no renderer change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (films with an AttentionArcs in an inset or under a headline now render natively in `auto`; every other film emits the same document).

## Why this slice

Firstmate msg 044: the next block family on `/8`. AttentionArcs is the last svg device that sets no italic serif: VectorSpace
sets its required arrow label (and point labels) and Distribution its "sampled" chip label in the serif, which stays the owner's
decision (Firstmate decision 042), so both stay refused.

## What Chrome draws

The device and its layout as described in `docs/NATIVE_RENDERER.md` (P2.8c). Chrome draws each arc with `pathLength={1}`: the
dash and offset are fractions of the arc's own length, so the asset dashes each arc by its measured length and offsets it by the
same eased fraction.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

`attention-arcs`, long and reel: frame 45, every 4th frame 92 to 236 and 330 to 476, 239, 300, 479, 520, and the end card (600,
659): 162 frames, none under 0.995; lowest long 112 0.99751 (the inset opening on its pan).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/attention_arcs.journey.ts`: native chosen for both formats; all 41 frames at or above 0.995 (47 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the frame sweep above (scratch, outside the repo) |
| Expect / golden test for complex output | PASS | no golden or expect change; films without an AttentionArcs emit the same documents |
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
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- attention-arcs` | PASS | |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/attention_arcs.journey.ts` | PASS (1) | 47 s |

## Still refused (planned or owner-held)

- An AttentionArcs alone on the frame stage, with any block but a headline, or with a note that would wrap.
- VectorSpace, Distribution, MatrixGrid and Math (the italic serif, owner-held per decision 042).

## Test changes

- New journey `backend/journeys/attention_arcs.journey.ts` (weight 60 s in `scripts/ciJourneyShards.ts`) and fixture
  `test_fixtures/packages/attention-arcs`.
- No assertion, tolerance, threshold, bar or golden is edited, loosened or removed.

## Fix attempts

- Attempts used: 0 / 3 (the first pass matched).
