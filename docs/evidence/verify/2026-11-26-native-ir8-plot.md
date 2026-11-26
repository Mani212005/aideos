<!-- File Description: Verification evidence log for Phase 2 step P2.8a of the native renderer: Render IR aideos.render/8 (svg nodes allowed in the overlay, a strict superset of /7) and the Plot device drawn natively as an svg node in a card or an inset, behind the plots journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: Render IR /8 and the Plot device (P2.8a)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-ir8-overlay-svg`
- **Scope**:
  - Render IR `aideos.render/8`: `backend/renderIr/schema.ts` (`RENDER_IR_VERSION_8`, `renderIrSchemaV8`, `/7`'s structure), `validate.ts` (svg nodes allowed in a `/8` overlay), `jsonSchema.ts` and `scripts/render_ir_schema.ts` (the committed `aideos.render.8.schema.json`, identical to `/7`'s apart from the version), the Rust loader (`VERSION_8`, `SCHEMA_V8_JSON`, the version gate, the overlay rule in `semantic.rs`), the renderer (`draw_overlay_node` draws an svg node), shared fixtures (`valid/overlay-svg.json`, `invalid/v7-overlay-svg.json`, the unsupported-version example moved from `/8` to `/9`).
  - Plot: `src/dl/plotSpline.ts` (the spline moved out of `primitives.tsx` unchanged, shared by the component and the emitter), `backend/renderIr/emitPlot.ts` (the generated asset and its element tracks), `backend/renderIr/emit.ts` (`nativeSupport` accepts a Plot alone in an inset or under a TextReveal; `plotNodes`; a card's generated assets and files; `/8` with an empty underlay when a card draws an svg).
  - The fixture `test_fixtures/packages/plots`, the journey `backend/journeys/plots.journey.ts`, its weight, docs.
- **Risk tier**: Medium (a new IR version; films with a Plot in an inset or under a headline now render natively in `auto`; every other film emits the same document and version).

## Why this slice

Firstmate decision 042: option (1), Render IR `/8` with svg nodes in the overlay, to unlock the svg devices, one PR per block
family; the unsupported-version fixture moves to `/9` with the same assertion strength; `/8` a strict superset of `/7`. Plot is
the first family and the version's first measured consumer.

## What Chrome draws, measured

- The Plot's SVG, its draw-on and its layout as described in `docs/NATIVE_RENDERER.md` (P2.8a).
- Chrome clips an svg element's content to the element's box: the width-limited inset plot's y label ("latency", drawn at
  x < 0 in plot units) shows as "tency" in Chrome. Drawn whole natively, the long inset frames measured 0.99821; with the asset's
  content clipped to the element box (a `clipPath`), 0.99838.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

`plots`, long and reel: frame 45, every 4th frame 92 to 200 and 330 to 420, 220, 239, 300, 450, 479, 520, and the end card (600,
659): none under 0.995; lowest reel 358 0.99834.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/plots.journey.ts`: native chosen for both formats; all 39 frames at or above 0.995 (42 s) |
| Property test for new invariants | N/A | the `/8` rules are pinned by the shared fixtures, read by both loaders |
| Differential test on replacement | PASS | the frame sweep above (scratch, outside the repo) |
| Expect / golden test for complex output | PASS | no golden or expect change; films without a Plot keep their version and bytes |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; see Test changes |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsx scripts/render_ir_schema.ts` then `--check` | PASS | writes `aideos.render.8.schema.json`; `/1` to `/7` byte-identical |
| `cargo test --release -p aideos-render -p aideos-render-ir` | PASS (every test binary) | |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts`, `renderIr.test.ts` | PASS (21, 2, 12) | |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- plots` | PASS | |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/plots.journey.ts` | PASS (1) | 42 s |

## Test changes

- `backend/renderIr/renderIr.test.ts` and `native/aideos-render-ir/tests/fixtures.rs`: the expected supported-version text gains
  `aideos.render/8` (same exact-equality assertion).
- `native/aideos-render/tests/cli.rs`: the unsupported-version example moves from `aideos.render/8` to `aideos.render/9`, now that
  `/8` is read (same assertion).
- `native/aideos-render-ir/fixtures/invalid/unsupported-version.json` and `expectations.json`: the unsupported example moves to `/9`
  (same expected verdict); new fixtures `valid/overlay-svg.json` and `invalid/v7-overlay-svg.json` (`node_not_allowed` at
  `/overlay/0/children/0/kind`).
- `backend/renderIr/emit.test.ts`, "a film the native renderer cannot draw is refused with every reason": its example of an
  unsupported block in an inset was a Plot, which P2.8a draws; it is now a MatrixGrid (still refused: it sets the italic serif,
  Firstmate decision 042), with the same assertion that the reasons name that block.
- New journey `backend/journeys/plots.journey.ts` (weight 55 s in `scripts/ciJourneyShards.ts`) and fixture
  `test_fixtures/packages/plots`.
- No tolerance, threshold, bar or golden is edited, loosened or removed.

## Fix attempts

- Attempts used: 2 / 3 (the empty underlay `/8` requires; the plot clipped to its element box).
