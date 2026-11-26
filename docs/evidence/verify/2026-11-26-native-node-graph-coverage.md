<!-- File Description: Verification evidence log for the node-graph coverage slice: the node-graph cases P2.2c draws natively but had not measured (a bright accent, small nodes above the shadow cap zoom, cards close together and overlapping, a StatCounter over the canvas), measured against the swangle reference; the card backdrop drawn as Chrome draws it; overlapping cards refused. -->

# Verification Evidence: node-graph coverage (accent, zoom, cards close together, StatCounter)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-nodegraph-coverage`
- **Scope**: the fixture `test_fixtures/packages/node-graph-cases`; `backend/renderIr/emitNodeGraph.ts` (the backdrop copy clipped to the card and mirrored at its edges; `nodeGraphCanvasReasons` refuses overlapping cards); `backend/renderIr/emitNodeGraph.test.ts` (one test added, see Test changes); `backend/journeys/node_graph_native.journey.ts` (a second fixture); its weight in `scripts/ciJourneyShards.ts`; docs. No renderer, IR, golden or expect change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (node-graph films with overlapping cards go back to Remotion; the backdrop of a card with an edge behind it changes by under a level).

## Why

After P2.2c the renderer choice in `auto` sends every flat node-graph film to native, but only one fixture was measured.
Firstmate asked for the cases it did not reach to be measured against the swangle reference at the same bar (0.995 on
every measured frame), and for any case that cannot clear it to be refused natively with a clear reason.

## The fixture

`node-graph-cases`: accent `#F59E0B` (amber, much brighter than `#635BFF`), two 120 x 48 nodes the camera solves to a zoom of
9.3 (long) and 6.1 (reel), above the 6.4 at which a lit card's 40 px shadow meets Chrome's 128 device px box-shadow cap,
two cards 46 units apart with an edge running between and behind them, both lit in turn, and a StatCounter (12000) in a
frame shot over the canvas; six shots over two chapters, 540 story frames, end card to 720 (long) and 630 (reel).

## Findings, each measured against Remotion (swangle), stage SSIM by ffmpeg

1. **Overlapping cards: refused.** With the front card overlapping the back one, 10 of 88 sweep frames were under the bar
   (lowest long 345 at 0.99009): Chrome's `backdrop-filter` blurs the back card (body, border, glow) into the front card,
   and the canvas's backdrop copy carries only the canvas colour and the edges. `nativeSupport` now refuses node-graph
   cards whose boxes overlap (the lit card's 2% lift included) with the reason
   `the node-graph cards "<a>" and "<b>" overlap: a card's backdrop blur over another card is not drawn natively`.
2. **The backdrop edge: fixed.** With the cards apart, two frames were still under the bar (long 345 0.99463, long 285
   0.99489): an amber edge passing behind the lit card. Chrome blurs only what lies inside the card's border box, with
   mirrored edges (probe: a white bar 24 device px outside a backdrop-blurred box never reaches it; a bar 6 to 12 px
   inside the edge reads 79 at the edge, a mirror's 83, not a clamp's 47). The canvas blurred a region reaching 36 units
   past the box, so light from outside bled in. The copy is now clipped to the box with its mirror images across each
   edge and corner, then blurred and cut to the rounded box. Chrome ignores `edgeMode` on SVG `feGaussianBlur` (none,
   mirror and duplicate draw the same), so the mirror is built from plain SVG and the native SVG subset is unchanged.
3. **The accent, the zoom above the shadow cap, the StatCounter: clear the bar** (below).

## Sweeps after the change: every 15th frame of each delivered video, long and reel

| Fixture | Frames | Under 0.995 | Lowest |
| --- | --- | --- | --- |
| node-graph-cases | 88 (0 to 615 both formats, long 630 to 719) | 0 | long 345 0.99510, long 285 0.99539, long 330 0.99540 |
| node-graph-flat | 95 (0 to 645 both formats, long 660 to 749) | 0 | long 270 0.99541, long 285 0.99552 |

On node-graph-flat the backdrop change is neutral: mean SSIM change -0.00003 over 88 common frames, at most -0.0003 (long
240), all frames still clear. On node-graph-cases it lifted long 285 0.99489 to 0.99539 and long 345 0.99463 to 0.99510.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/node_graph_native.journey.ts`: native chosen for both fixtures and both formats; all 52 frames at or above 0.995 (91 s) |
| Property test for new invariants | N/A | one geometric refusal, pinned by its test |
| Differential test on replacement | PASS | the sweeps above, native against Remotion's own stills |
| Expect / golden test for complex output | PASS | no golden or expect file changes |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar `STAGE_SSIM_MIN` (0.995) unchanged; node-graph-flat's frames unchanged |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emitNodeGraph.test.ts`, `emit.test.ts`, `emit.expect.test.ts`, `backend/rendererSelection.test.ts`, `backend/nativeRenderer.test.ts`, `scripts/ciJourneyShards.test.ts` | PASS (5, 19, 2, 10, 4, 11) | |
| `npx tsx scripts/check_tests_wired.ts`, `npm run typecheck`, `npx eslint` on the changed files | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/node_graph_native.journey.ts` | PASS (1) | 91 s |
| scratch sweeps (outside the repo) | PASS | the tables above |

## Test changes

- New fixture `test_fixtures/packages/node-graph-cases` (firstmate asked for this measurement).
- `backend/renderIr/emitNodeGraph.test.ts`: one test added, encoding firstmate's rule that a case which cannot clear the
  bar is refused with a clear reason: the fixture is accepted, and the same film with its front card moved over the back
  card is refused in both formats with exactly the overlap reason.
- `backend/journeys/node_graph_native.journey.ts`: the second fixture and its frames added; node-graph-flat's frames and
  the bar are unchanged. Weight 130 s in `scripts/ciJourneyShards.ts`.
- No assertion, tolerance, threshold, bar or golden is loosened or removed.

## Fix attempts

- Attempts used: 1 / 3 (the backdrop: clipped and mirrored; the overlap refused).
