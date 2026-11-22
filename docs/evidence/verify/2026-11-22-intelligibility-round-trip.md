<!-- File Description: Verification evidence log for the repeatable narration intelligibility round trip (npm run intelligibility). -->

# Verification Evidence: narration intelligibility round trip

- **Date**: 2026-11-22
- **Branch / PR**: `fm/aideos-intelligibility-check`
- **Scope**: Feature Map row "Voiceover & Narration" (new by-hand check `scripts/intelligibility/round_trip.ts` and `scripts/intelligibility/transcribe_wer.py`, `npm run intelligibility`); docs only elsewhere (`docs/GOOD_VIDEO.md` House pace, `ruff.toml` header)
- **Risk tier**: Low (a new by-hand script; no pipeline, review, CI or test code changes)

## What it does

`npm run intelligibility -- --backend <name> [--voice <id>] [--speed <n>] [--rate <n>]` narrates the committed
`sample-explainer` fixture (14 lines, 234 words) through the real `produceAudioPipeline` twice with one voice: as
spoken (stretch 1) and re-paced by `timeStretch` at the house rate (1.2). Both takes re-pace the same raw recording
of each line. It transcribes both with local Whisper (openai-whisper `small`, the scene kit's engine, or
faster-whisper `small.en`, the engine of the 2026-11-21 evidence), scores them against the script and exits 1 when
the stretch adds more than 2 points of misheard words. Audio goes to a temporary directory and is deleted; nothing is
uploaded and no network service is called. A Kokoro voice stands in for a voice without pace control at speed 1.

## Findings while building it

1. **The 2026-11-21 numbers carry decoding noise.** faster-whisper's default temperature fallback samples, so the same
   `kokoro-1.05` wav scored 6.8% WER on one run and 9.4% on the next (2.6 points, more than the effect being
   measured). The scorer pins temperature 0; three runs over four evidence wavs then gave identical numbers.
2. **Plain WER is dominated by spelling choices** that flip between takes: "downsampling" against "down sampling",
   "U-Net" against "unet", "Midjourney" against "mid journey". The judged number forgives an error run whose letters
   match the script (single digits spelled out). Plain WER is still reported for comparison with the old numbers.
3. **Stretching a voice already at house pace does lose words.** Kokoro at its house speed 1.05 stretched another
   1.2x (176 wpm, a path production never takes because Kokoro paces itself) misheard "U-Net" as "unit" three times:
   1.7% to 5.6% misheard, FAIL. This is why a pace-controlled synthesizer defaults to speed 1 here.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `npm run intelligibility -- --backend kokoro` with local Kokoro and faster-whisper small.en (table below) |
| Property test for new invariants | N/A | No new invariant in shipped code; the scorer is a by-hand tool |
| Differential test on replacement | PASS | The scorer's WER and error counts equal jiwer's (the 2026-11-21 `intelligibility.py`) on the stored `before`, `after-stretch` and `atempo-1.2` wavs, with identical transcripts, under the old decoding |
| Expect / golden test for complex output | N/A | Report JSON is a by-hand artefact, not a contract |
| No sleeps in tests | N/A | No tests added |
| No mocks of thing under test | N/A | No tests added; the run uses the real pipeline, synthesizer and engine |
| Protected suites unloosened | PASS | None touched |
| Weak-test audit | N/A | No tests touched |
| Independent review | PENDING | `no-mistakes` pipeline, run when firstmate asks |
| Evidence log written | PASS | This file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `transcribe_wer.py --engine faster-whisper` on the stored 2026-11-21 wavs (old decoding) | PASS | `before` 9.83% (13/5/5), `after-stretch` 8.55% (11/6/3), `atempo-1.2` 8.97% (12/6/3): equal to jiwer |
| same, temperature 0, three runs | PASS | identical each run: `kokoro-1.05` 6.84%, `kokoro-1` 8.12%, `before` 9.83%, `after-stretch` 8.97% |
| `npm run intelligibility -- --backend kokoro` | PASS (exit 0) | speed 1: spoken 144 wpm 2.1% misheard (8.1% WER), stretched 171 wpm 2.6% (8.6% WER), +0.4 points |
| `npm run intelligibility -- --backend kokoro --speed 0.75` | PASS (exit 0) | the 2026-11-21 stand-in: spoken 104 wpm 2.1% (8.1% WER), stretched 109.5 s 124 wpm 2.1% (9.0% WER), +0.0 points; duration and pace equal the old `after-stretch` take |
| `npm run intelligibility -- --backend kokoro --speed 1.05` (before the speed 1 default) | FAIL (exit 1) | finding 3: 1.7% to 5.6% misheard |
| `npm run intelligibility -- --backend kokoro --rate 2` (negative control) | FAIL (exit 1), as intended | spoken 144 wpm 2.1% misheard, stretched 280 wpm 5.6% (U-Net heard as unit, run as runs), +3.4 points: the check catches a stretch that loses words |
| `npx tsx scripts/check_headers.ts`, `npx tsx scripts/check_tests_wired.ts` | PASS | |
| `uvx ruff@0.17.0 check .`, `uvx ruff@0.17.0 format --check .` | PASS | |
| `npm run -s typecheck` | PASS (exit 0) | includes `scripts/intelligibility/round_trip.ts` |

The cloned owner voice (`vcd`) was not run: it is the voice this check matters most for, and it must be run on the
host where that service runs (`npm run intelligibility -- --backend vcd --voice <id>`).

## Fix attempts

- None failed; the two scoring changes (temperature 0, spelling-blind count) were design findings, recorded above.

## Weak-test removals

- None.

## Artifacts and links

- Reports (outside the repo): `/home/mani/aideos-linux-home/data/aideos-intelligibility-check/` (`kokoro-speed1.json`, `kokoro-speed0.75.json`, `kokoro-default.json`, `kokoro-rate2.json`, `differential.json`, `t0-*.json`)
