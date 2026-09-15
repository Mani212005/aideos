<!--
File Description: The story, the staging and the rebuild steps for the film "Still Talking".
This is the committed record of the package: script.md and voiceover.wav beside it are gitignored
build artefacts, so the narrative intent lives here.
-->

# Still Talking

A three act film about Voyager 1, drawn entirely in vectors. Every moving thing on screen is an
SVG element driven by the declarative timeline engine in
[src/dl/scene](../../src/dl/scene/README.md). There is no footage, no raster sequence and no 3D.

## The story

**Act I - Departure.** A machine the size of a small car is bolted to a rocket and pointed away
from everything it has ever known. It has one job, it is never coming back, and the people who
built it pack it a gold plated record anyway. Then they let it go.

**Act II - The grand tour, and the turn.** Eighteen months of falling outward, then Jupiter, then
Saturn. The swing past Titan bends its path up and out of the plane of the planets and there is
nothing ahead of it any more. Thirteen years out, it is asked to turn around one last time, takes
sixty photographs of home, and finds a single pale blue pixel in one of them. Then it shuts its
eyes for good. This is where the film stops being an adventure and becomes a departure.

**Act III - The edge, and the voice.** In August 2012 the solar wind simply stops and it crosses
out of the sun's reach entirely. It is still talking, on twenty two watts. Every year it grows
colder and another instrument goes dark to keep the radio alive. Some time in the thirties the last
one will go quiet, and then it will keep going anyway, carrying its record, for longer than the sun
has left.

## How the picture is built

The film's canvas is one `Scene` that runs for its whole length, not one scene per shot. That is
what makes the continuity real: the craft, its signal thread and the sun are on screen in every
single frame, and every value an element holds is carried forward from the clip before it.

- **The stage is a square.** Scene space is 1920 x 1920. The wide cut takes the horizontal band
  through the middle of it; the reel takes the vertical column. Everything essential lives where
  the two strips overlap. See `src/dl/SceneStage.tsx`.
- **Two bands.** Inserts (the planets, the survey, the plate, the record) hold the upper band. The
  craft, the signal thread and the sun hold the lower band for the entire film.
- **The camera is fixed and the world moves past it.** Two star layers travel at different rates,
  both accelerating hard through the Jupiter slingshot and never slowing down again.
- **The thread is the through line.** A single accent coloured line runs from the craft's feed horn
  back toward the sun, with bursts of signal travelling down it every few seconds. It draws itself
  on in the first shot, thins in the third act, stops partway across the frame when the craft goes
  quiet, and is gone by the closing card.

## Rebuilding it

```bash
# 1. Narration first. Synthesizes with the project's TTS pipeline, masters the result for
#    delivery, and writes the shot spine the picture is compiled from.
npx tsx backend/stillTalking/produceVoiceover.ts

# 2. Artwork, scene timelines, film.json, its shadow module and the bundled SVG source map.
npx tsx backend/stillTalking/buildFilm.ts

# 3. Review stills from both formats into .frames/still-talking/
npx tsx backend/stillTalking/reviewFrames.ts 0.5

# 4. Final renders.
npx remotion render Long out/still-talking-long.mp4 --concurrency=2
npx remotion render Reel out/still-talking-reel.mp4 --concurrency=2
```

Step 1 owns `shot-spine.json`, which is the narration measured per shot and the only narration
artefact the film builder reads. `voiceover.wav`, `captions.vtt` and `voiceover_words.json` beside
it belong to the shared pipeline.

Step 2 is the only thing that may write `film.json` and `src/dl/films/still-talking.ts`: they go
through `backend/pipeline/filmStore.ts` so both land together, and
`backend/still_talking_film.test.ts` fails if they ever drift apart.

Every frame number in the timeline is derived from step 1's measurement, so a re-recorded take
retimes the whole film rather than drifting away from it. The cues that have to land on a specific
word ask for it by name, and the build fails if that word is no longer in that shot.
