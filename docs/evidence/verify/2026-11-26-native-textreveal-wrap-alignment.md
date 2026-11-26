<!-- File Description: Verification evidence log for the native emitter's wrapped TextReveal alignment fix (rows start at the block's left, as in Remotion). -->

# Verification Evidence: native TextReveal wrapped-row alignment

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-textreveal-align`
- **Scope**: `backend/renderIr/emit.ts` (`textRevealNodes`), its test, the two captured emit expect files and one line of `docs/NATIVE_RENDERER.md`. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (the native text layout of a wrapped headline moves; a headline on one row is placed bit for bit as before).

## The defect

In Remotion a TextReveal is a wrapping flex row with `justify-content: flex-start` (no panel provides a centred
`AlignContext`) inside a panel column with `align-items: center`: the block is as wide as its content up to the stage
and centred, and its rows start at the block's left. A headline that wraps therefore starts at the stage's left edge.
The native emitter centred every row instead, so a wrapped headline drew at the wrong place (found while matching
node-graph films, P2.2b).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | a hello-scene copy whose second headline wraps, emitted and drawn by the release binary and rendered by Remotion (scratch journey, outside the repo) |
| Property test for new invariants | N/A | the rule is a fixed layout mapping, pinned by the emit test and the captured IR |
| Differential test on replacement | PASS | native against Remotion before and after the fix on the wrapped headline (table below) |
| Expect / golden test for complex output | PASS | the two captured emit expect files regenerated with `AIDEOS_UPDATE_EXPECT=1` and reviewed: only the x of the wrapped card's words moves (1.6 px left on the probe film); every committed native golden IR regenerates byte-identical (`npx tsx scripts/native_golden_ir.ts` then restored), so no native golden frame changes |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | the emitter runs for real (the emit test's measurer is the existing fake) |
| Protected suites unloosened | PASS | see Test changes |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Native against Remotion (SSIM by ffmpeg), the wrapped headline of a hello-scene copy

| Frame | Whole frame before | after | Stage (above the caption band) before | after |
| --- | --- | --- | --- | --- |
| long 120 | 0.91821 | 0.99950 | 0.88687 | 0.99958 |
| long 150 | 0.91820 | 0.99948 | 0.88689 | 0.99959 |
| reel 120 | 0.95351 | 0.99944 | 0.93620 | 0.99924 |
| reel 150 | 0.95342 | 0.99941 | 0.93608 | 0.99920 |

The films firstmate named (hello-scene reel, still-talking long and reel) have no wrapped headline: at their native
golden frames the native frame before and after is pixel-identical and the SSIM against Remotion is unchanged
(hello-scene reel 150: 0.99963; still-talking long 924: 0.99855, 2773: 0.99683; reel 1848: 0.99939). An earlier draft of
the fix computed the same single-row position with a different floating-point association, which changed the last
digits of their golden IR; the fix now sums and centres exactly as before, and their IR is byte-identical.

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/renderIr/emit.test.ts backend/renderIr/emit.expect.test.ts` | PASS (21) | after regenerating the expect files |
| `npx tsx scripts/native_golden_ir.ts` (then the golden directory restored from git) | PASS | every `render.*.json` byte-identical to the committed golden IR |
| scratch journeys (outside the repo) | PASS | the SSIM tables above |

## Test changes

- `backend/renderIr/emit.test.ts` ("headline words enter in order, wrap inside the stage..."): the assertion that every
  wrapped row is centred encoded the defect. It now asserts the Remotion rule exactly: every wrapped row of the probe
  film's closing line starts at the stage's left edge (x = 96). The margin assertion is kept.
- `test_fixtures/expect/render-ir/native-probe.long.json` and `native-probe.reel.json`: regenerated; only the x of the
  wrapped card's words changes.
- No native golden frame or golden IR changes.

## Fix attempts

- Attempts used: 0 / 3.
