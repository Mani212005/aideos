<!-- File Description: Verification evidence log for the data-oriented speedups of the PNG decoder, the picture palette check and the study frame tone statistics. -->

# Verification Evidence: pixel hot paths (PNG decoder, picture palette check, study frame tone)

- **Date**: 2026-11-25
- **Branch / PR**: fm/aideos-dod-perf (PR URL is added by the pipeline)
- **Scope**: `backend/pictures/png.ts` (decoder), `backend/designCheck/pictures.ts` (`checkPicturePalette`, `relativeLuminance`), `backend/study/tone.ts` (`frameTone`); Feature Map rows "Picture Layer / Illustrated Stage" and "Reference Study & Compare"
- **Risk tier**: Low (same inputs give the same outputs, bit for bit, no API change)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | The picture journey (`pictures_stage.journey.ts`) is left to the no-mistakes pipeline: this worker may not run full journeys on the shared machine. `pictures.test.ts` and `pictureComposition.test.ts` run the real design check on real PNG files and passed |
| Property test for new invariants | PASS | `backend/pictures/png.test.ts`: independent spec encoder (all colour types, depths, Adam7, all five filters, tRNS) round-trips through the decoder; it also passes on the pre-change decoder |
| Differential test on replacement | PASS | Old and new run on shared inputs: decoder 6933 random PNGs (1915 of them invalid, same error text), 3 real PNGs, 0 byte differences; palette check 2800 random pictures (612 with findings), identical findings JSON; frame tone 300 random frames, bit-identical doubles; `relativeLuminance` 2000 colours identical. Harness kept with the benchmark scripts outside the repo (see the handoff) |
| Expect / golden test for complex output | N/A | No new structured output; `backend/study/tone.test.ts` adds hand-computed expected values for the tone statistics |
| No sleeps in tests | PASS | None added |
| No mocks of thing under test | PASS | Decoder and tone code run for real |
| Protected suites unloosened | PASS | No existing test, tolerance, timeout or golden touched |
| Weak-test audit | PASS | Read the picture and study tests that touch these functions; none judged weak, none removed |
| Independent review | PENDING | Runs in the no-mistakes pipeline |
| Evidence log written | PASS | This file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/pictures/png.test.ts backend/study/tone.test.ts backend/designCheck/pictures.test.ts backend/designCheck/pictureComposition.test.ts backend/pictures/cache.test.ts backend/pictures/cli.test.ts backend/study/study.test.ts` | PASS (exit 0) | 34 tests, 0 fail |
| `npx tsc --noEmit -p tsconfig.json` | PASS (exit 0) | clean |
| `npx eslint` on the five touched code files and the two new tests | PASS (exit 0) | clean |
| mutation checks of the property test (filter 3 shift, tRNS key index) | detected | both made `png.test.ts` fail |

## Fix attempts

- Attempts used: 0 / 3 for every failure. One rejected optimization (`frameFeatures`, slower) was reverted before commit.

## Weak-test removals

- None.

## Artifacts and links

- Benchmarks and differential harnesses: `/home/mani/aideos-linux-home/data/aideos-dod-perf/bench/`
- Handoff: `/home/mani/aideos-linux-home/data/aideos-dod-perf/handoff.md`
