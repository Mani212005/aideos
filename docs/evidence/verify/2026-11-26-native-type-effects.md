<!-- File Description: Verification evidence for opt-in native glyph tracks and the 2D shutter. -->

# Verification Evidence: native type effects

- **Date**: 2026-11-26
- **Branch**: fm/aideos-type-effects
- **Scope**: Render IR and native 2D effects rows in the Feature Map.
- **Risk tier**: Medium. The change touches the shared renderer, but the effect fields require a new IR version and existing films follow the integer path.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | Native CLI loaded the effects fixture and rendered 1080p stills; `effects.rs` runs the real loader and CPU renderer in long and reel. No editor integration is claimed. |
| Property test for new invariants | PASS | Seeded fractional track bounds and integer parity in `evaluator.rs`. |
| Differential test on replacement | PASS | Existing fixture rendered identically as /1 and /4 without effects in both formats; all existing native golden frames passed. |
| Expect / golden test for complex output | PASS | Reviewed separate glyph and shutter PNGs and compared them in `effects.rs` at the native golden thresholds. |
| No sleeps in tests | PASS | No sleeps added. |
| No mocks of thing under test | PASS | The real loaders, font shaping and CPU raster run in tests. |
| Protected suites unloosened | PASS | Firstmate approved the new-version contract update described below; no assertion, tolerance or golden was weakened. |
| Weak-test audit | PASS | No tests removed. |
| Independent review | PENDING | Firstmate-directed no-mistakes pipeline will provide independent review after the commit handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/renderIr/renderIr.test.ts` | PASS | 11 tests, including shared /4 fixtures and schema. |
| `cargo test --offline --locked --release --manifest-path native/Cargo.toml -p aideos-render-ir --test fixtures` | PASS | 10 tests across the shared TypeScript and Rust fixture corpus. |
| `cargo test --offline --locked --release --manifest-path native/Cargo.toml -p aideos-render --test effects --test evaluator -- --test-threads=1 --nocapture` | PASS | 7 effects and 11 evaluator tests. Final effects-only rerun also passed after the glyph lookup refinement. |
| `cargo test --offline --locked --release --manifest-path native/Cargo.toml -p aideos-render --test golden -- --test-threads=1` | PASS | 43 existing frames at the existing thresholds. |
| `./node_modules/.bin/tsc --noEmit --skipLibCheck --esModuleInterop --module commonjs --moduleResolution node --target ES2022 backend/renderIr/schema.ts backend/renderIr/validate.ts backend/renderIr/jsonSchema.ts scripts/render_ir_schema.ts` | PASS | Targeted type check. |
| `./node_modules/.bin/eslint backend/renderIr/schema.ts backend/renderIr/validate.ts backend/renderIr/jsonSchema.ts backend/renderIr/renderIr.test.ts scripts/render_ir_schema.ts` | PASS | Targeted lint. |
| `npm run render-ir:schema -- --check` | PASS | All four generated schemas match. |
| `./node_modules/.bin/tsx scripts/check_headers.ts` | PASS | All 727 code files passed. |
| `git diff --check` | PASS | No whitespace errors. |

The 24-frame 1920 x 1080 CPU raster and readback loop, with eight shutter samples on one worker, measured 20.178 fps in one run and 5.643 fps in another under shared machine load. This excludes encoding and does not establish the 15 delivered-fps target. The final rerun measured 6.679 fps and its output is in the task handoff. Full static, journey, and independent review gates remain for the instructed pipeline.

## Fix attempts

- One new shared fixture initially expected the stage3d node at index 0; the source fixture places it at index 1. Corrected the new expected path and both loader suites passed.
- A first shutter raster used RGBA instead of the reference N32 surface, changing caption pixels. Using the reference surface restored pixel-identical captions; the real raster test now checks them.

## Test changes

- The approved unsupported-version fixture advances from /4 to /5, and both exact supported-version expectations include /4. The original rejection and error assertions remain intact. /4 without effects is tested through both loaders and against existing frame pixels.
- Added native effects, fractional track property, shared validation fixture, and reviewed golden coverage. No tests were removed.

## Artifacts and links

- Reviewed reference frames: `native/aideos-render/fixtures/effects/`.
- Local run logs: `/home/mani/aideos-linux-home/data/aideos-type-effects/`.
