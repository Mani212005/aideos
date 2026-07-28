# aideos

Explainer video generated from data. A film is a **canvas** (a graph of labelled
nodes) plus a **shot list** (where the camera looks, and for how long). Remotion
renders it. There is one engine and one film format; both aspect ratios are the
same film.

## Commands

```bash
npm run studio      # Remotion Studio — the editing surface
npm run editor      # Vite + React visual interactive editor (runs on localhost:3000)
npm run validate    # ~2s: schema + pacing rules, prints the runsheet
npm run frames      # 17 real stills from both formats → .frames/
npm run render      # Long (1920×1080) → out/long.mp4
npm run render:reel # Reel (1080×1920) → out/reel.mp4
npm run lint        # eslint + tsc --noEmit
```

**Run `npm run validate` after touching a film.** It catches pacing and
reference errors in two seconds instead of after a twenty-minute render.

## Layout

```
src/
  index.ts          registerRoot
  Root.tsx          the two compositions: Long and Reel
  dl/
    tokens.ts       §01 colour, §02 type, format-aware layout
    motion.ts       §03 easing, durations, entrance/stagger hooks
    schema.ts       §09 the film contract + §08 pacing rules
    camera.ts       §06 camera solver, edge geometry, timeline (pure, no React)
    primitives.tsx  §04 text, stats, plots
    devices.tsx     §07 the device library
    CanvasGraph.tsx §06 the canvas: nodes, edges, arrival states
    Film.tsx        §05 panels, stage, chapter rail
    Block.tsx       block union → component
    films/          film data (pure data, `import type` only)
    activeFilm.ts   which film renders
    runtime.ts      parses the film at module scope; Studio props
scripts/
  validate.mjs      film validator + runsheet
  frames.mjs        proof stills
```

Section numbers (§NN) refer to the design-language spec this implements. See
`src/dl/README.md` for the full mapping and the rules in prose.

## The invariants

These are what the code is *for*. Breaking one means the design falls apart, so
prefer failing loudly over working around them.

1. **Shots reference nodes, not coordinates.** `solveCam` fits the camera to the
   bounding box of whatever a shot names. Move a node or reorder the script and
   every shot re-frames itself. Never write a pixel position into a shot.
2. **Order defines stagger.** A block's index among its siblings is its only
   timing input. No block declares its own delay.
3. **Format only scales.** Both compositions solve from the same canvas and the
   same shot list. There is no per-format authoring anywhere — if you find
   yourself adding `if (format === "reel")` to a film, the layout is wrong.
4. **Shot starts are derived, never authored.** Only `dur` exists. A shot that
   begins before the previous one ends is unrepresentable rather than validated.
5. **One accent colour.** Everything else is greyscale plus opacity. Three
   accents in a frame is a validation error, not a style choice.

## Working on it

**Adding a block:** add it to `blockSchema` in `dl/schema.ts`, build it in
`primitives.tsx` or `devices.tsx`, wire it into `Block.tsx`. The union is
exhaustive, so skipping the last step is a compile error rather than an empty
frame at minute nine.

**Adding a film:** write `dl/films/<topic>.ts` and point `activeFilm.ts` at it.
Film modules must stay **pure data with `import type` only** — the validator
loads them in plain Node with no React, no fonts and no browser, so a single
runtime import breaks `npm run validate`.

**Audio:** drop a file into `public/` and type its filename in the Studio props
panel. Media in `public/` is gitignored on purpose — it is large, and licensed
tracks should not be redistributed with the code.

## Conventions

- Comments explain *why*, not what. Match the existing density — it is high, and
  deliberately so: most of this code encodes a design decision that is not
  recoverable from reading the mechanics.
- `dl/camera.ts` and `dl/films/*` are pure and must import nothing at runtime.
- Do not add captions, code blocks, drop shadows, grain or vignettes. The spec
  excludes them; depth is a hairline and a lift in surface value.
- Don't leave `showGrid` on in a render.
