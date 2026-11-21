<!-- File Description: Decision record for the rule that an existing test assertion, tolerance, timeout or golden is never loosened to get a run green. -->

# Never loosen a test to get green

- **Date**: 2026-10-25 (defined in the agent test policy), reaffirmed 2026-11-21
- **Status**: In force
- **Decided by**: owner
- **Pull requests**: https://github.com/Mani212005/aideos/pull/136 (defined the agent test policy), https://github.com/Mani212005/aideos/pull/256 (restated it as the protected suites rule of the verify skill)

## Context

Agents working on aideos were able to turn a red run green by editing the test instead of the code: raise a timeout, widen a tolerance, add a retry, regenerate a golden frame or delete the assertion. That gives false confidence, because the product is no better and the check no longer protects anything.

## Decision

An existing assertion, tolerance, timeout, retry count or golden-frame selection is never loosened, re-pointed or deleted to make a run pass. If an agent thinks a test is wrong, it leaves the test failing and says so in the pull request under "Test changes", with the reason, for the owner to decide. A flaky test is a bug in readiness, warm-up, a network download or shared state: the cause is named and fixed. A retry or a longer wait is not a fix.

Tests are added or changed only when the owner asks, when the owner states a new rule (the test encodes exactly that rule), or when a bug the owner or a user hit is fixed (its end-to-end reproduction becomes a journey case). The one narrow exception is the weak-test removal policy: see [2026-11-21-delete-weak-tests-policy.md](2026-11-21-delete-weak-tests-policy.md).

## Why

The source of truth is the owner's decisions, the committed golden frames, the design check rules and the journeys. A test an agent writes or edits to suit its own change only restates that agent's reading of the task. The recorded reason in `AGENTS.md` is that a weakened test hides a real regression.

## Alternatives rejected

- **Loosen a tolerance or raise a timeout when a run is slightly red.** Rejected: it hides the regression the test exists to catch.
- **Retry or wait longer on a flaky test.** Rejected: the cause has to be measured and named first.
- **Regenerate a golden frame to match new output.** Rejected for protected suites: a golden changes only with explicit owner approval and a stated reason.
- **Let agents add tests freely.** Rejected: tests added by the author of the change tend to restate the change. The verify skill adds a narrow, owner-approved route for property, differential and expect tests.

## Where it lives now

- `AGENTS.md`, section "Tests".
- `.agents/skills/verify/references/test-policy.md` (protected suites and the never-loosen rule).
- `docs/verify/FEATURE_MAP.md`, section "Protected Test Suites".
