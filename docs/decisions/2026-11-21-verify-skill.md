<!-- File Description: Decision record for the reusable verify skill with its Feature Map, protected suites, fix loop and dated evidence log. -->

# A reusable verify skill with a Feature Map and evidence log

- **Date**: 2026-11-21
- **Status**: In force
- **Decided by**: owner (he approved building it, as its own small pull request, from an article he liked)
- **Pull requests**: https://github.com/Mani212005/aideos/pull/256

## Context

Verification of a change was ad hoc: each agent chose its own checks, and nothing recorded what actually ran. The owner wanted a repeatable way to prove a change works before handoff or merge.

## Decision

Add a project-agnostic `verify` skill at `.agents/skills/verify/` (`SKILL.md` plus `references/`). One pass: map the change against the Feature Map, pick the verification methods (end-to-end, property-based, differential, expect or golden), enforce the protected suites and the owner test policy, run the reliability checklist with an independent review (a separate model or the review pipeline, never the author alone), and write a dated evidence record under `docs/evidence/verify/`. At most 3 fix attempts per failure, then stop and escalate to the human with the evidence. The skill carries no project knowledge: copying it to another project needs only a new `docs/verify/FEATURE_MAP.md`.

## Why

The owner asked for it. Keeping all project-specific features, suites and commands in one Feature Map, built from the real test inventory, keeps the skill short enough to follow in one pass and portable.

## Alternatives rejected

- **Put the workflow in `AGENTS.md`.** Rejected: the owner said not to edit `AGENTS.md` or `CLAUDE.md`, which are loaded into every session. The precedence over the `AGENTS.md` no-delete and no-add-tests rules is stated inside the skill instead.
- **Add a property-testing dependency.** Not done: the skill uses the repository's installed libraries or a deterministic seeded generator, and a new dependency needs approval.
- **Unlimited fix attempts.** Rejected: a loop that keeps tweaking drifts toward loosening a test.

## Where it lives now

- `.agents/skills/verify/SKILL.md` and its `references/` (methods, test policy, checklist and evidence template).
- `docs/verify/FEATURE_MAP.md`, `docs/evidence/verify/README.md`.
- Related decisions: [2026-10-25-never-loosen-tests.md](2026-10-25-never-loosen-tests.md) and [2026-11-21-delete-weak-tests-policy.md](2026-11-21-delete-weak-tests-policy.md).
