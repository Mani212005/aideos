<!-- File Description: Verification evidence log for P2.2a of the native renderer: Render IR aideos.render/5 with colour tracks and the dash offset element track. -->

# Verification Evidence: Render IR `aideos.render/5`, colour and dash offset tracks (P2.2a)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p22a-ir-tracks`
- **Scope**: the Render IR contract (`backend/renderIr/schema.ts`, `validate.ts`, `jsonSchema.ts`, the committed JSON Schemas, `native/aideos-render-ir`), the native evaluator and raster (`native/aideos-render/src/eval/mod.rs`, `raster/svg.rs`), shared fixtures and docs. Feature Map rows: Export & Rendering (Render IR), Parity & determinism gates (TS vs Rust IR parity).
- **Risk tier**: Low (no emitter writes `/5`; `/1` to `/3` documents, their JSON Schemas and every film's emitted IR are unchanged).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | no user-facing path emits `/5` yet (P2.2b will); the release CLI was driven on real `/5` documents in the differential check below |
| Property test for new invariants | N/A | the new rules are fixed mappings (a linear or held colour mix, a dash offset), pinned by evaluator reference values and the shared fixtures |
| Differential test on replacement | PASS | TS and Rust loaders give the same verdict and the same issue paths on every shared fixture (4 new); native frames of a `/5` document against Remotion's Chrome drawing the sampled values as attributes: SSIM 0.99977 to 0.99978 at frames 0, 6, 12, 20, 45 and 89, the differing pixels the same anti-aliased edges at every frame |
| Expect / golden test for complex output | PASS | the committed `/1` to `/3` JSON Schemas regenerate byte-identical; the native goldens pass unchanged |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | loaders, evaluator and raster run for real |
| Protected suites unloosened | PASS | see Test changes: the only edited assertions follow the version list growing by one; none is weaker |
| Weak-test audit | PASS | none removed |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `cargo test --locked --manifest-path native/Cargo.toml` | PASS (exit 0) | every native crate, including goldens, fixtures, evaluator (1 new test) and render (1 new test) |
| `cargo clippy --locked --all-targets --manifest-path native/Cargo.toml -p aideos-render -p aideos-render-ir` | PASS | no warnings |
| `npx tsx scripts/render_ir_schema.ts --check` | PASS | |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/renderIr/*.test.ts backend/nativeRenderer.test.ts backend/rendererSelection.test.ts` | PASS (60) | |
| `npx tsc --noEmit -p .`, `npx tsc -b editor/tsconfig.node.json`, `npx eslint` on the changed TS files | PASS | |

## Test changes

- `backend/renderIr/renderIr.test.ts` and `native/aideos-render-ir/tests/fixtures.rs`: the expected `supported` text of an
  unsupported-version refusal now lists `aideos.render/5`; it is the loaders' exact list, which grew by one.
- `native/aideos-render-ir/fixtures/invalid/unsupported-version.json` (and its `expectations.json` entry) and
  `native/aideos-render/tests/cli.rs`: the example of an unsupported version moves from `aideos.render/5`, now supported,
  to `aideos.render/6`. The rule (an unknown version is refused before the document is read) is unchanged.
- `native/aideos-render/tests/render.rs`: the helper that builds an `SvgNode` literal names the new optional field
  (`color_tracks: None`); no assertion changed.
- New: a `/3`-carries-`/5` pair and a broken colour-track fixture with exact issue paths, the `/5` valid example, the
  `/5` schema check, an evaluator test against Remotion's `interpolateColors` values and a pixel test of both tracks.

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.

## Artifacts and links

- Differential harness and frames (outside the repo): `/home/mani/aideos-linux-home/data/aideos-native-phase2-nodegraph/parity/p22a/`.
