<!-- File Description: Verification evidence entry for habits slice 6: Studio voice truth (spoken voice in the line cache key, Kokoro through its worker at explicit speed 1.0 within its request limit, and the voiceover save race). -->

# Verification Evidence: Studio voice truth (habits slice 6)

- **Date**: 2026-11-25
- **Branch / PR**: `fm/aideos-habits-s06-voice-truth` (PR URL assigned when pushed by `no-mistakes`)
- **Scope**: Feature Map rows `Voiceover & Narration` and `Studio Cut / Edit` (film sync machine). Files: `backend/tts.ts`, `backend/voiceSynthesis.ts`, `backend/voiceLines.ts`, `editor/vite.config.ts` (voiceover and narration routes only), `editor/src/components/ScriptEditor.tsx`, `editor/src/state/{filmSyncMachine,useFilmProject,FilmSaveContext}.ts(x)`.
- **Risk tier**: Medium (Studio Kokoro moves to a separate process and its line cache key changes, so existing Studio Kokoro lines are recorded once more; the film sync machine gains one event).
- **Already on main, left out**: the vcd `voices[0]` pick and the injected-fetch `backend/vcdClient.test.ts` (both landed in https://github.com/Mani212005/aideos/pull/270).

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | Real Studio dev server (`scripts/studioDriver.ts` `startEditor`) on a scratch videos dir with real local Kokoro, run on this branch and on `origin/main` (table below). Browser run in Chrome (Words stage, edit a line, Generate Voiceover). |
| Property test for new invariants | N/A | No new pure numeric or parser invariant; the cache-key rule is one fixed scenario. |
| Differential test on replacement | PASS | Same script and story through the Studio route on main and on this branch: main 22.30 s of audio, branch 28.72 s (words main dropped), see below. |
| Expect / golden test for complex output | N/A | No rendered output. |
| No sleeps in tests | PASS | None added. |
| No mocks of thing under test | PASS | The line store, provider chain, worker restart logic and sync machine run for real; only speech engines are fakes. |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden touched. |
| Weak-test audit | PASS | None removed. Mutations: storing a fallback line under the requested key fails the new voiceLines test; 800-character Kokoro requests fail the new voiceSynthesis test; ignoring `server_wrote` fails the new sync machine test. |
| Independent review | PENDING | Scheduled via `no-mistakes` on handoff. |
| Evidence log written | PASS | This file. |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| Kokoro request-limit probe (`backend/kokoroWorker.mjs`, am_adam, speed 1) | Measured | One 559-character request: 24.85 s. Same words as two ~280-character requests: 33.95 s. |
| Studio E2E, `origin/main` code | Reproduced | No Kokoro worker process (in-process model), audio 22.30 s, line keys `kokoro-am_adam\|stretch=1.2`, no `rev` in the reply, so the studio's follow-up save on its pre-recording revision gets 409 `stale_revision`. |
| Studio E2E, this branch | PASS | One `kokoroWorker.mjs` child, audio 28.72 s, line keys `kokoro-am_adam\|speed=1\|chars=300\|stretch=1.2`, `film.voiceover.voice` set, reply carries `rev` and `order`; a save on that `rev` is 200, re-recording reuses both lines, `/api/narration` reports both recorded. |
| Browser (Chrome, Words stage) | PASS | After Generate Voiceover the studio sends no film save (no 409), status reads the recorded and kept line counts, no conflict banner. |
| Narrator of record (`narratingVoiceKey`) | PASS | `backend/voiceLines.test.ts` covers one voice, mixed with and without the requested voice, a tie and no lines. `backend/voiceOfChoice.test.ts` drives `/api/generate-voiceover` on a real dev server (scratch videos dir, fake voice service, no network or real audio) and reads `ttsBackend` from `narration.json`. Only the cloned-voice branch writes `narration.json`, and it never falls back, so there it equals the requested key. |
| `npm run lint` (ci static) | PASS | headers, tests wired, eslint, tsc root, oxlint, editor build (`tsc -b` plus vite), ruff. |
| `node --import tsx ... --test` voiceSynthesis, voiceLines, filmSyncMachine, vcdClient, audio, narrationTakes, voiceOfChoice, screenplay_lines, sync | PASS (124/124) | Targeted only. |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

- None.

## Follow-ups found, not in this slice

- A Studio project made from a plain story cannot record from the Words stage: `plainTextToTaggedScript` titles each section with the narration's first words and `checkVoiceoverIntake` then refuses the stored script as a title leak (reproduced on main code; intake files are untouched here).
- The shared film store broadcasts every write over the live stream, so when that event reaches the studio before the voiceover reply, the studio's own recording shows as "Live update: ... updated" and the undo step is named "Live sync update".
- Studio Kokoro lines recorded before this change (old key) are no longer reused or pruned; they stay on disk until the package is cleaned.
- A non-cloned Studio recording leaves an older `narration.json`, `captions.vtt` and `voiceover_words.json` from a previous cloned-voice recording in place.

## Artifacts and links

- Feature Map: [docs/verify/FEATURE_MAP.md](../../verify/FEATURE_MAP.md)
