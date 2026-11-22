<!-- File Description: Verification evidence entry for pruning per-line voice recordings made under an older stretch rate or the pre-stretch plain key. -->

# Verification Evidence: Prune old-rate voice line recordings

- **Date**: 2026-11-22
- **Branch / PR**: `fm/aideos-voicelines-prune-old-keys` (PR URL assigned when pushed by `no-mistakes`)
- **Scope**: Feature Map row `Voiceover & Narration`. `backend/voiceLines.ts`: pruning now matches a stored recording by `unpacedVoiceKey` equality instead of the exact key, and is split into `planPrune` (lists, deletes nothing, reports fingerprint, stored voice key and bytes) and `applyPrune` (deletes exactly the plan). One behavioural test in `backend/voiceLines.test.ts`.
- **Risk tier**: Low (cache entries only, they are regenerable; the same-voice match is narrower than "everything": another voice or another take selection has another unpaced key and is untouched).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | No user-facing workflow changed shape; the real `synthesizeLines` runs on a scratch package directory in the test. No journey touches the line store pruning. |
| Property test for new invariants | N/A | One fixed scenario covers the rule (same voice other rate pruned, other voice and take variant kept). |
| Differential test on replacement | N/A | Nothing replaced; behaviour widens only for same-voice other-rate entries. |
| Expect / golden test for complex output | N/A | No rendered output. |
| No sleeps in tests | PASS | None. |
| No mocks of the thing under test | PASS | Store, fingerprint, plan and prune run for real; only the synthesizer is a counting fake. |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden touched. |
| Weak-test audit | PASS | None removed. Mutation: restoring the exact-key comparison fails the new test (1 fail, 7 pass). |
| Independent review | PENDING | Scheduled via `no-mistakes` on handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npx tsx --test backend/voiceLines.test.ts` | PASS (8/8) | Includes the new prune test and the unchanged `produceAudioPipeline` rerun test. |
| Same command with the old exact-key comparison restored | FAIL (1) | Proves the new test catches the reported leak. |
| `npx tsx scripts/check_headers.ts` | PASS | 692 headers valid. |
| `npx tsc --noEmit -p editor/tsconfig.node.json` | Errors elsewhere | Errors in `editor/vite.config.ts` (narrowing at lines near 1810) exist on main and none mention `voiceLines`. |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.

## Artifacts and links

- Feature Map: [docs/verify/FEATURE_MAP.md](../../verify/FEATURE_MAP.md)
