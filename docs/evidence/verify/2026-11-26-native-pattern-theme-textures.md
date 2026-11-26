<!-- File Description: Verification evidence log for Phase 2 step P2.4a of the native renderer: the blueprint-grid and subtle-dots theme textures lowered into the new Render IR aideos.render/7 underlay and drawn natively, behind a parity journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: pattern theme textures in the `/7` underlay (P2.4a)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p24a-pattern-themes`
- **Scope**: Render IR `aideos.render/7` (`underlay`: frame-space svg, image and group nodes between the background and the stage) in the zod schema, the validator, the generated JSON Schema, the Rust loader (types, version gate, semantic rules) and the renderer (underlay drawing, a top-level underlay group composited as a resampled layer); the emitter's theme texture (`backend/renderIr/emitThemeTexture.ts`) and `nativeSupport` (only `paper-fibers` is still refused); shared fixtures (`valid/underlay.json`, `invalid/v6-underlay.json`, `invalid/underlay-space.json`; the unsupported-version example moves from `/7` to `/8`); the fixtures `node-graph-blueprint` and `node-graph-dots`; the journey `theme_textures`; docs. Feature Map rows: Export & Rendering (native renderer, Render IR), Parity gates.
- **Risk tier**: Medium (films on the `blueprint` and `dot-grid` themes now render natively in `auto`; every other film is emitted and drawn exactly as before).

## What was measured first

`Film.tsx` draws the texture under the canvas at the texture layer's opacity (`blueprint-grid` 0.45, `subtle-dots` 0.35),
pushed by the end card with the canvas but not drifted. The patterns were lowered to explicit shapes (a tile in Chrome
keeps only the inner half of a stroke centred on its edges: the 0.5 px minor lines are 0.25 px, the 1 px major lines 0.5 px)
and compared alone, a whole frame each, with Chrome (swangle): blueprint SSIM 0.999965, dots 0.999939, no pixel more than one
level apart. The IR had no frame-space place under the stage, so `/7` adds the `underlay`.

Under the end card's push (up to 1.01) the first native pass was 0.990 to 0.995 on the blueprint fixture's end-card frames:
Chrome rasters the texture layer once and resamples it bilinearly rather than redrawing it (texture alone at scale 1.0099:
redrawn vectors 0.960, a 1x raster resampled 0.996, best at the exact placement, no snapping). A top-level underlay group is
therefore composited as a resampled layer (identity transform: drawn in place, the same pixels).

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg, every 15th frame of each delivered video

| Fixture | Frames (0 to 645 long and reel, long 660 to 749) | Under 0.995 | Lowest |
| --- | --- | --- | --- |
| node-graph-blueprint | 92 | 0 | long 270 0.99527, long 285 0.99568 |
| node-graph-dots | 92 | 0 | long 285 0.99512, long 90 0.99530 |

End card after the layer resampling: blueprint long 749 0.99040 -> 0.99799; every end-card frame of both fixtures 0.9960 or
above. The dot-grid fixture also puts the node-graph's dark glass cards on a light canvas, which had not been measured.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/theme_textures.journey.ts`: native chosen for both fixtures and formats; all 42 frames at or above 0.995 (73 s) |
| Property test for new invariants | N/A | the version and underlay rules are pinned by the shared fixtures, read by both loaders |
| Differential test on replacement | PASS | the sweeps above |
| Expect / golden test for complex output | PASS | no golden or expect file changes; films without a lowered texture keep their version and bytes (emit expect and golden tests pass unchanged) |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; see Test changes |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsx scripts/render_ir_schema.ts` then `--check` | PASS | writes `aideos.render.7.schema.json`; `/1` to `/6` byte-identical |
| `cargo test --release -p aideos-render-ir -p aideos-render` | PASS (every test binary) | |
| `cargo clippy --release -p aideos-render -p aideos-render-ir` | PASS with 2 warnings | both pre-existing on main (`raster/mod.rs` lines 75 and 111) |
| `node ... --test` on `backend/renderIr/renderIr.test.ts`, `emit.test.ts`, `emit.expect.test.ts`, `emitNodeGraph.test.ts`, `nativeEffects.test.ts`, `backend/rendererSelection.test.ts`, `backend/nativeRenderer.test.ts`, `scripts/ciJourneyShards.test.ts`, `backend/themeBinding.test.ts` | PASS (12, 19, 2, 5, 3, 10, 4, 11, 18) | |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- --all` | PASS | the new fixtures included |
| `npx tsx scripts/check_tests_wired.ts`, `npm run typecheck`, `npx eslint` on the changed files | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/theme_textures.journey.ts` | PASS (1) | 73 s |

## Test changes

- `backend/renderIr/renderIr.test.ts` and `native/aideos-render-ir/tests/fixtures.rs`: the expected supported-version text
  gains `aideos.render/7` (same exact-equality assertion).
- `native/aideos-render/tests/cli.rs`: the unsupported-version example moves from `aideos.render/7` to `aideos.render/8`, now
  that `/7` is read (same assertion).
- `native/aideos-render-ir/fixtures/invalid/unsupported-version.json` and `expectations.json`: the unsupported example moves to
  `/8` (same expected verdict); new fixtures `valid/underlay.json`, `invalid/v6-underlay.json` (refused by the `/6` schema),
  `invalid/underlay-space.json` (`node_not_allowed` at `/underlay/0/kind`).
- New fixtures `test_fixtures/packages/node-graph-blueprint` and `node-graph-dots`, and the journey `theme_textures` (weight
  110 s in `scripts/ciJourneyShards.ts`).
- No assertion, tolerance, threshold, bar or golden is loosened or removed.

## Fix attempts

- Attempts used: 1 / 3 (the end card: the texture layer resampled as Chrome does).
