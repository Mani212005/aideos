<!--
File Description: Explains the videos/ directory, where your own video packages live. Everything in it except this file is gitignored.
-->

# videos/

This folder holds **your** videos. Nothing in it is committed: whoever forks the repo makes their own.

Each video is a self-contained package, `videos/<slug>/`:

- `film.json`: the authoritative manifest (see `src/dl/videoPackageLoader.ts`)
- `script.md`, `voiceover.wav`, `voiceover_words.json`, `captions.vtt`
- `voiceover_lines/`: per-line recordings keyed by content fingerprint so only changed lines are re-recorded
- `narration_log.json`: visible narration change list tracking added, edited, or removed lines across edits
- `footage/<shotId>.mp4`: generated B-roll
- `visuals/*.svg` and `design/`: scene artwork and the design spec
- `reel/`: `reel/REEL_BRIEF.md`, `reel/cut.json`, derived `reel/film.json`, `reel/voiceover.wav`, `reel/voiceover_words.json`, and `reel/status.json` for condensed reel cuts

Keep your videos somewhere else entirely by setting `AIDEOS_VIDEOS_DIR` (absolute, or relative to the
repo root), for example `AIDEOS_VIDEOS_DIR=~/aideos-videos`. If you do, also point the `public/videos`
symlink at it so Remotion's `staticFile("videos/...")` finds your media.

A fresh clone has no packages here and falls back to `examples/hello-scene`, a tiny scene film that
opens in studio and editor out of the box. Generated, gitignored files derived from your packages (`src/dl/films/*.ts`,
`src/dl/activeFilm.ts`, `src/dl/scene/assets/svgSources.generated.ts`) are rebuilt by
`npm run ensure:generated`, which `npm install` and the test, lint, studio and render scripts run for you.

## Per-video package layout (moved from AGENTS.md)

### Package layout, generated files and fixtures

- Personal videos are never committed. Every video is a self-contained package under `videos/<slug>/` (the whole tree is gitignored, `AIDEOS_VIDEOS_DIR` moves it anywhere, a relative value resolves against the repo root): `film.json` (authoritative manifest; see `src/dl/videoPackageLoader.ts`), `script.md`, `voiceover.wav` + `voiceover_words.json`, `footage/<shotId>.mp4` (GPU B-roll), `visuals/`, `design/`, and `renders/`. Whoever forks the repo makes their own. Only `examples/hello-scene/` (a tiny scene film, the read-only fallback when `videos/` has no packages) ships; see [videos/README.md](README.md). Never read or write a path under `videos/` directly: use `getVideosDir()`/`resolvePackageDir()`/`resolveRepoAssetPath()` from `src/dl/videoPackageLoader.ts` (or `filmStore.ts`'s `readFilm`/`writeFilm`).
- Tests never touch personal videos. `npm test` preloads `backend/testSupport/fixtureVideosDir.ts`, which points `AIDEOS_VIDEOS_DIR` at a throwaway copy of `test_fixtures/packages/` per test process (a test run on its own imports the same module first). Small canvas films for model tests are `test_fixtures/films/*.json` via `backend/testSupport/fixtureFilms.ts`. Add fixtures there, never copy a real video in.
- Generated and gitignored: `src/dl/films/<slug>.ts` (a shadow of each package's `film.json`, kept only because Remotion's CLI bundles code, not a JSON path), `src/dl/activeFilm.ts` (which shadow Remotion renders) and `src/dl/scene/assets/svgSources.generated.ts` (every package's SVGs inlined). `backend/pipeline/generatedFiles.ts`'s `ensureGenerated` rebuilds all three from the packages on disk, rewriting only what changed; `npm install` (postinstall) and the pre-hooks of `test`, `lint`, `studio`, `editor`, `render`, `smoke:studio` run it (`npm run ensure:generated`), so a fresh clone works from the example alone and a drifted shadow heals itself. Never hand-edit the shadows; write films with `backend/pipeline/filmStore.ts`'s `readFilm`/`writeFilm`/`wireFootageIntoFilm` or `editor/vite.config.ts`'s same-named helpers, which emit the identical module format. `tsconfig.json` excludes `src/dl/films` so one owner's invalid film cannot fail lint for everyone.
- `public/videos` is a tracked symlink to `../videos` (point it at `AIDEOS_VIDEOS_DIR` if you set one). Vite's own `publicDir` static serving won't follow it (its `sirv`-based middleware does a realpath containment check), so `editor/vite.config.ts` serves `/videos/*` with an explicit range-aware middleware (personal dir first, then `examples/`). `staticFile('videos/<slug>/...')` resolves through that same URL path for both the editor's Remotion `<Player>` preview and any consumer that fetches it directly.
- Also gitignored: `public/film.json`, `public/captions*.vtt`, `public/media/`, `public/*.png` (except the favicon), `src/voiceover.wav`, `.lavish/` and all `*.mp3 *.wav *.mp4 *.mov *.m4a`. Git history from before this change still holds old videos; it was deliberately not rewritten.
