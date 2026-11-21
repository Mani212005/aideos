<!-- File Description: Per-change reliability checklist, independent review protocol, 3-attempt fix loop escalation format, and dated evidence log template. -->

# Reliability checklist, fix loop, and evidence log

## Per-change reliability checklist

Complete every item before calling a change verified. Mark items `PASS`, `FAIL`, or `N/A` (with a one-line reason).

1. **Real E2E run**: ran the real journey(s) from `docs/verify/FEATURE_MAP.md` covering touched user-facing workflows.
2. **Property test for new invariants**: added/ran randomized or generated-input invariant checks for every new invariant.
3. **Differential test on replacement**: compared old vs new implementation on shared inputs when replacing or porting an implementation.
4. **Expect / golden test for complex output**: verified new complex structured or rendered outputs against reviewed expectations.
5. **No sleeps**: zero `sleep` / fixed-delay waits introduced in tests; waits synchronize on real conditions.
6. **No mocks of the thing under test**: production code under test runs for real; only external/network/model boundaries are injected.
7. **Protected suites unloosened**: no assertion, tolerance, timeout, or golden baseline was weakened.
8. **Weak-test audit**: any weak test removed (~60-70% confidence) is listed with a one-line reason in the PR.
9. **Independent review**: diff and evidence reviewed by a separate model or review pipeline (never author alone).
10. **Evidence log written**: dated entry committed under `docs/evidence/verify/`.

## Fix loop and escalation (max 3 attempts)

For each distinct failure:

- **Attempt 1**: inspect full error output and artifacts, fix root cause, re-run failing command.
- **Attempt 2**: if still failing, re-check assumptions (environment, state, upstream contract), apply targeted fix, re-run.
- **Attempt 3**: final targeted fix and re-run.
- **After 3 failed attempts -> STOP and escalate to human.** Never try a 4th speculative tweak and never loosen a test to pass.

Escalation packet (include in the evidence log and human message):
- Failing command and exit code
- Exact error summary and paths to failure artifacts/logs
- Summary of attempts 1, 2, and 3 (hypothesis, change, observed result)
- Suspected root cause and specific decision or help needed from the human

## Independent review requirement

Before marking verification complete:
- Pass the git diff and the verification evidence to an **independent reviewer**: a separate model, a separate reviewer agent session, or the repository's automated review pipeline (e.g., `no-mistakes` or a dedicated PR review workflow).
- The author's own self-check does not satisfy this step.
- Record the reviewer identity (pipeline/model/tool), review round count, and verdict in the evidence log.

## Evidence log entry template

Save dated records under `docs/evidence/verify/YYYY-MM-DD-<short-slug>.md` (or append to that day's record if verifying follow-up rounds on the same change).

```markdown
<!-- File Description: Verification evidence log for <change title>. -->

# Verification Evidence: <change title>

- **Date**: YYYY-MM-DD
- **Branch / PR**: <branch name or PR URL>
- **Scope**: <short summary of touched areas and Feature Map rows>
- **Risk tier**: Low | Medium | High

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS / N/A | <journey names or why N/A> |
| Property test for new invariants | PASS / N/A | <test file or why N/A> |
| Differential test on replacement | PASS / N/A | <comparison or why N/A> |
| Expect / golden test for complex output | PASS / N/A | <baseline or why N/A> |
| No sleeps in tests | PASS / N/A | <verified> |
| No mocks of thing under test | PASS / N/A | <verified> |
| Protected suites unloosened | PASS | <confirmed> |
| Independent review | PASS / PENDING | <separate model or pipeline name + verdict> |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `<exact command>` | PASS (exit 0) | <key output, counts, timing> |

## Fix attempts

- Attempts used: 0 / 3 (or list each attempt and outcome; if 3/3 failed, include escalation packet).

## Weak-test removals

- None (or `<file>: <one-line reason>`).

## Artifacts and links

- <paths or URLs to logs, reports, screenshots, or PR>
```
