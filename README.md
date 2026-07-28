# aideos

Explainer video as data.

A film is a **canvas** — a graph of labelled nodes — and a **shot list** saying
where the camera looks and for how long. Everything else is derived: layout,
timing, stagger, framing, and both aspect ratios.

```ts
{
  id: "cache", dur: 18, look: "cache", move: "pan", stage: "anchor",
  blocks: [
    { c: "TextReveal", size: "headline", text: "Keep the grid. That is the cache." },
    { c: "MatrixGrid", values: [...], sweep: "row" },
  ],
}
```

That shot knows nothing about pixels. It names a node, and the camera solves its
own framing — so moving a node or reordering the script re-frames every shot
that referenced it, in both formats, with no further edits.

## Two formats, one film

`Long` (1920×1080) and `Reel` (1080×1920) are not two edits. They solve from the
same canvas and the same shot list; the reel simply gives the camera a narrower
viewport to fit into. There is no per-format authoring anywhere in the project.

## Quick start

```bash
npm install
npm run validate    # check the film and print its runsheet (~2s)
npm run studio      # open Remotion Studio
```

`validate` prints the film as a runsheet before you spend twenty minutes
rendering it:

```
✓ kvcache — valid
  18 shots · 7 nodes · 9 edges
  03:36 · 6480 frames @ 30fps · 4 chapters

  00:00  ch1  cut        8s ░░░░          open        beat        → tokens
  00:08  ch1  zoom-in   14s ▓▓▓▓▓▓▓       strip       TokenStrip  → tokens
  00:22  ch1  zoom-out   6s ███           spine-1     spine       → tokens+attend+kv
  …
  █ spine  ▓ device  ░ beat
```

It also enforces pacing as **rules rather than advice** — no device holds past
25s, never the same device twice in a row, a text beat at least every 90s, a
return to the canvas at least every 90s, and at most three accents in a frame.
A film that breaks one of these fails with a field path.

## Rendering

```bash
npm run render        # → out/long.mp4
npm run render:reel   # → out/reel.mp4
npm run frames        # 17 proof stills from both formats → .frames/
```

## Writing a film

Films are pure data in `src/dl/films/`. Point `src/dl/activeFilm.ts` at one.

```
canvas   nodes + edges, laid out once, left to right
shots    what the camera looks at, in order, with durations only
blocks   what appears on the panel at each stop
```

Starts are derived from durations, so a shot cannot begin before the previous
one ends. The device library — matrices, distributions, token strips, attention
arcs, vector spaces, layer stacks, scale bars, plots — lives in
`src/dl/devices.tsx`.

Audio goes in `public/` and is named in the Studio props panel. Media files are
gitignored: they are large, and licensed tracks should not ship with the code.

## Documentation

- `CLAUDE.md` — invariants, conventions, and how to extend the engine
- `src/dl/README.md` — the design-language spec mapped section by section

Built with [Remotion](https://remotion.dev), which requires a company licence
for some organisations — see its
[terms](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).
