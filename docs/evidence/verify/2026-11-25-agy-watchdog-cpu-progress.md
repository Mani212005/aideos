<!-- File Description: Verification evidence for the agy CPU progress watchdog fixture. -->

# Verification Evidence: agy watchdog CPU progress fixture

- **Date**: 2026-11-25
- **Branch / PR**: `fm/aideos-agy-watchdog-flake` (pre-PR handoff)
- **Scope**: Review Gates, Design Check & All-Check; `backend/geminiReview/agyProcess.test.ts`
- **Risk tier**: Low

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | Targeted process integration runs the real `defaultAgyRunner` and an OS process tree; no user-facing journey changed. |
| Property test for new invariants | N/A | No pure invariant or randomized behavior changed. |
| Differential test on replacement | N/A | No production implementation was replaced. |
| Expect / golden test for complex output | N/A | No structured output or rendered artifact changed. |
| No sleeps | PASS | CPU worker waits on a filesystem watcher and explicit `start` marker; no fixed-delay wait was added. |
| No mocks of thing under test | PASS | The runner and process tree execute for real; only the agy executable is a local fixture. |
| Protected suites unloosened | PASS | No assertion, timeout, tolerance, or golden was weakened. |
| Weak-test audit | PASS | No tests removed. |
| Independent review | PENDING | Deferred to the instructed no-mistakes pipeline after firstmate handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/geminiReview/agyProcess.test.ts` | PASS (exit 0) | 11 tests passed, 0 failed, 0 skipped. |
| `node --import tsx --test --test-name-pattern='agy idle watchdog allows continuing CPU progress' backend/geminiReview/agyProcess.test.ts` on pre-fix `origin/main` | PASS (1/1) | The flake did not reproduce in one local baseline run. |
| `node --import tsx --test backend/geminiReview/agyProcess.test.ts`; `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/geminiReview/agyProcess.test.ts` | PASS (2/2) | CPU case passed in both full-file runs after the ready-marker synchronization. No synthetic load was added. |
| `npm run ci -- static` | PASS (exit 0) | Generated files, headers, test wiring, ESLint, root typecheck, editor oxlint/build, Ruff check and format check passed. Existing lint/build warnings remain in unrelated editor files. |
| `git diff --check` | PASS (exit 0) | No whitespace errors. |

## Fix attempts

- Attempts used: 1 / 3. An initial draft waited for PID files before starting the runner and failed to converge. The runner now starts before the test waits for leader and child PIDs plus the worker's ready marker; the focused and full file runs passed.

- Baseline note: the original CPU test passed once locally, so this session did not capture a failing pre-fix run. The intermittent whole-second CPU sampling race was identified in the task handoff; the fix makes the process-tree readiness condition explicit and passed two final full-file repetitions.

## Weak-test removals

- None.

## Artifacts and links

- No external artifacts.
