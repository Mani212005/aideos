<!-- File Description: Verification evidence log for the reversible npm or bun toolchain switch (full Bun path: bun install, Bun runtime, bun test). -->

# Verification Evidence: reversible npm or bun toolchain switch

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-bun-full`
- **Scope**: Feature Map row "CI, Test Wiring & Static Enforcement" (`scripts/ci.ts`, `scripts/toolchain.ts`, `scripts/bunTest.ts`, `backend/testSupport/bunTestEnv.ts`, `backend/testSupport/fakeVcd.ts`, `.github/actions/install-dependencies/action.yml`, `.github/workflows/ci.yml`, `bunfig.toml`, `.bun-version`, `docs/CI.md`)
- **Risk tier**: Medium. The default npm path keeps every command it ran before, but the shared install action and every ci.yml job now branch on `AIDEOS_TOOLCHAIN`; the bun path changes the runtime and the test runner of every gate when flipped.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | bun path, real entry points: `bun scripts/ci.ts static`, `unit`, `legacy`; journeys `j3_studio_edit`, `j8_failures`, `master_audio` through `scripts/bunTest.ts`; `scripts/smoke_studio.ts` on Bun. Full journeys run only in CI (fleet rule) |
| Property test for new invariants | N/A | no new math, layout or state-machine invariant; the new parser is covered by an expect test on real bun output |
| Differential test on replacement | PASS | the whole unit suite on `node --test` and on the bun path, same commit: identical per-test name sets and outcomes (see below) |
| Expect / golden test for complex output | PASS | `scripts/bunTest.test.ts` reads `test_fixtures/bunJunit/kinds.xml`, a real bun 1.4.4 JUnit report of every outcome; legacy golden frames pass pixel-exact on the bun path |
| No sleeps in tests | PASS | none added; the `ci.test.ts` stdout fix passes writes through instead of waiting |
| No mocks of thing under test | PASS | the runner, `runStep` and the CI jobs run for real |
| Protected suites unloosened | PASS | `scripts/ci.test.ts` and `scripts/ciJourneyShards.test.ts` assert the same facts for the active toolchain (and both workflow forms); no assertion, tolerance, timeout or golden was weakened |
| Weak-test audit | PASS | no removals |
| Independent review | PENDING | the no-mistakes pipeline reviews this branch |
| Evidence log written | PASS | this file |

## Commands run and results

Fleet Linux machine, 12 cores, shared with other workers (one-minute load 3.5 to 11 during the suite runs). Bun 1.4.4, SHA-256 checked against the release `SHASUMS256.txt`, used from a scratch folder on PATH.

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 "backend/**/*.test.ts" "scripts/**/*.test.ts"` | PASS (exit 0) | 594 s; 1792 tests reported, 1791 pass, 1 skipped, 0 fail |
| `AIDEOS_TOOLCHAIN=bun bun scripts/bunTest.ts "backend/**/*.test.ts" "scripts/**/*.test.ts"` | PASS (exit 0) | 492 s; 178 files, 1793 tests, 1792 pass, 1 skipped, 0 fail; the only name not in Node's report is the `ci.test.ts` test whose result Node lost (fixed in this change) |
| `bun test --isolate` over every file (first probe, before the runner) | 3 fail | `pipeline.test.ts` took 395 s (no `NODE_TEST_CONTEXT`, so real agent and device-caller paths waited) and two CLI children reached for the real voice service (bun ignores `NODE_OPTIONS`); both fixed by `bunTestEnv.ts` and `BUN_OPTIONS` |
| `AIDEOS_TOOLCHAIN=bun bun scripts/bunTest.ts backend/pipeline/pipeline.test.ts` | PASS | 52 of 52 |
| `npm run ci -- static` and `AIDEOS_TOOLCHAIN=bun bun scripts/ci.ts static`, interleaved twice, then once more on the final tree | PASS (exit 0) | npm: eslint 10.7 s, tsc 12.9 s, editor build 18.5 s; bun: eslint 10.7 s, tsc 12.1 s, editor build 11.2 + 1.6 s |
| `AIDEOS_TOOLCHAIN=bun bun scripts/ci.ts unit` | PASS (exit 0) | tests 403 s, cargo 131.6 s, validate, design:check, eval:look, eval:visuals, performance:check passed; the skipped native farm test reported as NOT COVERED through the runner's report |
| `AIDEOS_TOOLCHAIN=bun bun scripts/ci.ts legacy` | PASS (exit 0) | golden frames 29.4 s |
| `AIDEOS_TOOLCHAIN=bun bun scripts/bunTest.ts backend/journeys/{j8_failures,j3_studio_edit,master_audio}.journey.ts` | PASS (exit 0) | 17 of 17 |
| `AIDEOS_SMOKE_REQUIRED=1 bun scripts/smoke_studio.ts` | PASS (exit 0) | scrub, return, split, autosave and reload |
| `bun install --frozen-lockfile --ignore-scripts` in a clean `git archive` copy | PASS | installed from `package-lock.json`, wrote no `bun.lock`; a `package.json` change without a lockfile change is refused |
| `node --test scripts/ci.test.ts` three times | PASS | 18 tests each time (17 before the stdout fix) |

## Fix attempts

- Attempts used: 1 / 3 per failure (missing `NODE_TEST_CONTEXT`; `BUN_OPTIONS` quoting; bun's node:test child event stream; the TODO capture in `ci.test.ts` swallowing Node's report of the previous test).

## Weak-test removals

- None.

## Artifacts and links

- Raw logs, JUnit reports and the CI timing inputs: `/home/mani/aideos-linux-home/data/aideos-bun-full/runs/` and `ci-before/` on the fleet machine (not committed).
