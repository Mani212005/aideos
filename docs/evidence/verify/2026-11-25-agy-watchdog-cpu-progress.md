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
| Protected suites unloosened | PASS | No assertion, timeout, tolerance, or golden was weakened. The leader's stdout keep-alive stops when the `start` marker appears, so the burn phase emits no stdout and only CPU growth can satisfy the watchdog. |
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

## Follow-up round: 2026-11-26

- **Branch / head**: `fm/aideos-agy-watchdog-flake` at pipeline head `7cf7f8ad`, with an uncommitted four-burner fixture refinement.
- **Scope**: Same Review Gates feature row and test file.
- **Risk tier**: Medium. The four-burner candidate failed once in 30 loaded repetitions; per the owner's direction, no timeout was raised and work stopped for review.

| Check | Status | Notes |
| --- | --- | --- |
| Process integration | FAIL | The four-burner CPU case rejected once under load with `agy appears wedged: no stdout or CPU growth for 1s`. |
| CPU growth negative control | PASS | With `cpu > lastCpu` temporarily disabled in `agyProcess.ts`, the targeted test failed at the expected `rejected` versus `burn-complete` assertion. The production file was restored and has no diff. |
| Protected suites unloosened | PASS | The one-second idle timeout and existing 60-second runner timeout were unchanged. |
| Independent review | PENDING | Review round 1 applied the silent-leader fix. The next review fix agent exhausted its Claude usage limit twice, so the pipeline failed before completing review or running Test. |

| Command / conditions | Result | Notes |
| --- | --- | --- |
| `node --import tsx --test --test-name-pattern='agy idle watchdog allows continuing CPU progress' backend/geminiReview/agyProcess.test.ts` | PASS (1/1) | Four burners, two CPU seconds per worker, release after all `burn-complete-*` files exist. |
| Same targeted CPU case, 30 repetitions on the pre-refinement single-burner fixture | PASS (30/30) | Eight concurrent `yes > /dev/null` CPU load workers. |
| Same targeted CPU case, 30 repetitions on the four-burner candidate | FAIL (29/30) | Eight concurrent `yes > /dev/null` CPU load workers. Run 4 failed with the watchdog rejection above; all other runs passed. |
| Same targeted CPU case with the CPU-growth update branch temporarily disabled | Expected failure (exit 1) | Failed because the runner rejected before all CPU workers reached their burn-complete condition. The source was restored immediately afterward. |

- **Disposition**: The four-burner candidate is not reliable enough under this load. Stop here and report these counts; do not increase a timeout. No fresh no-mistakes run was started.

## Decision round: 2026-11-26 single-burner fixture

- **Decision**: Return to one burner. The prior single-burner fixture passed 30/30 under eight load workers; the four-burner candidate passed 29/30.
- **Final fixture (superseded by the burner-thread fix below)**: One silent CPU worker waits for the leader and child PID files plus its ready marker, starts on the `start` marker, burns two seconds of process CPU, records `burn-complete`, and burns until the test writes `stop`. The leader stops its stdout keep-alive as soon as `start` exists. Stdout and stderr stay silent during the burn.
- **No timeout changes**: The watchdog remains at one second and the runner timeout remains at 60 seconds.
- **Negative control**: Temporarily removed the `cpu > lastCpu` activity update; the final single-burner test failed with the watchdog rejection before `burn-complete`. Restored `agyProcess.ts`; it has no diff.
- **Current candidate result**: The final committed single-burner fixture passed 60/60 under the same eight load workers; the previous single-burner version passed 30/30.
- **PR wording**: The original CI flake was not reproduced locally. The change removes the stdout keep-alive masking and unsynchronized-start weaknesses, and reports repeat results. Local repeats do not prove the CI flake is gone.

## Final single-burner repeat: 2026-11-26

The repeat counts below were taken before the burner-thread fix and describe the one-burner fixture, which the last section supersedes.

- **Committed fixture**: `e2ca22905fedcf06f8403edda8992170bf6376a8`.
- **Repeat counts under eight concurrent `yes > /dev/null` CPU load workers**: prior single-burner fixture 30/30; final committed single-burner fixture 60/60.
- **Command**: `node --import tsx --test --test-name-pattern='agy idle watchdog allows continuing CPU progress' backend/geminiReview/agyProcess.test.ts`, repeated 60 times sequentially.
- **Negative control**: Temporarily disabled the `cpu > lastCpu` activity update in `agyProcess.ts`; the final single-burner test failed with the watchdog rejection before `burn-complete`. Restored the production file; it has no diff.
- **PR statement**: The original CI flake was not reproduced locally. This change removes the stdout keep-alive masking and unsynchronized-start weaknesses and records the repeat counts. These local runs do not prove the CI flake is gone.
- **Production changes**: None.

## Burner-thread fix: 2026-11-26

- **Cause**: With one burner, the group's whole-second `ps time` ticks only once per CPU second, so the margin before the 1s idle window expires is the startup CPU plus poll phase (about 150ms). Reproduced before the fix: 11/30 and 22/30 CPU-case failures with 12 and 14 concurrent `yes > /dev/null` workers on 12 cores.
- **Fix**: The CPU worker burns on three extra threads inside the same process (still one `child.pid`), so group CPU grows several seconds per second and `ps time` ticks inside every idle window. The two-second burn is now measured in wall-clock time, because process CPU time would reach two seconds in under one second and end the test before the idle window could expire.
- **Result after the fix**: 0/30 failures with 12 workers, 0/30 with 14 workers, 0/30 with no load. No timeout, tolerance or assertion changed.
- **Negative control**: With the `cpu > lastCpu` update disabled in `agyProcess.ts`, the CPU case fails with the watchdog rejection. The production file was restored; it has no diff.
