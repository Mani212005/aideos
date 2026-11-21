<!-- File Description: Decision record that the owner's cloned voice (My voice, vcd) is the default narrator and never silently swaps to another voice. -->

# The owner's cloned voice is the default narrator

- **Date**: 2026-11-20 (day the pull request merged, local time)
- **Status**: In force (the follow-up that makes it the voice of choice in every test and doc is still in flight, see below)
- **Decided by**: owner
- **Pull requests**: https://github.com/Mani212005/aideos/pull/247

## Context

Aideos already had pluggable speech backends for narration: offline Kokoro-82M ONNX, Google Cloud TTS and macOS `say`, with a per-line voice cache keyed by content fingerprint and an audio-first master clock where narration length drives all shot timing. The owner has a separate voice-clone project (a local service called `vcd` that clones his voice from one reference clip and speaks English or Hindi/Hinglish).

## Decision

The owner's own cloned voice, "My voice", is added as a backend and is the default voice-over. The voice ids are `vcd-my-voice` and `vcd-my-voice-hi`. The service is loopback only (default `http://127.0.0.1:8740`). If `vcd` is unreachable, synthesis fails with a plain per-provider reason and never silently falls back to another voice. Kokoro, Google and macOS `say` stay available as explicit choices.

## Why

The owner wanted his own voice narrating his videos. Audio-first timing and the per-line cache stay unchanged, so the new voice plugs into the existing path instead of adding a second one. A silent fallback was rejected because it would ship a video in a voice the owner never chose.

## Alternatives rejected

- **Keep Kokoro (the previous default) and offer the cloned voice as an option only.** Not chosen: the owner asked for it to be the default.
- **Fall back to Kokoro, Google or `say` when `vcd` is down.** Rejected: a quiet voice swap fabricates the wrong result. The failure is explicit instead.
- **Reach the voice service over a non-loopback address.** Rejected: the client enforces loopback only. An SSH tunnel to the owner's other machine is the sanctioned way to reach a remote service.

## Open follow-ups (not part of this decision)

- A follow-up task (voice of choice everywhere) was started on 2026-11-21: make every test, journey, fixture and doc that assumed another narrator use the owner voice id, give tests a deterministic fake synthesizer that reports itself as the owner voice, and never commit any voice audio, recordings or enrolled-voice data. It has no pull request on main yet.
- The owner has said the cloned voice is less clear than the old voice; tuning is tracked separately (see [2026-11-21-faster-narration-and-edits.md](2026-11-21-faster-narration-and-edits.md)).

## Where it lives now

- `backend/vcdClient.ts`, `backend/tts.ts` (default backend `vcd`), `backend/voiceSynthesis.ts`, `aideos.config.json` (`voiceClone` section).
- `docs/PRODUCTION_PIPELINE.md` (speech backends) and `docs/WORKFLOW.md` (TTS synthesis).
