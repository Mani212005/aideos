# Reference study (`aideos study`)

`aideos study <reference.mp4 ...>` measures a local reference video as numbers and writes a **style bible** plus a **look seed**.
It is numbers first, never opinions: it measures what can be measured, says what it could not measure, and never judges.

## Boundary (read this first)

**Craft measurements only.** Cut cadence, camera speed, tone, caption presence and pacing, as numbers. No identity, likeness, script,
voice, character or channel cloning. A study never keeps what a reference says or shows as text, and aideos does not ship a download
or scraping workflow: **references are local files you are allowed to analyse, and a URL is refused** (exit 2). The same boundary is in
`aideos study --help` and in the header of every bible and seed.

## The rule: two methods, or the number is excluded

A metric measured from pixels is a hypothesis until a second, different method agrees with it (see
[REVIEW.md](REVIEW.md#trust-a-pixel-derived-reference-metric-only-after-a-second-method)). Every pixel-derived metric in a bible
therefore carries **two readings from two methods, a stated tolerance and an agreement flag**:

| Status | Meaning | Enters the seed |
|---|---|---|
| `agreed` | both methods read it inside the stated tolerance | yes |
| `unresolved` | they disagree, or one method could not run: both readings are kept with the reason | no |
| `single-method` | only one method exists for it, named in the bible | no |
| `not-pixel` | read from container metadata or the audio track by one named method (no pixel claim) | yes |

The tolerances and every threshold a method uses are fixed constants in `backend/study/types.ts` (`STUDY`). They are study constants,
not review thresholds: this command changes no review threshold, golden or gate.

## What it measures, and the two methods behind each metric

| Metric ids | Method A | Method B | Tolerance for agreement |
|---|---|---|---|
| `cuts.count`, `cuts.perMinute`, `shots.*LengthSec` | ffmpeg scene score above 0.3 (frames scaled to 640 px) | changed-block coverage: at least 60% of 8x8 gray blocks differ by more than 20 levels | every cut found by both within 0.1 s; at most 15% of cuts unmatched. Shot lengths come from the agreed cuts |
| `camera.movingShare`, `camera.medianSpeedWidthsPerSec`, `camera.p90SpeedWidthsPerSec`, `camera.moveCount`, `camera.framesPerMove` | 4x4 tile iterative Lucas-Kanade (sub-pixel, two pyramid levels), **bottom 30% masked as the caption band**, robust (Tukey) fit of translation plus zoom | coarse-to-fine block matching (16x16 blocks, +-5 px, parabolic sub-pixel) over the **whole unmasked frame**, median translation and median radial zoom | moving share 0.10 absolute; speeds 0.01 widths/s or 30%; move count 1; frames per move 3 or 35% |
| `tone.meanLuma`, `tone.blackPoint`, `tone.contrast`, `tone.saturation` | ffmpeg `signalstats` on full-resolution frames at 5 fps | own statistics on area-scaled `yuv444p` planes at 5 fps | 0.05 absolute (contrast 0.10), all on 0..1 limited-range scales |
| `captions.presenceShare` | the review's own caption measurement (tesseract OCR, `analyzeSample`, bottom 25% band, a sample every 2 s) | band ink test on the same frames (a plausible share of pixels far from the band median, no OCR) | 0.15 absolute |
| `audio.firstSpeechSec`, `audio.speechShare`, `audio.pauseCount`, `audio.pauseTotalSec`, `audio.longestPauseSec` | ffmpeg `silencedetect` at -45 dB, silences of at least 0.3 s | 20 ms RMS windows against an adaptive floor (95th percentile level minus 35 dB) | 0.1 s, 0.05, 1 pause, 0.3 s or 20% |
| `media.durationSec` | ffprobe container duration | decoded analysis frames / frame rate | 0.1 s |

Notes on the camera metric:

- The camera speed is the speed of the **fastest frame corner** under the fitted translation plus zoom, in **frame widths per second**,
  so a push-in and a pan are both a speed. A pair of frames is moving at 0.01 frame widths per second or more; a run of fewer than 3
  moving pairs is noise and gaps of up to 2 pairs inside a move are bridged. Frames around every cut are blanked, so a cut is never read as motion.
- Method A masks the caption band and weights tiles by a robust fit; method B uses the whole frame. They fail differently (a textureless
  region, large motion), which is the point; instead of encoding a wrong rule they are compared and a disagreement excludes the metric (the
  original study's first camera tool called a video 80% still; a second method found 65% moving).
- A **static overlay** (a dot grid, a HUD, a logo) biases both methods the same way, toward zero, so agreement alone cannot catch it. For every frame
  pair the study finds edge pixels that moved far less than the content around them along the motion direction (the direction is read from the pixels,
  which an overlay does not affect), masks them and a margin around them in both methods, and skips pairs where that leaves too little to read. A dense
  grid therefore makes the camera speed unresolved rather than a slow number that both methods agree on. A sparse overlay is masked and the speed stays measured.
- Pixel analysis runs at 320 px on the long side and at most 30 frames per second, in one pass over the file: about 15 to 35 ms per frame
  pair on a busy machine (a 60 s reel takes about a minute, an 11 minute video several minutes).

Also measured, from one method, and named as such: `audio.loudnessLufs` (ffmpeg ebur128) and, only when word timings are supplied,
`audio.wpm`.

## What it does not measure (and says so)

- **Words per minute without word timings.** There is no offline transcription in this repo (`backend/transcribe.ts` needs a Deepgram key or the
  whisper CLI), so `aideos study` does not guess. Pass `--words <file>` (a `voiceover_words.json` shape: `word`, `start`, `end` per word) for a single
  reference, or put `<name>.words.json` next to `<name>.mp4`. The pause map always comes from the audio energy, not from words.
- **Caption cadence** (words per burst, burst rate, one-word captions). It needs OCR at frame rate, which is out of scope for this step, and the
  review's 2 s sampling cannot resolve a word shown for 0.1 to 0.3 s. Only caption **presence** is measured.
- **What is said or shown as text**, and anything about identity, likeness, characters, voice or channel.
- URL download. Never.

Every bible lists these under `notMeasured` with the reason, so a gap is never mistaken for a zero.

## Outputs

```
aideos study ref-a.mp4 ref-b.mp4 --name my-study
```

writes, under `.frames/study/my-study/` (git ignores `.frames/`; `--out <dir>` moves it):

```
study.json              index of the references
<reference>/bible.json  every metric: both readings, tolerance, status, delta; the cut list, shot lengths, camera moves and pause map; notMeasured
<reference>/bible.md    the same as a short table plus the method list
<reference>/seed.json   the look seed (below)
<reference>/seed.md     the look brief paragraph, the partial look and the exclusions
```

Exit codes: 0 when the study ran (agreed or not: a disagreement is a finding, not a failure), 2 when it could not run (a URL, a missing file, no ffmpeg).
`--json` prints the bible(s) on stdout; progress goes to stderr.

## The seed

The seed is a **proposal made only of agreed metrics**:

- `partialLook`: a partial `design/look.json` shape. It is **not a valid `aideos.look/N` document** (it has no cast, camera poses or shots).
  `film.captions.position` is a real look.json field (`"bottom"`, set only when caption presence is agreed and at least 0.5); `film.targets.*`
  are numeric targets (cuts per minute, shot lengths, camera moving share and speed, tone, narration pacing) that look.json has no field for yet.
- `entries`: each number, the look path it would go to, and both readings behind it.
- `excluded`: every metric that did not seed, with the reason (unresolved, single-method).
- `brief`: one look brief paragraph made of the agreed numbers, marked `PROPOSAL from measured numbers, not a plan and not a verdict`.

The command **never writes into a film package by default.** With `--into <film>` (exactly one reference) it writes `design/look.seed.json` and
`design/STUDY_SEED.md` into that package, never touches `design/look.json`, and refuses to overwrite an existing seed. Turning a seed into a
look plan is a decision for whoever writes the look plan (`aideos look brief`).

## Worked example (synthetic reference)

A 7 s synthetic clip made with ffmpeg (still for 2 s, a pan of exactly 1 px per frame on a 480 px wide frame for 3 s, still for 2 s; a tone
track with sound at 0.5 to 1.5 s, 2.0 to 3.5 s and 4.5 to 6.5 s), so the known truth is: moving share 90/209 = 0.43, speed 0.0625 frame widths per
second, one move of 90 frames, first sound at 0.5 s, pauses of 0.5 s and 1.0 s. `aideos study pan.mp4` measures:

```
  agreed        camera.movingShare                 0.4306 share               [0.4306 / 0.4306]
  agreed        camera.medianSpeedWidthsPerSec     0.062 frame widths/s       [0.062 / 0.0635]
  agreed        camera.moveCount                   1 moves                    [1 / 1]
  agreed        camera.framesPerMove               90 frames                  [90 / 90]
  agreed        audio.firstSpeechSec               0.5001 s                   [0.5001 / 0.5]
  agreed        audio.pauseCount                   2 pauses                   [2 / 2]
  agreed        audio.longestPauseSec              1.0001 s                   [1.0001 / 1]
  unresolved    captions.presenceShare             excluded                   [0 / 1]
```

The brief paragraph the seed wrote from the agreed numbers: "PROPOSAL from measured numbers, not a plan and not a verdict. Measured on the reference: 0 hard cuts per minute, a median shot of 7 s ...; the camera moves in 43% of frames, at a median 0.062 frame widths per second, a move lasting a median 90 frames; ... speech: first sound at 0.5 s, longest pause 1 s. Not agreed, therefore not used: captions.presenceShare."

The last line is the rule working: the synthetic texture has no captions, tesseract read none, but the band holds noisy texture, so the pixel ink
test said yes. The two methods disagreed, both readings are kept, and caption presence stays out of the seed.

## Tests

`backend/study/study.test.ts` generates short synthetic references with ffmpeg (known cuts, a known camera move, known luma and saturation, a known tone track
with pauses, known burned-in captions) and asserts the measured numbers within the tolerances above, the agreement rule including a case where the
methods disagree and the metric is excluded from the seed, URL refusal, no network, and the film-package seed rules. These tests were written at the
captain's request for this tool (reference follow-up, ideas 1 and 13).

## Next step

`aideos compare <ours.mp4> <ref.mp4>` (side by side against a reference, a diff table of these same metrics) is the next, separate step. Reading a seed
into `aideos look brief` is not done yet.
