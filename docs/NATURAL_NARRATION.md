<!-- File Description: How aideos plugs in a more natural narrator: the take-selection seam, the naturalness score and thresholds, and the blind A/B listening test the owner judges a voice with. -->

# Natural narration

Owner feedback (2026-11-22, item 2a, for the next video): the narrator sounds unnatural and robotic in places. The
voice itself is improved in the voice-clone project on the machine that holds the owner's recordings. This page is the
aideos side: where a better voice or per-sentence retries plug in, how a take is chosen, and how the owner decides
whether a voice is good enough.

Rules that bind everything here: recordings and enrolled-voice data stay on the machine that has them and are never
copied, uploaded, quoted, committed or deleted; no voice audio goes to Telegram; moving the voice to another machine
needs the owner's explicit yes at that moment. Nothing in this feature reads, writes or needs a recording: it sees
only the samples one synthesizer returns for one line.

## What is on main

- The voice of choice is the owner's cloned voice through the local `vcd` service (`backend/vcdClient.ts`,
  `backend/tts.ts`; see [Voice of choice](PRODUCTION_PIPELINE.md#voice-of-choice)). The service returns one take per
  request. aideos asks once per line and keeps the result.
- Each line is cached by content fingerprint in `voiceover_lines/` (`backend/voiceLines.ts`): its words plus a voice key
  made of the backend name, voice, speed, chunk limit, sample rate and the time-stretch.
- A backend with no pace control of its own (`vcd`) is re-paced to the house rate (1.2x) line by line with a
  pitch-preserving stretch before the line is cached. Stretching can add artefacts, so a take is judged after it.
- The assembled narration is normalized to -16 LUFS with -1 dB true peak (`NARRATION_LOUDNESS_TARGET`). Level against
  the music is the clarity-mix work, not this page.

## The seam

`backend/narrationTakes.ts` adds one idea between the synthesizer and the line cache: a line is spoken as up to N
takes, a selector chooses one, and only the chosen take is stored.

```
produceAudioPipeline  --takeSelector-->  withTakes(takeSynthesizer, selector)
                                            |  take 0, 1, ... (backend.synthesizeTake; a backend without it gets one take)
                                            |  measure each take, score it (pluggable), apply the rule
                                            v
                                         chosen LineAudio  -->  voiceLines.synthesizeLines
                                                                  stored under  <voice key>|takes=<selector key>[|stretch=<rate>]
```

- **A better voice** needs no code here: a new voice build changes the backend name or voice id, so the voice key
  changes and every line is recorded again. Nothing recorded with the old voice is served.
- **Per-sentence retries** are the selector's `maxTakes`. `TtsBackend.synthesizeTake(text, take)` is optional: a
  backend that has it can use the take number as a seed and return the service's own naturalness score. A backend
  without it is deterministic, so a second take would be identical: it gets exactly one take per line (`maxTakes` is
  capped at 1, the gates and scorer still judge that take, and the cache key carries the effective take count).
- **The cache key carries the selector.** `takeSelectorKey` hashes the take count, thresholds, accept and minimum
  score, the gates and the scorer's id and version. Changing any of them re-records the lines; an unchanged selector
  reuses what is stored and calls nothing. With no selector the key is the plain key, so nothing recorded before this
  exists is invalidated and the default path is unchanged.
- **Where it is wired:** `produceAudioPipeline` (`takeSelector`, `onTakeChoice` in `ProduceAudioOptions`), which the
  production pipeline and the CLI use. The Studio voiceover route builds its own one-line synthesizer in
  `editor/vite.config.ts`; wrapping that function with `withTakes` and `pacedVoiceKey(takesVoiceKey(key, selector), rate)`
  is the same two lines and is not done yet (see Not done).

## The naturalness score

A score is a number from 0 (robotic) to 1 (natural) for one take of one line. The selector takes a
`NaturalnessScorer` (`{ id, version, score({ text, audio, reportedScore }) }`), so the source is pluggable:

| Source | How it plugs in | State |
| --- | --- | --- |
| Voice service reports it | `synthesizeTake` returns `score`; `reportedScoreScorer(version)` passes it through | The seam exists; `vcdClient.ts` does not read a score yet because the service API for it is the voice-clone project's to define |
| External scorer | Any function over the line's samples (an MOS predictor, a prosody model) wrapped as a `NaturalnessScorer` | Pluggable, none shipped |
| No scorer | `scorer: null`: the first take that passes the gates wins | Works today |

A scorer that cannot answer returns `null` and the line falls back to the gates; a score outside 0..1 is an error, not
a silent pick. Bump the scorer's `version` whenever its model or scaling changes.

## The selection rule (per sentence)

1. Make takes in order, up to `maxTakes` (1 to 8; each is a full synthesis and the voice service runs one job at a time).
2. Measure each take from its samples and score it.
3. A take fails a gate for each of: `empty`, `clipping`, `too-quiet`, `too-hot`, `dead-air`, `too-slow`, `too-fast`, and
   `low-naturalness` (score below `minScore`).
4. Stop early at the first take that fails no gate and either scores at least `acceptScore` or has no score to improve on.
5. Choose the take with the fewest failed gates, then the highest score (a scored take beats an unscored one), then the
   earliest take.
6. If even that take fails a gate, the choice is `degraded`: it is kept so the film is never blocked, `onTakeChoice`
   reports it, and the pipeline logs the line on stderr so someone can listen to it.

## Loudness and clarity thresholds

Gates judge the dry line before the film-wide loudness mastering and the music mix (`DEFAULT_TAKE_GATES`). They are
provisional sanity bounds that reject broken takes. They are not a measure of how clear the mix is, and they must be
tightened against the owner's own recordings by the voice-clone work, not by guessing here.

| Gate | Default | Reads as |
| --- | --- | --- |
| `maxPeak` | 0.999 | a sample at or above it is clipped |
| `activeRmsDb` | -38 to -10 dBFS | RMS of the non-silent samples; outside it the take is near-silent or hot |
| `maxInternalSilenceSec` | `HOUSE_PACE.deadAirMaxSec` | longest silence inside the line, edges trimmed |
| `wpmWindow` | `HOUSE_PACE.wpmWindow` widened by 25% each side | pace of the finished (stretched) line |
| `minWordsForPace` | 4 | shorter lines are not judged on pace |

**Mix clarity is a different measure and is not defined here.** The speech clarity of the finished mix (voice against
music: band audibility, STOI or word error rate under the mix, swells under speech) belongs to the clarity-mix work
(`fm/aideos-narrator-clarity-mix`). At the time of writing it had written no handoff and opened no pull request, so
this page defines no clarity metric and duplicates nothing of it. When that measure lands, a mix-level clarity floor
joins the acceptance below as one more row, with its metric name and threshold taken from that work.

## Blind A/B listening test

The owner is the judge. `backend/narrationListening.ts` defines the format; it holds only relative file paths, content
hashes and text, never audio.

1. **Make the set.** On the machine that holds the voice, synthesize at least 16 varied sentences with the current
   voice and with the candidate. Put the audio under the package's own folder (`videos/<slug>/naturalness/`, which git
   ignores; resolve it with `resolvePackageDir`), named so the name does not give the system away (`clips/p07a.wav`,
   not `tuned-07.wav`; the builder refuses a path that contains a system id).
2. **Build it.** `buildListeningSet({ seed, systems: [current, candidate], sentences })` returns three documents:
   - `manifest.json` (`aideos.listening-manifest/1`): what the owner opens. Items in a seeded random order, A and B
     randomised per item, no system names, hashes or scores.
   - `key.json` (`aideos.listening-key/1`): which system is A and B for every item, the file hashes, optional scores.
     Keep it away from the listener until the results are in.
   - `results.json` (`aideos.listening-results/1`): the empty file the owner fills in.
3. **The owner listens and fills in `results.json`.** Per item: `preferred` is `"a"`, `"b"` or `"tie"`, optional
   `naturalness` ratings 1 (robotic) to 5 (natural) for each side, and free `notes`. Items stay `null` until answered.
4. **Score it.** `scoreListening(key, results)` returns wins per system, ties, mean ratings, the exact two-sided
   sign-test p-value over decided items, the scorer agreement, and a verdict.

**Acceptance (`LISTENING_ACCEPTANCE`).** `accept` needs every item answered and all of: at least 16 items; the candidate
wins at least 65% of decided (non-tie) items; the sign test is significant in the candidate's favour (p <= 0.05); and
its mean rating, when ratings were given, is not below the baseline's. Anything unanswered is `incomplete`; otherwise
`reject`, with each unmet condition named in `reasons`.

**Scorer agreement.** When takes carry a score, the summary counts how often the higher-scored take was the one the
owner preferred. That is the check on the scorer itself: a scorer that disagrees with the owner is not used to pick takes.

## Not done (and why)

- `vcdClient.ts` does not request a seed per take or read a naturalness score. The service contract for both is the
  voice-clone project's; `synthesizeTake` and `reportedScoreScorer` are where it lands. This change deliberately does not
  touch `vcdClient.ts` (the open change https://github.com/Mani212005/aideos/pull/270 edits it for the request deadline).
- No CLI command builds the listening set or reads the results; the functions are the format, and the first real set
  is made by hand on the machine that holds the voice.
- The Studio voiceover route does not use the selector yet (see The seam).
- Gate numbers are not calibrated on real speech; they are sanity bounds until the voice-clone work measures them.
