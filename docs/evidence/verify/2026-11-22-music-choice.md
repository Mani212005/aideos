<!-- File Description: Verification evidence log for the default music selector (speech-band share, swells, energy, mood, reuse) and the audio library profile. -->

# Verification Evidence: better default music choice

- **Date**: 2026-11-22
- **Branch / PR**: `fm/aideos-music-choice` (PR opened by the pipeline)
- **Scope**: Feature Map row "Soundtrack, Audio Library & Mastering": `backend/musicSelector.ts`, `backend/defaultSoundtrack.ts`, `backend/audioLibrary/{musicProfile,schema,cli}.ts`, `audio/library.json` profiles, `docs/AUDIO_LIBRARY.md`
- **Risk tier**: Medium (every new film's default music changes; the manifest gains measured profiles; mixer, ducking and review untouched)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | `j14_soundtrack` renders through Remotion; the pipeline owns journeys on this shared machine. The real path was run by replaying `scoreDefaultSoundtrack` on the delivered test-quality film with the hash-verified cache (long: mk-615 / mk-184 / mk-1023, reel: mk-107) and `aideos audio profile --write` on the real cache. |
| Property test for new invariants | PASS | `backend/musicSelector.test.ts`: 300 seeded generated libraries (order independence, sorted ranking, pick within the tie width, a swell never lowers a cost) |
| Differential test on replacement | PASS | Old pick (`pool[seed % n]`) vs new on the fixture film: `backend/defaultSoundtrackMusic.test.ts` asserts picks the old code did not make (old: b, c, reel b); unmeasured fixture beds tie and keep the old seeded pick, so existing fixtures are unchanged |
| Expect / golden test for complex output | N/A | No new rendered or structured golden; profile numbers are checked against real ffmpeg tones in `musicProfile.test.ts` |
| No sleeps in tests | PASS | none introduced |
| No mocks of thing under test | PASS | selector, profile math, ffmpeg measurement and `scoreDefaultSoundtrack` all run for real; only the library data is a fixture |
| Protected suites unloosened | PASS | no assertion, tolerance, timeout or golden changed |
| Weak-test audit | PASS | no weak test found in the touched areas; none removed |
| Independent review | PENDING | `no-mistakes` pipeline |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/audioLibrary/*.test.ts backend/soundtrack*.test.ts backend/deliveryGate.test.ts backend/sectionMixer.test.ts backend/designCheck/soundtrack*.test.ts backend/designCheck/designCheck.test.ts backend/musicSelector.test.ts backend/defaultSoundtrackMusic.test.ts` | PASS (82 tests, 0 fail, before the property test was added) | |
| `node --import tsx --test backend/musicSelector.test.ts` | PASS (10 tests) | includes the property test |
| `npx tsx scripts/typecheck_tracked.ts` | PASS | 598 files |
| `npx tsx scripts/check_headers.ts` | PASS | 678 files |
| `npm --prefix editor run build` | PASS | |
| `AIDEOS_VIDEOS_DIR=<scratch> npx tsx backend/cli.ts audio profile --write` | PASS | 12 music items profiled from the verified cache |

## Fix attempts

- Attempts used: 0 / 3 for failures in the final code. Two defects were found and fixed while developing the new tests (swell start picked the first of a flat run, and a 2-pole band edge let a 100 Hz tone count as midrange); both fixed on the first attempt before any commit.

## Weak-test removals

- None.

## Artifacts and links

- Handoff with measurements: `/home/mani/aideos-linux-home/data/aideos-music-choice/handoff.md`
