<!-- File Description: Verification evidence for the Studio narrow layout and two-width pixel pass. -->

# Verification Evidence: Studio narrow layout and two-width pixel pass

- **Date**: 2026-11-25
- **Branch / PR**: `fm/aideos-fe-p7` (PR assigned by the validation pipeline)
- **Scope**: Studio header and Words stage responsive layout in `editor/src/App.tsx` and `editor/src/components/ScriptEditor.tsx`.
- **Risk tier**: Low

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `npm run smoke:studio` completed the real Studio workflow. Chrome DevTools also loaded the real editor at 390 x 844 and 1440 x 900. |
| Property test for new invariants | N/A | No new pure invariant. |
| Differential test on replacement | N/A | No implementation replacement. |
| Expect / golden test for complex output | N/A | No generated structured output or render golden changed. |
| No sleeps | PASS | No test code added or changed. |
| No mocks of thing under test | PASS | The editor was rendered in Chrome from the local Vite server; no layout was mocked. |
| Protected suites unloosened | PASS | No test assertions, tolerances, timeouts, or goldens changed. |
| Weak-test audit | PASS | No tests removed. |
| Independent review | PENDING | Awaiting the instructed no-mistakes validation after commit. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npm --prefix editor run build` | PASS (exit 0) | TypeScript build and Vite production bundle completed. Vite reported the existing large-chunk advisory. |
| `npm --prefix editor run lint` | PASS (exit 0) | Oxlint reported existing warnings outside the changed layout, including the existing `App.tsx` fast-refresh warning. |
| `npm run smoke:studio` | PASS (exit 0) | Real Studio smoke completed scrub, return, split, autosave, and reload without uncaught errors. The fixture skipped unavailable soundtrack cache tracks. |
| `git diff --check` | PASS (exit 0) | No whitespace errors. |
| Chrome DevTools at 390 x 844 and 1440 x 900 | PASS | Reviewed the live Words stage at both widths; root scroll width matched viewport width at 390 before the change and 1440 after. |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.

## Artifacts and links

Screenshots are stored outside the worktree as required and should be attached to the PR:

- Before, 390 x 844: `/home/mani/aideos-linux-home/data/aideos-fe-p7/before-narrow-390x844.png`
- After, 390 x 844: `/home/mani/aideos-linux-home/data/aideos-fe-p7/after-narrow-390x844.png`
- Before, 1440 x 900: `/home/mani/aideos-linux-home/data/aideos-fe-p7/before-wide-1440x900.png`
- After, 1440 x 900: `/home/mani/aideos-linux-home/data/aideos-fe-p7/after-wide-1440x900.png`
