<!-- File Description: Definition of the speech-clarity measure used to judge whether narration stays clear over a mixed soundtrack. -->

# Speech clarity of a mix

This page defines the measure that judged owner feedback 2026-11-22 item 2b (the narration must stay clear over the music). It is the reference for any later work on narration clarity or naturalness that needs the same number. An average dB gap between voice and music is not enough. A short loud moment under a word can mask the word while the average still looks healthy, and that is what happened in the 2026-11-22 test-quality delivery.

## In plain words

For every second in which the narrator speaks, compare the narration against everything else in the mix (music, sound effects, codec noise) one frequency band at a time. Weight each band by how much it matters for understanding speech, then average the weights. A score of 1 means every important band of the voice is at least 15 dB above everything else. A score of 0 means everything else is at least 15 dB louder in every band. A score below about 0.9 marks a second worth listening to, and a score below 0.6 means words are likely lost.

## Exact definition (SII-style band audibility index)

1. **Inputs**: the delivered mix, and the clean narration stem the mix was built from (`voiceover.wav`). Decode both to mono at 16 kHz.
2. **Separate the voice**: find the stem's lag in the mix by cross-correlation over the first minute. Find its gain by least squares (`g = <mix, voice> / <voice, voice>`). Then `voice = g * stem` and `rest = mix - voice`.
3. **Speech seconds**: split the stem into 10 ms frames. A frame is active above -40 dBFS RMS (`SPEECH_FLOOR_DB` in `src/dl/audio/voiceActivity.ts`). A 1 s window is a speech second when at least half of its frames are active.
4. **Bands**: one-third-octave bands centred on 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000 and 6300 Hz. Each band runs from `fc * 2^(-1/6)` to `fc * 2^(1/6)`. The 8000 Hz band is dropped at 16 kHz. Band power is the sum of the Hann-windowed FFT power of the 1 s window inside the band.
5. **Score per second**: per band, `snr = 10 * log10(voicePower / restPower)`, clipped to [-15, 15] dB, then `audibility = (snr + 15) / 30`. The score is the importance-weighted mean of the audibility values. The weights are ANSI S3.5 one-third-octave band importance (average speech), renormalised over the bands used: 0.0083, 0.0095, 0.0150, 0.0289, 0.0440, 0.0578, 0.0653, 0.0711, 0.0818, 0.0844, 0.0882, 0.0898, 0.0868, 0.0844, 0.0771, 0.0527, 0.0364.
6. **Report**: over the speech seconds, report the mean, the minimum and the count below 0.9, together with the seconds that score lowest.

This is a simplified Speech Intelligibility Index. It has no hearing threshold and no spread of masking, so it compares the mix against itself and does not predict a listener's absolute score.

## Companion measure (STOI)

Short-time objective intelligibility (Taal et al., 2011) of `mix` against `voice` at 10 kHz:
- 256-sample Hann frames, 50% overlap, 512-point FFT;
- frames more than 40 dB below the loudest clean frame are dropped;
- 15 one-third-octave bands from 150 Hz;
- 30-frame segments, with clipping at -15 dB signal to distortion.

STOI sits near 1 at the SNRs a narrated video has, so it confirms a direction but separates mixes less well than the per-second index.

## Reference numbers (2026-11-22 test-quality delivery)

Speech seconds within 1 s before to 2.5 s after a chapter-cut effect:

| Film | delivered: mean / min | with library effects ducked under speech: mean / min |
| --- | --- | --- |
| Long | 0.834 / 0.318 | 0.925 / 0.713 |
| Reel | 0.826 / 0.302 | 0.896 / 0.661 |

## Tool

The measure lives in two Python scripts (numpy and ffmpeg only), run by hand from the repo root:
- [`scripts/speech_clarity/measure_mix.py`](../scripts/speech_clarity/measure_mix.py): `python3 -I scripts/speech_clarity/measure_mix.py <label> <mix.mp4> <voice.wav> [...]`
- [`scripts/speech_clarity/simulate_effect_duck.py`](../scripts/speech_clarity/simulate_effect_duck.py): `python3 -I scripts/speech_clarity/simulate_effect_duck.py <label> <mix.mp4> <voice.wav> <film.json> <effectCacheDir> [...]`. The offline what-if used for the table above.

Both scripts decode in memory and write no audio. Like `aideos review`, the measure needs the narration stem from the video package. It cannot run on a bare mp4.
