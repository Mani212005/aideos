<!--
File Description: Explains the videos/ directory, where your own video packages live. Everything in it except this file is gitignored.
-->

# videos/

This folder holds **your** videos. Nothing in it is committed: whoever forks the repo makes their own.

Each video is a self-contained package, `videos/<slug>/`:

- `film.json`: the authoritative manifest (see `src/dl/videoPackageLoader.ts`)
- `script.md`, `voiceover.wav`, `voiceover_words.json`, `captions.vtt`
- `footage/<shotId>.mp4`: generated B-roll
- `visuals/*.svg` and `design/`: scene artwork and the design spec

Keep your videos somewhere else entirely by setting `AIDEOS_VIDEOS_DIR` (absolute, or relative to the
repo root), for example `AIDEOS_VIDEOS_DIR=~/aideos-videos`. If you do, also point the `public/videos`
symlink at it so Remotion's `staticFile("videos/...")` finds your media.

A fresh clone has no packages here and falls back to `examples/hello-scene`, a tiny scene film that
renders out of the box. Generated, gitignored files derived from your packages (`src/dl/films/*.ts`,
`src/dl/activeFilm.ts`, `src/dl/scene/assets/svgSources.generated.ts`) are rebuilt by
`npm run ensure:generated`, which `npm install` and the test, lint, studio and render scripts run for you.
