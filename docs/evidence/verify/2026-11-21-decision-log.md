<!-- File Description: Verification evidence log for the docs-only decision log change (docs/decisions, its index and one README pointer). -->

# Verification Evidence: Decision log (docs/decisions)

- **Date**: 2026-11-21
- **Branch / PR**: `fm/aideos-decision-log` (PR URL assigned when pushed by `no-mistakes`)
- **Scope**: Docs only. New `docs/decisions/` (index `README.md` plus 12 decision files) and one pointer line in the `README.md` Documentation list. Feature Map row: `CI, Test Wiring & Static Enforcement` (docs-only; no runtime code or test changes, so no Feature Map edit).
- **Risk tier**: Low (docs-only change)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | Docs-only change; no runtime code, Studio UI or pipeline code modified. |
| Property test for new invariants | N/A | No new code invariant introduced. |
| Differential test on replacement | N/A | No implementation replaced. |
| Expect / golden test for complex output | N/A | No rendered or structured code output changed. |
| No sleeps in tests | PASS | Zero test files added or edited. |
| No mocks of thing under test | PASS | Zero test files added or edited. |
| Protected suites unloosened | PASS | Zero edits to any journey, golden, parity gate, review gate, `AGENTS.md` or `CLAUDE.md`. |
| Weak-test audit | PASS | No test touched. The 12 `assert.ok(true)` placeholders in `backend/scene/scene.test.ts` are still on main and are recorded in the decision log as habits slice 14, not removed here. |
| Independent review | PENDING | Scheduled via the `no-mistakes` review pipeline on handoff (never the author alone). |
| Evidence log written | PASS | This file. |

## Fact checks against origin/main at `d1ea4e1`

Each seeded decision was checked against main and the merged pull requests before it was written. Items found stale, not on main or not code facts are called out here so the entries do not overstate them.

| Decision | Check on main | Result |
| --- | --- | --- |
| Cloned voice default narrator | `backend/tts.ts` default backend `vcd`; `docs/PRODUCTION_PIPELINE.md`, `docs/WORKFLOW.md`; PR 247 merged | Confirmed; follow-up "voice of choice everywhere" has no PR yet, recorded as open |
| Narration about 1.2x, edits 20 to 30 percent faster | `docs/GOOD_VIDEO.md` criterion 9 still says 130 to 170 wpm; no pacing PR open | Not on main: recorded as `Decided, not yet on main` |
| Illustrated stage picture format | PR 248 and PR 254 merged; `backend/pictures/` present | Confirmed (phase 1 only) |
| Hosted Studio look-only for strangers | `backend/studioApiGuard.ts`, `docs/DEPLOY_HOSTING.md` Studio API access; PR 250 merged | Confirmed; the doc still calls the owner's hosted access model open, recorded as such |
| Stay on npm, not bun | `package-lock.json` only, no `bun.lock`; CI uses `npm ci` | Confirmed; the npm ci slowdown fix has no PR yet |
| Keep Used-by headers, no checker | `scripts/check_headers.ts` checks label presence only; PR 257 still open | Confirmed |
| End card compulsory | `README.md`, `docs/WORKFLOW.md` Compulsory finishing steps; PR 166 merged | Confirmed; supersedes the PR 161 switch |
| No loosening of tests | `AGENTS.md` Tests section; PR 136 and PR 256 merged | Confirmed |
| Delete weak tests policy | `.agents/skills/verify/references/test-policy.md`; PR 256 merged | Confirmed |
| Verify skill | `.agents/skills/verify/` present; PR 256 merged | Confirmed |
| Habits purge slicing | PR 253, 255, 258 merged, PR 257 open | Confirmed |
| Neon sign-in in the desktop keyring | Not a repository fact (machine and fleet operations) | Recorded from the fleet launch shim note and Firstmate's task brief; no repository check possible |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| Python audit over `docs/decisions/*.md` and `README.md` | PASS (exit 0) | 14 files; 0 long dashes (U+2013 or U+2014); every relative link resolves; every decision file is listed in the index. |
| `npx tsx scripts/check_headers.ts` | PASS (exit 0) | 661 code files, all three-field headers present (docs carry no code header). |
| `npx tsx scripts/check_tests_wired.ts` | PASS (exit 0) | All tracked test files are run by a package.json script. |

The full `npm run ci -- static` was not run: the change adds only Markdown, which none of its steps read, and the machine is shared by many workers.

## Fix attempts

- Attempts used: 0 / 3. One self-review pass replaced reasons I had inferred (hosted Studio, habits slicing, Neon) with what the record actually says.

## Weak-test removals

- None.

## Artifacts and links

- Decision log index: [docs/decisions/README.md](../../decisions/README.md)
- Verify skill: [.agents/skills/verify/SKILL.md](../../../.agents/skills/verify/SKILL.md)
