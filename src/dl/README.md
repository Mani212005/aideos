<!--
File Description: Documentation for the Video Design Language implementation in Remotion, covering color tokens, typography, motion grammar, and camera continuity.
-->

# Video Design Language - implementation

Implements the Video Design Language specification across color tokens, typography, motion grammar, and camera continuity.

Compositions: **Long** (1920x1080) and **Reel** (1080x1920). For Reel cut
behavior, identity deliveries, and delivered-length limits, see the
[production pipeline reference](../../docs/PRODUCTION_PIPELINE.md#reel-cut-delivery).

| Spec section          | Here                                            |
| --------------------- | ----------------------------------------------- |
| §01 Color             | `tokens.ts` - `useTokens()`, `PALETTE` + derivation helpers |
| §02 Type              | `tokens.ts` - `SCALE`, `useLayout().type()`    |
| §03 Motion grammar    | `motion.ts` - `EXPO`, `MS`, `useEntrance`        |
| §04 Primitives        | `primitives.tsx`                                 |
| §05 Stations          | `Film.tsx` - `Stage`                             |
| §06 Camera/continuity | `camera.ts` + `CanvasGraph.tsx` / `SceneStage.tsx` |
| §07 Device library    | `devices.tsx`                                   |
| Custom SVG animation  | `scene/` - see [scene/README.md](scene/README.md)  |
| Sparse performances   | `performance/` - see [performance/README.md](performance/README.md) |
| §08 Runsheet          | `schema.ts` `superRefine` + `scripts/validate.mjs` |
| §09 Schema contract   | `schema.ts`                                      |

## The three rules that hold it together

1. **Shots reference nodes, not coordinates.** `solveCam` fits the camera to the
   bounding box of whatever a shot names. Move a node or reorder the script and
   every shot re-frames itself.
2. **Order defines stagger.** A block's index among its siblings is its only
   timing input. No block declares its own delay.
3. **Format solves framing.** Both compositions solve their framing from the
   same canvas. Checked reel cuts can derive a shorter shot list; see the
   [production pipeline reference](../../docs/PRODUCTION_PIPELINE.md#reel-cut-delivery)
   for supported film types and cut behavior.

Shot start times are *derived* from durations, so a scene cannot start before
the previous one ends - that failure mode is unrepresentable rather than
validated.

## Working on it

```bash
npm run validate        # ~2s: schema + runsheet rules, and prints the runsheet
npm run frames          # real stills from both formats -> .frames/
npm run studio          # Remotion Studio
```

`validate` enforces §08 as rules rather than advice: no device holds past
25s, never the same device twice in a row, a text beat every 60-90s, a return
to the canvas every 90s, and at most three accents in a frame.

## Adding capability

- **A new block:** add it to `blockSchema`, build it in `primitives.tsx` or
  `devices.tsx`, and wire it into `Block.tsx`. The union is exhaustive, so
  skipping the last step is a compile error rather than an empty frame.
- **A new film:** create a standalone video package under `videos/<slug>/`
  (`film.json`, `script.md`, `voiceover.wav`, `footage/`, `visuals/`),
  or copy `examples/hello-scene/`. The shadow module in `src/dl/films/<slug>.ts`
  is generated automatically by `npm run ensure:generated`.

## Deliberately not implemented

- **No shadows, no grain, no vignette.** Depth is a hairline and a lift in
  surface value.

## Known limit

A wide system map in a 9:16 frame letterboxes - the canvas is shaped as a
compromise between the two aspect ratios, but a 2.5:1 graph will always leave
vertical space in a reel. The alternative is authoring a second canvas, which
§06 rule 05 forbids.

## Owner caption cards

The shared caption geometry is `captionPlacement.ts`. Film and shot placements are optional and
independent in `long` and `reel`; absence preserves the existing bottom card with zero pixel changes.
An absent `w` keeps the legacy shrink-to-content card, including after Lock, movement or switching
to **This shot only**. The editor outline and collision checks reserve the full 86% default band.
Explicit `w` values from 0 through 1 are clamped to the format's minimum and maximum. An omitted
`w` remains auto-sized. Existing saved widths remain fixed, including an explicit width of 86%.
`captionPhrases.ts` fixes each phrase's placement at its first word and splits a narrowed card
into at most two measured lines. The font size stays fixed. The studio overlay is outside FilmView;
its drafts and the export use the same composition.
For CanvasGraph films, the design check reports that owner-positioned cards were not checked against
graph art because its 3D projection is deliberately out of scope for the collision geometry. Review
of the placed position (where Review checks the placed card) remains the safety net for CanvasGraph films;
scene-art and posed-character collision checks remain active.

In Edit, choose Wide or Reel, then **Move captions**. Drag the card body to move it and an edge handle
to resize it. **Whole film** changes that format's default; **This shot only** creates an exception
at the playhead. A drop saves one undo step. **Lock** pins the chosen entry, **Unlock** enables edits,
and **Reset** removes that entry. Resetting a shot restores the film-wide position. Studio saves are
trusted owner writes and can move locked captions; locks prevent checked agent edits and rebuilds.

Arrow keys nudge by 0.5%, Shift increases the step to 5%, Alt + Left/Right changes width, and L toggles
lock. Alt bypasses snapping during a pointer gesture. Esc cancels the current gesture.

The same `carryCaptionPlacement` helper carries an existing film's `endCard.enabled` setting
through rebuilds. Omitted settings default to enabled; Studio and `aideos end-card <slug> on|off`
are owner paths for changing it.
