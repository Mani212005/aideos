<!--
File Description: Explains the hello-scene example package, the tiny committed scene film that renders on a fresh clone.
-->

# hello-scene

A 10 second, silent, three-shot scene film (about 12 KB). It is the only video package that ships
in git: your own videos live in `videos/` (gitignored) or wherever `AIDEOS_VIDEOS_DIR` points.

- `film.json`: the manifest, a scene film on a square 1920 x 1920 scene space with three text shots.
- `visuals/`: three static SVGs (backdrop, three nodes, a query dot) that the scene's clips animate by id.

On a fresh clone `npm install` generates the files Remotion needs from this package, so
`npm run studio` and `npm run editor` open it straight away, and `npm run render` renders it.
It also anchors `npm run smoke:studio`. Check it with `npm run design:check -- hello-scene`.
Copy the folder to `videos/<your-slug>/` (and change `id`) to start your own.
