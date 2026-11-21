<!-- File Description: Verification evidence log for the picture cache no-overwrite follow-up (PR 248 review finding review-2). -->

# Verification Evidence: picture cache refuses to overwrite an approved original

- **Date**: 2026-11-21
- **Branch / PR**: fm/aideos-pictures-no-overwrite (PR URL added by the pipeline)
- **Scope**: Feature Map row "Picture Layer / Illustrated Stage": `backend/pictures/cache.ts` (`storePicture`), `backend/pictures/cli.ts` (`aideos pictures add --replace`), `bin/aideos`, docs
- **Risk tier**: Low

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | Real `backend/cli.ts pictures-add` run three times on a copy of the pictures-stage fixture in a temp videos dir: first add stores, a different image is refused, `--replace --pin` stores it and keeps the old PNG and record as `<fingerprint>.<sha256>.png|json`. The full `pictures_stage` journey was not run (resource limits; the fixture package and render paths are untouched) |
| Property test for new invariants | N/A | No new pure math or parser; the invariant (original never lost) is covered by direct behavioural cases |
| Differential test on replacement | N/A | No implementation replaced |
| Expect / golden test for complex output | N/A | No structured or rendered output changed |
| No sleeps in tests | PASS | None used |
| No mocks of thing under test | PASS | Real `storePicture` and `addPicture` on real files in temp dirs |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden touched |
| Weak-test audit | PASS | None removed |
| Independent review | PENDING | `no-mistakes` pipeline |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/pictures/*.test.ts` | PASS (exit 0) | 7 tests, 0 fail (3 new) |
| `node ... --test backend/designCheck/pictures.test.ts` | PASS (exit 0) | 6 tests, 0 fail |
| `npm run lint` | PASS | headers, eslint, tracked typecheck clean |
| `npx tsc --noEmit -p editor/tsconfig.node.json` | no errors in changed files | existing errors in `editor/vite.config.ts` (not touched) |
| manual `backend/cli.ts pictures-add` x3 | PASS | see E2E row |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

None.

## Independent review

Pending: `no-mistakes` pipeline.
