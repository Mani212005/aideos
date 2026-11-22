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
of each line. It transcribes both with local openai-whisper `small` (the scene kit's engine, `backend/sceneKit/whisperWords.py`) at
temperature 0, scores them against the script and exits 1 when the stretch adds more than 2 points of misheard
words. The 2026-11-21 evidence used faster-whisper `small.en`, so its numbers are not comparable with this check's. Audio goes to a temporary
directory and is deleted; nothing is uploaded and no network service is called. A Kokoro voice stands in for a voice without pace control at speed 1.

## Findings while building it

1. **The 2026-11-21 numbers carry decoding noise.** faster-whisper's default temperature fallback samples, so the same
   `kokoro-1.05` wav scored 6.8% WER on one run and 9.4% on the next (2.6 points, more than the effect being
   measured). The scorer pins temperature 0; three runs over four evidence wavs then gave identical numbers.
2. **Plain WER is dominated by spelling choices** that flip between takes: "downsampling" against "down sampling",
   "U-Net" against "unet", "Midjourney" against "mid journey". The judged number forgives an error run whose letters
   match the script (single digits spelled out). Plain WER is still reported, as jiwer counts it.
3. **The check has a limit: it does not catch an extreme stretch.** The 2x negative control (280 wpm) moved the
   misheard rate by -0.4 points and passed: openai-whisper `small` transcribes fast clean speech about as well as
   normal speech, and it mishears "U-Net" as "unit" at every pace. The check guards against a stretch that makes
   words misheard; it is not proof of a pace limit.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `npm run intelligibility -- --backend kokoro` with local Kokoro and openai-whisper small (table below) |
| Property test for new invariants | N/A | No new invariant in shipped code; the scorer is a by-hand tool |
| Differential test on replacement | PASS | Run on the earlier faster-whisper version of the scorer, before review-1 removed that engine: the scorer's WER and error counts equal jiwer's (the 2026-11-21 `intelligibility.py`) on the stored `before`, `after-stretch` and `atempo-1.2` wavs, with identical transcripts, under the old decoding |
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
| `transcribe_wer.py --engine faster-whisper` on the stored 2026-11-21 wavs (old decoding; earlier faster-whisper version of the scorer, before review-1 removed that engine) | PASS | `before` 9.83% (13/5/5), `after-stretch` 8.55% (11/6/3), `atempo-1.2` 8.97% (12/6/3): equal to jiwer |
| `transcribe_wer.py` twice over the stored 2026-11-21 `kokoro-1` and `after-stretch` wavs (openai-whisper small) | PASS | identical each run: 10.26% WER / 5.98% misheard and 11.11% / 4.70% |
| `npm run intelligibility -- --backend kokoro` (speed 1) | PASS (exit 0) | spoken 144 wpm 6.0% misheard (10.3% WER), stretched 1.2x 171 wpm 7.3% (11.5% WER), +1.3 points |
| `npm run intelligibility -- --backend kokoro --speed 0.75` | PASS (exit 0) | spoken 104 wpm 4.7% (10.3% WER), stretched 109.5 s 124 wpm 4.7% (11.1% WER), +0.0 points; same duration and pace as the 2026-11-21 `after-stretch` take |
| `npm run intelligibility -- --backend kokoro --speed 1.05` | PASS (exit 0) | spoken 147 wpm 6.4% (10.7% WER), stretched 176 wpm 5.6% (12.0% WER), -0.9 points |
| `npm run intelligibility -- --backend kokoro --rate 2` (negative control) | PASS (exit 0): NOT caught | spoken 144 wpm 6.0%, stretched 280 wpm 5.6% (12.0% WER), -0.4 points: a limitation of the check (finding 3) |
| `beam_size` 5 on the kept speed 1 takes | not adopted | spoken 6.0%, 1.2x 6.4%, 2x 5.6%: no better separation, so greedy decoding is kept |
| `npx tsx scripts/check_headers.ts`, `npx tsx scripts/check_tests_wired.ts` | PASS | |
| `uvx ruff@0.17.0 check .`, `uvx ruff@0.17.0 format --check .` | PASS | |
| `npm run -s typecheck` | PASS (exit 0) | includes `scripts/intelligibility/round_trip.ts` |

openai-whisper is not installed for this host's system `python3`; the runs used `AIDEOS_STT_PYTHON` pointing at a local
venv outside the repo (openai-whisper 20250625, torch 2.14.1, CPU) with the public `small` model downloaded to
`~/.cache/whisper`.

The cloned owner voice (`vcd`) was not run: it is the voice this check matters most for, and it must be run on the
host where that service runs (`npm run intelligibility -- --backend vcd --voice <id>`).

## Fix attempts

- None failed; the two scoring changes (temperature 0, spelling-blind count) were design findings, recorded above; review-1 then made the scorer openai-whisper only.

## Weak-test removals

- None.

## Artifacts and links

- Reports (outside the repo): `/home/mani/aideos-linux-home/data/aideos-intelligibility-check/` (`ow-kokoro-speed1.json`, `ow-kokoro-speed0.75.json`, `ow-kokoro-speed1.05.json`, `ow-kokoro-rate2.json`, `ow-rep1.json`, `ow-rep2.json`, `beam5.json`, plus the earlier faster-whisper `differential.json` and `t0-*.json`)
