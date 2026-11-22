<!-- File Description: Verification evidence log for the backend voice resolution and HTTP deadline cleanup. -->

# Verification Evidence: backend voice resolution, one HTTP deadline policy, transcript integrity

- **Date**: 2026-11-21
- **Branch / PR**: fm/aideos-cleanup-backend-voice-and-timeouts (PR URL is added by the pipeline)
- **Scope**: Feature Map rows "Voiceover & Narration" (`backend/vcdClient.ts`, `backend/httpDeadline.ts`, `backend/voiceSynthesis.ts`, `backend/transcribe.ts`), "Soundtrack, Audio Library & Mastering" (`backend/audioLibrary/library.ts`), "Agent Integration" (`backend/mcp/server.ts`)
- **Risk tier**: Medium (changes which enrolled voice narrates and adds time limits to external requests)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | `j2_retime` and the other journeys run in the pipeline, not locally (shared 12-core host). Instead a real loopback HTTP server drives a real `fetch` through a stalled vcd audio body and stalled audio-library downloads (including real `curl`) |
| Property test for new invariants | N/A | The deadline invariants (never sleep or request past the budget) are pinned by injected-clock cases, no generated-input surface |
| Differential test on replacement | PASS | New vcd tests were run against the old `vcdClient.ts`: resolution, deadline, 429 and hung-request cases fail there (stalled-body case never ends), pass on the new one |
| Expect / golden test for complex output | N/A | No structured or rendered output changed |
| No sleeps in tests | PASS | Waits are injected clocks or real aborts on a short budget; the `setInterval` keep-alive only holds the event loop open for an abort, it does not delay anything |
| No mocks of the thing under test | PASS | vcd client, deadline module, downloader and transcript reader run for real; only fetch, sleep, clock and the LLM planner are injected |
| Protected suites unloosened | PASS | No existing assertion, tolerance, timeout or golden changed. The restored vcd suite has one updated expectation (`narrationVoiceOf` now also carries `language: "auto"`) |
| Weak-test audit | PASS | None removed |
| Independent review | PENDING | `no-mistakes` pipeline |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/vcdClient.test.ts backend/voiceSynthesis.test.ts backend/transcribe.test.ts backend/audioLibrary/library.test.ts` (3 runs) | PASS (exit 0) | 39 tests, 0 failures each run |
| `node ... --test backend/mcp/mcp.test.ts` | PASS (exit 0) | 6 tests, includes the corrupt-transcript warning case |
| `node ... --test backend/deliveryGate.test.ts backend/designCheck/soundtrackHeadroom.test.ts backend/designCheck/soundtrackReel.test.ts backend/editContext/editContext.test.ts` | PASS (exit 0) | 19 tests |
| `npm run lint` | PASS (exit 0) | headers, eslint, typecheck of 581 tracked files |
| `npx tsc -b tsconfig.node.json` in `editor/` | PASS (exit 0) | backend modules stay valid for the editor build |
| `npx tsx scripts/check_tests_wired.ts` | PASS (exit 0) | the restored suite is picked up by the glob |

## Fix attempts

- Attempts used: 0 / 3 (two first-run test expectation fixes: 429 submit count 3 -> 2 since a spent budget makes no request, and a keep-alive for mock-only hang tests).

## Weak-test removals

- None.

## Artifacts and links

- Audit: `/home/mani/audit-reports/backend-sol.md` (B1 to B6) and `editor-src-neon.md` (ES-P0-04).
