<!--
File Description: The story, the staging and the rebuild steps for the film "RAG, in four steps".
voiceover.wav beside it is a gitignored build artefact, so the intent lives here.
-->

# RAG, in four steps

A 65 second, 16:9 kinetic typography explainer about retrieval-augmented generation, cut as a rhythmic
spoken "parody song" in the style of code-driven lyric videos: heavy grotesque display type mixed with
terminal-style overlays (next-token probability panel, context readout, a hallucination counter), one
orange accent, and a single light title card. Every frame is procedural SVG driven by the scene engine
([src/dl/scene](../../src/dl/scene/README.md)); there is no footage and no sampled or downloaded music: Kokoro speaks (it does not sing) over an original
beat synthesized in numpy at 104 BPM, with every line starting on a beat.

## The story

1. **The problem.** The model stopped learning last spring, invents anything about today, and calls it
   confidence. With no source it just picks the next likely word.
2. **The fix.** "Let me look it up": retrieval-augmented generation, unmasked word by word on a cream card.
3. **The pipeline.** Step 1 chunk (overlap, and why size matters), step 2 embed (points in a vector space
   that cluster by meaning), step 3 search (the question becomes a point, rings find the top-k), step 4 stuff
   the nearest chunks into the prompt with a source each.
4. **The answer.** The same next-token panel collapses onto the grounded answer and the hallucination
   counter falls.
5. **The catch.** Fetch the wrong chunk and the model is confidently wrong, with a citation. Bad retrieval is
   the bug. Chunk it, embed it, search it, stuff it, ground it.

All numbers on screen (probabilities, the counter, config lines) are illustrative and labelled as such.

## Rebuilding it

```bash
# 1. Narration first: Kokoro speaks the beats, then local Whisper (small) measures every word, because
#    the synthesizer's own word offsets are estimates. Writes the raw take: voiceover.raw.wav, shot-spine.raw.json.
npx tsx backend/ragExplainer/produceVoiceover.ts

# 1b. Beat: fits each line to the 104 BPM grid (first sound on a beat, tempo change at most 7%), synthesizes
#    the drum / bass / pad / arp stem procedurally (backend/ragExplainer/beatTrack.py), ducks it under the voice,
#    and rewrites shot-spine.json, voiceover.wav, beat.wav, voiceover_words.json and captions.vtt.
#    The raw take (voiceover.raw.wav, shot-spine.raw.json) is kept so this step can be re-run alone.
npx tsx backend/ragExplainer/produceBeat.ts

# 2. Word widths (kerned, measured in headless Chrome) - only after changing any displayed word.
npx tsx backend/ragExplainer/measureWords.ts

# 3. Artwork, timelines, film.json, its shadow module and the bundled SVG source map. Sets this film active.
npx tsx backend/ragExplainer/buildFilm.ts

# 4. The standard gate, then real-compositor review stills (.frames/rag-explainer/review/).
npm run design:check -- rag-explainer
npx tsx backend/ragExplainer/reviewFrames.ts            # one frame per shot, or pass frame numbers

# 5. Final render (wide cut only: the scene is composed for the 16:9 band of the square stage).
npx remotion render Long out/rag-explainer.mp4 --codec=h264 --image-format=png --crf=16 --pixel-format=yuv420p --concurrency=4
```

`backend/ragExplainer/preview.ts` is a faster loop while designing (compiles the scene and screenshots
frames in headless Chrome without the film's chapter rail).

Every frame number is derived from `shot-spine.json`. `Canvas.lyric()` checks each on-screen line against the
narration and throws on a mismatch or an overflow, so rewriting a line cannot silently mis-time or clip the film.

## The beat

`backend/ragExplainer/beatGrid.ts` plans the grid (pure, unit tested): each line owns a whole number of beats,
starts on a beat, and is time-stretched by at most 7% to fill it (a line that cannot is padded with silence rather
than slowed further). `beatTrack.py` then builds the track: kick, snare, clap, hats, sub bass, pad and a plucked arp
over an Am - F - C - G loop, with intensity following the story (sparse in the problem, full through the pipeline,
a breakdown on the wrong-chunk line, peak on the recap) and a crash on each chapter change. The track is ducked
under the voice (9 dB for the music bus, 5 dB for drums, 25 ms attack, 220 ms release) and mastered to -12 LUFS as a
stem and played at `film.music.volume` 0.25 (`duckUnderVoiceover` off, because `Video.tsx` would otherwise duck a whole
shot at a time): in the render it sits about 10 dB under the voice while a line is spoken. The HUD's four-cell bar counter lights one cell per beat from the same grid.
