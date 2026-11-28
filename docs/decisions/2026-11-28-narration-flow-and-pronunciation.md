<!-- File Description: Decision record for the owner's 2026-11-28 narration flow, brand-name pronunciation and local voice-cleanup rules for all later videos. -->

# Narration sentence flow, brand-name pronunciation and local voice cleanup

- **Date**: 2026-11-28
- **Status**: In force (applies to every later video; the two finished distillation videos are not reworked)
- **Decided by**: owner ("Narration pauses in the middle of sentences where a person would not pause. Example in the long video at 1:41: 'compute is the only reason [pause] there is'. Fix the narration so sentences flow naturally: synthesize and place each sentence whole, break pauses only at sentence and clause ends, and check the joined audio for unwanted gaps inside a sentence before rendering. Some words are pronounced wrongly. Example: 'OpenAI' is spoken as 'open A I' or similarly wrong. Add a pronunciation fix list for brand and technical names (OpenAI, Anthropic, DeepSeek, Llama, Codex, and similar) so they are said the way a person says them, and listen to every such word in the output before delivery. Make both a standing check in the narration pipeline so they apply to every later video. Record this in the project decision log." Follow-up owner decision same day: turn local voice cleanup ON for AIDeos narration only as the last narration step on generated narration audio only, cleaned output only with no plain-and-cleaned pair, original-reference cloned-voice training untouched, with a switch to turn cleanup off.)
- **Pull requests**: none yet

## Context

After watching the finished distillation videos (`distill-long`, 2026-11-28), the owner recorded three narration rules to apply to every later video without reworking the finished distillation or Riemann deliveries:

1. **Unnatural mid-sentence pauses.** Inspection of the distillation long narration (`voiceover_lines/`) showed two causes: multi-sentence beats were sent to the voice service as one combined block, and the local `vcd` voice engine still inserted 0.50 to 0.72 s silences in the middle of single sentences (including a 0.67 s mid-sentence pause around 1:41 in shot `s16`, and 0.60 to 0.72 s mid-sentence pauses inside single-sentence beats). In addition, `aideos review` only checked word-timing gaps when timings existed and ignored acoustic silences inside sentences, while `compareStemFrames` could count a silent -71 dB pause window as masked speech.
2. **Mispronounced brand and technical names.** Transcribing the dry `distill-long` narration lines with offline `faster-whisper` (`small.en`) confirmed `OpenAI` and `OpenAI's` were spoken as `"OpenEye"` / `"Open-Eyes"`, `Anthropic` as `"Entropic"` in places, `Epoch AI` as `"APOC AI"`, and `H800 GPU` split mid-acronym. The pipeline previously sent raw written text directly to TTS and had no standing pronunciation lexicon or post-synthesis transcription check.
3. **Post-synthesis local voice cleanup.** The owner decided to turn local voice cleanup ON for AIDeos narration only (using the local Resemble Enhance video enhanced profile on the machine that runs narration, never hosted enhancement and never moving or copying any recording). The cleanup applies strictly to the generated narration audio as the last narration step, never to the owner's reference voice recordings, producing only the cleaned narration with no side-by-side plain-and-cleaned pair, and with an explicit off switch.

## Decision

Add three standing rules and gates to the narration and review pipeline for every later video:

1. **Sentence-whole narration flow and in-sentence gap gate.** Split narration beats into whole sentences before synthesis (breaking an over-long sentence only at clause ends before word fallback), place each sentence whole so pauses land only at sentence and clause ends, compact unwanted engine-inserted mid-sentence silences in sample-domain assembly with smooth edge ramps, and enforce a standing measured in-sentence silence gate (`DEFAULT_MAX_IN_SENTENCE_GAP_SEC = 0.35` s) on the final joined narration in `produceAudioPipeline` and as gate criterion 16 (`narration-flow`) in `aideos review`.
2. **Pronunciation lexicon and standing ASR verification check.** Maintain a standing pronunciation lexicon (`DEFAULT_PRONUNCIATION_LEXICON`) for brand, AI, hardware and technical/math names (including `OpenAI`, `Anthropic`, `DeepSeek`, `DeepSeek-R1`, `DeepSeek-V3`, `Llama`, `Codex`, `Claude`, `Gemini`, `Epoch AI`, `GPU`, `H100`, `H800`, `LLM`, `Riemann`, `Euler`, `Dirichlet`, `Gauss`, `zeta`), apply it in the spoken-form step sent to TTS while preserving exact written spellings in captions and word timings, invalidate cached lines when lexicon rules change, and verify every produced narration that contains lexicon terms using offline local speech recognition (Whisper), failing before rendering when a lexicon word is misheard or missed. Because headless build hosts have no audio output for manual listening, offline speech recognition is the standing automated substitute that checks every lexicon word in the output audio before delivery.
3. **Local voice cleanup ON by default for AIDeos narration only.** Run local post-synthesis voice cleanup as the last audio processing step on the generated narration WAV only (`backend/narrationCleanup.ts`), configured via a local command template (`AIDEOS_NARRATION_CLEANUP_CMD` or `narrationCleanup.command` in `aideos.config.json`, taking `{in}` and `{out}` placeholders; profile parameters stay in the host configuration rather than guessed defaults in the repo). Cleanup is ON by default and fails plainly naming the setting when unconfigured rather than silently skipping; `AIDEOS_NARRATION_CLEANUP=off` (or `narrationCleanup.enabled: false`) turns it off explicitly. Only the single cleaned `voiceover.wav` is kept (no plain-and-cleaned pair). The owner's cloned voice remains trained and driven strictly from the original reference recording (never trained on enhanced audio, never uploaded or moved). Both standing checks (in-sentence gaps and pronunciation ASR) run on the **final cleaned audio** so cleanup cannot reintroduce gaps or alter words.

## Why

- Sending whole sentences and compacting engine-inserted mid-sentence stalls eliminates unnatural robotic pauses inside clauses while preserving natural sentence-end, chapter-end and brief clause breaths.
- Making in-sentence silence detection a standing gate in both narration synthesis (`produceAudioPipeline`) and `aideos review` guarantees a mid-sentence pause cannot slip into a rendered video unnoticed.
- Separating spoken-form TTS input from written caption text fixes real voice-engine mispronunciations (verified on local `vcd` `my-voice`: raw `"OpenAI"` was heard as `"OpenEye"`, while spoken form `"Open A.I."` was heard cleanly as `"OpenAI"`) without altering captions or script text.
- Checking produced audio with offline speech recognition catches delivery-time pronunciation regressions on headless machines where an agent cannot listen through speakers.
- Applying local voice cleanup only to generated narration audio (and keeping the reference voice original) improves final video audio polish without risking voice-clone drift, hosted uploads, or duplicate uncleaned/cleaned deliverables.

## Alternatives rejected

- **Re-render or rework the finished distillation or Riemann videos.** Rejected: the owner explicitly scoped this feedback to the next video and all later videos.
- **Swap away from the owner's cloned voice, or enroll/train the cloned voice on enhanced audio.** Rejected: the owner's cloned voice (`vcd` `my-voice`) trained from the original reference remains the voice of choice (see [2026-11-20-cloned-voice-default-narrator.md](2026-11-20-cloned-voice-default-narrator.md)).
- **Silently skip voice cleanup when unconfigured, or emit both plain and cleaned narration files.** Rejected: an unconfigured default-ON step must fail plainly with the setting name so an uncleaned video does not ship by accident, and the next video ships with cleaned narration only.
- **Hardcode unconfirmed Resemble Enhance profile numbers or private host paths in the repository.** Rejected: private model paths and owner profile parameters stay outside the repo in the local host command setting (`AIDEOS_NARRATION_CLEANUP_CMD` / `narrationCleanup.command`).
- **Rewrite the script or captions with phonetic spellings like `"Open A.I."` or `"Oiler"`.** Rejected: captions and script text must stay in exact written form; spoken-form conversion belongs strictly at the TTS boundary.
- **Rely only on word-timing gaps without checking the audio waveform.** Rejected: syllable-estimated word timings inside a segment have zero inter-word gap even when the synthesized audio contains a 0.67 s mid-sentence silence, so the gate must inspect the audio samples and detected silences directly.

## Where it lives now

- Sentence-whole splitting, sample-domain internal pause compaction, and the standing in-sentence flow gate: `backend/narrationFlow.ts`, `backend/pcm.ts`, `backend/audio.ts`, `backend/narrationFlow.test.ts`.
- Review gate criterion 16 (`narration-flow`) and silent pause-window guard: `backend/review/speech.ts`, `backend/review/thresholds.ts`, `backend/review/types.ts`, `backend/review/criteria.ts`, `backend/review/music.ts`.
- Pronunciation lexicon, spoken-form conversion and offline ASR verification check: `backend/narrationPronunciation.ts`, `backend/narrationTranscribe.py`, `backend/audio.ts`, `backend/pipeline/run.ts`, `editor/vite.config.ts`, `backend/narrationPronunciation.test.ts`.
- Local post-synthesis voice cleanup step and config/env switches: `backend/narrationCleanup.ts`, `backend/aideosConfig.ts`, `backend/audio.ts`, `backend/pipeline/run.ts`, `editor/vite.config.ts`, `backend/narrationCleanup.test.ts`.
- Documentation: [docs/NATURAL_NARRATION.md](../NATURAL_NARRATION.md), [docs/PRODUCTION_PIPELINE.md](../PRODUCTION_PIPELINE.md), [docs/REVIEW.md](../REVIEW.md).
- Related decisions:
  - [2026-11-20-cloned-voice-default-narrator.md](2026-11-20-cloned-voice-default-narrator.md)
  - [2026-11-21-faster-narration-and-edits.md](2026-11-21-faster-narration-and-edits.md)
  - [2026-11-22-video-feedback-next-video.md](2026-11-22-video-feedback-next-video.md)
