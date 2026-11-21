<!-- File Description: Decision record for the owner's 2026-11-22 video feedback for the next video (music, narrator naturalness and clarity, SVG with pictures) and the no-Gemini-review rule for the first test-quality video. -->

# Owner video feedback for the next video (music, narrator, SVG with pictures)

- **Date**: 2026-11-22
- **Status**: Decided, not yet on main (applies to the next video; the no-Gemini-review rule for the first test-quality video is in force immediately)
- **Decided by**: owner
- **Pull requests**: none yet (builds on https://github.com/Mani212005/aideos/pull/247, https://github.com/Mani212005/aideos/pull/248, https://github.com/Mani212005/aideos/pull/254 and https://github.com/Mani212005/aideos/pull/268)

## Context

After watching the first aideos test-quality video, the owner recorded feedback on what to improve for the next video made with aideos. On `main` at the time of this decision (`ccdcced`), aideos already uses the owner's cloned voice as the default narrator (`backend/vcdClient.ts`, `backend/tts.ts`, https://github.com/Mani212005/aideos/pull/247 and https://github.com/Mani212005/aideos/pull/268), mixes and checks soundtrack ducking (`backend/soundtrack.ts`, `backend/review/music.ts`), and supports phase 1 of the illustrated stage picture layer (`backend/pictures/`, https://github.com/Mani212005/aideos/pull/248 and https://github.com/Mani212005/aideos/pull/254).

For that first test-quality video, only the built-in measured review (`aideos review`) was run (scoring long 2.92/4 and reel 2.87/4 with gate failures on camera moves and the reel caption reader); it measured music averaging 15 to 17 dB under the voice. No Gemini review or `aideos all-check` was run on it.

## Decision

Apply three improvements to the **next** video made with aideos, and do not hold or redo the current test-quality video unless the owner says so:

1. **Better music choice**: improve soundtrack selection so the background music fits better.
2. **Narrator naturalness and speech clarity**:
   - Reduce unnatural and robotic spots in the cloned narrator voice. Any voice improvement must use only recordings already on the machine doing the work: never copy, upload, quote, delete, commit or share recordings, and never move voice data to another machine without the owner's explicit permission at that moment.
   - Make the narration slightly louder and clearer over the music so music does not overpower speech. Judge clarity by listening and by a speech-clarity measure, not only by the average music-under-voice dB gap.
3. **Use SVG and pictures together**: go further than choosing one or the other per visual and combine them on the stage (for example, a hero picture with SVG labels, arrows and callouts drawn on and around it, or an SVG diagram that transitions into the picture it explains).

In addition, **do not run Gemini review (`aideos gemini-review`) or `aideos all-check` on the first test-quality video unless the owner explicitly asks**.

## Why

Recorded by the owner after watching the first test-quality video:

- The music choice needed improvement.
- The narrator sounded unnatural and robotic in places, and music sometimes seemed to overpower the narration and hurt clarity even though the measured average music-under-voice gap was 15 to 17 dB. That points to perceived clarity factors (voice level, voice presence, music competing in the same frequency band, or music swells under speech) rather than the average level alone.
- The system is already smart about where SVG and pictures each fit, so combining them together on the stage can make the visuals look noticeably stronger.
- The owner explicitly scoped these items to the next video rather than holding or redoing the current test-quality delivery, and confirmed no Gemini review or `aideos all-check` is to be run on it unless requested.

## Alternatives rejected

- **Hold or redo the first test-quality video for these improvements.** Rejected: the owner stated that nothing in this feedback is a reason to hold or redo that delivery unless he says so.
- **Run Gemini review or `aideos all-check` on the test-quality video without being asked.** Rejected: explicitly forbidden unless the owner asks.
- **Judge voice clarity over music using only the average 15 to 17 dB stem gap.** Rejected: listening showed narration clarity was still lost in places despite that average, so clarity must be judged by listening and a speech-clarity measure as well.
- **Keep SVG and generated pictures separate instead of layering and transitioning them together.** Not chosen: the owner asked to combine them on the stage.

## Where it lives now

- No code change lands with this entry; the three next-video improvements have no implementation pull request on `main` yet.
- Existing areas they touch:
  - Music selection, mixing and review: `backend/audioLibrary/`, `backend/soundtrack.ts`, `backend/review/music.ts`, `docs/AUDIO_LIBRARY.md`.
  - Narrator voice and synthesis: `backend/vcdClient.ts`, `backend/tts.ts`, `backend/voiceSynthesis.ts`, `backend/voiceOfChoice.ts`, `docs/PRODUCTION_PIPELINE.md`.
  - Picture layer and SVG stage: `backend/pictures/`, `backend/designCheck/pictures.ts`, `docs/GOOD_VIDEO.md`, `docs/RENDER_IR.md`, `docs/NATIVE_RENDERER.md`.
  - Measured review, Gemini review and `aideos all-check`: `backend/review/`, `backend/geminiReview/`, `backend/allCheck/`, `docs/REVIEW.md`.
- Related decisions:
  - [2026-11-20-cloned-voice-default-narrator.md](2026-11-20-cloned-voice-default-narrator.md)
  - [2026-11-21-faster-narration-and-edits.md](2026-11-21-faster-narration-and-edits.md)
  - [2026-11-21-illustrated-stage-picture-format.md](2026-11-21-illustrated-stage-picture-format.md)
