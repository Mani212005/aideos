<!-- File Description: Verification evidence log for P2.1 of the native renderer: the SVG filter subset (glow and drop shadow) drawn natively. -->

# Verification Evidence: native SVG filter subset (P2.1, first slice of native Phase 2)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-phase2-nodegraph`
- **Scope**: `native/aideos-render` SVG parser and raster (new `svg/filter.rs`, `raster/filter.rs`), the parity journey `backend/journeys/svg_filters.journey.ts`, shared journey helpers moved into `backend/journeys/nativeFrames.ts` and `backend/testSupport/pictureReelCut.ts`. Feature Map rows: Export & Rendering (native renderer), Parity & determinism gates.
- **Risk tier**: Medium (a film whose SVG artwork uses the glow or shadow subset now renders natively instead of on Remotion; every other film is unchanged, which the native goldens confirm).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `svg_filters.journey.ts` (render choice through `createSelectedRenderer` in `auto`, native frames by the release binary, Remotion stills) and `pictures_stage.journey.ts` (its helpers moved) |
| Property test for new invariants | N/A | the new logic is a fixed mapping of SVG filter markup to Skia image filters; its rules are pinned by example tests and by the differential check |
| Differential test on replacement | PASS | native against Remotion's Chrome (pinned `chrome-headless-shell`, `swangle` flags) on the same artwork; numbers below and in `docs/NATIVE_RENDERER.md` (P2.1 parity) |
| Expect / golden test for complex output | PASS | the native golden suite (`native/aideos-render/tests/golden.rs`) passes unchanged at its strict tolerance, so existing native films render the same |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | the journey stubs only the Remotion renderer object to prove it is not chosen; the native renderer, loader and binary run for real |
| Protected suites unloosened | PASS | no assertion, tolerance, timeout or golden changed; see Test changes |
| Weak-test audit | PASS | none removed |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `cargo test --locked --manifest-path native/Cargo.toml` | PASS (exit 0) | every native crate, including goldens, render, svg (5 tests, 2 new) |
| `cargo clippy --locked --manifest-path native/Cargo.toml -p aideos-render` | PASS | no warnings from the crate |
| `AIDEOS_NATIVE_TESTS_REQUIRED=1 node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/journeys/svg_filters.journey.ts backend/journeys/pictures_stage.journey.ts` | PASS (4/4) | svg_filters 9 to 12 s |
| same journey with the `origin/main` renderer sources rebuilt | FAIL as expected | the film went to Remotion (the loader refused `filter`): the reproduction of what users got before |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test scripts/ciJourneyShards.test.ts backend/rendererSelection.test.ts` | PASS (21) | |
| `npx tsc --noEmit -p .`, `npx eslint` on the changed TS files | PASS | |

Journey frames, native against Remotion on the stage (SSIM, bar 0.995): long 135 0.99764, long 285 0.99761, reel 285
0.99755. The same frames drawn with the filters removed score 0.99195, 0.99259 and 0.99255, so the gate fails if the
filters stop being drawn.

## Test changes

- `native/aideos-render/tests/render.rs` `an_svg_feature_the_renderer_does_not_draw_is_refused_not_dropped`: its
  fixture `filtered.svg` used `feGaussianBlur`, which is now drawn. The rule it encodes (an SVG feature the renderer
  does not draw is refused, not dropped) is unchanged; the fixture now uses `feTurbulence` (still Phase 2) and the
  assertion is stricter (it names the primitive instead of matching the word "filter").

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.

## Artifacts and links

- Differential harness and frames (outside the repo): `/home/mani/aideos-linux-home/data/aideos-native-phase2-nodegraph/parity/`.
