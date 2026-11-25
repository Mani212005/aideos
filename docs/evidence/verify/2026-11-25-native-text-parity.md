<!-- File Description: Verification evidence log for the native 2D text parity follow-up (Chrome-matched letter spacing, ligatures, text gamma, SVG and caption baselines). -->

# Verification Evidence: native 2D text and end card parity with Chrome

- **Date**: 2026-11-25
- **Branch / PR**: fm/aideos-native-text-parity (PR URL added by the pipeline)
- **Scope**: `native/aideos-render/src/raster/{text,chrome,svg}.rs`, `native/aideos-render/src/{renderer,gpu}.rs` (text shaping, placement and glyph gamma), the native golden set `native/aideos-render/fixtures/golden/` (IR re-emitted and frames remade), `docs/NATIVE_RENDERER.md`. Feature Map rows: Export & Rendering (native renderer, Render IR), Golden frame & audio suites, Parity & determinism gates (file lists unchanged).
- **Risk tier**: Medium (every native frame with text changes by design, toward Chrome; the native goldens were remade at the same tolerance)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `native_character_goldens.journey.ts` (films built from their packages, emitted, drawn by the release binary, compared with the remade goldens at the strict tolerance) and `pictures_stage.journey.ts` (native golden match and native against Remotion SSIM at least 0.995) ran green with `AIDEOS_NATIVE_TESTS_REQUIRED=1`. Other journeys run in the pipeline. |
| Property test for new invariants | N/A | No new pure invariant; the changes are rendering rules measured against Chrome. |
| Differential test on replacement | PASS | Native against Remotion (Chrome) on every compared frame of hello-scene, pixels-stage-pip, journey-j3-j4-dots and still-talking, both formats, before (main) and after (this branch); table in `docs/NATIVE_RENDERER.md`, Text parity follow-up. Frames under 0.995: 71 before, 49 after (all on still-talking long, scene art). |
| Expect / golden test for complex output | PASS | Native goldens remade with `npm run goldens:native:ir` and `AIDEOS_NATIVE_GOLDEN_UPDATE=1` (each frame rendered twice, identical); the run against the old goldens before the update failed only on frames that show text (0.11% to 0.93% of pixels changed). `emit.expect.test.ts` passes unchanged. |
| No sleeps in tests | PASS | No test added or changed. |
| No mocks of the thing under test | PASS | Real renderer, real emitter, real Remotion. |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or Chrome golden changed; the native golden tolerance (mean 0.05, 0.1% over 8) is unchanged and only frame bytes and manifest byte sizes moved. |
| Weak-test audit | N/A | No test touched besides the remade native golden frames. |
| Independent review | PENDING | no-mistakes pipeline review. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `cargo build --locked --release --manifest-path native/Cargo.toml -p aideos-render` | PASS (exit 0) | |
| `cargo check --locked --manifest-path native/Cargo.toml -p aideos-render --features gpu` | PASS (exit 0) | the GPU surface takes the same text properties |
| `npm run goldens:native:ir` | PASS (exit 0) | reel IRs: spaced text widths move by up to 0.04 px; still-talking long: the text card row 1 px |
| `cargo test --locked --manifest-path native/Cargo.toml -p aideos-render --test golden` (old goldens) | FAIL (exit 101), expected | 30 text frames moved; the reason for the remake |
| `AIDEOS_NATIVE_GOLDEN_UPDATE=1 cargo test ... --test golden` | PASS (exit 0) | |
| `cargo test --locked --manifest-path native/Cargo.toml` | PASS (exit 0) | every crate, text_parity 3/3, golden 2/2, video 6/6 |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/renderIr/*.test.ts backend/nativeRenderer.test.ts` | PASS (44/44) | |
| `node ... --test backend/journeys/native_character_goldens.journey.ts` | PASS (2/2) | |
| `node ... --test backend/journeys/pictures_stage.journey.ts` | PASS (3/3) | |

## Fix attempts

- Attempts used: 0 / 3. Two candidate changes were measured and dropped (whole-pixel glyph positioning; gradient dither off), both further from Chrome.

## Weak-test removals

- None.

## Artifacts and links

- `/home/mani/aideos-linux-home/data/aideos-native-text-parity/` (`before/` and `after/` per-frame SSIM and summaries, `handoff.md`, test logs).
