<!-- File Description: Verification evidence log for Phase 2 step P2.5e of the native renderer: blocks on a none-stage shot, which Film.tsx never draws, no longer refuse a film (except an AnalogyInset and footage), behind the node-graph journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: blocks on a none stage (P2.5e)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p25e`
- **Scope**: `backend/renderIr/emit.ts` (`nativeSupport` skips the block checks for a `none` shot, keeping the AnalogyInset and footage refusals), the fixture `test_fixtures/packages/node-graph-quiet-blocks`, the `node_graph_native` journey (a third fixture), its weight, docs. No emitter output change (the emitter never drew `none` shots' blocks), no Render IR change, no renderer change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Low (films whose `none` shots carry blocks now render natively in `auto`; every emitted document is unchanged).

## Why this slice

Firstmate msg 040: the next lowest-risk measurable slice. The screenplay compiler (`backend/scriptIntake.ts`) gives the first
shot of every other segment a `none` stage and still fills it with primitive blocks, so such films were refused for blocks
`Film.tsx` never draws (`Stage` returns nothing for `none`). The one block `Film.tsx` draws on any stage is a full-screen
`AnalogyInset` hero from a frames directory (its hero overlay), so that stays refused, with footage.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

`node-graph-quiet-blocks` (node-graph-flat with a CodeBlock, a ProgressBar, and a Kicker, Divider and IconLabel on its `none`
shots), long and reel: every 15th frame 0 to 645 and 659: 90 frames, none under 0.995; lowest long 270 0.99541 (node-graph-flat's
own lowest frames are the same ones).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/node_graph_native.journey.ts`: native chosen for all three fixtures and both formats; all 68 frames at or above 0.995 (130 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the frame sweep above (scratch, outside the repo) |
| Expect / golden test for complex output | PASS | no golden or expect change; no emitted document changes |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; no assertion edited |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts` | PASS (23) | |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- node-graph-quiet-blocks` | PASS | |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/node_graph_native.journey.ts` | PASS (1) | 130 s, three fixtures |

## Test changes

- `backend/journeys/node_graph_native.journey.ts`: a third fixture (`node-graph-quiet-blocks`, 16 frames) with the same bar;
  weight 175 s in `scripts/ciJourneyShards.ts`. New fixture `test_fixtures/packages/node-graph-quiet-blocks`.
- No assertion, tolerance, threshold, bar or golden is edited, loosened or removed.

## Fix attempts

- Attempts used: 0 / 3.
