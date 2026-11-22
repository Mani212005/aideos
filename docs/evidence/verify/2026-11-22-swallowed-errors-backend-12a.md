<!-- File Description: Verification evidence log for habits slice 12a, swallowed errors in backend/mcp, agentBridge, geminiReview and editPlanner. -->

# Verification Evidence: stop swallowing errors in backend/mcp, agentBridge, geminiReview, editPlanner (slice 12a)

- **Date**: 2026-11-22
- **Branch / PR**: fm/aideos-habits-s12a-swallowed-backend
- **Scope**: Feature Map rows "Agent Integration (MCP server, Agent Bridge, Agent Link)", "Review Gates, Design Check & All-Check" (geminiReview facts and runner), "Studio Cut / Edit" (editPlanner provenance log and interpreter trace)
- **Risk tier**: Medium (a corrupt or unreadable edit log now throws instead of reading as empty; a video ffprobe cannot read is now reported as unmeasured instead of stated as 80.0 s)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | Journeys run only in the pipeline on this shared machine. The unit suites for the touched modules ran through the same `npm test` runner flags. |
| Property test for new invariants | N/A | No new pure math, parser or state machine; the new tests pin error reporting. |
| Differential test on replacement | N/A | No implementation was replaced. |
| Expect / golden test for complex output | N/A | No new structured or rendered output. |
| No sleeps in tests | PASS | The four new tests use temp files and a console.warn spy, no waits. |
| No mocks of thing under test | PASS | Production code runs for real; only console.warn is spied to read the diagnostic. |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden changed. One empty `catch {}` in `agyProcess.test.ts` cleanup now ignores only ESRCH and rethrows anything else. |
| Weak-test audit | PASS | No weak test found in the touched suites; none removed. |
| Independent review | PENDING | To be run by the no-mistakes pipeline. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npx eslint backend/fsErrors.ts backend/agentBridge backend/editPlanner backend/geminiReview backend/mcp` with `no-empty` `allowEmptyCatch: false` forced | PASS | Zero empty catch blocks remain in the four folders, so slice 12c can flip the flag for them. |
| `npx eslint backend/fsErrors.ts backend/agentBridge backend/editPlanner backend/geminiReview backend/mcp` (repo config) | PASS | |
| `npm run typecheck` | PASS | 617 tracked root files, no type errors. |
| `npx tsx scripts/check_headers.ts` | PASS | 699 files. |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/mcp/*.test.ts backend/editPlanner/*.test.ts backend/agentBridge/*.test.ts backend/geminiReview/*.test.ts backend/review/*.test.ts` | PASS | 241 tests, 0 failures. |

## Fix attempts

- Attempts used: 0 / 3. (Running the mcp suite with bare `tsx --test` fails on a clean main as well because it needs the fixture preload; the real runner flags pass.)

## Weak-test removals

- None.

## Artifacts and links

- Habits report: row 12 of section 2.
