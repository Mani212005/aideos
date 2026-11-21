---
name: verify
description: Verify a code or documentation change in one pass using the project Feature Map, three verification methods (E2E, property-based, differential), protected test suites, reliability checklist, independent review, dated evidence log, and a 3-attempt fix loop before human escalation. Use before opening or merging a PR, or whenever asked to verify a change.
---

<!-- File Description: Reusable, project-agnostic verification skill for Claude Code and Antigravity (agy). Copy this folder to another project and swap only docs/verify/FEATURE_MAP.md. -->

# verify

One operational workflow to prove a change works reliably before handoff or merge. This skill is project-agnostic: every project-specific feature, test suite, protected gate, and command lives in `docs/verify/FEATURE_MAP.md`.

## Single-pass workflow

Follow steps 1 through 5 in order. Do not skip a step; record why if a step does not apply (for example, a docs-only change).

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
- **Weak-test removal (owner test policy)**: remove a test you are roughly 60 to 70 percent sure is weak, with a one-line reason in the PR. Replace a broken or weak test with a stronger test, never loosen it, and list it under Test changes in the PR. Smells and limits are in the reference.

**Precedence.** The owner standing test policy dated 2026-11-21 (remove weak tests at about 60 to 70 percent confidence with a one-line PR reason, never loosen an assertion, tolerance, timeout or golden, replacing a weak test with a stronger one is fine, and add expect, property-based and differential tests) wins over the AGENTS.md no-delete and no-add-tests rules for weak-test removal and for the verification tests this skill asks for. Every other AGENTS.md test rule stands. AGENTS.md is intentionally unedited here.

### 4. Run the checks, fix loop, and independent review

[references/checklist-and-evidence.md](references/checklist-and-evidence.md) is the single definition of the per-change reliability checklist, the 3-attempt fix loop with its escalation packet, and the independent review requirement. Run the project's static checks and targeted commands from `docs/verify/FEATURE_MAP.md`, then complete every item there. Do not copy those rules elsewhere.

### 5. Write the evidence log

Record what actually ran under `docs/evidence/verify/` using the template in the same reference and the format in `docs/evidence/verify/README.md`. Reference the evidence log entry in the PR description or handoff.

## Porting to another project

To reuse this skill in another repository:

1. Copy `.agents/skills/verify/` unchanged (and symlink `.claude/skills -> ../.agents/skills` if the repo uses Claude Code).
2. Create `docs/verify/FEATURE_MAP.md` from that repository's real test inventory, naming its features, suites, protected gates, and independent review pipeline.
3. Create `docs/evidence/verify/README.md` and begin appending dated verification records per change.
