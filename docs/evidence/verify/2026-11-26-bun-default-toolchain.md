<!-- File Description: Verification evidence log for flipping the default JavaScript toolchain to Bun (npm kept selectable through AIDEOS_TOOLCHAIN). -->

# Verification Evidence: Bun is the default toolchain

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-bun-default`
- **Scope**: Feature Map row "CI, Test Wiring & Static Enforcement" (`scripts/toolchain.ts`, `scripts/ci.ts`, `scripts/postinstall.mjs`, `package.json`, `editor/package.json`, `.github/workflows/{ci,nightly,update-goldens}.yml`, `.github/actions/install-dependencies/action.yml`, `.no-mistakes.yaml`, `bin/aideos` `test` and `lint`), plus the contributor docs that name commands.
- **Risk tier**: Medium. The default of every CI job, the install and the package.json scripts changes; the bun path itself is the one pull request 313 verified. The npm path changes only in how it is spelled (`npx tsx <file>` and the `node --test` command instead of npm scripts that now start bun).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `bun install --frozen-lockfile` in the worktree (runs the new postinstall: editor install and generated files), `bun run test` (pre and post hooks), `bun scripts/ci.ts static`, `AIDEOS_TOOLCHAIN=npm npx tsx scripts/ci.ts static`, `bun run validate`, the editor `predev` hook under bun and npm. Full journeys run only in CI (fleet rule) |
| Property test for new invariants | N/A | no new math, layout or state-machine invariant |
| Differential test on replacement | PASS | the whole unit suite on the npm path before the change and on the bun default after: same test names and outcomes (see below) |
| Expect / golden test for complex output | N/A | no new complex output; legacy goldens run in CI on the default path |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | none added |
| Protected suites unloosened | PASS | `scripts/ci.test.ts` and `scripts/ciJourneyShards.test.ts` now match the npm form `npx tsx scripts/ci.ts <job>` where they matched `npm run ci -- <job>`; one check is stronger (every `npx tsx <file>` an npm step runs must exist). No assertion, tolerance, timeout or golden was weakened |
| Weak-test audit | PASS | no removals |
| Independent review | PENDING | the no-mistakes pipeline reviews this branch |
| Evidence log written | PASS | this file |

## Commands run and results

Fleet Linux machine, 12 cores, shared with other workers (one-minute load 4 to 11). Bun 1.4.4 from the release zip, used from a scratch folder on PATH. Node 22.23.4, npm 10.9.9.

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| before, on `bc3b9a27` with the npm-installed tree: `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 --test-reporter=tap "backend/**/*.test.ts" "scripts/**/*.test.ts"` | PASS (exit 0) | 546 s (9:06 wall); 1797 tests, 1796 pass, 1 skipped, 0 fail |
| after, fresh bun tree: `bun run test --junit-dir=<dir> --report=<json>` | PASS (exit 0) | 516 s (8:36 wall); 179 files, 1797 tests, 1796 pass, 1 skipped, 0 fail |
| test name comparison (TAP names, `\#` unescaped, against JUnit names) | PASS | identical apart from the two `ci.test.ts` tests renamed here and the TAP line of the `sceneKit/parts` describe block, which JUnit does not count as a test |
| `bun install --frozen-lockfile --ignore-scripts` twice in clean copies, then `bun install --frozen-lockfile` in the worktree | PASS | all three trees list the same 696 package directories and versions; no `bun.lock` written at the root or in `editor/` |
| `bun install --cwd editor` without `--no-save` (probe) | wrote `editor/bun.lock` | why the postinstall passes `--no-save` |
| `bun scripts/ci.ts static` | PASS (exit 0) | eslint 11.1 s, tsc 19.0 s, editor build 26.3 + 6.2 s |
| `AIDEOS_TOOLCHAIN=npm npx tsx scripts/ci.ts static` on the bun tree | PASS (exit 0) | the npm editor build runs the new `prebuild` hook |
| `bun scripts/bunTest.ts scripts/ci.test.ts scripts/ciJourneyShards.test.ts scripts/bunTest.test.ts scripts/check_headers.test.ts` and the first two on `node --test` with `AIDEOS_TOOLCHAIN=npm` | PASS | 43 of 43 and 29 of 29 |

After the pipeline's fix rounds (`scripts/run.mjs`, `scripts/runTests.ts`, the runner picking the default toolchain, `bin/aideos` back on `npm test` and `npm run lint`) and the merge of `origin/main` (Render IR /6, #318, #319):

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `AIDEOS_TOOLCHAIN=npm node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 --test-reporter=tap "backend/**/*.test.ts" "scripts/**/*.test.ts"` | PASS (exit 0) | 7:58 wall; 1803 tests, 1802 pass, 1 skipped, 0 fail |
| `bun run test --junit-dir=<dir>` | PASS (exit 0) | 5:55 wall; 180 files, 1803 tests, 1802 pass, 1 skipped, 0 fail |
| test name comparison | PASS | identical names (only the TAP line of the `sceneKit/parts` describe block differs, as before) |
| `bun scripts/ci.ts static` and `AIDEOS_TOOLCHAIN=npm npx tsx scripts/ci.ts static` | PASS (exit 0) | every step passed on both |
| `backend/aideosLauncher.test.ts`, `backend/aideosLauncherMenuFirst.test.ts`, `scripts/ci.test.ts` with no bun on PATH (`AIDEOS_TOOLCHAIN=npm`) and through `scripts/bunTest.ts` with bun on PATH | PASS | 37 of 37 each way |

CI wall time on GitHub-hosted `ubuntu-24.04` runners (manual `workflow_dispatch`, head `3b6f0b0d`, before the merge of `origin/main`, which brings in only main's changes), one run at a time; runner load is not observable on hosted runners:

| Run | Toolchain | Result | Run span | unit job | unit tests step | slowest journeys shard |
| --- | --- | --- | --- | --- | --- | --- |
| 45767350502 | npm | failure: apt mirror timeout in journeys shard 2 before any repo code | 11.2 min | 11.1 min | 9.7 min | 9.4 min |
| 45768671587 | bun | success | 9.4 min | 9.3 min | 7.8 min | 8.0 min |
| 45769889770 | npm | success | 13.2 min | 13.1 min | 9.9 min | 11.9 min |
| 45771502896 | bun | failure: apt mirror timeout in journeys shard 1 before any repo code | 11.8 min | 11.7 min | 8.2 min | 7.5 min |
| 45750211080, 45746587615 (main, npm default) | npm | success | 11.2, 11.5 min | 11.1, 11.3 min | 10.1, 9.7 min | 8.7, 8.3 min |

`static`, `unit` and `legacy` passed in every run. On head `c17d9048` two earlier npm dispatch runs failed in `unit` (`backend/aideosLauncher.test.ts`: `bin/aideos` called bun unconditionally); the pipeline fixed that before this head.

## Fix attempts

- Attempts used: 1 / 3 (the postinstall could not find `bun` when bun was started by its full path: bun is not on PATH inside its own lifecycle scripts, so the postinstall uses `npm_execpath`).

## Weak-test removals

- None.

## Artifacts and links

- Raw TAP, JUnit reports, timings, tree listings and the name comparison: `/home/mani/aideos-linux-home/data/aideos-bun-default/evidence/` on the fleet machine (not committed).
