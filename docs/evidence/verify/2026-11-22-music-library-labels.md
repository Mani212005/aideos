<!-- File Description: Verification evidence log for labelling the music library beds as instrumental from source proof. -->

# Verification Evidence: music library instrumental labels

- **Date**: 2026-11-22
- **Branch / PR**: fm/aideos-music-library-labels (PR URL added by the pipeline)
- **Scope**: `audio/library.json` (one field on `mk-615`) and `docs/AUDIO_LIBRARY.md` (labelling rule). Feature Map row: Soundtrack, Audio Library & Mastering. No code change, so no Feature Map change.
- **Risk tier**: Low

## Evidence for each label

| Bed | Label | Proof |
| --- | --- | --- |
| `mk-615` Tapis | `instrumental: true` | The "Instrumental" tag on its Mixkit track page (https://mixkit.co/free-stock-music/tapis/), fetched 2026-11-22. |
| other 11 music beds | left unlabelled (unknown) | Their Mixkit pages carry no "Instrumental" and no "Vocals" tag. Mixkit tags only 9 tracks "Instrumental" and 1 track "Vocals" (`mk-527`), so a missing tag proves nothing. |

Measurement (scratch script, numpy and ffmpeg, first 120 s of each file, 16 kHz mono): voiced-band share, fraction of pitched frames (autocorrelation peak above 0.7 at 80 to 400 Hz), median pitch strength and the 2 to 8 Hz envelope modulation of the 300 to 3400 Hz band. The known vocal control `mk-527` (pitched fraction 0.028, modulation 0.46, speech share 0.278) sits inside the range of the 12 beds on every feature (pitched fraction 0.005 to 0.415, modulation 0.357 to 0.697, speech share 0.039 to 0.75), so the features cannot separate a voice from a synth lead. No label was derived from them. The sha256 of all 12 downloaded files matched the manifest.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | Data and docs only. The real manifest was loaded through `loadAudioLibrary` and ranked by the real `rankMusic`. |
| Property test for new invariants | N/A | No new invariant. |
| Differential test on replacement | PASS | Real library ranked for 5 roles and 4 shot paces with and without the `mk-615` label: 0 differences (a `true` label changes no cost). `hasVocals` is true for no real bed. |
| Expect / golden test for complex output | N/A | No structured output added. |
| No sleeps in tests | N/A | No test added or changed. |
| No mocks of thing under test | N/A | No test added or changed. |
| Protected suites unloosened | PASS | No test, assertion, tolerance, timeout or golden touched. |
| Weak-test audit | PASS | No weak test found in `library.test.ts` or `musicSelector.test.ts`; none removed. |
| Independent review | PENDING | The no-mistakes pipeline reviews this diff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `npx tsx --test backend/audioLibrary/library.test.ts backend/musicSelector.test.ts` | PASS (exit 0) | 14 tests, 0 fail |
| scratch differential script over the real manifest | PASS | labelled `mk-615` only, vocals none, 0 ranking differences |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.

## Artifacts and links

- Scratch analysis and fetched pages: `/home/mani/aideos-linux-home/data/aideos-music-library-labels/` (`features.json`, `mixkit-tags.json`, `pages/`).
