<!-- File Description: Decision record for the owner standing policy to remove weak tests at about 60 to 70 percent confidence while never loosening a real one. -->

# Delete weak tests at about 60 to 70 percent confidence

- **Date**: 2026-11-21
- **Status**: In force
- **Decided by**: owner (standing test policy)
- **Pull requests**: https://github.com/Mani212005/aideos/pull/256 (wrote it into the verify skill), applied in https://github.com/Mani212005/aideos/pull/253 and https://github.com/Mani212005/aideos/pull/258

## Context

`AGENTS.md` says never to delete an existing assertion and not to add tests on your own. A sweep on 2026-11-21 found weak tests that give false confidence: 12 `assert.ok(true)` placeholders in `backend/scene/scene.test.ts` (removed by slice 14, see below), real `setTimeout` sleeps in unit tests and tests of code that no longer exists.

## Decision

Tests must be real and reliable. If an agent is roughly 60 to 70 percent sure a test is weak or removable, it removes the test and states each removal with a one-line reason in the pull request. Weak means: a tautology, a test that re-implements the code under test, a test that asserts nothing meaningful, a test that sleeps instead of waiting on a condition, a duplicate of another test, or a test of a mock. Replacing a weak test with a stronger one is welcome. It never means loosening an assertion, tolerance, timeout or golden (see [2026-10-25-never-loosen-tests.md](2026-10-25-never-loosen-tests.md)). The owner also allows property-based, differential and expect tests under the verify skill.

## Why

Weak tests create false confidence and slow every change, and a test that restates the code protects nothing. The 60 to 70 percent bar is deliberately low: the owner prefers a removed doubtful test to a kept false signal.

## Alternatives rejected

- **Keep every test until the owner signs off on its deletion (the old `AGENTS.md` rule).** Overridden for weak tests only. Every other `AGENTS.md` test rule still stands.
- **Fix a weak test by loosening it.** Rejected: that is exactly what the never-loosen decision forbids.

## How it is applied

- `AGENTS.md` is intentionally not edited. The precedence is written into `.agents/skills/verify/SKILL.md` and `.agents/skills/verify/references/test-policy.md`, and the weak-test smells are listed there.
- Each removal goes under "Test changes" in the pull request. Examples: https://github.com/Mani212005/aideos/pull/253 removed two tests whose subjects were deleted by owner decision (`alignSceneToAudio` and the `validateFilmNode` duration-sum validator), and https://github.com/Mani212005/aideos/pull/258 removed guarded-route rows that asserted nothing once their routes were gone.
- The 12 `assert.ok(true)` placeholders are slice 14 of the habits purge (see [2026-11-21-habits-purge-slicing.md](2026-11-21-habits-purge-slicing.md)); the owner answered on 2026-11-22 to delete all 12 without adding new tests, and slice 14 removed them.
