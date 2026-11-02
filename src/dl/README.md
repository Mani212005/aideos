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
An absent `w` keeps the legacy shrink-to-content card, including after Lock or movement. Collision checks
reserve the full 86% default band; the Studio selection ring hugs the card that was actually rendered.
Explicit `w` values from 0 through 1 are clamped to the format's minimum and maximum. An omitted
`w` remains auto-sized. Existing saved widths remain fixed, including an explicit width of 86%.
`captionPhrases.ts` fixes each phrase's placement at its first word and splits a narrowed card
into at most two measured lines. The font size stays fixed. The studio overlay is outside FilmView;
its drafts and the export use the same composition.
For CanvasGraph films, the design check reports that owner-positioned cards were not checked against
graph art because its 3D projection is deliberately out of scope for the collision geometry. Review
of the placed position (where Review checks the placed card) remains the safety net for CanvasGraph films;
scene-art and posed-character collision checks remain active.

In Edit, choose Wide or Reel and click the captions in the preview (or the toolbar **Captions** button).
The captions are an object, not a mode: hovering draws a ring, a click selects them (pausing first if the
video is playing) and rings the whole rendered card with a handle on each side, and a drag moves them.
A click on empty video deselects, and Esc does too. One position applies to the whole video in that format;
Wide and Reel keep independent positions and **Copy to Wide** / **Copy to Reel** writes one to the other. A drop saves one
undo step. Snap guides and the unsafe areas of the frame appear only while dragging, snapping within 6 screen
pixels; hold Alt to bypass. An auto-width card can move sideways only as far as its reserved band allows
(up and down are free), and the strip says so: narrow the card with its side handles to move it sideways.
The strip under the preview also offers **Center**, **Default position** (back to the bottom position and
automatic width), **Lock** and, when a shot has its own position written by an agent, **Follow whole video**.
The Studio no longer creates per-shot positions; existing ones still render and can be cleared. **Lock** only
stops checked agent edits and rebuilds: Studio saves are trusted owner writes, so you can still drag a
locked caption.

Tab focuses the captions and Enter selects them. Arrow keys nudge by 0.5% (bursts merge into one undo
step), Shift increases the step to 5%, Alt + Left/Right changes width, and L toggles lock. Esc cancels
a drag. Touch uses the same path: tap selects, a press and move drags after a 4 px slop.
Captions are measured with `@remotion/layout-utils` `measureText`, the same measurer the renderer uses.

The same `carryCaptionPlacement` helper carries an existing film's legacy `endCard` entry
through rebuilds. The end card is compulsory on every delivered video (turning it off is refused;
see [Compulsory finishing steps](../../docs/WORKFLOW.md#compulsory-finishing-steps-every-video)).
