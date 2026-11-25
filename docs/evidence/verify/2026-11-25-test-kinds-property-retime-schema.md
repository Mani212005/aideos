<!-- File Description: Verification evidence for the seeded retime cache reuse and generated film schema JSON round-trip properties. -->

# Verification Evidence: Test kinds property follow-up (retime and film schema)

- **Date**: 2026-11-25
- **Branch / PR**: `fm/aideos-tests-property-retime-schema` (PR URL assigned by no-mistakes)
- **Scope**: `Voiceover & Narration` and `Production Pipeline & Director` Feature Map rows. Replaced the wall-clock retime cache example with a seeded property over real cache files and added generated film/schema JSON round trips.
- **Risk tier**: Low (test-only change).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | The changed coverage exercises pure schema parsing and the real retime cache function; no user-facing workflow changed. |
| Property test for new invariants | PASS | `backend/audio.test.ts` checks eight generated speeds against real cache files; `backend/schemaRoundTrip.property.test.ts` checks generated film JSON round trips. |
| Differential test on replacement | N/A | No production implementation was replaced. |
| Expect / golden test for complex output | N/A | No complex output format or rendered output changed. |
| No sleeps | PASS | No fixed-delay waits were added. |
| No mocks of the thing under test | PASS | Film parsing and retiming run through production code; retiming uses the committed synthetic WAV fixture. |
| Protected suites unloosened | PASS | No journey, golden, parity, or review gate changed. |
| Weak-test audit | PASS | Removed the `<100 ms` elapsed-time assertion because it was machine-dependent; replaced it with generated checks that assert stable path, duration, modification time, and file size on cache hits. |
| Independent review | PENDING | no-mistakes review is scheduled after commit. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/audio.test.ts backend/schemaRoundTrip.property.test.ts` | PASS (exit 0) | 16 tests passed, 0 failed. |
| `npx tsx scripts/check_tests_wired.ts` | PASS (exit 0) | All tracked test files are run by a package script. |
| `npx eslint backend/audio.test.ts backend/schemaRoundTrip.property.test.ts` | PASS (exit 0) | No lint findings. |
| `npx tsc --noEmit -p tsconfig.json` | PASS (exit 0) | Root TypeScript project type-check passed. |
| `git diff --cached --check` | PASS (exit 0) | Checked the staged change before commit. |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- `backend/audio.test.ts`: removed the under-100 ms cache timing threshold as machine-dependent; the new property verifies cache reuse without relying on elapsed time.

## Artifacts and links

- `backend/schemaRoundTrip.property.test.ts`
- `backend/audio.test.ts`
