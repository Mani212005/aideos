# Video Design Language — implementation

Implements the spec at
`claude.ai/design/p/1d822f99-b90c-487a-a17f-76320be74e76` → `Video Design Language.dc.html`.

Compositions: **Long** (1920×1080) and **Reel** (1080×1920). They are the
same film, not two edits of it.

| Spec section          | Here                                            |
| --------------------- | ----------------------------------------------- |
| §01 Color             | `tokens.ts` — `PALETTE` + the derivation helpers |
| §02 Type              | `tokens.ts` — `SCALE`, `useLayout().type()`    |
| §03 Motion grammar    | `motion.ts` — `EXPO`, `MS`, `useEntrance`        |
| §04 Primitives        | `primitives.tsx`                                 |
| §05 Stations          | `Film.tsx` — `Stage`                             |
| §06 Camera/continuity | `camera.ts` + `CanvasGraph.tsx`                  |
| §07 Device library    | `devices.tsx`                                    |
| §08 Runsheet          | `schema.ts` `superRefine` + `scripts/validate-dl.mjs` |
| §09 Schema contract   | `schema.ts`                                      |

## The three rules that hold it together

1. **Shots reference nodes, not coordinates.** `solveCam` fits the camera to the
   bounding box of whatever a shot names. Move a node or reorder the script and
   every shot re-frames itself.
2. **Order defines stagger.** A block's index among its siblings is its only
   timing input. No block declares its own delay.
3. **Format only scales.** Both compositions solve their framing from the same
   canvas and the same shot list. There is no per-format authoring anywhere.

Shot start times are *derived* from durations, so a scene cannot start before
the previous one ends — that failure mode is unrepresentable rather than
validated.

## Working on it

```bash
npm run validate        # ~2s: schema + runsheet rules, and prints the runsheet
npm run frames          # real stills from both formats → .frames/
npm run studio          # Remotion Studio
```

`validate` enforces §08 as rules rather than advice: no device holds past
25s, never the same device twice in a row, a text beat every 60–90s, a return
to the canvas every 90s, and at most three accents in a frame.

## Adding capability

- **A new block:** add it to `blockSchema`, build it in `primitives.tsx` or
  `devices.tsx`, and wire it into `Block.tsx`. The union is exhaustive, so
  skipping the last step is a compile error rather than an empty frame.
- **A new film:** write `films/<topic>.ts` as pure data (`import type` only —
  the validator loads it in plain Node) and point `activeFilm.ts` at it.

## Deliberately not implemented

- **No code primitive.** The spec is explicit: ideas are carried by graphs,
  vectors and distributions, never by a syntax-highlighted editor.
- **No captions.** Not part of this design language. Burned-in subtitles fight
  the panel for the same space, and every platform this ships to draws its own.
- **No shadows, no grain, no vignette.** Depth is a hairline and a lift in
  surface value.

## Known limit

A wide system map in a 9:16 frame letterboxes — the canvas is shaped as a
compromise between the two aspect ratios, but a 2.5:1 graph will always leave
vertical space in a reel. The alternative is authoring a second canvas, which
§06 rule 05 forbids.
