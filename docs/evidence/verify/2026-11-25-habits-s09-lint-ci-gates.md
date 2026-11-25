<!-- File Description: Verification evidence log for habits slice 9: align lint and CI gates, prune LEGACY_ANY, clean dependencies, one setup-apt action, Clippy and bin/aideos portability. -->

# Verification Evidence: habits slice 9 (lint and CI gates, dependencies, Clippy, launcher)

- **Date**: 2026-11-25
- **Branch / PR**: fm/aideos-habits-s09-lint-ci-gates (PR URL added by the pipeline)
- **Scope**: Feature Map row "CI, Test Wiring & Static Enforcement" (`package.json`, `eslint.config.mjs`, `scripts/ci.ts`, `scripts/ciChanges.mjs`, `.github/`), row "Export & Rendering" (`native/` Clippy fixes), `bin/aideos`, `editor/vite.config.ts` (two `prefer-const` fixes only)
- **Risk tier**: Low

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `npm run lint` (now the whole static job) ran green; `bin/aideos` launch path ran end to end against stubbed `lsof`, `curl`, `tmux` under `set -euo pipefail` and called `xdg-open` |
| Property test for new invariants | N/A | no new pure logic |
| Differential test on replacement | PASS | `bin/aideos` subcommands (`design`, `review`, `pictures`, `character`, unknown command) return the same exit codes before and after |
| Expect / golden test for complex output | N/A | native golden tests re-run unchanged and pass (`golden`, `render`, `measure`, `stage3d_dots`) |
| No sleeps in tests | PASS | none added |
| No mocks of the thing under test | PASS | none added |
| Protected suites unloosened | PASS | no assertion, tolerance, timeout or golden weakened; `scripts/ci.test.ts` apt test was re-pointed at the new action with every assertion kept (see Test changes in the PR) |
| Weak-test audit | PASS | none removed |
| Independent review | PENDING | no-mistakes pipeline |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npm run lint` (= `npm run ci -- static`) | PASS (exit 0) | headers, tests wired, eslint over src, backend, scripts, editor/src and editor/vite.config.ts (0 errors, 2 pre-existing warnings in `ReelPanel.tsx` and `SoundtrackPanel.tsx`), tsc root on TypeScript 6.0.3, oxlint, editor build, ruff |
| `node --import tsx --test scripts/ciChanges.test.ts scripts/ci.test.ts scripts/check_headers.test.ts scripts/typecheck_tracked.test.ts` | PASS | 52 tests |
| `cargo clippy --locked --all-targets --manifest-path native/Cargo.toml` | PASS | 0 code warnings (was 7) |
| `cargo test --locked -p aideos-render-ir -p aideos-encode` | PASS | 37, 10 and 3 tests |
| `cargo test --locked -p aideos-render --test render --test measure --test golden --test stage3d_dots` | PASS | 19, 8, 2 and 8 tests |
| `npm ci --dry-run --ignore-scripts` (root) and `npm ls` | PASS | lockfile consistent |

## Fix attempts

- Attempts used: 1 / 3 (the `scripts/ci.test.ts` apt test failed once because the apt recipe moved into the action; the test was re-pointed, all assertions kept).

## Weak-test removals

- None.

## Artifacts and links

- Handoff: /home/mani/aideos-linux-home/data/aideos-habits-s09-lint-ci-gates/handoff.md
