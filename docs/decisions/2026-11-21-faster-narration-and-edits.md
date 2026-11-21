<!-- File Description: Decision record that new films get a faster pacing profile: narration about 1.2x and edits 20 to 30 percent faster, with the pace gates updated on purpose. -->

# Narration about 1.2x and edits 20 to 30 percent faster

- **Date**: 2026-11-21
- **Status**: Decided, not yet on main (the work is in pull request 267, open)
- **Decided by**: owner, in his own words after watching the Signal video and reel: "I feel that 1.2x of the speed would really fit this nicely. Honestly, I think that the reels that we produce are a bit slow to watch. I want a bit more faster editing. By faster editing, I mean the story needs to pace up a bit by like 20-30% more speed."
- **Pull requests**: https://github.com/Mani212005/aideos/pull/267

## Context

The pace that main enforces today is encoded in `docs/GOOD_VIDEO.md` (criterion 9, Pacing): mean beat length 5 to 12 s, no dead air over 0.7 s, narration 130 to 170 words per minute, and no story hold over 3 s. Kokoro's default speaking speed is 0.75 (`DEFAULT_KOKORO_SPEED` in `backend/tts.ts`). Narration and edit share one timeline because narration length is the master clock.

## Decision

Make a faster pacing profile the default for new films in both formats (the long film and the reel):

1. Narration about 1.2x of today's speed. Use a native speaking-rate setting of the voice service when it offers one; otherwise use a pitch-preserving time-stretch in the sample domain (`backend/pcm.ts`), applied per line, with the rate included in the per-line cache fingerprint. Measure intelligibility after any stretch with a local speech-to-text round trip.
2. Shorter beats and tighter editing: more cuts and camera moves, tighter gaps between lines, a target story 20 to 30 percent shorter for the same script, and earlier hooks in reels.
3. Update the `docs/GOOD_VIDEO.md` targets and the deterministic review gates that encode the old pace as a deliberate, owner-approved change with the owner's words quoted in the pull request. Every safety and readability gate (text readability, no overlap, camera rule intent, caption sync, captions in the vertical safe zone) stays at least as strict.
4. Show before and after numbers on one fixture film: duration, words per minute, beats, cuts per minute and gate results.

## Why

The owner finds the reels a bit slow to watch and wants faster editing. This is a product decision that changes defaults and the gates that enforce them. It is not a loosening to get a run green, which is why it is written down with his words.

## Alternatives rejected

- **Change only the narration speed.** Rejected: the owner asked for faster editing as well, and narration and edit share one timeline.
- **Raise the speed with a plain resample.** Rejected in the brief: the stretch must preserve pitch and its effect on clarity must be measured, because the owner already finds the cloned voice less clear than the old voice (tuned separately).
- **Quietly relax the pacing gates.** Rejected: the gates change only as a stated owner decision, and the safety and readability gates stay at least as strict.

## Where it lives now

The numbers live in `backend/pacingProfile.ts` (`HOUSE_PACE`, each derived from the old value and the 1.2x narration rate). The targets are in `docs/GOOD_VIDEO.md` (section "House pace"), the review gates in `docs/REVIEW.md` and `backend/review/thresholds.ts`, and the before and after numbers and clarity measurement in `docs/evidence/verify/2026-11-21-faster-pacing-profile.md`. Set this entry's status to `In force` when pull request 267 merges. It is related to [2026-11-20-cloned-voice-default-narrator.md](2026-11-20-cloned-voice-default-narrator.md).
