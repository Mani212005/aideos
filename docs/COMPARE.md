# Reference compare (`aideos compare`)

`aideos compare <ours.mp4> <reference.mp4>` puts one of our videos next to a local reference and states the difference as numbers.
It runs the measurements of [`aideos study`](STUDY.md) on both videos and writes a labelled contact sheet, a metric diff, a short plain-words summary and a JSON of the same.
It states numbers only. It is not a verdict, not a score and not advice, and it contains no fix logic: it starts no agent and changes no review threshold, golden or gate.

## Boundary (read this first)

**Craft measurements only.** Cut cadence, camera motion, tone, caption presence and pacing, as numbers. No identity, likeness, script, voice, character or channel cloning.
Both inputs are **local files you are allowed to analyse; a URL is refused** (exit 2) and nothing is downloaded or scraped.
The same boundary is in `aideos compare --help` and in the header of every output file. It is for colour, motion and density. It does not analyse 3D ink and it reads no text (no OCR of what the videos say).

## The rule: a delta needs two agreed readings on both sides

Every pixel-derived metric comes from the study with two readings from two different methods (see [STUDY.md](STUDY.md#the-rule-two-methods-or-the-number-is-excluded)
and [REVIEW.md](REVIEW.md#trust-a-pixel-derived-reference-metric-only-after-a-second-method)). The diff applies the rule to the pair:

| Row status | Meaning | Delta | Used in the summary |
|---|---|---|---|
| `agreed` | both videos have the metric `agreed` (or read by one named non-pixel method) | ours minus ref | yes, when it differs |
| `unresolved` | a side did not agree (two methods disagree, or one could not run) | none | no: both readings of both sides are kept and listed |
| `not-measured` | a video has no such metric (for example no audio track, or no word list for words per minute) | none | no |

`differs` is yes when the delta is larger than the study's own agreement tolerance for that metric (the table of tolerances is in `backend/compare/diff.ts` and comes from the `STUDY` constants,
for example 0.05 for luma, 0.10 for the moving share, 1 for the number of camera moves). A smaller delta is inside what the study itself accepts as the same reading. No new threshold is introduced.

## What is compared

Duration and aspect (the aspect is text: same or different), cut count, cuts per minute and median shot length, the camera motion profile (moving share, median speed, moves, frames per move),
mean luma, contrast, black point and saturation, caption presence share, the pause map (first sound, speech share, pause count, total and longest pause) and words per minute when both videos have a word list
(`--ours-words`, `--ref-words`, or a `<name>.words.json` next to the video). The method names and tolerances of each metric are in `diff.md`.

## Not measured

The original idea for this command also named ink/edge coverage and depth of field (DOF). The diff has no row for either:

- `aideos study` measures neither, so there is no study metric for the diff to read.
- 3D ink is out of scope for compare (it is for colour, motion and density).
- Each would need a new measurement with a second, independent method that agrees within a stated tolerance, under the two-method agreement rule above. Until then no delta may be stated.

They are possible follow-up items for the captain to ask for.

## Outputs

```
aideos compare ours.mp4 ref.mp4
```

writes a folder `compare-<ours>-vs-<ref>/` next to our video (`--out <dir>` is the folder itself):

```
contact-sheet.png   REF on the left, OURS on the right (below)
diff.md             the metric diff table with the method name and tolerance of every metric
summary.md          the largest agreed deltas as short sentences, what was not used, the file list
compare.json        the same as data (aideos.compare/1): rows, summary, unresolved, not-measured, the sheet manifest
bibles/ours.json    the two study bibles the diff was built from
bibles/ref.json
```

Exit codes: 0 when the comparison ran (a disagreement is a finding, not a failure), 2 when it could not run (a URL, a missing file, no ffmpeg). `--json` prints the report on stdout, `--no-sheet` skips the PNG.

### The contact sheet

A PNG, 1008 px wide. A heading names the two files and repeats the boundary. Under it:

1. **Matched moments**: five rows at 10, 30, 50, 70 and 90 percent of **each video's own duration**.
2. **Cut points**: one row per cut, the first five agreed cuts of each video, paired by order (a side with fewer cuts shows an empty cell).

Each cell has a label (`REF F36 T1.20S (30%)`: the frame id, the time and the position in the duration) and, under the frame, a strip of palette swatches with their hex colours.
The swatches are the five most used colours of that frame (4 bits per channel, near duplicates skipped). They are an illustration for the eye, not a metric: they are never used in a delta.
The labels are drawn with a built-in pixel font, so the sheet needs no browser and no system font. `compare.json` lists every cell (side, label, frame id, time, box, swatch colours) under `sheet`.

## Handing the summary to the fix agent

The all-check loop sends its review to the agent session that started the film (the same session, its own harness and model, no new agent). `compare` uses the same route:

```
aideos compare ours.mp4 ref.mp4 --send-to <film-slug>
```

types the summary into the pane of the session recorded for `<film-slug>` (`backend/allCheck/feedback.ts`, `deliverMessageToOrigin`). It launches nothing and it never starts a replacement agent. The message holds
the summary sentences and the paths of `summary.md` and `compare.json`; it asks for nothing and judges nothing. If the route is not available (no recorded session, the pane is gone, or the command runs inside that very session,
where its output is already the delivery) the command says why and prints the path of `summary.md`, which is the file the agent should read. Without `--send-to` nothing is sent.

## Worked example (synthetic clips)

REF is a 4 s clip with a still camera and a bright tone. OURS is a 4 s clip of the same texture, darker by exactly 50 luma codes, with a pan of 1 px per frame from 1 s to 3 s. The known truth: the luma gap is
50 / 219 = 0.228 on the study scale, and the camera moves for 60 of about 119 frame pairs at 0.0625 frame widths per second.

```
aideos compare ours-pan.mp4 ref-still.mp4 --out out-pan
```

```
Largest agreed deltas (ours minus ref):
  - Median frames per camera move: ours is 60 frames, the reference is 0 frames. Ours is 60 frames higher.
  - Median camera speed while moving (fastest frame corner): ours is 0.062 frame widths/s, the reference is 0 frame widths/s. Ours is 0.062 frame widths/s higher.
  - Share of frames where the camera moves: ours is 0.504 share, the reference is 0 share. Ours is 0.504 share higher.
  - Black point (10th percentile luma): ours is 0.311 0..1, the reference is 0.525 0..1. Ours is 0.214 0..1 lower (41% of the reference).
  - Mean luma: ours is 0.384 0..1, the reference is 0.602 0..1. Ours is 0.218 0.1 lower (36% of the reference).
  - Not used: 1 metric is unresolved (captions.presenceShare). Two methods did not agree, so no delta is stated.
```

The caption presence share is the rule working: the synthetic texture has no captions, but the caption band holds noise, so the OCR reading and the band ink test disagree. Both readings are kept in `diff.md` and no delta is stated.

## Tests

`backend/compare/compare.test.ts` generates short synthetic clips with ffmpeg and asserts: the known luma, cut cadence and camera deltas within stated tolerances, a disagreeing metric
getting no delta and staying out of the summary, the contact sheet (PNG size equal to the manifest, labels, frame ids, REF left and OURS right, swatch colours read back from the pixels), URL refusal,
and zero deltas for a file against itself. These tests were written at the captain's request for this tool (reference follow-up, step B of ideas 1 and 2).
The delivery route itself is covered by `backend/allCheck/sameAgent.test.ts` (`deliverFeedbackToOrigin` now calls the same `deliverMessageToOrigin`).
