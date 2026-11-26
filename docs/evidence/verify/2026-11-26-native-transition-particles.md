<!-- File Description: Verification evidence for native transitions and seeded particles. -->

# Verification Evidence: Native transitions and particles

- **Date**: 2026-11-26
- **Branch**: fm/aideos-type-effects-part2-final
- **Scope**: Export and Rendering feature map row, native IR loaders and CPU raster.
- **Risk tier**: Medium. New versioned rendering paths and shader code; the existing path is unchanged when effects are absent.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | Built the real `aideos-render` CLI and rendered the fade, wipe and particle fixture IRs to PNG at frame 30. |
| Property test for new invariants | PASS | `native_effects.rs` checks seek determinism and distinct pixels across 12 seeds, including fractional shutter sampling. |
| Differential test on replacement | N/A | Additive effects, no implementation replaced; absent-effects /4 and /6 frames are compared. |
| Expect / golden test for complex output | PASS | Reviewed three CLI-generated frames and committed them as new native goldens; existing native golden suite passed unchanged. |
| No sleeps in tests | PASS | None introduced. |
| No mocks of thing under test | PASS | Tests use the real schema loader, Skia shader and CPU raster. |
| Protected suites unloosened | PASS | Existing supported-version assertions were updated to include the new version; no tolerances or golden baselines changed. |
| Weak-test audit | PASS | No tests removed. |
| Independent review | PENDING | The instructed no-mistakes pipeline owns independent review after handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `cargo check --locked --offline --manifest-path native/Cargo.toml -p aideos-render` | PASS | Native crates compile. |
| `cargo build --locked --offline --manifest-path native/Cargo.toml -p aideos-render --bin aideos-render` | PASS | Built the real CLI. |
| `native/target/debug/aideos-render <native-fade, native-wipe, native-particles>.json --frame 30 --format long --out <png>` | PASS | Three real CLI invocations; reviewed frames under task data. |
| `npx tsx --test backend/renderIr/nativeEffects.test.ts backend/renderIr/renderIr.test.ts` | PASS | 15 tests after merging /5. |
| `cargo test --locked --offline --manifest-path native/Cargo.toml -p aideos-render-ir --test fixtures` | PASS | 10 tests. |
| `cargo test --locked --offline --manifest-path native/Cargo.toml -p aideos-render --test native_effects --test golden` | PASS | 7 effects tests after merge, 2 existing golden tests. |
| `npx eslint backend/renderIr/schema.ts backend/renderIr/validate.ts backend/renderIr/jsonSchema.ts backend/renderIr/nativeEffects.test.ts backend/renderIr/renderIr.test.ts scripts/render_ir_schema.ts` | PASS | Targeted lint. |
| `npx tsc --noEmit -p tsconfig.json --pretty false` | PASS | TypeScript project check. |
| `npx tsx scripts/check_headers.ts` | PASS | Three-field code headers. |
| `npx tsx scripts/check_tests_wired.ts` | PASS | Tracked test wiring after staging new files. |
| `npm run render-ir:schema -- --check` | PASS | Committed schema matches zod. |

## Fix attempts

- No failing test attempts. After merging /5, repeated the TypeScript, native effects, native loader, CLI and native golden checks; the /6 tests combine colour tracks and particles in one document.

## Test changes

- Updated the TypeScript and Rust supported-version assertions to require the newly supported version. No existing assertions were weakened.
- Added schema bounds, native pixel goldens, seed and seek invariants, shutter sampling, overlay ordering, transition endpoint and old-version parity checks.

## Weak-test removals

- None.

## Limitations

- The optional GPU path was not exercised. Full static checks, journey suites and independent review remain for the instructed pipeline.
- `/6` extends the merged `/5` schema. Independent pipeline validation remains pending.
