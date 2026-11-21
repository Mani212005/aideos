<!-- File Description: Seed verification evidence entry recording the verify skill checklist executed on the PR that introduces the verify skill and Feature Map. -->

# Verification Evidence: Reusable verify skill and aideos Feature Map

- **Date**: 2026-11-21
- **Branch / PR**: `fm/aideos-verify-skill` (PR URL assigned when pushed by `no-mistakes`)
- **Scope**: Docs-only addition of `.agents/skills/verify/` (`SKILL.md` + `references/`), `docs/verify/FEATURE_MAP.md`, `docs/evidence/verify/` (`README.md` + this seed entry), and one docs index line in `README.md`. Feature Map row: `CI, Test Wiring & Static Enforcement` (docs-only; zero runtime code or test changes).
- **Risk tier**: Low (docs-only change)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | Docs-only change; no runtime code, Studio UI, or pipeline code modified. |
| Property test for new invariants | N/A | No new code invariant introduced; no property-based dependency added. |
| Differential test on replacement | N/A | No existing implementation replaced. |
| Expect / golden test for complex output | N/A | No rendered or structured code output changed. |
| No sleeps in tests | PASS | Zero test files added or edited; verified in `git status`. |
| No mocks of thing under test | PASS | Zero test files added or edited; Feature Map inventory verified directly against `git ls-files`. |
| Protected suites unloosened | PASS | Zero edits to any journey, golden, parity gate, review gate, `AGENTS.md`, or `CLAUDE.md`. |
| Weak-test audit | PASS | No weak tests touched or removed in this docs-only PR. |
| Independent review | PENDING | Scheduled via `no-mistakes` review pipeline upon handoff (never author alone). |
| Evidence log written | PASS | Recorded in `docs/evidence/verify/2026-11-21-verify-skill.md` (this file). |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `git ls-files` inventory & link/path/dash audit (`python3` verification over all touched docs) | PASS (exit 0) | Checked 190 tracked test files (137 backend unit, 9 scripts unit, 25 journeys, 1 legacy golden, 3 live, 15 native integration crates); 190/190 mapped in `docs/verify/FEATURE_MAP.md`; all relative markdown links resolve; `.claude/skills/verify/SKILL.md` resolves via symlink; zero em/en dashes. |
| `npm run ci -- static` | PASS (exit 0) | 9/9 steps passed: `ensure generated files` (3.4s), `file headers` (665 code files, 1.8s), `every test file is wired` (1.5s), `eslint` (0 errors, 22.7s), `tsc root` (584 files, 19.1s), `oxlint editor` (0 errors, 0.1s), `editor build` (18.4s), `ruff check` (0.1s), `ruff format --check` (0.1s). |

## Fix attempts

- Attempts used: 1 / 3 (initial path audit caught 5 owner-module paths in `docs/verify/FEATURE_MAP.md` pointing to `backend/` instead of `editor/src/` or `src/dl/`; corrected from `git ls-files` and re-verified to 190/190 pass).

## Weak-test removals

- None.

## Artifacts and links

- Skill definition: [.agents/skills/verify/SKILL.md](../../../.agents/skills/verify/SKILL.md)
- Reference docs: [.agents/skills/verify/references/](../../../.agents/skills/verify/references/methods.md)
- Feature Map: [docs/verify/FEATURE_MAP.md](../../verify/FEATURE_MAP.md)
- Evidence log index: [docs/evidence/verify/README.md](README.md)
