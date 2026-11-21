---
name: verify
description: Verify a code or documentation change in one pass using the project Feature Map, three verification methods (E2E, property-based, differential), protected test suites, reliability checklist, independent review, dated evidence log, and a 3-attempt fix loop before human escalation. Use before opening or merging a PR, or whenever asked to verify a change.
---

<!-- File Description: Reusable, project-agnostic verification skill for Claude Code and Antigravity (agy). Copy this folder to another project and swap only docs/verify/FEATURE_MAP.md. -->

# verify

One operational workflow to prove a change works reliably before handoff or merge. This skill is project-agnostic: every project-specific feature, test suite, protected gate, and command lives in `docs/verify/FEATURE_MAP.md`.

## Single-pass workflow

Follow steps 1 through 7 in order. Do not skip a step; record why if a step does not apply (for example, a docs-only change).

### 1. Map the change against the Feature Map

1. Open `docs/verify/FEATURE_MAP.md`.
2. Match every modified file or behavior to its user-facing feature row(s), owner area, E2E journeys, unit/property/native tests, and protected suites.
3. If your change adds a feature, removes a feature, or changes test coverage, update `docs/verify/FEATURE_MAP.md` in the same PR. Never invent coverage; mark uncovered areas `not covered`.

### 2. Choose verification methods

Select every method that applies to the change (details in [references/methods.md](references/methods.md)):

- **E2E testing**: run real user journeys through the real entry point for every touched user-facing workflow.
- **Property-based testing**: add or run randomized/generated-input invariant checks for any new pure math, parser, planner, layout, serialization, or state-machine invariant. Do not add a new dependency without approval; use the repo's installed library or a deterministic seeded generator.
- **Differential testing**: when replacing, porting, or optimizing an existing implementation, run both old and new implementations on shared inputs and assert parity within stated bounds.
- **Expect / golden testing**: for new complex structured output (IR, reports, rendered frames), verify against reviewed expected outputs or goldens.

### 3. Enforce protected suites and the owner test policy

Before running or editing any test, read [references/test-policy.md](references/test-policy.md) and the Protected Test Suites section of `docs/verify/FEATURE_MAP.md`:

- **Protected suites** (journeys, goldens, parity gates, hard review gates) must **never be loosened**. Never weaken an assertion, widen a tolerance, raise a timeout, skip a case, or regenerate a golden just to turn a failing run green.
- **Weak-test removal (owner test policy)**: tests must be real and reliable. If you are roughly 60 to 70 percent sure an existing test is weak or removable (tautology, re-implements the code under test, asserts nothing meaningful, sleeps instead of waiting on a condition, duplicates another test, or tests a mock), remove it and state the removal with a one-line reason in the PR. Replacing a weak test with a stronger one is encouraged.

### 4. Run the reliability checklist

Run the project's static checks and targeted verification commands from `docs/verify/FEATURE_MAP.md`, and check every item below (template in [references/checklist-and-evidence.md](references/checklist-and-evidence.md)):

- [ ] Real E2E run covers touched user-facing flows (or explicitly marked N/A for docs-only changes).
- [ ] Property test covers any new invariant (or N/A when no new invariant is added).
- [ ] Differential test compares old vs new when replacing an implementation (or N/A).
- [ ] Expect / golden test covers new complex output (or N/A).
- [ ] Zero arbitrary `sleep` / fixed-delay waits in new or touched tests (wait on real conditions).
- [ ] Zero mocks of the thing under test (inject only external/network/model boundaries).
- [ ] Zero silent skips or `todo` placeholders passing as green.
- [ ] Protected test suites untouched and unloosened.

### 5. Fix loop (maximum 3 attempts)

If any check or test fails:

1. Diagnose the real root cause from logs and failure artifacts.
2. Fix the code (or the test only if the test itself is provably broken and not a protected expectation; never loosen a test to pass).
3. Re-run the failing check.
4. Repeat at most **3 fix attempts per failure**.
5. If the failure persists after 3 attempts, **stop immediately**. Write the evidence log with exact commands, failure outputs, artifact links, and what each of the 3 attempts tried, and escalate to the human.

### 6. Independent review (never author alone)

The author never signs off on their own verification:

1. Run an independent review of **both the diff and the verification evidence** using a separate model, an independent reviewer agent, or the repository's review pipeline (listed in `docs/verify/FEATURE_MAP.md`).
2. Every review finding enters the same max-3-attempt fix loop; architectural or product disagreements escalate to the human.
3. Record the reviewer identity (pipeline/model) and outcome in the evidence log.

### 7. Write the evidence log

Record what actually ran under `docs/evidence/verify/` (format in `docs/evidence/verify/README.md` and [references/checklist-and-evidence.md](references/checklist-and-evidence.md)):

- Date, branch/PR, and scope.
- Reliability checklist status (pass / fail / N/A with reason).
- Exact commands run and observed results (exit code, counts, timings).
- Protected suite status and any weak-test removals (with one-line reasons).
- Independent review method and verdict.
- Links to failure/review artifacts, reports, or screenshots.

Reference the evidence log entry in the PR description or handoff.

## Porting to another project

To reuse this skill in another repository:

1. Copy `.agents/skills/verify/` unchanged (and symlink `.claude/skills -> ../.agents/skills` if the repo uses Claude Code).
2. Create `docs/verify/FEATURE_MAP.md` from that repository's real test inventory, naming its features, suites, protected gates, and independent review pipeline.
3. Create `docs/evidence/verify/README.md` and begin appending dated verification records per change.
