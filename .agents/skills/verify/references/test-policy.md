<!-- File Description: Protected test suites contract and the owner test policy for removing weak tests without ever loosening assertions. -->

# Protected test suites and owner test policy

Tests exist to catch real regressions and protect user-visible guarantees. This policy governs what can never be weakened and when weak tests should be deleted.

## Protected test suites (never loosen)

Every repository names its exact protected suites in `docs/verify/FEATURE_MAP.md`. Across projects, four categories are always protected:

1. **User journeys (E2E suites)**: real end-to-end user workflows and browser smoke checks.
2. **Golden suites**: committed pixel, audio, or artifact baselines and their manifests.
3. **Parity gates**: cross-engine, preview-vs-export, cross-language (e.g., TS-vs-Rust), and determinism/repeatability gates.
4. **Hard review and delivery gates**: mandatory quality, schema, design, security, and release gates that block bad output.

Hard rule for protected suites:
- **Never loosen** an assertion, numeric tolerance, pixel threshold, timeout, retry count, or golden baseline to make a failing check pass.
- **Never skip, comment out, or mark `todo`** a failing protected test.
- If a protected test appears wrong because requirements legitimately changed, stop and get explicit human approval before updating it, and document the reason in the PR.

## Owner test policy: remove weak tests, never loosen real ones

Tests must be real and reliable. Weak tests create false confidence and slow down every change.

### When to remove a test

If you are **roughly 60 to 70 percent sure** a test is weak or removable, **remove it** and state the removal with a one-line reason in the PR description. Replacing a weak test with a stronger, real test is always welcome.

A test is weak if it exhibits one or more of these smells:
- **Tautology**: asserts something guaranteed by construction or by the test setup itself (e.g., checking a constant it just assigned).
- **Re-implements the code under test**: duplicates the production formula/logic in the test and compares the two instead of checking independent behavior or invariants.
- **Asserts nothing meaningful**: only checks "did not throw", `toBeTruthy()`, or non-empty output when the actual behavior or value matters.
- **Sleeps instead of waiting on a condition**: uses `setTimeout` / `sleep` to hope async work finished, creating flakiness or slow false passes.
- **Duplicates another test**: tests the exact same code path and assertion already covered by a stronger test or journey with no extra signal.
- **Tests a mock**: verifies mock call counts or stubbed return values rather than real behavior of the system under test.

### What is strictly forbidden

- Never remove a test because it is failing on your change. Diagnose the failure first; only remove a test if it is genuinely weak under the criteria above and its removal is not hiding a regression.
- Never loosen an assertion, tolerance, timeout, or golden to make something pass.
- Never silently delete a test without stating the removal and its one-line reason in the PR.
